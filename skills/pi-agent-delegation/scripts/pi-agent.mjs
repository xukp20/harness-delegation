#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const TERMINAL_STATES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_THINKING = "high";
const DEFAULT_TIMEOUT_SECONDS = 3600;
const READ_ONLY_TOOLS = "read,grep,find,ls";
const WORKER_TOOLS = `${READ_ONLY_TOOLS},bash,edit,write`;
const SENSITIVE_ENV = /(api[_-]?key|token|secret|password|credential|authorization|auth[_-]?key)/i;

function now() {
  return new Date().toISOString();
}

function runtimeRoot(env = process.env) {
  return path.resolve(env.PI_AGENT_DELEGATION_DIR || path.join(os.homedir(), ".codex", "runtime", "pi-agent-delegation"));
}

function jobDir(jobId, env = process.env) {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error(`Invalid job id: ${jobId}`);
  return path.join(runtimeRoot(env), "jobs", jobId);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["help", "json"].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`Missing value for --${key}`);
    index += 1;
    if (key === "allow-env") {
      options.allowEnv ||= [];
      options.allowEnv.push(next);
    } else {
      options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = next;
    }
  }
  return { positional, options };
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, file);
}

async function appendEvent(directory, event) {
  await fsp.appendFile(path.join(directory, "events.jsonl"), `${JSON.stringify({ at: now(), ...event })}\n`, { mode: 0o600 });
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function commandExists(command) {
  return spawnSync("sh", ["-lc", `command -v "$1"` , "sh", command], { encoding: "utf8" }).status === 0;
}

function piBinary(env = process.env) {
  return env.PI_AGENT_PI_BIN || "pi";
}

function safeEnvironment(allowNames = [], env = process.env) {
  const allowed = new Set(allowNames);
  const output = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV.test(key) && !allowed.has(key)) continue;
    output[key] = value;
  }
  return output;
}

function roleTools(role, explicitTools) {
  if (explicitTools) return explicitTools;
  return role === "worker" ? WORKER_TOOLS : READ_ONLY_TOOLS;
}

function rolePrompt(request) {
  const lines = [
    `You are an external Pi ${request.role} delegated by a Codex orchestrator.`,
    "Work only on the bounded task below. Return concrete evidence and a concise final report.",
  ];
  if (request.role !== "worker") {
    lines.push("This is a read-only task. Do not modify repository files, create commits, or push changes.");
  } else {
    lines.push("Modify only the explicitly authorized scope. Do not commit, merge, or push unless the task explicitly requests it.");
  }
  lines.push("", "## Delegated task", request.task);
  return lines.join("\n");
}

function gitSnapshot(cwd) {
  const root = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (root.status !== 0) return null;
  const head = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["-C", cwd, "status", "--short", "--untracked-files=all"], { encoding: "utf8" });
  return {
    root: root.stdout.trim(),
    head: head.status === 0 ? head.stdout.trim() : null,
    status: status.status === 0 ? status.stdout.trim().split("\n").filter(Boolean) : null,
  };
}

function extractText(message) {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

class PiRpc {
  constructor(child, directory) {
    this.child = child;
    this.directory = directory;
    this.buffer = "";
    this.pending = new Map();
    this.waiters = [];
    this.closedError = null;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.#onStdout(chunk));
    child.stderr.on("data", (chunk) => {
      void fsp.appendFile(path.join(directory, "stderr.log"), chunk, { mode: 0o600 });
    });
    child.on("exit", (code, signal) => this.#close(new Error(`Pi RPC exited code=${code} signal=${signal}`)));
    child.on("error", (error) => this.#close(error));
  }

  async command(type, payload = {}, timeoutMs = 15000) {
    if (this.closedError) throw this.closedError;
    const id = `pi-agent-${crypto.randomUUID()}`;
    const request = { id, type, ...payload };
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Pi RPC command timed out: ${type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, type });
    });
    this.child.stdin.write(`${JSON.stringify(request)}\n`);
    const record = await response;
    if (record.success !== true) throw new Error(record.error || `Pi RPC ${type} failed`);
    return record;
  }

  waitFor(predicate, timeoutMs) {
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error("Pi RPC event wait timed out"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  #onStdout(chunk) {
    this.buffer += chunk;
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        this.#close(new Error(`Pi RPC emitted invalid JSON: ${error.message}`));
        return;
      }
      void appendEvent(this.directory, { source: "pi", record });
      if (record.type === "response" && typeof record.id === "string") {
        const pending = this.pending.get(record.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(record.id);
          pending.resolve(record);
        }
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(record)) {
          clearTimeout(waiter.timer);
          this.waiters = this.waiters.filter((item) => item !== waiter);
          waiter.resolve(record);
        }
      }
    }
  }

  #close(error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }
}

async function terminateProcessGroup(child, signal = "SIGTERM") {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function createControlServer(socketPath, rpc, context) {
  try {
    await fsp.unlink(socketPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const server = net.createServer((connection) => {
    let input = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => {
      input += chunk;
      const newline = input.indexOf("\n");
      if (newline < 0) return;
      const line = input.slice(0, newline);
      void (async () => {
        try {
          const request = JSON.parse(line);
          if (!["steer", "follow_up", "abort"].includes(request.action)) throw new Error("Unsupported control action");
          const payload = request.action === "abort" ? {} : { message: request.message };
          await rpc.command(request.action, payload, 10000);
          if (request.action === "abort") context.cancelRequested = true;
          connection.end(`${JSON.stringify({ accepted: true, action: request.action })}\n`);
        } catch (error) {
          connection.end(`${JSON.stringify({ accepted: false, error: error.message })}\n`);
        }
      })();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  await fsp.chmod(socketPath, 0o600);
  return server;
}

async function supervise(jobId) {
  const directory = jobDir(jobId);
  const request = await readJson(path.join(directory, "request.json"));
  const stateFile = path.join(directory, "state.json");
  const socketPath = path.join(directory, "control.sock");
  const sessionRoot = path.join(runtimeRoot(), "sessions");
  await fsp.mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const args = [
    "--mode", "rpc",
    "--provider", request.provider,
    "--model", request.model,
    "--thinking", request.thinking,
    "--session-dir", sessionRoot,
    "--tools", request.tools,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-approve",
  ];
  if (request.sessionFile) args.push("--session", request.sessionFile);
  else args.push("--session-id", request.sessionId);
  let child;
  let controlServer;
  let timeout;
  const context = { cancelRequested: false, timedOut: false };
  const startedAt = now();
  const gitBefore = gitSnapshot(request.cwd);
  try {
    await writeJsonAtomic(stateFile, { job_id: jobId, status: "starting", supervisor_pid: process.pid, started_at: startedAt });
    child = spawn(piBinary(), args, {
      cwd: request.cwd,
      env: safeEnvironment(request.allowEnv),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const rpc = new PiRpc(child, directory);
    controlServer = await createControlServer(socketPath, rpc, context);
    const initial = (await rpc.command("get_state")).data || {};
    await writeJsonAtomic(stateFile, {
      job_id: jobId,
      status: "running",
      supervisor_pid: process.pid,
      pi_pid: child.pid,
      started_at: startedAt,
      session_id: initial.sessionId || request.sessionId,
      session_file: initial.sessionFile || request.sessionFile || null,
      provider: request.provider,
      model: request.model,
      thinking: request.thinking,
      role: request.role,
    });
    const settled = rpc.waitFor((record) => record.type === "agent_settled", request.timeoutSeconds * 1000);
    timeout = setTimeout(() => {
      context.timedOut = true;
      void rpc.command("abort", {}, 5000).catch(() => terminateProcessGroup(child));
    }, request.timeoutSeconds * 1000);
    await rpc.command("prompt", { message: rolePrompt(request) });
    await settled;
    clearTimeout(timeout);
    const finalState = (await rpc.command("get_state")).data || {};
    const messages = (await rpc.command("get_messages")).data?.messages || [];
    const stats = (await rpc.command("get_session_stats")).data || {};
    const assistant = [...messages].reverse().find((message) => message?.role === "assistant");
    const finalText = extractText(assistant);
    const finishedAt = now();
    const status = context.timedOut ? "timed_out" : (context.cancelRequested ? "cancelled" : "completed");
    const receipt = {
      job_id: jobId,
      status,
      role: request.role,
      provider: request.provider,
      model: request.model,
      thinking: request.thinking,
      cwd: request.cwd,
      tools: request.tools.split(","),
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: Date.parse(finishedAt) - Date.parse(startedAt),
      session_id: finalState.sessionId || initial.sessionId || request.sessionId,
      session_file: finalState.sessionFile || initial.sessionFile || request.sessionFile || null,
      usage: stats.tokens || null,
      cost: stats.cost ?? null,
      context_usage: stats.contextUsage || null,
      git_before: gitBefore,
      git_after: gitSnapshot(request.cwd),
      final_text_path: path.join(directory, "result.md"),
      events_path: path.join(directory, "events.jsonl"),
      stderr_path: path.join(directory, "stderr.log"),
    };
    await fsp.writeFile(path.join(directory, "result.md"), finalText, { mode: 0o600 });
    await writeJsonAtomic(path.join(directory, "receipt.json"), receipt);
    await writeJsonAtomic(stateFile, { ...receipt, final_text: finalText });
    await appendEvent(directory, { source: "controller", type: "terminal", status });
  } catch (error) {
    if (timeout) clearTimeout(timeout);
    const finishedAt = now();
    const current = await readJson(stateFile).catch(() => ({ job_id: jobId, started_at: startedAt }));
    const status = context.timedOut || /timed out/i.test(error.message) ? "timed_out" : (context.cancelRequested ? "cancelled" : "failed");
    const receipt = {
      ...current,
      status,
      finished_at: finishedAt,
      error: { type: error.name, message: error.message },
      events_path: path.join(directory, "events.jsonl"),
      stderr_path: path.join(directory, "stderr.log"),
    };
    await writeJsonAtomic(path.join(directory, "receipt.json"), receipt);
    await writeJsonAtomic(stateFile, receipt);
    await appendEvent(directory, { source: "controller", type: "terminal", status, error: receipt.error });
  } finally {
    if (controlServer) await new Promise((resolve) => controlServer.close(resolve));
    try {
      await fsp.unlink(socketPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (child && child.exitCode === null) {
      child.stdin.end();
      await terminateProcessGroup(child, "SIGTERM");
    }
  }
}

async function buildRequest(options) {
  const role = options.role || "reviewer";
  if (!["explorer", "worker", "reviewer"].includes(role)) throw new Error(`Unsupported role: ${role}`);
  const cwd = path.resolve(options.cwd || process.cwd());
  const stat = await fsp.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`);
  let task = options.task;
  if (options.taskFile) task = await fsp.readFile(path.resolve(options.taskFile), "utf8");
  if (!task?.trim()) throw new Error("A non-empty --task or --task-file is required");
  const timeoutSeconds = Number(options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error("--timeout-seconds must be positive");
  return {
    role,
    cwd,
    task: task.trim(),
    provider: options.provider || DEFAULT_PROVIDER,
    model: options.model || DEFAULT_MODEL,
    thinking: options.thinking || DEFAULT_THINKING,
    tools: roleTools(role, options.tools),
    timeoutSeconds,
    allowEnv: options.allowEnv || [],
    sessionFile: options.sessionFile ? path.resolve(options.sessionFile) : null,
    sessionId: crypto.randomUUID(),
    createdAt: now(),
  };
}

async function startJob(options) {
  const request = await buildRequest(options);
  const jobId = `pi_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
  const directory = jobDir(jobId);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  await writeJsonAtomic(path.join(directory, "request.json"), request);
  await writeJsonAtomic(path.join(directory, "state.json"), { job_id: jobId, status: "queued", created_at: request.createdAt });
  const supervisor = spawn(process.execPath, [SCRIPT_PATH, "__supervise", jobId], {
    cwd: request.cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
  });
  supervisor.unref();
  return { job_id: jobId, status: "queued", job_dir: directory };
}

async function statusJob(jobId) {
  return readJson(path.join(jobDir(jobId), "state.json"));
}

async function waitJob(jobId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const state = await statusJob(jobId);
    if (TERMINAL_STATES.has(state.status)) return state;
    if (Date.now() >= deadline) throw new Error(`Client wait timed out for ${jobId}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function controlJob(jobId, action, message) {
  if (action !== "abort" && !message?.trim()) throw new Error(`${action} requires --message`);
  const socketPath = path.join(jobDir(jobId), "control.sock");
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(socketPath);
    let output = "";
    connection.setEncoding("utf8");
    connection.on("connect", () => connection.write(`${JSON.stringify({ action, message })}\n`));
    connection.on("data", (chunk) => { output += chunk; });
    connection.on("end", () => {
      try { resolve(JSON.parse(output.trim())); } catch (error) { reject(error); }
    });
    connection.on("error", reject);
  });
}

async function doctor(options) {
  const binary = piBinary();
  const found = commandExists(binary) || fs.existsSync(binary);
  const version = found ? spawnSync(binary, ["--version"], { encoding: "utf8" }) : null;
  const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
  let auth = null;
  try {
    const raw = await readJson(authPath);
    const entry = raw[options.provider || DEFAULT_PROVIDER];
    auth = entry ? { configured: true, type: entry.type, refreshable: typeof entry.refresh === "string" } : { configured: false };
  } catch {
    auth = { configured: false };
  }
  const provider = options.provider || DEFAULT_PROVIDER;
  const models = found ? spawnSync(binary, ["--list-models", provider], { encoding: "utf8", env: safeEnvironment([]) }) : null;
  return {
    ok: Boolean(found && version?.status === 0 && auth.configured && models?.status === 0),
    node: process.version,
    pi: { found, binary, version: version?.stdout?.trim() || null },
    provider,
    auth,
    model_list: models?.stdout?.trim().split("\n").slice(1).filter(Boolean) || [],
  };
}

function usage() {
  return `Usage: pi-agent.mjs <doctor|start|run|status|wait|steer|follow-up|cancel|resume|result> [options]`;
}

async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { positional, options } = parseArgs(rest);
  if (!command || options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "__supervise") {
    await supervise(positional[0]);
    return;
  }
  if (command === "doctor") {
    emit(await doctor(options));
    return;
  }
  if (["start", "resume", "run"].includes(command)) {
    if (command === "resume" && !options.sessionFile) throw new Error("resume requires --session-file");
    const started = await startJob(options);
    if (command === "run") {
      const waited = await waitJob(started.job_id, Number(options.waitTimeoutSeconds || options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS) + 30);
      emit(waited);
    } else {
      emit(started);
    }
    return;
  }
  const jobId = positional[0];
  if (!jobId) throw new Error(`${command} requires JOB_ID`);
  if (command === "status") emit(await statusJob(jobId));
  else if (command === "wait") emit(await waitJob(jobId, Number(options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS)));
  else if (command === "steer") emit(await controlJob(jobId, "steer", options.message));
  else if (command === "follow-up") emit(await controlJob(jobId, "follow_up", options.message));
  else if (command === "cancel") emit(await controlJob(jobId, "abort"));
  else if (command === "result") {
    const directory = jobDir(jobId);
    const receipt = await readJson(path.join(directory, "receipt.json"));
    const finalText = await fsp.readFile(path.join(directory, "result.md"), "utf8").catch(() => null);
    emit({ ...receipt, final_text: finalText });
  }
  else throw new Error(`Unknown command: ${command}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  main().catch((error) => {
    emit({ ok: false, error: { type: error.name, message: error.message } });
    process.exitCode = 1;
  });
}

export { buildRequest, doctor, parseArgs, rolePrompt, roleTools, safeEnvironment, startJob, statusJob, waitJob };
