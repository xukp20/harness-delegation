import { EventEmitter } from 'node:events';
import { fail } from './common.mjs';

// Framing only. Pi RPC and ACP interpretation live in their adapters.
export class Wire extends EventEmitter {
  constructor(child, record, stderr) {
    super(); this.child = child; this.pending = new Map(); this.serial = 0; this.buffer = ''; this.closed = null;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.close(fail('PROTOCOL_ERROR', 'Protocol frame exceeds 4 MiB'));
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (!item || Array.isArray(item) || typeof item !== 'object') throw new Error('Expected object');
          record(item);
          const pending = this.pending.get(String(item.id));
          if (pending && !item.method) { clearTimeout(pending.timer); this.pending.delete(String(item.id)); pending.resolve(item); }
          this.emit('record', item);
        } catch (error) { this.close(fail('PROTOCOL_ERROR', error.message)); }
      }
    });
    child.stderr.on('data', stderr);
    child.on('error', error => this.close(error));
    child.on('exit', (code, signal) => this.close(fail('PROCESS_EXIT', `Harness exited: code=${code}, signal=${signal}`)));
    child.stdin.on('error', error => this.close(error));
  }
  write(item) {
    if (this.closed) throw this.closed;
    this.child.stdin.write(JSON.stringify(item) + '\n');
  }
  request(item, timeout = 15000) {
    const id = String(++this.serial);
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(this.closed);
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail('DELIVERY_UNKNOWN', `No response for ${item.method || item.type}`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ ...item, id }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  close(error) {
    if (this.closed) return;
    this.closed = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear(); this.emit('closed', error);
  }
}
