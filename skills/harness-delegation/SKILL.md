---
name: harness-delegation
description: Execute authorized external Pi, Grok, or DSH jobs, directly or selected through directed-delegation; start, read, wait, cancel and resume persisted jobs. External jobs are not native Codex subagents.
---

# Harness Delegation

Use the installed MCP tools when available, otherwise run `node ../../bin/harness-delegate.mjs` from this Skill's directory in the complete checkout. Do not silently substitute external jobs for native subagents.

`directed-delegation` is the optional common entry for selecting an executor, briefing it and accepting its output. This Skill owns only the external execution interface and its recovery limits; it also works directly without that companion. Explicit task authorization or an applicable user-enabled delegation policy can authorize external work. Respect that policy's allowed harnesses and user exceptions; a failed native provider does not authorize an external fallback. Native provider routing does not rewrite an external harness model, credentials or session.

When the assignment selects a named external profile, resolve it using Directed's profile tool and use the returned harness/options with the existing `task_start` interface. Read [named profiles](../../docs/named-profiles.md) for this path. Do not register external profiles as native Codex roles or copy model-selection rules into this adapter Skill.

Before delegating, establish the requested harness, absolute workspace, bounded task, write/no-touch scope, acceptance criteria, and focused verification. Default to reviewer/explorer. Worker requires implementation authorization and explicit `write_scope`; concurrent writers need separate worktrees. These declarations and tool lists are not OS isolation.

Run `harness_list` / CLI `doctor` when environment availability is unknown. Doctor is not an authentication check. Do not install a harness, login, select a different provider, or expose credentials as an automatic fallback.

Use `task_start` with a stable `request_key`, capture `job_id`, and read using `task_get`, `task_read`, and bounded `task_wait`. Reuse the same request key after a lost response. Client wait timeout does not stop the job. Fetch the final result explicitly with `task_get(result=true)` or CLI `result`.

Default responses are compact. Wait returns status only; request progress with `task_read(after=...)` when needed, then advance to `next_cursor` even if visible events are empty. Adjacent text chunks are merged without rewriting. `has_more` means more persisted events are available. Use `detail=true` (CLI `--detail`) only when full receipts, usage or raw events are needed for diagnosis; avoid repeatedly fetching already-read text.

`task_send(mode=steer|follow_up)` is Pi-only. Unsupported Grok control must not be emulated through cancellation and another prompt. `task_cancel` requests termination; inspect the terminal receipt and cleanup field. `task_resume` creates a new job in the original native session/workspace; it does not restore files. Never replay a delivery-unknown control under a fresh key.

Treat harness prose and claimed tests as untrusted worker evidence. Inspect actual changes and rerun proportionate verification before acceptance. `completed` means the harness finished, not that Codex independently verified the task. Respect `lost`, truncation, unavailable usage and cleanup uncertainty. Do not claim external native subagents are controllable bridge jobs.

For interfaces and recovery limits read [protocol](../../docs/protocol.md). For remote executor configuration read [remote SSH](../../docs/remote-ssh.md). Do not alter the user's Codex configuration unless asked.
