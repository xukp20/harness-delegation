# Pi Agent Delegation

Pi Agent Delegation lets a Codex session delegate bounded explorer, worker, and reviewer jobs to the Pi coding agent over its official RPC protocol. Pi runs as an external worker using its own provider configuration and session history; the Codex session remains the orchestrator and audits the resulting receipt.

The repository is self-contained at runtime. It requires Node.js and the `pi` CLI, but does not depend on Agent Runtime Kit (ARK). The implementation borrows proven lifecycle ideas from ARK's Pi adapter: strict JSONL framing, correlated RPC responses, persisted session locators, bounded waits, steering, cancellation, and terminal receipts.

## Capabilities

- Start foreground or detached Pi jobs and receive a stable job ID.
- Query status, wait for completion, steer active work, queue follow-ups, cancel, and resume a saved Pi session.
- Choose provider, model, thinking level, working directory, role, tool allowlist, and timeout per job.
- Keep reviewer and explorer jobs read-only at the Pi tool layer; enable shell/write/edit tools only for worker jobs.
- Persist request metadata, Pi events, stderr, session locator, usage, final text, before/after Git snapshots, and a structured receipt.
- Filter credential-like environment variables from the Pi tool environment unless explicitly allowed.

## Requirements

- Node.js 20 or newer.
- Pi coding agent available as `pi` on `PATH`.
- A configured Pi provider. For ChatGPT Plus/Pro, open Pi interactively and run `/login`, then select OpenAI Codex and device-code login on a headless server.

## CLI

```bash
node scripts/pi-agent.mjs doctor

node scripts/pi-agent.mjs start \
  --role reviewer \
  --cwd /path/to/repo \
  --task "Review HEAD for correctness and return findings first"

node scripts/pi-agent.mjs status JOB_ID
node scripts/pi-agent.mjs steer JOB_ID --message "Focus on recovery semantics"
node scripts/pi-agent.mjs wait JOB_ID --timeout-seconds 1800
node scripts/pi-agent.mjs result JOB_ID
```

Use `run` instead of `start` for a foreground start-wait-result cycle. Use `resume --session-file ...` to continue a persisted Pi session as a new job.

Runtime state defaults to `~/.codex/runtime/pi-agent-delegation`. Override it with `PI_AGENT_DELEGATION_DIR`.

## Security boundary

This is an external-agent channel, not a native Codex subagent. Jobs do not appear in Codex's agent tree. The orchestrating Codex session remains responsible for validating scope, reviewing diffs, and deciding whether to integrate changes.

Pi OAuth credentials stay in Pi's own configuration directory. The controller never copies them into this repository or job receipts.
