import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomic, readJson, now, fail, errorData, envelope, failure, digest, processIdentity, closeProcess, safeEnvironment, harnessConfig, gitSnapshot, redact } from './common.mjs';
import { directory, Journal } from './store.mjs';
import { adapterFor } from './adapters/index.mjs';

export async function supervise(id) {
  process.umask(0o077);
  const dir = directory(id); const owner = path.join(dir, 'supervisor.lock');
  try { fs.mkdirSync(owner, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') return; throw e; }
  const request = readJson(path.join(dir, 'request.json')); const cfg = request.profile || harnessConfig(request.harness);
  const journal = new Journal(dir, cfg); const stateFile = path.join(dir, 'state.json');
  let state = { job_id: id, status: 'starting', harness: request.harness, cwd: request.cwd, role: request.role, requested_model: request.harness_options.model || cfg.model || (request.harness === 'pi' ? 'gpt-5.6-luna' : null), provider: request.harness === 'pi' ? request.harness_options.provider || cfg.provider || 'openai-codex' : 'grok', created_at: request.created_at, started_at: now(), supervisor: processIdentity(), revision: 0 };
  const save = patch => { state = { ...state, ...patch, revision: state.revision + 1, last_event_seq: journal.seq }; atomic(stateFile, state); };
  const session = value => save({ session: { ...value, config_identity: request.config_identity } });
  let child, server, connected, deadline, stopTimer, outcome, error, stopping;
  const connections = new Set(); const controls = new Map(); let queue = Promise.resolve(); let accepting = true;
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const markStop = reason => {
    if (stopping || !accepting) return;
    stopping = reason; save({ status: 'cancelling', stop_requested: reason });
    stopTimer = setTimeout(() => { void closeProcess(child).catch(() => {}); }, 3000);
  };
  const handle = async input => {
    const { action, message, request_key } = input;
    if (!['cancel', 'steer', 'follow_up'].includes(action) || typeof request_key !== 'string' || request_key.length > 160) throw fail('INVALID_REQUEST', 'Invalid control');
    const hash = digest({ action, message });
    if (controls.has(request_key)) {
      const prior = controls.get(request_key);
      if (prior.digest !== hash) throw fail('IDEMPOTENCY_CONFLICT', 'Control key reused with different input');
      return prior.response;
    }
    if (!accepting) throw fail('JOB_TERMINAL', 'Job is finalizing');
    if (!connected && action !== 'cancel') throw fail('JOB_STARTING', 'Harness is not ready');
    if (connected && !connected.capabilities[action]) throw fail('UNSUPPORTED_CAPABILITY', `${request.harness} does not support ${action}`);
    if (controls.size >= 128) throw fail('CONTROL_LIMIT', 'A job accepts at most 128 distinct controls');
    if (action !== 'cancel' && (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 65536)) throw fail('INVALID_REQUEST', 'Invalid message');
    const record = { request_key, digest: hash, action, at: now() };
    fs.appendFileSync(path.join(dir, 'controls.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
    if (action === 'cancel') markStop('cancelled');
    let response;
    try { if (connected) await connected[action](message); response = { accepted: true, action, request_key, delivery: connected ? 'sent' : 'stop_before_prompt' }; }
    catch (e) { response = { accepted: false, action, request_key, delivery: e.code === 'DELIVERY_UNKNOWN' ? 'unknown' : 'failed', error: errorData(e) }; }
    controls.set(request_key, { digest: hash, response });
    fs.appendFileSync(path.join(dir, 'controls.jsonl'), JSON.stringify({ ...record, response }) + '\n', { mode: 0o600 });
    return response;
  };
  save({}); const before = gitSnapshot(request.cwd);
  try {
    const adapter = adapterFor(request.harness); const launch = adapter.prepare(request, cfg, dir);
    child = spawn(cfg.binary, launch.args, { cwd: request.cwd, env: { ...safeEnvironment(cfg.allow_env), ...launch.env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', () => {});
    child.delegationIdentity = child.pid ? processIdentity(child.pid) : null;
    save({ child: child.delegationIdentity, tools: launch.tools });
    server = net.createServer(socket => {
      connections.add(socket); socket.on('close', () => connections.delete(socket)); socket.on('error', () => {});
      socket.setTimeout(17000, () => socket.destroy()); let buffer = ''; let handled = false;
      socket.on('data', chunk => {
        if (handled) return; buffer += chunk;
        if (Buffer.byteLength(buffer) > 70000) return socket.destroy();
        const end = buffer.indexOf('\n'); if (end < 0) return; handled = true;
        let input; try { input = JSON.parse(buffer.slice(0, end)); } catch { socket.end(JSON.stringify(failure(fail('INVALID_REQUEST', 'Invalid JSON'))) + '\n'); return; }
        serial(() => handle(input)).then(data => socket.end(JSON.stringify(envelope(data)) + '\n'), e => socket.end(JSON.stringify(failure(e)) + '\n'));
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path.join(dir, 'control.sock'), resolve); });
    fs.chmodSync(path.join(dir, 'control.sock'), 0o600);
    connected = await adapter.connect(child, { request, tools: launch.tools, native_home: launch.native_home, session, settling: () => { accepting = false; }, event: (...args) => journal.event(...args), native: record => journal.native(record), stderr: chunk => journal.stderr(chunk) });
    if (stopping) throw fail('CANCELLED_BEFORE_PROMPT', 'Cancelled during initialization');
    save({ status: 'running', capabilities: connected.capabilities });
    deadline = setTimeout(() => {
      void serial(async () => { if (!accepting) return; markStop('timed_out'); try { await connected.cancel(); } catch {} });
    }, request.timeout_seconds * 1000);
    const prompt = `You are an external ${request.harness} ${request.role}. Work only on the bounded task.\n${request.role === 'worker' ? 'Only modify the authorized scope. Do not commit, merge, or push unless explicitly requested.' : 'Read-only: do not modify files, execute writes, commit, or push.'}\nWrite scope: ${JSON.stringify(request.write_scope)}\nNo-touch scope: ${JSON.stringify(request.no_touch_scope)}\nAcceptance: ${JSON.stringify(request.acceptance)}\n\n${request.task}`;
    outcome = await connected.run(prompt);
    await serial(() => { accepting = false; save({ status: 'finalizing' }); });
  } catch (e) { error = e; await serial(() => { accepting = false; }); }
  finally {
    clearTimeout(deadline); clearTimeout(stopTimer); accepting = false;
    for (const socket of connections) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    const cleanup = await closeProcess(child).catch(e => ({ stopped: false, error: e.message }));
    if (!cleanup.stopped) error = fail('CLEANUP_FAILED', 'Harness process could not be stopped');
    if (outcome?.session) session(outcome.session);
    const status = stopping || (error ? 'failed' : outcome?.native_cancelled ? 'cancelled' : 'completed');
    journal.event('job.terminal', { status }, true);
    const finalText = redact(outcome?.text || '');
    fs.writeFileSync(path.join(dir, 'result.md'), finalText, { mode: 0o600 });
    const receipt = { ...state, status, finished_at: now(), model: outcome?.model ?? state.requested_model, final_text_path: path.join(dir, 'result.md'), text_truncated: !!outcome?.text_truncated, native_stop_reason: outcome?.native_stop_reason ?? null, evidence: outcome?.evidence ?? null, usage: outcome?.usage ?? null, error: error ? errorData(error) : null, cleanup, execution_may_continue: !cleanup.stopped, git_before: before, git_after: gitSnapshot(request.cwd), log_truncated: journal.truncated, last_event_seq: journal.seq };
    atomic(path.join(dir, 'receipt.json'), JSON.parse(redact(receipt))); atomic(stateFile, JSON.parse(redact(receipt)));
    try { fs.unlinkSync(path.join(dir, 'control.sock')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) supervise(process.argv[2]).catch(() => { process.exitCode = 1; });
