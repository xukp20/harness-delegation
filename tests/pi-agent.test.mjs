import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { parseArgs, roleTools, safeEnvironment } from "../scripts/pi-agent.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "scripts", "pi-agent.mjs");
const fakePi = path.join(root, "tests", "fixtures", "fake-pi.mjs");

async function waitUntilRunning(jobId, env) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const raw = await execFileAsync(process.execPath, [cli, "status", jobId], { env });
    const state = JSON.parse(raw.stdout);
    if (state.status === "running") return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Fake Pi job did not reach running state: ${jobId}`);
}

test("argument parsing keeps repeatable allow-env values", () => {
  const parsed = parseArgs(["job", "--allow-env", "ONE", "--allow-env", "TWO", "--thinking", "low"]);
  assert.deepEqual(parsed.positional, ["job"]);
  assert.deepEqual(parsed.options.allowEnv, ["ONE", "TWO"]);
  assert.equal(parsed.options.thinking, "low");
});

test("role defaults keep reviewers read-only", () => {
  assert.equal(roleTools("reviewer"), "read,grep,find,ls");
  assert.equal(roleTools("explorer"), "read,grep,find,ls");
  assert.match(roleTools("worker"), /bash,edit,write/);
});

test("sensitive environment values are filtered unless allowed", () => {
  const filtered = safeEnvironment(["NEEDED_TOKEN"], {
    PATH: "/bin",
    OPENAI_API_KEY: "hidden",
    NEEDED_TOKEN: "kept",
  });
  assert.equal(filtered.PATH, "/bin");
  assert.equal(filtered.OPENAI_API_KEY, undefined);
  assert.equal(filtered.NEEDED_TOKEN, "kept");
});

test("detached fake Pi job reaches a persisted terminal receipt", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-agent-delegation-test-"));
  const env = {
    ...process.env,
    PI_AGENT_DELEGATION_DIR: path.join(temporary, "runtime"),
    PI_AGENT_PI_BIN: fakePi,
  };
  const startedRaw = await execFileAsync(process.execPath, [cli, "start", "--role", "reviewer", "--cwd", temporary, "--task", "Review fixture"], { env });
  const started = JSON.parse(startedRaw.stdout);
  assert.match(started.job_id, /^pi_/);
  const waitedRaw = await execFileAsync(process.execPath, [cli, "wait", started.job_id, "--timeout-seconds", "10"], { env });
  const waited = JSON.parse(waitedRaw.stdout);
  assert.equal(waited.status, "completed");
  assert.equal(waited.final_text, "FAKE_PI_DONE");
  const receipt = JSON.parse(await fsp.readFile(path.join(started.job_dir, "receipt.json"), "utf8"));
  assert.equal(receipt.model, "gpt-5.6-luna");
  assert.equal(receipt.status, "completed");
  const resultRaw = await execFileAsync(process.execPath, [cli, "result", started.job_id], { env });
  const result = JSON.parse(resultRaw.stdout);
  assert.equal(result.final_text, "FAKE_PI_DONE");
});

test("active jobs accept steer and follow-up, then persist cancellation", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-agent-delegation-control-test-"));
  const env = {
    ...process.env,
    FAKE_PI_DELAY_MS: "5000",
    PI_AGENT_DELEGATION_DIR: path.join(temporary, "runtime"),
    PI_AGENT_PI_BIN: fakePi,
  };
  const startedRaw = await execFileAsync(process.execPath, [cli, "start", "--role", "reviewer", "--cwd", temporary, "--task", "Review fixture"], { env });
  const started = JSON.parse(startedRaw.stdout);
  await waitUntilRunning(started.job_id, env);
  const steerRaw = await execFileAsync(process.execPath, [cli, "steer", started.job_id, "--message", "Focus on safety"], { env });
  assert.equal(JSON.parse(steerRaw.stdout).accepted, true);
  const followRaw = await execFileAsync(process.execPath, [cli, "follow-up", started.job_id, "--message", "Then summarize"], { env });
  assert.equal(JSON.parse(followRaw.stdout).accepted, true);
  const cancelRaw = await execFileAsync(process.execPath, [cli, "cancel", started.job_id], { env });
  assert.equal(JSON.parse(cancelRaw.stdout).accepted, true);
  const waitedRaw = await execFileAsync(process.execPath, [cli, "wait", started.job_id, "--timeout-seconds", "10"], { env });
  assert.equal(JSON.parse(waitedRaw.stdout).status, "cancelled");
});

test("resume requires and forwards an explicit session file", async () => {
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-agent-delegation-resume-test-"));
  const env = {
    ...process.env,
    PI_AGENT_DELEGATION_DIR: path.join(temporary, "runtime"),
    PI_AGENT_PI_BIN: fakePi,
  };
  const sessionFile = path.join(temporary, "prior-session.jsonl");
  await fsp.writeFile(sessionFile, "");
  const startedRaw = await execFileAsync(process.execPath, [cli, "resume", "--session-file", sessionFile, "--cwd", temporary, "--task", "Continue review"], { env });
  const started = JSON.parse(startedRaw.stdout);
  const waitedRaw = await execFileAsync(process.execPath, [cli, "wait", started.job_id, "--timeout-seconds", "10"], { env });
  const waited = JSON.parse(waitedRaw.stdout);
  assert.equal(waited.status, "completed");
  const request = JSON.parse(await fsp.readFile(path.join(started.job_dir, "request.json"), "utf8"));
  assert.equal(request.sessionFile, sessionFile);
});
