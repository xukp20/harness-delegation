# Job protocol v1

Both the CLI and MCP call the same core. CLI stdout contains one JSON envelope; diagnostics never share its JSON stream. MCP uses its normal wire protocol and returns the same envelope as text and `structuredContent`.

```json
{"api_version":1,"ok":true,"data":{"job_id":"job_00000000-0000-0000-0000-000000000000","status":"queued"}}
```

Failures use `{"api_version":1,"ok":false,"error":{"code":"INVALID_REQUEST","message":"..."}}`. A successful query of a failed job has `ok:true`. Query success and harness success are independent. CLI command errors exit nonzero; a queried failed job does not.

## Operations

| MCP | CLI | Behavior |
| --- | --- | --- |
| `harness_list` | `harnesses`, `doctor [--harness pi|grok]` | Binary/version and declared capabilities; no prompt/authentication proof |
| `task_start` | `start`, `run` | Start detached job; `run` additionally waits |
| `task_list` | `list [--cwd PATH] [--limit N]` | Up to 200 bridge jobs |
| `task_get` | `get`, `status`, `result` | State; `result=true` or `result` includes bounded final text |
| `task_read` | `read ID --after SEQ --limit N` | Up to 200 events/64 KiB |
| `task_wait` | `wait ID --timeout-seconds N [--after SEQ]` | Wait 0–45 seconds for terminal, or new events when cursor supplied |
| `task_send` | `send ID --mode steer|follow_up --message TEXT` | Native Pi control; CLI aliases `steer` and `follow-up` |
| `task_cancel` | `cancel ID` | Request stop; final receipt confirms cleanup |
| `task_resume` | `resume ID --task TEXT` | New job continuing original native session/workspace |

MCP start/send/cancel/resume require `request_key`. CLI accepts `--request-key`; omitted keys mean a new operation on each invocation. Pass tasks/messages with `--task-file`/`--message-file` or `--request-file` to avoid shell quoting hazards. Models, providers and thinking levels are strings passed to the appropriate harness; `provider` is Pi-specific. Arbitrary binary/argv fields are rejected.

Example start request (`--request-file` contents or MCP arguments):

```json
{
  "harness":"pi",
  "cwd":"/absolute/repo",
  "role":"worker",
  "task":"Fix the parser's empty-input case. Run the focused parser tests.",
  "write_scope":["src/parser.js","tests/parser.test.js"],
  "no_touch_scope":[".env"],
  "acceptance":["Empty input returns an empty list; existing parser tests pass"],
  "timeout_seconds":1800,
  "request_key":"parser-empty-fix-1",
  "harness_options":{"model":"gpt-5.6-luna","thinking":"high"}
}
```

Roles: reviewer/explorer default read-only; worker requires nonempty `write_scope`. Task input is capped at 64 KiB, execution timeout at one day. Scope/acceptance arrays are bounded and included in the prompt; they are not filesystem enforcement.

## Lifecycle and truth

`queued → starting → running → finalizing → completed|failed|cancelled|timed_out`; cancellation passes through `cancelling`. Missing supervisor identity after startup, supervisor death or a changed boot identity produces `lost` without replaying prompts. PID reuse is checked using Linux boot ID and process start ticks.

Pi waits for `agent_settled`, checks idle state and extracts only this job's assistant result; native errors are failed, absent current results unavailable. Grok waits for ACP `session/prompt` with an explicit stop reason; refusal and limits are not success. Native Grok subagents/default tool injection are excluded by the generated profile. Cleanup and lost reconciliation inspect surviving process-group members, including ordinary tools after their leader exits. Processes that deliberately escape the group are outside this cooperative lifecycle boundary.

Pi `auto_retry_start` triggers `abort_retry` during native backoff and emits `retry.suppressed`. This does not write Pi settings, replay a prompt, or promise control over retries inside a provider SDK/already-started request. Assistant errors include `details.source=pi_assistant`; negative RPC responses use `pi_rpc_response`. Neither a native error mentioning “timeout” nor a client wait timeout is automatically a bridge job deadline.

`completed` is harness execution completion, not independently verified acceptance. A cancel acknowledgement is not a terminal receipt. Deadline and cancellation record intent before native stop; shutdown escalates to SIGTERM/SIGKILL with an exit check. A receipt can report `execution_may_continue:true` when cleanup or supervision is uncertain. Do not begin another writer while execution may continue.

Client wait timeout returns `timed_out:true, terminal:false` alongside the current state. It never mutates the job. MCP/client exit does not own job lifetime. An immutable receipt is the terminal authority, with state a current projection; a `lost` query can additionally reconcile whether the originally observed process has exited.

## Identity, concurrency and ambiguity

Job IDs are `job_<uuid>`. Native session IDs/locators remain adapter-owned and include configuration identity. Resume cannot change the original workspace/harness and requires a stopped previous execution. It restores conversation, not Git/files.

A start key plus normalized request digest resolves to exactly one stored job. Reusing a key with different input returns `IDEMPOTENCY_CONFLICT`; failed/lost jobs are not automatically restarted. A single supervisor lock prevents duplicate owners. Short storage transactions use a private directory lock. If a transaction owner dies, commands fail closed with `STALE_LOCK`: stop other bridge commands, inspect its owner identity, then remove only the reported transaction lock directory. Uncertain ownership is never stolen automatically.

Writer exclusion uses the canonical Git worktree root (or canonical cwd outside Git). Read-only jobs can share it. A single native session has at most one active bridge job. Different state roots, other shell processes and manually launched harnesses are outside these cooperative locks.

Controls are serialized. A persisted intent precedes sending; result follows acknowledgement. Retrying the same key reads the recorded result. If the connection dies after possible delivery, report `DELIVERY_UNKNOWN`; do not resubmit under another key. At most 128 controls are accepted per job. No automatic model retries are implemented by the bridge; the native harness may perform its own retries.

## Storage and evidence

Default root: `~/.local/state/harness-delegation`, owned by the launching user, mode 0700, local filesystem only. Each job contains:

- `request.json`: immutable validated request/digest/config identity.
- `state.json`: atomic current snapshot, supervisor/child identity and native locator.
- `events.jsonl`: normalized ordered events (`seq`, `at`, `type`, `data`).
- `native.jsonl`: original protocol evidence with known-secret redaction.
- `stderr.log`: bounded native diagnostics.
- `controls.jsonl`: bounded control intents/results, without message content.
- `result.md` and `receipt.json`: final text and terminal evidence.
- `control.sock`: mode 0600 while active; `supervisor.lock`: duplicate-start guard.
- Grok `grok-profile.md`: generated exact native tool configuration.

Per-stream default limit is 2 MiB, locally configurable from 1 KiB to 16 MiB. Once exhausted, further ordinary records are dropped; terminal events remain, and `log_truncated` records omissions. Individual normalized events over 16 KiB become bounded previews with truncation evidence; legacy oversized events also advance the read cursor. Cursor sequence counts persisted events, not every native event. Final text API output is limited to 64 KiB and reports truncation. Private raw logs may contain model/tool-emitted sensitive content despite known-secret filtering.

Receipts include native stop reason, session locator, cleanup, Git observations, and usage when reported. Pi statistics are explicitly `scope:session`; they may include prior turns. Missing usage remains null; Grok credits/native usage are not converted to fabricated dollars. Git before/after snapshots do not attribute every modification to the job and do not restore files.

## Harness capability boundary

Pi: start/cancel/resume/steer/follow-up; its LF JSONL RPC is not ACP. Read-only tools are `read,grep,find,ls`; worker adds `bash,edit,write`. `tools:[]` disables Pi tools. No extensions, skills or prompt templates are loaded by this bridge.

Grok 1.0.30: ACP v1 initialize/new/prompt/update/cancel/load, with load negotiated at connection. Read-only profile uses `read_file,list_dir,grep`; worker additionally uses `run_terminal_cmd,search_replace`. This binary rejects empty curated profiles, so `tools:[]` explicitly fails. No steer/follow-up, live interactive questions, native subagent control or generic ACP extension guarantee. Unknown incoming requests are rejected; permission requests use deterministic declared-role policy and reject unknown operations.

After new/load, the Grok-specific `_x.ai/commands/list` request with `sessionId` pulls the live registered tool names. This validated private extension is not ACP v1. Missing, duplicate, extra or omitted tools fail closed with `TOOL_PROFILE_MISMATCH` before a prompt; the unsolicited `available_commands_update` notification is not an initialization barrier. A successful check emits `tools.verified` and retains the native response as evidence.

Grok uses an isolated HOME/GROK_HOME partitioned by canonical native auth-home identity, a native-auth symlink, `GROK_DISABLE_AUTOUPDATER=1`, no leader, and no inherited custom tool profile. Switching auth Home creates a separate native session store; it cannot silently retain the previous account link. Workspace ancestry containing unsupported executable native configuration is rejected. This limitation is intentional: arbitrary hooks/MCP/plugins could run before a read-only prompt.

Errors include `INVALID_REQUEST`, `JOB_NOT_FOUND`, `WORKSPACE_BUSY`, `SESSION_BUSY`, `SESSION_MISMATCH`, `UNSUPPORTED_CAPABILITY`, `PROJECT_CONFIG_UNSUPPORTED`, `PROTOCOL_ERROR`, `DELIVERY_UNKNOWN`, `SUPERVISOR_LOST`, `STALE_LOCK` and native process/launch failures. Unknown capabilities fail explicitly; they are not emulated by replaying or broadening permissions.
