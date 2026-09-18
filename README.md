# Harness Delegation

[简体中文](README.zh-CN.md)

Delegate bounded coding tasks from native Codex Desktop or CLI to **Pi**, **Grok Build**, and **DSH**. A small shared job core powers a JSON CLI, a STDIO MCP server, and a Codex Skill. External jobs remain external: Codex retrieves their evidence and verifies their changes.

This repository was previously **Pi Agent Delegation**. The [migration guide](docs/migration.md) covers the old Skill, script, environment variables, and receipts.

Use it directly, or as the external execution branch of `directed-delegation`, whose customizable profiles and task recommendations also cover native subagents. [Named profiles](docs/named-profiles.md) explains the optional integration. Provider-mode routing of native subagents does not change external harness authentication or model settings.

## What it provides

- Detached per-job supervisors, private persisted state, terminal receipts, and bounded event reads.
- Pi's native JSONL RPC; Grok-specific ACP v1 stdio. Pi is not ACP.
- Start, list, inspect, wait, cancel, and session continuation; Pi additionally supports steer/follow-up.
- Idempotent start/control keys, exclusive bridge writers per Git worktree, and native-session exclusion.
- Read-only explorer/reviewer defaults; workers require an explicit authorized write scope.
- Ordinary MCP tool results. No CodexHost, ARK dependency, app-server proxy, Desktop injection, custom renderer, or Thread database.
- Compact CLI/MCP responses: status-only waits, lossless adjacent text aggregation, and explicit `detail=true` / CLI `--detail` for diagnostic queries. Raw evidence stays on disk. Fetch progress with `task_read` and final text with `task_get(result=true)`; see [response and cursor semantics](docs/protocol.md#operations).

## Install

Requires **Linux, Node.js 22+**, and the selected harness CLI already installed and authenticated. Harness installation/login is managed separately. The process identity/recovery implementation uses Linux `/proc`; macOS and Windows are not supported in this version.

```bash
git clone https://github.com/xukp20/harness-delegation.git
cd harness-delegation
npm ci --ignore-scripts
node bin/harness-delegate.mjs doctor
```

The CLI/core have no external runtime imports; `npm ci` installs the MCP SDK for the MCP entry. No npm package has been published by this project. Run the script directly or use `npm link` to expose `harness-delegate` locally.

Configure binaries and defaults in `~/.config/harness-delegation/config.json`:

```json
{
  "schema_version": 1,
  "harnesses": {
    "pi": {"binary": "/absolute/path/to/pi", "provider": "openai-codex", "model": "gpt-5.6-luna", "thinking": "high"},
    "grok": {"binary": "/absolute/path/to/grok", "model": "grok-4.6", "thinking": "low"},
    "dsh": {"binary": "/absolute/path/to/dsh", "provider": "your-provider", "model": "your-model"}
  }
}
```

Optional local keys: `state_dir`; harness `allow_env` (names only), `log_bytes` (1 KiB–16 MiB), native `home`, and external-provider `base_url` plus `api_key_env`. Provider names, endpoints, models, and credential variable names are configuration values; adapters do not select a vendor or copy credential values. Override the config path with `HARNESS_DELEGATION_CONFIG`; state defaults to `~/.local/state/harness-delegation` and can be overridden with `HARNESS_DELEGATION_DIR`. Use one private local state root across CLI/MCP clients that must coordinate.

`doctor` checks executable/version availability; it does **not** prove credentials are valid or send a model prompt. Version targets and real verification evidence are in [verification](docs/verification.md).

Grok 1.0.30 verifies the live session's exact tool list through its `_x.ai/commands/list` extension before any prompt; unsolicited tool notifications are not a readiness guarantee. Pi model failures retain `error.details.source=pi_assistant`, distinct from RPC delivery failures and bridge execution deadlines. The bridge aborts observed Pi automatic-retry backoff without changing native settings; it never replays the prompt. See [troubleshooting](docs/troubleshooting.md) before starting a new paid attempt.

If direct shell calls work but MCP calls time out, check the MCP host's proxy environment first. SDK STDIO clients do not inherit proxies by default. Codex `env_vars` can explicitly forward required names; remote Desktop must select the remote environment source. See [remote setup](docs/remote-ssh.md); the bridge cannot forward variables its host did not supply.

## Codex integration

Link the Skill from the complete checkout (copying just the Skill directory is insufficient):

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/skills/harness-delegation" "${CODEX_HOME:-$HOME/.codex}/skills/harness-delegation"
```

Add an optional STDIO MCP entry to Codex's config, using actual absolute paths:

```toml
[mcp_servers.harness_delegation]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/harness-delegation/bin/harness-delegate.mjs", "mcp"]
tool_timeout_sec = 60
```

Reload Codex after updating integrations. For Desktop tasks on a remote Linux executor, see [remote SSH setup](docs/remote-ssh.md). No local companion app is required. Tools are `harness_list`, `task_start`, `task_list`, `task_get`, `task_read`, `task_wait`, `task_send`, `task_cancel`, and `task_resume`.

## CLI example

```bash
node bin/harness-delegate.mjs start --harness grok \
  --cwd /absolute/repo --role reviewer \
  --task "Review the parser changes. Return concrete findings with file references." \
  --request-key parser-review-1
node bin/harness-delegate.mjs wait JOB_ID --timeout-seconds 30
node bin/harness-delegate.mjs result JOB_ID
```

Use `--request-file /absolute/request.json` for structured scope/acceptance. `run` starts and waits in the foreground; `start` returns immediately. Reuse the same key after an ambiguous client response. Never retry an uncertain native message under a new key.

Read the [protocol](docs/protocol.md) for states, schema, capabilities, and errors.

## Boundaries

Tool restrictions and prompts are **not an OS sandbox**. Pi has no built-in permissions system. Native tools run as the launching user; scope strings and Git snapshots cannot prove or enforce filesystem isolation. Bridge workspace/session locks do not constrain unrelated programs. Use separate worktrees for concurrent writers and independently review the diff and run focused checks.

Grok uses a small generated tool profile and a private native Home with an auth-file symlink to the configured original store. It disables auto-update, leader sharing, skill discovery, default tool injection and native subagent tools. Unsupported executable project configuration fails closed; arbitrary native MCP/plugin inheritance is outside v1. Native auth refresh may update the harness's own files. No credential values are copied into launch requests or returned as job metadata.

Project checks cover canonical cwd through its verified Git worktree root, inclusive. User configuration outside that boundary is not mistaken for project configuration: ordinary repos under your home directory work with the isolated native Home. Project symlinks to user configuration are still rejected. When a worktree boundary cannot be reliably resolved, the bridge conservatively checks all ancestors; non-Git directories may therefore still be rejected. See [configuration discovery](docs/troubleshooting.md#project-configuration-and-worktree-boundaries).

Only finite base environment names and explicit local `allow_env` names are forwarded; loader injection variables remain blocked. Logs are private and bounded, with known environment-secret redaction. Native output may itself contain sensitive material: do not publish raw runtime directories.

Ordinary CLI exit/MCP reconnect can preserve work. Host reboot, logout cleanup, cgroup termination, and live supervisor replacement are not continuation guarantees. Lost work is never silently replayed. Session resume restores conversation, not workspace files.

## Update and uninstall

Pin a checkout/release directory for active supervisors. Finish/cancel jobs before replacing that installation, or retain the old checkout until its jobs terminate. Update with `git pull --ff-only`, `npm ci --ignore-scripts`, `npm run check`, and `npm test`; re-run no-model probes after harness upgrades.

Uninstall by removing this MCP entry and this project's Skill symlink; run `npm unlink -g harness-delegation` if linked. Keep state, native sessions/auth, and worktrees by default. Uninstall does not cancel active jobs. Purging runtime data is a separate, explicit operator action after confirming all jobs stopped.

## Development

```bash
npm run check
npm test
node scripts/probe.mjs pi
node scripts/probe.mjs grok
```

Probes create/load temporary native sessions without prompts, then remove only their temporary state. Tests use fake harnesses; real canaries are separate and potentially billable.

`src/jobs.mjs`, `store.mjs`, and `supervisor.mjs` own lifecycle; `src/adapters/` owns native protocols; `src/cli.mjs` and `mcp.mjs` call the same core. See [verification](docs/verification.md).
