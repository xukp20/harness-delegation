import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { atomic, processIdentity, groupAlive, closeProcess, sleep } from '../src/common.mjs';
import { get, start, wait } from '../src/jobs.mjs';
import { Journal, directory, readEvents } from '../src/store.mjs';
import { prepare } from '../src/adapters/grok.mjs';
const exec = promisify(execFile);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-tests-'));
process.env.HARNESS_DELEGATION_DIR = path.join(tmp, 'state');
process.env.HARNESS_DELEGATION_CONFIG = path.join(tmp, 'config.json');
atomic(process.env.HARNESS_DELEGATION_CONFIG, { harnesses: { pi: { binary: path.resolve('tests/fixtures/fake-harness.mjs'), allow_env: ['FAKE_DELAY'] } } });

test('lost leader retains exclusion until ordinary child tools stop', async () => {
  const child = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process'); const c=spawn('sleep',['30'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)"], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.delegationIdentity = processIdentity(child.pid);
  await new Promise(resolve => child.stdout.once('data', resolve));
  const id = `job_${crypto.randomUUID()}`; const dir = directory(id);
  atomic(path.join(dir, 'request.json'), { cwd: tmp, workspace: tmp, role: 'worker', harness: 'pi' });
  atomic(path.join(dir, 'state.json'), { job_id: id, status: 'running', created_at: new Date().toISOString(), supervisor: { ...processIdentity(), pid: 2147483647 }, child: child.delegationIdentity });
  try {
    process.kill(child.pid, 'SIGKILL'); await sleep(80);
    assert.equal(groupAlive(child.delegationIdentity), true);
    const state = await get(id); assert.equal(state.status, 'lost'); assert.equal(state.execution_may_continue, true); assert.equal(state.cleanup.stopped, false);
    await assert.rejects(start({ harness: 'pi', cwd: tmp, role: 'worker', write_scope: ['x'], task: 'must not run' }), { code: 'WORKSPACE_BUSY' });
    assert.equal((await closeProcess(child)).stopped, true);
    assert.equal(groupAlive(child.delegationIdentity), false); assert.equal((await get(id)).execution_may_continue, false);
  } finally { await closeProcess(child); }
});

test('Grok authentication homes have separate native stores and links', () => {
  const homes = ['A', 'B'].map(name => { const home = path.join(tmp, name); fs.mkdirSync(home); fs.writeFileSync(path.join(home, 'auth.json'), '{}', { mode: 0o600 }); return home; });
  const launches = homes.map((home, i) => {
    const dir = path.join(tmp, `profile-${i}`); fs.mkdirSync(dir);
    return prepare({ cwd: tmp, role: 'reviewer', harness_options: {} }, { home }, dir);
  });
  assert.notEqual(launches[0].native_home, launches[1].native_home);
  for (let i = 0; i < 2; i++) assert.equal(fs.readlinkSync(path.join(launches[i].native_home, 'auth.json')), path.join(homes[i], 'auth.json'));
});

test('oversized current and legacy events advance cursor to terminal', () => {
  const id = `job_${crypto.randomUUID()}`; const dir = directory(id); fs.mkdirSync(dir, { recursive: true });
  atomic(path.join(dir, 'request.json'), { harness: 'pi', cwd: tmp, role: 'reviewer' });
  atomic(path.join(dir, 'receipt.json'), { job_id: id, status: 'completed' });
  const journal = new Journal(dir);
  journal.event('tool.started', { title: 'x'.repeat(70000) }); journal.event('job.terminal', { status: 'completed' }, true);
  const page = readEvents(id); assert.equal(page.next_cursor, 3); assert.equal(page.events[1].data.truncated, true); assert.equal(journal.truncated.normalized_events, true);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ seq: 1, type: 'tool.started', data: 'x'.repeat(70000) }) + '\n' + JSON.stringify({ seq: 2, type: 'job.terminal' }) + '\n');
  const old = readEvents(id); assert.equal(old.next_cursor, 2); assert.equal(old.events.at(-1).type, 'job.terminal');
});

test('legacy session symlink aliases cannot start concurrent resumes', async () => {
  const session = path.join(tmp, 'session.jsonl'); const alias = path.join(tmp, 'alias.jsonl'); fs.writeFileSync(session, ''); fs.symlinkSync(session, alias);
  const run = file => exec(process.execPath, ['skills/pi-agent-delegation/scripts/pi-agent.mjs', 'resume', '--session-file', file, '--cwd', tmp, '--task', 'continue'], { env: { ...process.env, FAKE_DELAY: '1500' } });
  const results = await Promise.allSettled([run(session), run(alias)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const success = results.find(r => r.status === 'fulfilled'); const id = JSON.parse(success.value.stdout).job_id;
  assert.equal((await wait(id, { timeout_seconds: 5 })).state.status, 'completed');
});
