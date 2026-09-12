import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wire } from '../wire.mjs';
import { fail, rootDir, digest } from '../common.mjs';

export const capabilities = { start: true, cancel: true, resume: true, steer: false, follow_up: false, interaction: false };
const READ_TOOLS = ['read_file', 'list_dir', 'grep'];
export function prepare(request, cfg, dir) {
  // Native authentication stays in its original store. The link is a reference,
  // not a copy; no credential is read or placed in the launch request.
  const configuredHome = cfg.home || path.join(os.homedir(), '.grok');
  const authHome = fs.existsSync(configuredHome) ? fs.realpathSync(configuredHome) : path.resolve(configuredHome);
  const home = path.join(rootDir(), 'native', 'grok', digest(authHome).slice(0, 20));
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  if (request.session && request.session.locator.grok_home !== home) throw fail('SESSION_MISMATCH', 'Grok session belongs to a different native Home');
  const auth = path.join(authHome, 'auth.json');
  if (fs.existsSync(auth) && !fs.existsSync(path.join(home, 'auth.json'))) {
    try { fs.symlinkSync(auth, path.join(home, 'auth.json')); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const isolatedHome = path.join(rootDir(), 'native', 'home');
  fs.mkdirSync(isolatedHome, { recursive: true, mode: 0o700 });
  // Native project configuration can launch hooks/MCP before a model turn.
  for (let cwd = request.cwd; ; cwd = path.dirname(cwd)) {
    for (const name of ['.grok/config.toml', '.grok/hooks', '.grok/plugins', '.mcp.json', '.claude/settings.json', '.claude/settings.local.json', '.cursor/mcp.json']) {
      if (fs.existsSync(path.join(cwd, name))) throw fail('PROJECT_CONFIG_UNSUPPORTED', `Grok v1 requires a workspace without executable native configuration: ${path.join(cwd, name)}`);
    }
    if (path.dirname(cwd) === cwd) break;
  }
  const tools = request.harness_options.tools ?? (request.role === 'worker' ? [...READ_TOOLS, 'run_terminal_cmd', 'search_replace'] : READ_TOOLS);
  if (!tools.length) throw fail('UNSUPPORTED_CAPABILITY', 'Grok 1.0.30 rejects an empty curated toolset; use the read-only tools profile');
  const allowed = request.role === 'worker' ? [...READ_TOOLS, 'run_terminal_cmd', 'search_replace'] : READ_TOOLS;
  if (tools.some(t => !allowed.includes(t))) throw fail('PERMISSION_DENIED', 'Unsupported Grok tool for this role');
  const profile = { name: 'harness-delegation', description: 'Bounded external task', discoverSkills: false, inheritSkills: false, agentsMd: true, injectDefaultTools: false, toolConfig: { tools: tools.map(id => ({ id: `GrokBuild:${id}` })) }, mcpInheritance: 'none', disallowedTools: ['Agent', 'Task', 'task', 'workflow', 'monitor', 'scheduler_create'], background: false };
  const profilePath = path.join(dir, 'grok-profile.md');
  fs.writeFileSync(profilePath, `---\n${JSON.stringify(profile)}\n---\nWork only on the delegated task. Do not start background processes or subagents.\n`, { mode: 0o600 });
  const args = ['agent', '--no-leader', '--agent-profile', profilePath];
  if (request.harness_options.model || cfg.model) args.push('--model', request.harness_options.model || cfg.model);
  if (request.harness_options.thinking || cfg.thinking) args.push('--reasoning-effort', request.harness_options.thinking || cfg.thinking);
  args.push('stdio');
  return { args, env: { HOME: isolatedHome, GROK_HOME: home, GROK_DISABLE_AUTOUPDATER: '1' }, native_home: home, tools };
}
export async function connect(child, context) {
  const wire = new Wire(child, record => context.native(record), chunk => context.stderr(chunk));
  let sessionId; let text = ''; let usage = null; let textTruncated = false; let observedTools;
  const request = async (method, params, timeout) => {
    const response = await wire.request({ jsonrpc: '2.0', method, params }, timeout);
    if (response.error) throw fail('HARNESS_ERROR', response.error.message || `Grok ${method} failed`);
    if (!('result' in response)) throw fail('PROTOCOL_ERROR', `Missing ACP result: ${method}`);
    return response.result;
  };
  wire.on('record', record => {
    if (record.method === 'session/update' && Array.isArray(record.params?.update?._meta?.tools)) observedTools = record.params.update._meta.tools;
    if (record.method && record.id !== undefined) {
      if (record.method === 'session/request_permission') {
        const options = record.params?.options || [];
        // Preauthorized worker profile permits its declared tools; read-only
        // profiles only allow explicit read operations. Unknown requests deny.
        const kind = record.params?.toolCall?.kind;
        const allowed = record.params?.sessionId === sessionId && (['read', 'search'].includes(kind) || (context.request.role === 'worker' && ['edit', 'execute'].includes(kind)));
        const choice = options.find(o => o.kind === (allowed ? 'allow_once' : 'reject_once'));
        const outcome = choice ? { outcome: 'selected', optionId: choice.optionId } : { outcome: 'cancelled' };
        wire.write({ jsonrpc: '2.0', id: record.id, result: { outcome } });
        context.event('permission.decision', { allowed: !!allowed && !!choice, kind: kind || null });
      } else {
        wire.write({ jsonrpc: '2.0', id: record.id, error: { code: -32601, message: 'Client interaction is not supported by Harness Delegation' } });
        context.event('interaction.unsupported', { method: record.method });
      }
    }
    if (record.method !== 'session/update' || record.params?.sessionId !== sessionId) return;
    const update = record.params.update;
    if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      text += update.content.text;
      if (Buffer.byteLength(text) > 1024 * 1024) { textTruncated = true; text = text.slice(-512 * 1024); }
      context.event('text.delta', { text: update.content.text.slice(0, 8192) });
    } else if (update?.sessionUpdate === 'usage_update') usage = update;
    else if (update?.sessionUpdate === 'tool_call') context.event('tool.started', { name: update.title, native_id: update.toolCallId });
  });
  const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'harness-delegation', version: '0.2.0' } });
  if (init.protocolVersion !== 1) throw fail('UNSUPPORTED_PROTOCOL', 'Grok must negotiate ACP v1');
  if (init._meta?.agentVersion !== '1.0.30') throw fail('UNSUPPORTED_VERSION', 'Grok adapter requires validated version 1.0.30');
  const params = { cwd: context.request.cwd, mcpServers: [] };
  if (context.request.session) {
    if (!init.agentCapabilities?.loadSession) throw fail('UNSUPPORTED_CAPABILITY', 'Grok did not advertise session/load');
    sessionId = context.request.session.native_id;
    await request('session/load', { ...params, sessionId });
  } else sessionId = (await request('session/new', params)).sessionId;
  if (typeof sessionId !== 'string' || !sessionId) throw fail('PROTOCOL_ERROR', 'Grok did not return a session ID');
  if (context.tools && (!observedTools || observedTools.some(t => !context.tools.includes(t)) || context.tools.some(t => !observedTools.includes(t)))) throw fail('TOOL_PROFILE_MISMATCH', 'Grok did not report the exact configured tools');
  const session = { harness: 'grok', native_id: sessionId, locator: { grok_home: context.native_home }, cwd: context.request.cwd };
  context.session(session);
  // Ignore historical updates replayed by session/load.
  text = ''; usage = null; textTruncated = false;
  return {
    capabilities: { ...capabilities, resume: !!init.agentCapabilities?.loadSession },
    async run(prompt) {
      const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] }, (context.request.timeout_seconds + 20) * 1000);
      if (!['end_turn', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason)) throw fail('PROTOCOL_ERROR', `Unknown ACP stopReason: ${result.stopReason}`);
      if (result.stopReason !== 'end_turn' && result.stopReason !== 'cancelled') throw fail('HARNESS_STOPPED', `Grok stopped: ${result.stopReason}`);
      context.settling?.();
      return { text, text_truncated: textTruncated, session, model: result._meta?.modelId || null, native_stop_reason: result.stopReason, native_cancelled: result.stopReason === 'cancelled', usage: result._meta?.usage ? { scope: 'turn', source: 'x.ai prompt response metadata', native: result._meta.usage } : usage ? { scope: 'session', native: usage } : null, evidence: 'ACP session/prompt response; verified exact tool profile excludes native subagents' };
    },
    cancel: async () => { wire.write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); return { delivered: true, acknowledged: false }; },
  };
}
