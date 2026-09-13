import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compactEvents, present } from '../src/presentation.mjs';
import { Journal, readEvents } from '../src/store.mjs';

test('public states preserve failure, cleanup and truncation without process details', () => {
  const state = { job_id: 'job', status: 'lost', supervisor: { pid: 1 }, session: { locator: 'private' }, error: { code: 'SUPERVISOR_LOST', message: 'Stopped', details: { pid: 1 } }, execution_may_continue: true, cleanup: { stopped: false }, final_text: null, text_truncated: true, log_truncated: { 'events.jsonl': true } };
  const out = present('task_get', state);
  assert.equal(out.execution_may_continue, true);
  assert.deepEqual(out.error, { code: 'SUPERVISOR_LOST', message: 'Stopped' });
  assert.deepEqual(out.cleanup, { stopped: false });
  assert.equal(out.final_text, null);
  assert.equal(out.final_text_truncated, true);
  assert.equal(out.log_truncated, true);
  assert.equal('supervisor' in out, false);
  assert.equal('session' in out, false);
  assert.equal(present('task_get', state, { detail: true }), state);
  assert.equal('events' in present('task_wait', { state, events: ['old'], terminal: true }), false);
});

test('text aggregation is exact and respects messages, tools and truncation', () => {
  const events = [
    ['text.delta', { text: '中文\n```js\n' }], ['text.delta', { text: 'const x = "🙂";\n```' }],
    ['text.boundary', {}], ['text.delta', { text: 'another message' }],
    ['tool.started', { name: 'read', native_id: 'internal' }], ['text.delta', { text: 'after tool' }],
    ['text.delta', { truncated: true, preview: 'preview' }], ['text.delta', { text: 'tail' }],
    ['job.terminal', { status: 'failed' }],
  ].map(([type, data], i) => ({ seq: i + 1, at: 'timestamp', type, data }));
  const out = compactEvents(events);
  assert.equal(out[0].data.text, '中文\n```js\nconst x = "🙂";\n```');
  assert.equal(out[0].seq, 2);
  assert.equal(out[1].data.text, 'another message');
  assert.deepEqual(out[2].data, { name: 'read' });
  assert.equal(out[4].data.truncated, true);
  assert.equal(out.at(-1).type, 'job.terminal');
});

test('raw cursors advance through hidden events, pages and oversized text', () => {
  const previous = process.env.HARNESS_DELEGATION_DIR;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-presentation-'));
  process.env.HARNESS_DELEGATION_DIR = tmp;
  try {
    const id = 'job_00000000-0000-0000-0000-000000000001';
    const dir = path.join(tmp, 'jobs', id); fs.mkdirSync(dir, { recursive: true });
    const journal = new Journal(dir);
    journal.event('text.boundary'); journal.event('text.delta', { text: '你' }); journal.event('text.delta', { text: '好' });
    journal.event('text.delta', { text: '字'.repeat(20000) }); journal.event('job.terminal', { status: 'completed' }, true);
    const first = readEvents(id, 0, 2);
    assert.equal(compactEvents(first.events).length, 0);
    assert.equal(first.next_cursor, 2); assert.equal(first.has_more, true);
    const second = readEvents(id, first.next_cursor, 2);
    assert.equal(compactEvents(second.events)[0].data.text, '你好');
    const last = readEvents(id, second.next_cursor, 2);
    assert.equal(last.events[0].data.truncated, true);
    assert.equal(last.events.at(-1).type, 'job.terminal'); assert.equal(last.has_more, false);
    assert.equal(readEvents(id, last.next_cursor).events.length, 0);
  } finally {
    if (previous === undefined) delete process.env.HARNESS_DELEGATION_DIR; else process.env.HARNESS_DELEGATION_DIR = previous;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
