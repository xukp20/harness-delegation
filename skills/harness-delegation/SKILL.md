---
name: harness-delegation
description: Delegate explicitly authorized, bounded work from native Codex to external Pi or Grok coding harnesses; start, read, wait, cancel and resume persisted jobs. External jobs are not native Codex subagents.
---

# Harness Delegation

Use the installed MCP tools when available, otherwise run `node ../../bin/harness-delegate.mjs` from this Skill's directory in the complete checkout. Do not silently substitute external jobs for native subagents.

Before delegating, establish the requested harness, absolute workspace, bounded task, write/no-touch scope, acceptance criteria, and focused verification. Default to reviewer/explorer. Worker requires implementation authorization and explicit `write_scope`; concurrent writers need separate worktrees. These declarations and tool lists are not OS isolation.

Run `harness_list` / CLI `doctor` when environment availability is unknown. Doctor is not an authentication check. Do not install a harness, login, select a different provider, or expose credentials as an automatic fallback.

Use `task_start` with a stable `request_key`, capture `job_id`, and read using `task_get`, `task_read`, and bounded `task_wait`. Reuse the same request key after a lost response. Client wait timeout does not stop the job. Fetch the final result explicitly with `task_get(result=true)` or CLI `result`.

`task_send(mode=steer|follow_up)` is Pi-only. Unsupported Grok control must not be emulated through cancellation and another prompt. `task_cancel` requests termination; inspect the terminal receipt and cleanup field. `task_resume` creates a new job in the original native session/workspace; it does not restore files. Never replay a delivery-unknown control under a fresh key.

Treat harness prose and claimed tests as untrusted worker evidence. Inspect actual changes and rerun proportionate verification before acceptance. `completed` means the harness finished, not that Codex independently verified the task. Respect `lost`, truncation, unavailable usage and cleanup uncertainty. Do not claim external native subagents are controllable bridge jobs.

For interfaces and recovery limits read [protocol](../../docs/protocol.md). For remote executor configuration read [remote SSH](../../docs/remote-ssh.md). Do not alter the user's Codex configuration unless asked.
