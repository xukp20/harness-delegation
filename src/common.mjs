import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const now = () => new Date().toISOString();
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const terminal = status => ['completed', 'failed', 'cancelled', 'timed_out', 'lost'].includes(status);
export function fail(code, message, details) { return Object.assign(new Error(message), { code, details }); }
export function errorData(error) { return { code: error.code || 'INTERNAL_ERROR', message: error.message, ...(error.details ? { details: error.details } : {}) }; }
export const envelope = data => ({ api_version: 1, ok: true, data });
export const failure = error => ({ api_version: 1, ok: false, error: errorData(error) });
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export function digest(value) {
  const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function rootDir() { return path.resolve(process.env.HARNESS_DELEGATION_DIR || config().state_dir || path.join(os.homedir(), '.local/state/harness-delegation')); }
export function config() {
  const file = process.env.HARNESS_DELEGATION_CONFIG || path.join(os.homedir(), '.config/harness-delegation/config.json');
  const cfg = fs.existsSync(file) ? readJson(file) : {};
  if (cfg.schema_version && cfg.schema_version !== 1) throw fail('CONFIG_ERROR', 'Unsupported configuration schema');
  return cfg;
}
const BASE_ENV = ['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SYSTEMROOT', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const INJECTION = /^(NODE_OPTIONS|NODE_PATH|LD_.*|DYLD_.*|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|PYTHONPATH|PYTHONHOME)$/;
export function safeEnvironment(allow = [], env = process.env) {
  const out = {};
  for (const name of [...BASE_ENV, ...allow]) if (!INJECTION.test(name) && typeof env[name] === 'string') out[name] = env[name];
  return out;
}
export function harnessConfig(harness) {
  const cfg = config().harnesses?.[harness] || {};
  return { ...cfg, binary: cfg.binary || (harness === 'pi' ? process.env.PI_AGENT_PI_BIN || 'pi' : 'grok'), allow_env: cfg.allow_env || [] };
}
export function redact(value, env = process.env) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const [name, secret] of Object.entries(env)) if (/(token|secret|password|api.?key|credential)/i.test(name) && secret?.length >= 8) text = text.split(secret).join('[REDACTED]');
  return text.replace(/("(?:access_token|refresh_token|api_key|password|authorization)"\s*:\s*")[^"]*/gi, '$1[REDACTED]');
}
export function gitSnapshot(cwd) {
  const run = args => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  const root = run(['rev-parse', '--show-toplevel']);
  if (root.status !== 0) return null;
  const head = run(['rev-parse', 'HEAD']); const status = run(['status', '--short', '--untracked-files=all']);
  return { root: root.stdout.trim(), head: head.status === 0 ? head.stdout.trim() : null, status: status.status === 0 ? status.stdout.trim().split('\n').filter(Boolean) : null };
}
export function processIdentity(pid = process.pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const parts = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, pgid: Number(parts[2]), start_ticks: parts[19], boot_id: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), zombie: parts[0] === 'Z' };
  } catch { return null; }
}
export function alive(identity) {
  if (!identity) return false;
  const current = processIdentity(identity.pid);
  return !!current && !current.zombie && current.start_ticks === identity.start_ticks && current.boot_id === identity.boot_id;
}
export function groupAlive(identity) {
  if (!identity || identity.boot_id !== processIdentity()?.boot_id) return false;
  // A process group's ID remains reserved while ordinary child tools survive
  // its leader. Zombies cannot execute or write and do not retain exclusion.
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const member = processIdentity(Number(entry));
    if (member && !member.zombie && member.pgid === identity.pid) return true;
  }
  return false;
}
export async function closeProcess(child, grace = 1000) {
  if (!child?.pid) return { stopped: true, forced: false };
  const identity = child.delegationIdentity || processIdentity(child.pid) || { pid: child.pid, boot_id: processIdentity()?.boot_id };
  const current = processIdentity(child.pid);
  if (identity.start_ticks && current && current.start_ticks !== identity.start_ticks) return { stopped: false, error: 'Native process identity changed; refusing to signal' };
  const signal = sig => { try { process.kill(-child.pid, sig); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
  child.stdin?.end();
  if (!groupAlive(identity)) return { stopped: true, forced: false };
  signal('SIGTERM');
  const deadline = Date.now() + grace;
  while (groupAlive(identity) && Date.now() < deadline) await sleep(20);
  let forced = false;
  if (groupAlive(identity)) { forced = true; signal('SIGKILL'); }
  for (let i = 0; i < 100 && groupAlive(identity); i++) await sleep(20);
  return { stopped: !groupAlive(identity), forced };
}
export async function readText(file, limit = 65536) {
  const handle = await fsp.open(file, 'r');
  try { const buffer = Buffer.alloc(limit); const { bytesRead } = await handle.read(buffer, 0, limit, 0); return buffer.subarray(0, bytesRead).toString('utf8'); } finally { await handle.close(); }
}
