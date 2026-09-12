import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomic, terminal } from '../src/common.mjs';

test('MCP supervisor verifies live Grok tools independently of notification timing', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-handshake-'));
  const state = path.join(tmp, 'state');
  const config = path.join(tmp, 'config.json');
  atomic(config, { harnesses: { grok: { binary: path.resolve('tests/fixtures/fake-harness.mjs'), home: tmp, allow_env: ['FAKE_MODE'] } } });
  try {
    for (const [mode, expected] of [['missing-tools-update', 'completed'], ['delayed-tools', 'completed'], ['wrong-tools', 'failed'], ['missing-tool', 'failed'], ['duplicate-tools', 'failed'], ['no-tools-catalog', 'failed']]) {
      await t.test(mode, async () => {
        const client = new Client({ name: 'handshake-test', version: '1' });
        await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('bin/harness-delegate.mjs'), 'mcp'], env: { ...process.env, HARNESS_DELEGATION_DIR: state, HARNESS_DELEGATION_CONFIG: config, FAKE_MODE: mode } }));
        const call = async (name, args) => {
          const response = JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
          assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
        };
        try {
          assert.equal((await client.listTools()).tools.length, 9);
          const { job_id } = await call('task_start', { harness: 'grok', cwd: tmp, task: 'tiny', request_key: mode });
          let receipt;
          for (let i = 0; i < 10; i++) {
            await call('task_wait', { job_id, timeout_seconds: 2 });
            receipt = await call('task_get', { job_id, result: true });
            if (terminal(receipt.status)) break;
          }
          assert.equal(receipt.status, expected);
          assert.equal(receipt.cleanup.stopped, true);
          if (expected === 'completed') assert.equal(receipt.final_text, 'FAKE_GROK_DONE');
          else {
            assert.equal(receipt.error.code, 'TOOL_PROFILE_MISMATCH');
            assert.equal(receipt.error.details.source, '_x.ai/commands/list');
            const native = fs.readFileSync(path.join(state, 'jobs', job_id, 'native.jsonl'), 'utf8');
            assert.ok(!native.includes('_fixture/prompt_received'), 'mismatched profile must not send a prompt');
          }
        } finally { await client.close(); }
      });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
