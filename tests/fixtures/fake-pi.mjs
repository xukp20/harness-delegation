#!/usr/bin/env node

import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("fake-pi 1.0.0\n");
  process.exit(0);
}

if (process.argv.includes("--list-models")) {
  process.stdout.write("provider model context max-out thinking images\nopenai-codex fake-luna 128K 8K yes no\n");
  process.exit(0);
}

const sessionId = process.argv[process.argv.indexOf("--session-id") + 1] || "fake-session";
const sessionFile = `/tmp/${sessionId}.jsonl`;
const delayMs = Number(process.env.FAKE_PI_DELAY_MS || 150);
const messages = [];
let settleTimer;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(request, data = {}) {
  process.stdout.write(`${JSON.stringify({ id: request.id, type: "response", command: request.type, success: true, data })}\n`);
}

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "get_state") reply(request, { sessionId, sessionFile, isStreaming: false, isCompacting: false });
  else if (request.type === "prompt") {
    messages.push({ role: "user", content: request.message });
    reply(request);
    settleTimer = setTimeout(() => {
      messages.push({ role: "assistant", content: [{ type: "text", text: "FAKE_PI_DONE" }] });
      process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    }, delayMs);
  } else if (request.type === "get_messages") reply(request, { messages });
  else if (request.type === "get_session_stats") reply(request, { tokens: { input: 10, output: 2, total: 12 }, cost: 0, contextUsage: { tokens: 10, contextWindow: 128000, percent: 0.01 } });
  else if (["steer", "follow_up"].includes(request.type)) reply(request);
  else if (request.type === "abort") {
    if (settleTimer) clearTimeout(settleTimer);
    reply(request);
    process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  }
  else reply(request);
});
