# Verification evidence

Implementation baseline: original commit `9a12b75f6717bdfe58529f23c4b10dd77a848260`, whose six tests passed before refactoring. The v0.2 suite replaces those tests with core/adapter/CLI/MCP integration cases using fake subprocesses. No model calls are part of `npm test`.

Environment: Linux, Node 24.21.0. Tested binaries: Pi 0.80.10 and Grok Build 1.0.30 (`04b7ffed98c6`). Earlier v0.1 documentation mentioned Pi 0.82.0; that is historical evidence, not a claim that v0.2 was tested against that installation. Grok initialization rejects versions other than 1.0.30 until explicitly validated.

Commands:

```bash
npm run check
npm test
HARNESS_DELEGATION_CONFIG=/path/to/local-config.json node scripts/probe.mjs pi
HARNESS_DELEGATION_CONFIG=/path/to/local-config.json node scripts/probe.mjs grok
HARNESS_DELEGATION_CONFIG=/path/to/local-config.json node scripts/probe.mjs grok worker
```

No-model Pi fresh/load passed. Grok ACP v1 initialize, exact read-only profile, fresh session and load passed. Grok's empty curated profile failed during session initialization; this is now an explicit unsupported capability rather than inheriting default tools. Probes clean their own temporary session/state directory and never send a prompt.

Real Grok canary on 2026-09-12: a reviewer job with three read-only tools asked for exactly `GROK_CANARY_OK` and prohibited tool use. It returned the exact text with `stopReason=end_turn`, persisted native session `01a09562-0023-7c40-9f3c-c9692b50988d`, and completed process cleanup. Native xAI metadata reported 4,065 input tokens, 43 output tokens, 128 cached-read tokens, 32 reasoning tokens, one model call, and `costUsdTicks=27866400`. The requested model was `grok-4.6`; native per-model usage named `grok-4.6-build`. These are reported native counters, not a bridge price estimate.

The first real receipt preceded the xAI usage mapper and therefore has `usage:null`; its bounded native log retained the above evidence. The mapper was then added using the observed prompt-response `_meta.usage` shape. A tiny continuation returned `GROK_RESUME_OK` in the same native session, with completed/clean shutdown and a populated turn-scoped receipt: 4,184 input tokens, 31 output tokens, 256 cached-read tokens, 21 reasoning tokens, one model call and `costUsdTicks=27778000`. No tools were used in either real turn. The worker profile also passed the no-model fresh/load probe with its exact five declared tools.

Initial real Pi canary: configured `openai-codex` / `gpt-5.6-luna`, tools disabled, tiny fixed response. It failed before inference with `No API key found for openai-codex`. The default native auth file and existing Pi research auth files had no configured providers. No credentials were invented/copied and no provider was substituted. At that checkpoint, Pi live model success/paid continuation was unverified. Pi no-model session creation/loading and fake control/error/usage paths passed. The later operator-configured BeeAPI verification below supersedes the live-success gap, not the historical result.

The CLI/MCP process-exit tests verify that detached fake jobs remain readable after the launching CLI returns and after an MCP client closes/reconnects. Desktop-specific task cancellation, remote executor cgroup teardown, logout and reboot survival were not tested and are not promised.

Tests cover request validation, finite environment forwarding, start/control idempotency, current-vs-historical Pi results, private receipts, cursor reads, client wait timeout, workspace reader/writer exclusion, session resume exclusion, cancellation, uncooperative shutdown escalation, malformed wire, native errors, crash/lost reconciliation, bounded logs, Grok permission rejection/capability gating/resume, legacy receipts, JSON CLI, and MCP reconnection. Independent audit and final test totals are recorded in the delivery report; this document does not imply paid live coverage for every fixture case.

The final independent Astra review found four reproducible defects: group members surviving a lost leader could release exclusion, changing Grok auth Home could retain the old link, oversized events could stall cursors, and legacy Pi symlink aliases could bypass session exclusion. Each was corrected with an independent regression case in `tests/audit-regressions.test.mjs` (4/4 passed). Final `npm run check`, `npm test` (23/23), and `git diff --check` passed. No-model Pi and Grok reviewer/worker fresh/load probes passed again after these changes. No additional paid retry was needed for these process/storage/path fixes.

## Installed MCP repair — 2026-09-12

Base commit: `b05acc5`. Actual registered command: `/usr/bin/node /root/code/harness-delegation/bin/harness-delegate.mjs mcp`. A fresh SDK Client listed all nine documented tools and called `task_start → task_wait → task_get(result:true)` against the persistent default state root. Pi was operator-configured 0.85.1, BeeAPI / `gpt-5.6-sol`, high thinking, no tools; Grok remained 1.0.30, `grok-4.6`, low thinking, exact three read-only tools. No real config/auth files were edited for this repair.

Baseline Grok job `job_b875917b-1d6d-4ece-b946-732606da757a` reproduced `TOOL_PROFILE_MISMATCH` before any prompt: the native log lacked the unsolicited tool update. A no-model `_x.ai/commands/list` request with the real session ID returned the actual three tools. Source inspection traced this private extension to live registered tool names; the adapter now pulls that catalog after new/load and fails closed on an inexact/missing set. Persistent state was present in both failing and successful runs; the exact internal reason for the unsolicited notification's omission remains unproven.

The SDK client's default environment omitted proxy variables. With that default, repaired Grok job `job_b914963f-0403-497e-984c-e230e8f0a6de` passed tool verification but native requests reported connection timeout to the model endpoint; the 120-second bridge deadline stopped the job (forced cleanup). Pi job `job_ac27cdc4-5341-4c0c-a540-b5d2570f0a3a` reported native `Request timed out.` and the adapter aborted its first retry backoff, retained `source=pi_assistant`, and cleaned up. These failures were not automatically replayed.

A new, explicitly authorized tiny attempt after the environment diagnosis used the same STDIO command with `env:safeEnvironment()` (including existing proxy variables, not unrestricted environment inheritance). Both completed:

| Harness | Job / native session | Result / native usage |
| --- | --- | --- |
| Grok | `job_d636943e-04fb-4c27-ab9e-01a05ba9ae05` / `01a0962b-089b-7e31-b719-0efd77af49c5` | `GROK_MCP_OK`; one model call, input 4,177, output 44, cached-read 128, reasoning 34; `costUsdTicks=28648400` |
| Pi | `job_5e3130c8-bf8c-4fc1-9250-16272d8aa9f1` / `118306f3-9ced-49a4-9215-a38f18c14ec8` | `PI_MCP_OK` plus newline; session input 874, output 21, cache-read 4,608, total 5,503; reported cost `0.005759200000000001` |

Both receipts show `cleanup.stopped=true`, no forced cleanup and no tool calls. Prompts were `Reply exactly GROK_MCP_OK. Do not use tools.` and the analogous Pi token; execution limits were 90 seconds, client waits 15 seconds. This proves the real MCP client/server/supervisor/model path with supplied proxy environment. It does not certify the current Desktop process's inherited environment or hot refresh, nor attribute all earlier BeeAPI failures to the same cause. No additional paid continuation was needed for this handshake/error-surface repair.

Actual checks: `node --test tests/handshake.test.mjs` (7/7); `node --test --test-name-pattern='core, adapters|Pi native retry' tests/integration.test.mjs` (19/19); stable-candidate `npm run check`, `npm test` (31/31), `git diff --check` (all passed). `node scripts/probe.mjs pi`, `node scripts/probe.mjs grok`, and `node scripts/probe.mjs grok worker` each passed fresh/load without a prompt. `pi --version` reported 0.85.1 and `grok --version` reported 1.0.30 (`04b7ffed98c6`). Fixture coverage includes missing/late unsolicited tools, mismatched/duplicate/missing live catalogs over MCP and detached supervisors, and aborting Pi backoff while preserving a current assistant error no longer in `get_messages`.

The final independent Astra focused audit found no blocking code/security defect. It suggested strengthening the rejected-profile regression to observe prompt receipt immediately rather than infer it from delayed result output. That fixture marker/assertion was added; the final focused handshake suite passed 7/7, along with syntax and diff checks. The 31/31 full run preceded this test-only strengthening; no production code changed afterward and no extra paid canary was needed.
