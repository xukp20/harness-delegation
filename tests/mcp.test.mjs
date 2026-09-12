import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomic, sleep } from '../src/common.mjs';
test('MCP reconnect keeps detached job, typed errors and bounded waits', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-mcp-'));
  const file = path.join(tmp, 'config.json');
  atomic(file, { harnesses: { pi: { binary: path.resolve('tests/fixtures/fake-harness.mjs'), allow_env: ['FAKE_DELAY'] } } });
  const env = { ...process.env, HARNESS_DELEGATION_DIR: path.join(tmp, 'state'), HARNESS_DELEGATION_CONFIG: file, FAKE_DELAY: '1500' };
  async function open() { const client = new Client({ name: 'test', version: '1' }); await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('bin/harness-delegate.mjs'), 'mcp'], env, stderr: 'pipe' })); return client; }
  let client = await open();
  assert.equal((await client.listTools()).tools.length, 9);
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  const started = await call('task_start', { harness: 'pi', cwd: tmp, task: 'tiny', request_key: 'mcp-start' }); assert.equal(started.ok, true);
  const id = started.data.job_id;
  const wait = await call('task_wait', { job_id: id, timeout_seconds: 0 }); assert.equal(wait.data.terminal, false);
  const invalid = await call('task_start', { harness: 'pi', cwd: tmp, task: 'tiny', request_key: 'other', binary: '/bin/sh' }); assert.equal(invalid.ok, false);
  await client.close(); client = await open();
  const repeat = await call('task_start', { harness: 'pi', cwd: tmp, task: 'tiny', request_key: 'mcp-start' }); assert.equal(repeat.data.job_id, id);
  await sleep(1700); const result = await call('task_get', { job_id: id, result: true }); assert.equal(result.data.status, 'completed'); assert.equal(result.data.final_text, 'FAKE_PI_DONE');
  await client.close(); fs.rmSync(tmp, { recursive: true, force: true });
});
