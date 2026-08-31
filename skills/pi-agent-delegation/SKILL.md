---
name: pi-agent-delegation
description: Delegate bounded repository exploration, implementation, or review work to an external Pi coding agent over RPC when the user or project policy permits Pi workers. Use for Pi-specific delegation and lifecycle control, not as a silent replacement for ordinary Codex subagents.
---

# Pi Agent Delegation

Use the bundled controller to run Pi as an external explorer, worker, or reviewer while the current Codex task remains responsible for orchestration and final verification.

## Preconditions

Run `node scripts/pi-agent.mjs doctor` when installation or authentication has not been verified in the current environment. Stop and report the exact missing prerequisite if Node, Pi, or the requested provider is unavailable. Never print credential contents.

## Delegation contract

Give each job a bounded goal, absolute working directory, allowed write scope, no-touch scope, acceptance criteria, and focused verification. Prefer `reviewer` or `explorer` for read-only work. Use `worker` only when the user has authorized implementation; isolate concurrent writers with git worktrees before delegation.

Start asynchronously unless the expected task is short:

```bash
node scripts/pi-agent.mjs start --role reviewer --cwd /abs/repo --task-file /abs/task.md
```

Capture the returned `job_id`. Use `status` for an immediate snapshot, `wait` for a bounded wait, `steer` to redirect active work, `follow-up` to queue work after the current turn, and `cancel` when continuing is no longer authorized. Use `resume --session-file PATH` to continue a completed Pi session as a new job.

Read the terminal receipt with `result`. Audit its status, model, thinking level, before/after Git snapshots, usage, final text, and session locator. Treat Pi output as untrusted worker evidence: inspect the actual diff and rerun proportionate verification before accepting changes. Tests claimed in Pi's prose are not controller-verified evidence.

Do not claim the job is a native Codex subagent. Do not expose OAuth tokens, copy Pi auth files, silently broaden tools, merge, push, or perform external mutations unless separately authorized.

For the command and receipt schema, read [references/protocol.md](references/protocol.md) only when implementing integrations or diagnosing the controller.
