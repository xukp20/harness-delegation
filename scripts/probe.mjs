// Operator-only, no prompts: connect, create a session, close, and load it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { adapterFor } from '../src/adapters/index.mjs';
import { harnessConfig, safeEnvironment, closeProcess, redact } from '../src/common.mjs';
const harness = process.argv[2]; const adapter = adapterFor(harness); const cfg = harnessConfig(harness);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-probe-'));
process.env.HARNESS_DELEGATION_DIR = path.join(temp, 'state');
const request = { harness, cwd: temp, role: process.argv[3] === 'worker' ? 'worker' : 'reviewer', harness_options: harness === 'pi' ? { tools: [] } : {}, timeout_seconds: 30 };
let session; let child; const diagnostics = [];
async function connect() {
  const dir = path.join(temp, 'state/jobs/probe'); fs.mkdirSync(dir, { recursive: true });
  const launch = adapter.prepare(request, cfg, dir); const stderr = [];
  child = spawn(cfg.binary, launch.args, { cwd: temp, env: { ...safeEnvironment(cfg.allow_env), ...launch.env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const handle = await adapter.connect(child, { request, tools: launch.tools, native_home: launch.native_home, session: value => { session = value; }, native: r => { if (r.error) diagnostics.push(r.error); }, event: () => {}, stderr: x => { if (diagnostics.length < 10) diagnostics.push(redact(x.toString().slice(-4000))); } });
  await closeProcess(child); child = null;
  return handle.capabilities;
}
try {
  const capabilities = await connect();
  request.session = session;
  await connect();
  console.log(JSON.stringify({ harness, fresh: true, load: true, native_session_id: session.native_id, capabilities, model_called: false }));
} catch (e) { console.log(JSON.stringify({ harness, error: { code: e.code, message: e.message }, diagnostics, model_called: false })); process.exitCode = 1; }
finally { if (child) await closeProcess(child); fs.rmSync(temp, { recursive: true, force: true }); }
