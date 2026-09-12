import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { atomic, terminal } from '../src/common.mjs';

test('Grok project boundary excludes user config but rejects consumed project paths before launch', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-project-config-'));
  const home = path.join(tmp, 'home'); const repo = path.join(home, 'code', 'repo');
  const cwd = path.join(repo, 'sub'); const state = path.join(tmp, 'state');
  const config = path.join(tmp, 'config.json');
  fs.mkdirSync(cwd, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const userConfig = path.join(home, '.grok', 'config.toml');
  fs.mkdirSync(path.dirname(userConfig)); fs.writeFileSync(userConfig, '# user-only config\n');
  const authAlias = path.join(tmp, 'auth-alias'); fs.symlinkSync(path.dirname(userConfig), authAlias);
  atomic(config, { harnesses: { grok: { binary: path.resolve('tests/fixtures/fake-harness.mjs'), home: authAlias } } });
  const client = new Client({ name: 'project-config-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('bin/harness-delegate.mjs'), 'mcp'], env: { ...process.env, HOME: home, HARNESS_DELEGATION_DIR: state, HARNESS_DELEGATION_CONFIG: config } }));
  let serial = 0;
  const call = async (name, args) => {
    const response = JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
  };
  async function run(workspace, expected) {
    const { job_id } = await call('task_start', { harness: 'grok', cwd: workspace, task: 'tiny', request_key: `config-${++serial}` });
    let receipt;
    for (let i = 0; i < 10; i++) {
      await call('task_wait', { job_id, timeout_seconds: 2 });
      receipt = await call('task_get', { job_id, result: true });
      if (terminal(receipt.status)) break;
    }
    assert.equal(receipt.status, expected); assert.equal(receipt.cleanup.stopped, true);
    const log = path.join(state, 'jobs', job_id, 'native.jsonl');
    const native = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    if (expected === 'completed') {
      assert.equal(receipt.final_text, 'FAKE_GROK_DONE'); assert.ok(native.includes('_fixture/prompt_received'));
    } else {
      assert.equal(receipt.error.code, 'PROJECT_CONFIG_UNSUPPORTED');
      assert.ok(!receipt.child, 'reject before spawning the native process');
      assert.ok(!native.includes('_fixture/prompt_received'));
    }
    return receipt;
  }
  try {
    await t.test('repo under native user home connects and sends prompt', () => run(cwd, 'completed'));
    for (const name of ['.grok/config.toml', '.grok/hooks', '.grok/plugins', '.grok/lsp.json', '.mcp.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/plugins', '.cursor/mcp.json', '.cursor/hooks.json', '.envrc']) {
      await t.test(`project ancestor ${name}`, async () => {
        const marker = path.join(repo, name); fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, '');
        try { await run(cwd, 'failed'); } finally { fs.unlinkSync(marker); }
      });
    }
    await t.test('canonical cwd alias cannot bypass project config or auth-home alias', async () => {
      const alias = path.join(tmp, 'repo-alias'); fs.symlinkSync(repo, alias);
      await run(path.join(alias, 'sub'), 'completed');
      const marker = path.join(repo, '.grok/config.toml'); fs.symlinkSync(userConfig, marker);
      try { await run(path.join(alias, 'sub'), 'failed'); } finally { fs.unlinkSync(marker); }
      fs.symlinkSync(path.join(tmp, 'missing-config'), marker);
      try { await run(cwd, 'failed'); } finally { fs.unlinkSync(marker); }
    });
    await t.test('cwd-local configuration remains rejected', async () => {
      const marker = path.join(cwd, '.mcp.json'); fs.writeFileSync(marker, '{}');
      try { await run(cwd, 'failed'); } finally { fs.unlinkSync(marker); }
    });
    await t.test('linked worktree git-file boundary is included and checked', async () => {
      assert.equal(spawnSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']).status, 0);
      const worktree = path.join(home, 'code', 'linked');
      assert.equal(spawnSync('git', ['-C', repo, 'worktree', 'add', '--detach', worktree, 'HEAD']).status, 0);
      assert.equal(fs.statSync(path.join(worktree, '.git')).isFile(), true);
      await run(worktree, 'completed');
      fs.writeFileSync(path.join(worktree, '.mcp.json'), '{}');
      await run(worktree, 'failed');
    });
    await t.test('unresolved repository boundary retains conservative ancestry checks', async () => {
      const noRepo = path.join(home, 'plain'); fs.mkdirSync(noRepo);
      await run(noRepo, 'failed');
    });
  } finally { await client.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
