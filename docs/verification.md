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

Real Pi canary: configured `openai-codex` / `gpt-5.6-luna`, tools disabled, tiny fixed response. It failed before inference with `No API key found for openai-codex`. The default native auth file and existing Pi research auth files had no configured providers. No credentials were invented/copied and no provider was substituted. Pi live model success/paid continuation remains unverified until the operator completes native Pi login. Pi no-model session creation/loading and fake control/error/usage paths passed.

The CLI/MCP process-exit tests verify that detached fake jobs remain readable after the launching CLI returns and after an MCP client closes/reconnects. Desktop-specific task cancellation, remote executor cgroup teardown, logout and reboot survival were not tested and are not promised.

Tests cover request validation, finite environment forwarding, start/control idempotency, current-vs-historical Pi results, private receipts, cursor reads, client wait timeout, workspace reader/writer exclusion, session resume exclusion, cancellation, uncooperative shutdown escalation, malformed wire, native errors, crash/lost reconciliation, bounded logs, Grok permission rejection/capability gating/resume, legacy receipts, JSON CLI, and MCP reconnection. Independent audit and final test totals are recorded in the delivery report; this document does not imply paid live coverage for every fixture case.

The final independent Astra review found four reproducible defects: group members surviving a lost leader could release exclusion, changing Grok auth Home could retain the old link, oversized events could stall cursors, and legacy Pi symlink aliases could bypass session exclusion. Each was corrected with an independent regression case in `tests/audit-regressions.test.mjs` (4/4 passed). Final `npm run check`, `npm test` (23/23), and `git diff --check` passed. No-model Pi and Grok reviewer/worker fresh/load probes passed again after these changes. No additional paid retry was needed for these process/storage/path fixes.
