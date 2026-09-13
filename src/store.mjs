import fs from 'node:fs';
import path from 'node:path';
import { atomic, readJson, rootDir, fail, processIdentity, alive, sleep, now, redact } from './common.mjs';

export function directory(id) {
  if (!/^job_[a-f0-9-]{36}$/.test(id)) throw fail('INVALID_REQUEST', 'Invalid job ID');
  return path.join(rootDir(), 'jobs', id);
}
export function initRoot() {
  fs.mkdirSync(rootDir(), { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(rootDir());
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077)) throw fail('UNSAFE_STATE_ROOT', 'State root must be an owned private directory (0700)');
  fs.mkdirSync(path.join(rootDir(), 'jobs'), { recursive: true, mode: 0o700 });
}
// Short filesystem transactions only. A crashed transaction fails closed rather
// than stealing a possibly live lock. doctor reports the exact recovery path.
export async function transaction(fn) {
  initRoot(); const lock = path.join(rootDir(), 'transaction.lock');
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner; try { owner = readJson(path.join(lock, 'owner.json')); } catch {}
      if (owner && !alive(owner)) throw fail('STALE_LOCK', `Interrupted storage transaction; after confirming no bridge commands are active, remove ${lock}`);
      if (i >= 100) throw fail('STORE_BUSY', `Storage transaction is busy: ${lock}`);
      await sleep(25);
    }
  }
  atomic(path.join(lock, 'owner.json'), processIdentity());
  try { return await fn(); } finally { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); }
}
export function ids() {
  initRoot(); return fs.readdirSync(path.join(rootDir(), 'jobs')).filter(id => /^job_[a-f0-9-]{36}$/.test(id));
}
export function snapshot(id) {
  const dir = directory(id);
  try {
    if (fs.existsSync(path.join(dir, 'receipt.json'))) return readJson(path.join(dir, 'receipt.json'));
    return readJson(path.join(dir, 'state.json'));
  } catch (e) { if (e.code === 'ENOENT') throw fail('JOB_NOT_FOUND', `Job not found: ${id}`); throw e; }
}
export class Journal {
  constructor(dir, limits = {}) {
    this.dir = dir; this.seq = 0; this.truncated = {}; this.bytes = {};
    this.limit = Math.min(16 * 1024 * 1024, Math.max(1024, limits.log_bytes || 2 * 1024 * 1024));
    this.event('job.started', {});
  }
  append(name, text, critical = false) {
    const data = redact(text); const size = Buffer.byteLength(data);
    if (!critical && (this.bytes[name] || 0) + size > this.limit) { this.truncated[name] = true; return false; }
    fs.appendFileSync(path.join(this.dir, name), data, { mode: 0o600 });
    this.bytes[name] = (this.bytes[name] || 0) + size; return true;
  }
  event(type, data = {}, critical = false) {
    let item = { seq: this.seq + 1, at: now(), type, data };
    if (Buffer.byteLength(JSON.stringify(item)) > 16384) {
      this.truncated.normalized_events = true;
      item = { ...item, data: { truncated: true, preview: JSON.stringify(data).slice(0, 2048) } };
    }
    if (this.append('events.jsonl', JSON.stringify(item) + '\n', critical)) this.seq++;
  }
  native(record) { this.append('native.jsonl', JSON.stringify({ at: now(), record }) + '\n'); }
  stderr(chunk) { this.append('stderr.log', chunk.toString()); }
}
export function readEvents(id, after = 0, limit = 100) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw fail('INVALID_REQUEST', 'after must be nonnegative; limit must be 1..200');
  const file = path.join(directory(id), 'events.jsonl'); const events = []; let bytes = 0; let hasMore = false;
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let item; try { item = JSON.parse(line); } catch { break; }
      if (item.seq <= after) continue;
      if (Buffer.byteLength(line) > 16384) item = { seq: item.seq, at: item.at, type: item.type, data: { truncated: true, preview: line.slice(0, 2048) } };
      const size = Buffer.byteLength(JSON.stringify(item));
      if (events.length >= limit || bytes + size > 65536) { hasMore = true; break; }
      events.push(item); bytes += size;
    }
  }
  return { events, next_cursor: events.at(-1)?.seq ?? after, has_more: hasMore };
}
