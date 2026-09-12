import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atomic, readJson, rootDir, fail, now, digest, terminal, sleep, alive, groupAlive, harnessConfig, safeEnvironment, readText, gitSnapshot } from './common.mjs';
import { directory, transaction, ids, snapshot, readEvents } from './store.mjs';
import { adapterFor, doctor } from './adapters/index.mjs';

const supervisorPath = fileURLToPath(new URL('./supervisor.mjs', import.meta.url));
const stringList = x => Array.isArray(x) && x.length <= 100 && x.every(v => typeof v === 'string' && v.length <= 2048);
export function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_REQUEST', 'Expected a request object');
  const allowed = ['harness', 'cwd', 'role', 'task', 'write_scope', 'no_touch_scope', 'acceptance', 'timeout_seconds', 'harness_options', 'request_key', 'session', 'resume_from_job_id'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw fail('INVALID_REQUEST', `Unknown request field: ${key}`);
  adapterFor(input.harness);
  if (typeof input.cwd !== 'string' || !path.isAbsolute(input.cwd) || !fs.statSync(input.cwd, { throwIfNoEntry: false })?.isDirectory()) throw fail('INVALID_REQUEST', 'cwd must be an existing absolute directory');
  if (typeof input.task !== 'string' || !input.task.trim() || Buffer.byteLength(input.task) > 65536) throw fail('INVALID_REQUEST', 'task must contain 1..65536 bytes');
  const role = input.role || 'reviewer';
  if (!['explorer', 'reviewer', 'worker'].includes(role)) throw fail('INVALID_REQUEST', 'Invalid role');
  for (const field of ['write_scope', 'no_touch_scope', 'acceptance']) if (input[field] !== undefined && !stringList(input[field])) throw fail('INVALID_REQUEST', `${field} must be a bounded string array`);
  if (role === 'worker' && !input.write_scope?.length) throw fail('INVALID_REQUEST', 'worker requires explicit write_scope');
  if (role !== 'worker' && input.write_scope?.length) throw fail('INVALID_REQUEST', 'Read-only roles cannot declare write_scope');
  const timeout = input.timeout_seconds ?? 3600;
  if (!Number.isFinite(timeout) || timeout < 0.1 || timeout > 86400) throw fail('INVALID_REQUEST', 'timeout_seconds must be 0.1..86400');
  if (input.request_key !== undefined && (typeof input.request_key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(input.request_key))) throw fail('INVALID_REQUEST', 'Invalid request_key');
  const options = input.harness_options || {};
  if (typeof options !== 'object' || Array.isArray(options)) throw fail('INVALID_REQUEST', 'harness_options must be an object');
  for (const [key, value] of Object.entries(options)) {
    if (!['model', 'provider', 'thinking', 'tools'].includes(key)) throw fail('INVALID_REQUEST', `Unsupported harness option: ${key}`);
    if (key === 'provider' && input.harness !== 'pi') throw fail('INVALID_REQUEST', 'provider is Pi-specific');
    if (key === 'tools' ? !stringList(value) : typeof value !== 'string' || value.length > 200 || value.startsWith('-')) throw fail('INVALID_REQUEST', `Invalid harness option: ${key}`);
  }
  return { harness: input.harness, cwd: fs.realpathSync(input.cwd), role, task: input.task.trim(), write_scope: input.write_scope || [], no_touch_scope: input.no_touch_scope || [], acceptance: input.acceptance || [], timeout_seconds: timeout, harness_options: options, ...(input.request_key ? { request_key: input.request_key } : {}), ...(input.session ? { session: input.session } : {}), ...(input.resume_from_job_id ? { resume_from_job_id: input.resume_from_job_id } : {}) };
}
function reconcile(id) {
  const state = snapshot(id);
  if (state.status === 'lost' && state.execution_may_continue && !groupAlive(state.child)) return { ...state, execution_may_continue: false, cleanup: { stopped: true, reconciled: true } };
  if (terminal(state.status)) return state;
  // A just-spawned supervisor may not have written its identity yet.
  if (!state.supervisor && Date.now() - Date.parse(state.created_at) < 15000) return state;
  if (alive(state.supervisor)) return state;
  const mayContinue = groupAlive(state.child);
  const lost = { ...state, status: 'lost', finished_at: now(), error: { code: 'SUPERVISOR_LOST', message: 'Supervisor is no longer alive; native execution is not replayed' }, execution_may_continue: mayContinue, cleanup: { stopped: !mayContinue } };
  atomic(path.join(directory(id), 'receipt.json'), lost); atomic(path.join(directory(id), 'state.json'), lost);
  return lost;
}
export async function start(input, { internal = false } = {}) {
  if (process.platform !== 'linux') throw fail('UNSUPPORTED_PLATFORM', 'v0.2 requires Linux process identity and Unix sockets');
  if (input?.session && !internal) throw fail('INVALID_REQUEST', 'Use task_resume; session locators are not accepted by start');
  const request = validate(input); const cfg = harnessConfig(request.harness);
  const workspace = fs.realpathSync(gitSnapshot(request.cwd)?.root || request.cwd);
  const configIdentity = digest({ harness: request.harness, binary: cfg.binary, home: cfg.home || null });
  if (request.session && request.session.config_identity !== configIdentity) throw fail('SESSION_MISMATCH', 'Harness binary/home configuration changed');
  return transaction(async () => {
    const fingerprint = digest(request);
    const states = ids().map(id => ({ state: reconcile(id), request: readJson(path.join(directory(id), 'request.json')) }));
    if (request.request_key) {
      const previous = states.find(x => x.request.request_key === request.request_key);
      if (previous) {
        if (previous.request.request_digest !== fingerprint) throw fail('IDEMPOTENCY_CONFLICT', 'request_key was already used with different input');
        return { job_id: previous.state.job_id, status: previous.state.status, reused: true };
      }
    }
    for (const other of states) {
      if (terminal(other.state.status) && !other.state.execution_may_continue) continue;
      const otherSession = other.state.session || other.request.session;
      const samePiFile = request.harness === 'pi' && request.session?.locator?.session_file && otherSession?.locator?.session_file === request.session.locator.session_file;
      if (request.session && otherSession?.harness === request.harness && (otherSession.native_id === request.session.native_id || samePiFile)) throw fail('SESSION_BUSY', 'Native session already has an active job');
      if ((other.request.workspace || other.request.cwd) === workspace && (request.role === 'worker' || other.request.role === 'worker')) throw fail('WORKSPACE_BUSY', 'Writer requires exclusive workspace; use a distinct worktree');
    }
    const id = `job_${crypto.randomUUID()}`; const dir = directory(id);
    fs.mkdirSync(dir, { mode: 0o700 });
    const profile = { binary: cfg.binary, allow_env: cfg.allow_env, ...(cfg.home ? { home: cfg.home } : {}), ...(cfg.model ? { model: cfg.model } : {}), ...(cfg.provider ? { provider: cfg.provider } : {}), ...(cfg.thinking ? { thinking: cfg.thinking } : {}), ...(cfg.log_bytes ? { log_bytes: cfg.log_bytes } : {}) };
    const stored = { ...request, schema_version: 1, job_id: id, workspace, profile, request_digest: fingerprint, config_identity: configIdentity, created_at: now() };
    atomic(path.join(dir, 'request.json'), stored);
    atomic(path.join(dir, 'state.json'), { job_id: id, status: 'queued', created_at: stored.created_at });
    const env = safeEnvironment([...cfg.allow_env, 'HARNESS_DELEGATION_DIR', 'HARNESS_DELEGATION_CONFIG', 'PI_AGENT_PI_BIN']);
    env.HARNESS_DELEGATION_DIR = rootDir();
    const supervisor = spawn(process.execPath, [supervisorPath, id], { detached: true, stdio: 'ignore', env, cwd: request.cwd });
    supervisor.on('error', error => atomic(path.join(dir, 'receipt.json'), { job_id: id, status: 'failed', error: { code: 'SPAWN_FAILED', message: error.message } }));
    supervisor.unref();
    // Supervisor alone writes state after this transaction; the initial queued
    // record is deliberately not overwritten by the launcher after spawning.
    return { job_id: id, status: 'queued', job_dir: dir, reused: false };
  });
}
export async function get(id, { result = false } = {}) {
  const state = await transaction(() => reconcile(id));
  if (!result) return state;
  if (!terminal(state.status)) return { ...state, final_text: null };
  const file = path.join(directory(id), 'result.md');
  return { ...state, final_text: fs.existsSync(file) ? await readText(file) : null, final_text_truncated: fs.existsSync(file) && fs.statSync(file).size > 65536 };
}
export async function list({ cwd, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw fail('INVALID_REQUEST', 'limit must be 1..200');
  return transaction(() => ids().reverse().map(reconcile).filter(s => !cwd || s.cwd === fs.realpathSync(cwd)).slice(0, limit));
}
export async function read(id, options = {}) { const state = await get(id); return { job_id: id, status: state.status, terminal: terminal(state.status), ...readEvents(id, options.after, options.limit), truncated: state.log_truncated || {} }; }
export async function wait(id, { after, timeout_seconds = 30 } = {}) {
  if (!Number.isFinite(timeout_seconds) || timeout_seconds < 0 || timeout_seconds > 45) throw fail('INVALID_REQUEST', 'wait timeout_seconds must be 0..45');
  const end = Date.now() + timeout_seconds * 1000;
  while (true) {
    const state = await get(id); const events = readEvents(id, after ?? 0);
    if (terminal(state.status) || (after !== undefined && events.events.length) || Date.now() >= end) return { state, ...events, terminal: terminal(state.status), timed_out: !terminal(state.status) && Date.now() >= end };
    await sleep(100);
  }
}
export async function control(id, action, message, request_key = crypto.randomUUID()) {
  if (!['cancel', 'steer', 'follow_up'].includes(action)) throw fail('INVALID_REQUEST', 'Invalid control action');
  if (typeof request_key !== 'string' || request_key.length > 160) throw fail('INVALID_REQUEST', 'Invalid control request_key');
  if (action !== 'cancel' && (typeof message !== 'string' || !message.trim() || Buffer.byteLength(message) > 65536)) throw fail('INVALID_REQUEST', 'send requires a nonempty message up to 65536 bytes');
  const state = await get(id);
  const ledger = path.join(directory(id), 'controls.jsonl');
  if (terminal(state.status)) {
    if (fs.existsSync(ledger)) {
      const records = fs.readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.request_key === request_key);
      if (records.length) {
        if (records[0].digest !== digest({ action, message })) throw fail('IDEMPOTENCY_CONFLICT', 'Control key reused with different input');
        return records.at(-1).response || { accepted: false, delivery: 'unknown' };
      }
    }
    if (action === 'cancel') return { accepted: false, terminal: true, status: state.status };
    throw fail('JOB_TERMINAL', 'Job no longer accepts messages');
  }
  // A connection that has not been opened cannot have delivered a command.
  // Wait for the supervisor's socket; never retry after a socket write.
  for (let i = 0; !fs.existsSync(path.join(directory(id), 'control.sock')) && i < 100; i++) {
    const current = await get(id);
    if (terminal(current.status)) return { accepted: false, terminal: true, status: current.status };
    await sleep(50);
  }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path.join(directory(id), 'control.sock')); let buffer = '';
    socket.setTimeout(17000, () => socket.destroy(fail('DELIVERY_UNKNOWN', 'Control response timed out; inspect using the same request_key')));
    socket.on('connect', () => socket.write(JSON.stringify({ action, message, request_key }) + '\n'));
    socket.on('data', chunk => { buffer += chunk; if (buffer.length > 65536) socket.destroy(fail('PROTOCOL_ERROR', 'Oversized control response')); });
    socket.on('error', reject);
    socket.on('end', () => { try { const result = JSON.parse(buffer); if (!result.ok) reject(fail(result.error.code, result.error.message)); else resolve(result.data); } catch (e) { reject(e); } });
  });
}
export async function resume(id, input) {
  const previous = await get(id); const original = readJson(path.join(directory(id), 'request.json'));
  if (!terminal(previous.status) || previous.execution_may_continue) throw fail('SESSION_BUSY', 'Previous execution must be stopped before resume');
  if (!previous.session?.native_id) throw fail('SESSION_UNAVAILABLE', 'Job has no resumable native session');
  if (!adapterFor(original.harness).capabilities.resume) throw fail('UNSUPPORTED_CAPABILITY', 'Resume unsupported');
  const { schema_version, job_id, workspace, profile, request_digest, config_identity, created_at, ...base } = original;
  return start({ ...base, ...input, harness: original.harness, cwd: original.cwd, session: previous.session, resume_from_job_id: id, request_key: input.request_key }, { internal: true });
}
export const harnessList = () => ['pi', 'grok'].map(doctor);
