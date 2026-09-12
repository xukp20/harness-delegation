import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Wire } from '../wire.mjs';
import { fail } from '../common.mjs';

export const capabilities = { start: true, cancel: true, resume: true, steer: true, follow_up: true, interaction: false };
export const readTools = ['read', 'grep', 'find', 'ls'];
export function prepare(request, cfg, dir) {
  const opts = request.harness_options;
  const sessions = path.join(path.dirname(path.dirname(dir)), 'sessions', 'pi');
  fs.mkdirSync(sessions, { recursive: true, mode: 0o700 });
  const tools = opts.tools ?? (request.role === 'worker' ? [...readTools, 'bash', 'edit', 'write'] : readTools);
  if (request.role !== 'worker' && tools.some(t => !readTools.includes(t))) throw fail('PERMISSION_DENIED', 'Read-only Pi roles cannot enable writing or shell tools');
  const args = ['--mode', 'rpc', '--provider', opts.provider || cfg.provider || 'openai-codex', '--model', opts.model || cfg.model || 'gpt-5.6-luna', '--thinking', opts.thinking || cfg.thinking || 'high', '--session-dir', sessions, '--no-extensions', '--no-skills', '--no-prompt-templates'];
  if (tools.length) args.push('--tools', tools.join(',')); else args.push('--no-tools');
  if (request.session) args.push('--session', request.session.locator.session_file);
  else args.push('--session-id', crypto.randomUUID());
  return { args, env: {}, tools };
}
export async function connect(child, context) {
  const wire = new Wire(child, record => context.native(record), chunk => context.stderr(chunk));
  const command = async (type, payload = {}) => {
    const response = await wire.request({ type, ...payload });
    if (response.type !== 'response' || response.command !== type || response.success !== true) throw fail('HARNESS_ERROR', response.error || `Invalid Pi response: ${type}`);
    return response.data;
  };
  let resolveSettled, rejectSettled; let active = false; let currentAssistant;
  const settled = new Promise((resolve, reject) => { resolveSettled = resolve; rejectSettled = reject; });
  settled.catch(() => {});
  wire.on('closed', rejectSettled);
  wire.on('record', record => {
    if (active && record.type === 'message_end' && record.message?.role === 'assistant') currentAssistant = record.message;
    if (active && record.type === 'agent_settled') { context.settling?.(); resolveSettled(); }
    if (record.type === 'message_update') {
      const event = record.assistantMessageEvent;
      if (event?.type === 'text_delta') context.event('text.delta', { text: event.delta?.slice(0, 8192) });
    }
    if (record.type === 'tool_execution_start') context.event('tool.started', { name: record.toolName, native_id: record.toolCallId });
  });
  const state = await command('get_state');
  const initialMessages = (await command('get_messages'))?.messages || [];
  context.session({ harness: 'pi', native_id: state?.sessionId, locator: { session_file: state?.sessionFile }, cwd: context.request.cwd });
  return {
    capabilities,
    async run(prompt) {
      active = true; await command('prompt', { message: prompt }); await settled;
      const final = await command('get_state');
      if (final?.isStreaming || final?.isCompacting) throw fail('PROTOCOL_ERROR', 'Pi settled while still busy');
      const messages = ((await command('get_messages'))?.messages || []).slice(initialMessages.length);
      const assistant = currentAssistant || messages.filter(m => m.role === 'assistant').at(-1);
      if (!assistant) throw fail('RESULT_UNAVAILABLE', 'Pi settled without an assistant response for this job');
      const stats = await command('get_session_stats');
      const stop = assistant?.stopReason;
      if (stop === 'error' || assistant?.errorMessage) throw fail('HARNESS_ERROR', assistant.errorMessage || 'Pi model error');
      const text = typeof assistant?.content === 'string' ? assistant.content : (assistant?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      return { text, native_stop_reason: stop || null, native_cancelled: stop === 'aborted', usage: { scope: 'session', tokens: stats?.tokens ?? null, cost: stats?.cost ?? null }, evidence: 'agent_settled + idle get_state + current messages', session: { harness: 'pi', native_id: final?.sessionId, locator: { session_file: final?.sessionFile }, cwd: context.request.cwd } };
    },
    cancel: () => command('abort'),
    steer: message => command('steer', { message }),
    follow_up: message => command('follow_up', { message }),
  };
}
