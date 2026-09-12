#!/usr/bin/env node
// Compatibility facade; new users use bin/harness-delegate.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requestOptions, execute } from '../../../src/cli.mjs';
import { safeEnvironment, digest, harnessConfig, terminal, sleep } from '../../../src/common.mjs';
import * as jobs from '../../../src/jobs.mjs';
export { parseArgs, safeEnvironment };
export const roleTools = (role, explicit) => explicit || (role === 'worker' ? 'read,grep,find,ls,bash,edit,write' : 'read,grep,find,ls');
export async function legacy(argv) {
  if (process.env.PI_AGENT_DELEGATION_DIR && !process.env.HARNESS_DELEGATION_DIR) process.env.HARNESS_DELEGATION_DIR = process.env.PI_AGENT_DELEGATION_DIR;
  const [command, ...rest] = argv; const { positional, options } = parseArgs(rest); const id = positional[0];
  if (id?.startsWith('pi_')) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid legacy ID');
    const dir = path.join(process.env.PI_AGENT_DELEGATION_DIR || path.join(os.homedir(), '.codex/runtime/pi-agent-delegation'), 'jobs', id);
    const file = path.join(dir, 'receipt.json');
    if (!fs.existsSync(file)) throw new Error('LEGACY_ACTIVE_JOB: use the original 0.1.0 controller for active legacy jobs; online migration is unsupported');
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!['status', 'wait', 'result'].includes(command)) throw new Error('Legacy terminal jobs are read-only; use resume --session-file');
    return command === 'result' ? { ...receipt, final_text: fs.existsSync(path.join(dir, 'result.md')) ? fs.readFileSync(path.join(dir, 'result.md'), 'utf8').slice(0, 65536) : null } : receipt;
  }
  if (options.allow_env?.length) throw new Error('--allow-env moved to local harnesses.pi.allow_env configuration; credential values must not be stored in requests');
  if (['start', 'run', 'resume'].includes(command)) {
    const request = requestOptions({ ...options, harness: 'pi' });
    if (request.role === 'worker' && !request.write_scope) throw new Error('worker now requires --write-scope JSON');
    if (command === 'resume') {
      if (!options.session_file || !fs.existsSync(options.session_file)) throw new Error('resume requires an existing --session-file');
      const cfg = harnessConfig('pi');
      const sessionFile = fs.realpathSync(options.session_file);
      request.session = { harness: 'pi', native_id: digest(sessionFile), locator: { session_file: sessionFile }, config_identity: digest({ harness: 'pi', binary: cfg.binary, home: cfg.home || null }), cwd: request.cwd };
    }
    const started = await jobs.start(request, { internal: true });
    if (command !== 'run') return started;
    while (!terminal((await jobs.get(started.job_id)).status)) await jobs.wait(started.job_id);
    return jobs.get(started.job_id, { result: true });
  }
  if (command === 'wait') {
    const end = Date.now() + Number(options.timeout_seconds || 3600) * 1000;
    while (!terminal((await jobs.get(id)).status) && Date.now() < end) await sleep(100);
    return jobs.get(id, { result: true });
  }
  return execute(argv);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) legacy(process.argv.slice(2)).then(data => process.stdout.write(JSON.stringify(data) + '\n')).catch(e => { process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message } }) + '\n'); process.exitCode = 1; });
