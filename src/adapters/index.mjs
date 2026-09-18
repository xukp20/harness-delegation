import { spawnSync } from 'node:child_process';
import { harnessConfig, safeEnvironment, fail } from '../common.mjs';
import * as pi from './pi.mjs';
import * as grok from './grok.mjs';
import * as dsh from './dsh.mjs';

export function adapterFor(harness) {
  if (harness === 'pi') return pi;
  if (harness === 'grok') return grok;
  if (harness === 'dsh') return dsh;
  throw fail('INVALID_REQUEST', 'harness must be pi, grok or dsh');
}
export function doctor(harness) {
  const adapter = adapterFor(harness); const cfg = harnessConfig(harness);
  const result = spawnSync(cfg.binary, ['--version'], { encoding: 'utf8', timeout: 10000, env: safeEnvironment(cfg.allow_env), maxBuffer: 65536 });
  return { harness, available: result.status === 0, binary: cfg.binary, version: result.status === 0 ? result.stdout.trim() : null, error: result.error?.code || null, authentication: 'not_validated', capabilities: adapter.capabilities, note: 'Capabilities target tested versions; resume is negotiated at connection. No model call was made.' };
}
