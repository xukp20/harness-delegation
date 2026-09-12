import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import * as jobs from '../src/jobs.mjs';
import { atomic, alive, safeEnvironment, sleep, terminal } from '../src/common.mjs';
import { parseArgs } from '../src/cli.mjs';
import { directory } from '../src/store.mjs';
const exec = promisify(execFile);
const fixture = path.resolve('tests/fixtures/fake-harness.mjs');
fs.chmodSync(fixture, 0o755);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tests-'));
process.env.HARNESS_DELEGATION_CONFIG = path.join(temporary, 'config.json');
process.env.HARNESS_DELEGATION_DIR = path.join(temporary, 'state');
const configure = (mode = 'normal', delay = '150') => {
  process.env.FAKE_MODE = mode; process.env.FAKE_DELAY = delay;
  atomic(process.env.HARNESS_DELEGATION_CONFIG, { harnesses: { pi: { binary: fixture, allow_env: ['FAKE_MODE', 'FAKE_DELAY'], log_bytes: 4096 }, grok: { binary: fixture, allow_env: ['FAKE_MODE', 'FAKE_DELAY'], home: temporary } } });
};
const request = (harness = 'pi', extra = {}) => ({ harness, cwd: temporary, task: 'Return fixture result', ...extra });
async function done(id) { for (let i = 0; i < 150; i++) { const s = await jobs.get(id, { result: true }); if (terminal(s.status)) return s; await sleep(50); } throw new Error('Job did not settle'); }
async function running(id) { for (let i = 0; i < 100; i++) { const s = await jobs.get(id); if (s.status === 'running') return s; if (terminal(s.status)) throw new Error(JSON.stringify(s)); await sleep(30); } throw new Error('Not running'); }
test('core, adapters, persistence and compatibility', async t => {
  configure();
  await t.test('validation and finite environment', async () => {
    assert.deepEqual(parseArgs(['--allow-env', 'ONE', '--allow-env', 'TWO']).options.allow_env, ['ONE', 'TWO']);
    assert.deepEqual(safeEnvironment(['TOKEN', 'NODE_OPTIONS'], { HOME: '/tmp', TOKEN: 'value', OTHER: 'hidden', NODE_OPTIONS: '--require bad' }), { HOME: '/tmp', TOKEN: 'value' });
    await assert.rejects(jobs.start(request('pi', { role: 'worker' })), { code: 'INVALID_REQUEST' });
    await assert.rejects(jobs.start(request('pi', { binary: '/bin/sh' })), { code: 'INVALID_REQUEST' });
  });
  let first;
  await t.test('start idempotency, terminal receipt, current result and private files', async () => {
    const input = request('pi', { request_key: 'same' });
    const [a, b] = await Promise.all([jobs.start(input), jobs.start(input)]); assert.equal(a.job_id, b.job_id); first = a.job_id;
    await assert.rejects(jobs.start({ ...input, task: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' });
    const s = await done(first); assert.equal(s.status, 'completed'); assert.equal(s.final_text, 'FAKE_PI_DONE'); assert.equal(s.cleanup.stopped, true); assert.equal(alive(s.child), false);
    assert.equal(fs.statSync(path.join(directory(first), 'receipt.json')).mode & 0o777, 0o600);
    assert.equal(s.usage.scope, 'session');
  });
  await t.test('cursor and client timeout do not stop job', async () => {
    configure('normal', '900'); const { job_id } = await jobs.start(request());
    await running(job_id); const result = await jobs.wait(job_id, { timeout_seconds: 0 }); assert.equal(result.terminal, false); assert.equal(result.timed_out, true);
    const a = await jobs.read(job_id); const b = await jobs.read(job_id, { after: a.next_cursor }); assert.equal(b.events.length, 0);
    assert.equal((await done(job_id)).status, 'completed');
  });
  await t.test('workspace readers share, writer conflicts, separate workspace works', async () => {
    configure('normal', '700'); const a = await jobs.start(request()); const b = await jobs.start(request());
    await assert.rejects(jobs.start(request('pi', { role: 'worker', write_scope: ['src'] })), { code: 'WORKSPACE_BUSY' });
    const other = fs.mkdtempSync(path.join(temporary, 'other-')); const c = await jobs.start(request('pi', { cwd: other, role: 'worker', write_scope: ['src'] }));
    await Promise.all([a, b, c].map(x => done(x.job_id)));
  });
  await t.test('Pi control idempotency and cancellation', async () => {
    configure('normal', '4000'); const { job_id } = await jobs.start(request()); await running(job_id);
    const a = await jobs.control(job_id, 'steer', 'focus', 'steer-key'); const b = await jobs.control(job_id, 'steer', 'focus', 'steer-key'); assert.deepEqual(a, b);
    await assert.rejects(jobs.control(job_id, 'steer', 'other', 'steer-key'), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal((await jobs.control(job_id, 'follow_up', 'next', 'follow-key')).accepted, true);
    await jobs.control(job_id, 'cancel', undefined, 'cancel-key'); assert.equal((await done(job_id)).status, 'cancelled');
    assert.equal((await jobs.control(job_id, 'cancel', undefined, 'cancel-key')).accepted, true);
  });
  await t.test('session resume locks and result isolation', async () => {
    configure('normal', '700'); const next = await jobs.resume(first, { task: 'continue', request_key: 'continue' }); await running(next.job_id);
    await assert.rejects(jobs.resume(first, { task: 'second' }), { code: 'SESSION_BUSY' });
    assert.equal((await done(next.job_id)).final_text, 'FAKE_PI_DONE');
  });
  await t.test('deadline escalates uncooperative process', async () => {
    configure('ignore', '60000'); const { job_id } = await jobs.start(request('pi', { timeout_seconds: 0.15 })); const s = await done(job_id); assert.equal(s.status, 'timed_out'); assert.equal(s.cleanup.stopped, true); assert.equal(alive(s.child), false);
  });
  await t.test('Pi native retry backoff is aborted without changing settings or replaying prompt', async () => {
    configure('retry'); const { job_id } = await jobs.start(request()); const s = await done(job_id);
    assert.equal(s.status, 'failed'); assert.equal(s.error.message, 'Request timed out.');
    assert.equal(s.error.details.source, 'pi_assistant'); assert.equal(s.cleanup.stopped, true);
    const native = fs.readFileSync(path.join(directory(job_id), 'native.jsonl'), 'utf8');
    assert.ok(native.includes('abort_retry')); assert.ok(!native.includes('set_auto_retry')); assert.ok(!native.includes('fixture_unwanted_retry'));
    assert.equal(native.split('"command":"prompt"').length - 1, 1);
  });
  await t.test('malformed wire, process exit, native error and historical result', async () => {
    for (const mode of ['malformed', 'crash', 'error', 'empty']) {
      configure(mode); const { job_id } = await jobs.start(request()); const s = await done(job_id);
      assert.equal(s.status, 'failed'); assert.notEqual(s.final_text, 'HISTORICAL_WRONG');
    }
  });
  await t.test('bounded log policy keeps terminal evidence', async () => {
    configure('flood'); const { job_id } = await jobs.start(request()); const s = await done(job_id);
    assert.equal(s.log_truncated['stderr.log'], true); assert.equal(s.log_truncated['native.jsonl'], true); assert.equal(s.log_truncated['events.jsonl'], true);
    assert.ok(fs.statSync(path.join(directory(job_id), 'events.jsonl')).size < 5000);
    assert.equal((await jobs.read(job_id)).events.at(-1).type, 'job.terminal');
  });
  await t.test('Grok ACP, denied permission, unknown events, resume and capabilities', async () => {
    configure('permission'); const { job_id } = await jobs.start(request('grok')); const s = await done(job_id); assert.equal(s.status, 'completed'); assert.equal(s.final_text, 'FAKE_GROK_DONE');
    configure('normal', '900'); const next = await jobs.resume(job_id, { task: 'continue' }); await running(next.job_id);
    await assert.rejects(jobs.control(next.job_id, 'steer', 'change'), { code: 'UNSUPPORTED_CAPABILITY' });
    assert.equal((await done(next.job_id)).final_text, 'FAKE_GROK_DONE');
  });
  await t.test('Grok cancel, refusal and missing load capability', async () => {
    configure('normal', '4000'); const a = await jobs.start(request('grok')); await running(a.job_id); await jobs.control(a.job_id, 'cancel'); assert.equal((await done(a.job_id)).status, 'cancelled');
    configure('no-resume'); const b = await jobs.resume(a.job_id, { task: 'again' }); assert.equal((await done(b.job_id)).error.code, 'UNSUPPORTED_CAPABILITY');
    configure('error'); const c = await jobs.start(request('grok')); assert.equal((await done(c.job_id)).status, 'failed');
  });
  await t.test('dead supervisor reconciles to lost without replay', async () => {
    configure('normal', '4000'); const a = await jobs.start(request()); const s = await running(a.job_id);
    process.kill(s.supervisor.pid, 'SIGKILL'); await sleep(150); const lost = await jobs.get(a.job_id); assert.equal(lost.status, 'lost');
    if (alive(s.child)) process.kill(-s.child.pid, 'SIGKILL');
  });
  await t.test('CLI process exit preserves job and old terminal receipts remain readable', async () => {
    configure(); const raw = await exec(process.execPath, ['bin/harness-delegate.mjs', 'start', '--cwd', temporary, '--task', 'tiny'], { env: process.env }); const started = JSON.parse(raw.stdout); assert.equal(started.ok, true); assert.equal((await done(started.data.job_id)).status, 'completed');
    const legacyDir = path.join(temporary, 'legacy/jobs/pi_old'); fs.mkdirSync(legacyDir, { recursive: true }); atomic(path.join(legacyDir, 'receipt.json'), { job_id: 'pi_old', status: 'completed' }); fs.writeFileSync(path.join(legacyDir, 'result.md'), 'OLD');
    const old = await exec(process.execPath, ['skills/pi-agent-delegation/scripts/pi-agent.mjs', 'result', 'pi_old'], { env: { ...process.env, PI_AGENT_DELEGATION_DIR: path.join(temporary, 'legacy') } }); assert.equal(JSON.parse(old.stdout).final_text, 'OLD');
  });
  await t.test('queued resume excludes a duplicate before native handshake', async () => {
    configure('normal', '500');
    const source = await jobs.start(request()); await done(source.job_id);
    const next = await jobs.resume(source.job_id, { task: 'one' });
    await assert.rejects(jobs.resume(source.job_id, { task: 'two' }), { code: 'SESSION_BUSY' });
    await done(next.job_id);
  });
  await t.test('cancel immediately after start prevents further work', async () => {
    configure('normal', '4000'); const a = await jobs.start(request());
    const response = await jobs.control(a.job_id, 'cancel', undefined, 'early-cancel');
    assert.equal(response.accepted, true); assert.equal((await done(a.job_id)).status, 'cancelled');
  });
  await t.test('read-only tools, malformed cursors and Grok empty toolsets fail closed', async () => {
    configure();
    await assert.rejects(jobs.read(first, { after: -1 }), { code: 'INVALID_REQUEST' });
    await assert.rejects(jobs.wait(first, { timeout_seconds: 60 }), { code: 'INVALID_REQUEST' });
    const a = await jobs.start(request('pi', { harness_options: { tools: ['bash'] } })); assert.equal((await done(a.job_id)).error.code, 'PERMISSION_DENIED');
    const b = await jobs.start(request('grok', { harness_options: { tools: [] } })); assert.equal((await done(b.job_id)).error.code, 'UNSUPPORTED_CAPABILITY');
  });
  await t.test('legacy start, explicit migration errors and legacy active-job rejection', async () => {
    configure();
    const cli = 'skills/pi-agent-delegation/scripts/pi-agent.mjs';
    const result = await exec(process.execPath, [cli, 'run', '--cwd', temporary, '--task', 'legacy task'], { env: process.env }); assert.equal(JSON.parse(result.stdout).final_text, 'FAKE_PI_DONE');
    for (const args of [['start', '--allow-env', 'TOKEN', '--task', 'x'], ['resume', '--task', 'x'], ['status', 'pi_missing']]) {
      await assert.rejects(exec(process.execPath, [cli, ...args], { env: process.env }), e => JSON.parse(e.stdout).ok === false);
    }
  });
});
