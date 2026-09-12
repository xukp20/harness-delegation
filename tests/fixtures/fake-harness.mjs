#!/usr/bin/env node
import readline from 'node:readline';
import fs from 'node:fs';
const grok = process.argv.includes('stdio');
const mode = process.env.FAKE_MODE || 'normal';
const delay = Number(process.env.FAKE_DELAY || 150);
if (process.argv.includes('--version')) { console.log(grok ? '1.0.30' : 'fake-harness 1.0.0'); process.exit(0); }
const messages = [{ role: 'assistant', content: [{ type: 'text', text: 'HISTORICAL_WRONG' }] }];
const sessionFile = process.argv.includes('--session') ? process.argv[process.argv.indexOf('--session') + 1] : '/tmp/fake-session.jsonl';
let timer, promptId;
const emit = item => process.stdout.write(JSON.stringify(item) + '\n');
const piReply = (r, data = {}) => emit({ type: 'response', id: r.id, command: r.type, success: true, data });
const acpReply = (r, result = {}) => emit({ jsonrpc: '2.0', id: r.id, result });
function finish(cancelled = false) {
  if (mode === 'ignore' && cancelled) return;
  if (mode === 'malformed') { process.stdout.write('not-json\n'); return; }
  if (mode === 'crash') { process.exit(7); }
  if (grok) {
    emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'grok-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'FAKE_GROK_DONE' } } } });
    emit({ jsonrpc: '2.0', method: '_x.ai/private', params: { safe: true } });
    acpReply({ id: promptId }, { stopReason: cancelled ? 'cancelled' : mode === 'error' ? 'refusal' : 'end_turn' });
  } else {
    if (mode !== 'empty') messages.push({ role: 'assistant', stopReason: mode === 'error' ? 'error' : cancelled ? 'aborted' : 'stop', content: [{ type: 'text', text: 'FAKE_PI_DONE' }], ...(mode === 'error' ? { errorMessage: 'fixture model failure' } : {}) });
    emit({ type: 'agent_settled' });
  }
}
if (mode === 'ignore') process.on('SIGTERM', () => {});
readline.createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line);
  if (grok) {
    if (r.method === 'initialize') acpReply(r, { protocolVersion: 1, agentCapabilities: { loadSession: mode !== 'no-resume' }, _meta: { agentVersion: '1.0.30' } });
    else if (r.method === 'session/new') { emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'grok-session', update: { sessionUpdate: 'available_commands_update', _meta: { tools: ['read_file', 'list_dir', 'grep'] } } } }); acpReply(r, { sessionId: 'grok-session' }); }
    else if (r.method === 'session/load') {
      emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'grok-session', update: { sessionUpdate: 'available_commands_update', _meta: { tools: ['read_file', 'list_dir', 'grep'] } } } });
      emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'grok-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'HISTORICAL_WRONG' } } } }); acpReply(r);
    } else if (r.method === 'session/prompt') {
      promptId = r.id;
      if (mode === 'permission') emit({ jsonrpc: '2.0', id: 'permission', method: 'session/request_permission', params: { sessionId: 'grok-session', toolCall: { kind: 'execute' }, options: [{ kind: 'allow_once', optionId: 'yes' }, { kind: 'reject_once', optionId: 'no' }] } });
      timer = setTimeout(() => finish(), delay);
    } else if (r.method === 'session/cancel') { if (mode !== 'ignore') { clearTimeout(timer); finish(true); } }
    else if (r.id === 'permission' && r.result?.outcome?.optionId !== 'no') process.exit(23);
  } else {
    if (r.type === 'get_state') piReply(r, { sessionId: 'pi-session', sessionFile, isStreaming: false, isCompacting: false });
    else if (r.type === 'get_messages') piReply(r, { messages });
    else if (r.type === 'get_session_stats') piReply(r, { tokens: { input: 10, output: 2 }, cost: 0 });
    else if (r.type === 'prompt') { piReply(r); messages.push({ role: 'user', content: r.message }); if (mode === 'flood') { process.stderr.write('x'.repeat(20000)); for (let i = 0; i < 500; i++) emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x'.repeat(500) } }); } timer = setTimeout(() => finish(), delay); }
    else if (r.type === 'abort') { piReply(r); if (mode !== 'ignore') { clearTimeout(timer); finish(true); } }
    else piReply(r);
  }
});
