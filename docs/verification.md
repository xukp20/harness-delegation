# Verification evidence

## Compact response verification — 2026-09-13

Public CLI/MCP queries now project compact state, aggregate adjacent progress text without rewriting, and expose raw diagnostics via `detail=true` / `--detail`. Persisted receipts remain intact. Matching MCP text and structured output are retained for compatibility; transport byte reduction is not a measured model-token reduction.

Focused validation: `node --test tests/presentation.test.mjs tests/mcp.test.mjs tests/audit-regressions.test.mjs tests/integration.test.mjs` passed 27/27. After adding CLI parity checks and preserving CLI help through projection, `node --test tests/mcp.test.mjs` passed again. Syntax checks, Skill validation and diff whitespace checks passed. Coverage includes exact Unicode/code text aggregation, message/tool/truncation boundaries, empty visible pages, raw pagination, error/cleanup visibility, detailed queries, and the affected lifecycle integration cases. The full suite was not rerun.

Historical real-job replay: Pi `job_947f6045-28e3-4adc-8ab0-8438e11d84fe` merged five text deltas into one block; Grok `job_d6ba225f-504c-48c3-b023-7998debca44d` merged nine into one. Both matched their saved final text exactly. JSON data bytes (excluding the common envelope): Pi result 1843 → 179, read 720 → 238; Grok result 2228 → 183, read 1248 → 243. These are short canaries, not a claim of equivalent savings for long prose.

New live read-only calls used the configured providers in the actual repository, requesting a README read and longer text including Chinese and fenced JSON. Pi `job_deb9ad0c-dccf-4ced-8374-a5805dd1bdf4` failed before inference: its existing local BeeAPI credential helper still reads the main Codex config, whose BeeAPI block had been moved to dormant private storage. Grok `job_6149bfcf-8337-405c-9099-2f8ae328db28` passed initialization/exact tool verification but produced no text or tool call before its 120-second deadline. Both confirmed stopped cleanup. No provider switch, credential change or automatic paid retry was performed. Live long-text/tool-interleaving success remains unverified; historical replay and fixture coverage do not substitute for that result.

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

## Home-ancestor repair — 2026-09-12

Base commit: `c3df617`. The operator's real `/root/code/harness-delegation` Grok job `job_0dc245ad-8322-488b-be55-1e396b3ebae5` failed before launch because the bridge's unbounded ancestor guard encountered user config `/root/.grok/config.toml`. A `/tmp` success was a useful control, not final acceptance. No contents of the real user config were needed or modified.

Native no-model discovery probe: `node /tmp/harness-config-discovery.mjs` created an isolated temporary state, an ordinary Git repository below a synthetic user directory, and inert `{}`/comment-only config sentinels at user, parent, worktree root and cwd. It launched the normal Grok 1.0.30 isolated HOME/GROK_HOME/profile directly, initialized, created a session and verified live tools without prompting. `inotifywait -m -q -e open` observed reads of root `.claude/settings.json`, root/cwd `.grok/config.toml` and `.mcp.json`, and cwd `.cursor/mcp.json`; no watched file above the worktree was opened. The probe cleaned its temporary directory and watcher/native processes. The source confirms Git-bounded project discovery; certain loaders use only cwd or root. The bridge deliberately retains the old conservative full walk when Git cannot establish a valid boundary.

Real final acceptance used the actual repository, not `/tmp`:

```bash
node bin/harness-delegate.mjs start --harness grok --cwd /root/code/harness-delegation --task 'Reply exactly GROK_ROOT_WORKSPACE_OK. Do not use tools or modify any files.' --request-key grok-root-workspace-20260912-ancestry-fix --timeout-seconds 90
node bin/harness-delegate.mjs wait job_9256af05-f202-4ad5-9a59-0143961f3dd0 --timeout-seconds 30
node bin/harness-delegate.mjs result job_9256af05-f202-4ad5-9a59-0143961f3dd0
```

Job `job_9256af05-f202-4ad5-9a59-0143961f3dd0` completed in 4.775 seconds with exact text `GROK_ROOT_WORKSPACE_OK`, `end_turn`, native session `01a09648-4531-7610-a8a5-11f4965bd7c5`, exact `tools.verified=[read_file,list_dir,grep]`, no tool calls and `cleanup={stopped:true,forced:false}`. Model `grok-4.6`, low reasoning; native usage: one call, input 4,243, output 48, cached-read 128, reasoning 35, `costUsdTicks=29178800`. Git before/after snapshots matched exactly: base HEAD `c3df617` with only the existing adapter/test repair changes. They were not clean snapshots, and the model introduced no additional Git-status changes.

Pi was not called again: the operator's current successful `job_dc898375-4a85-4a17-b6cb-1742d682a97e` remains the unchanged Pi baseline. The new security regression exercises the real MCP/core/supervisor path using fake native execution, observing immediate prompt receipt for allowed cases and absence of a native child/prompt for rejected cases. It covers home ancestors, all guarded markers, cwd-local config, auth-home/cwd aliases, project links to user config, dangling links, linked worktrees and conservative unresolved-repository fallback.

Checks: initial `node --test tests/project-config.test.mjs` passed 15/15; after adding linked-worktree coverage, `node --test tests/project-config.test.mjs tests/handshake.test.mjs` passed 23/23. Stable-candidate `npm run check`, `npm test` (47/47) and `git diff --check` passed. No model calls are part of these tests.

The independent Astra security audit confirmed an existing, separate guard omission: `.grok/lsp.json` can reach native workspace construction and background LSP startup during session/new when native trust allows, regardless of the curated tool list. This was established from source, not by executing an LSP canary. The marker and pre-launch regression were added. The audit found no confirmed bypass in the new canonical worktree boundary. After this conservative marker addition, final `node --test tests/project-config.test.mjs tests/handshake.test.mjs` passed 24/24, `npm run check` and `git diff --check` passed; the earlier 47/47 full run predates it. No further paid model call was needed because the successful root-workspace canary has no project LSP config.

The audit also noted the probe's initial fixed watcher startup delay. The no-model discovery probe was strengthened to wait for `inotifywait -m -e open` to report `Watches established.` before launching Grok, then rerun. It produced the same six opened-file paths and zero watched paths outside the worktree. Explicit `GIT_*` pollution has not received a dedicated fixture test; the bounded Git discovery's finite environment excludes those variables by construction.
