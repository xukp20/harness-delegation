# Migrating Pi Agent Delegation 0.1

The repository is now `xukp20/harness-delegation`; development continues on its original main history. Node minimum is now 22, and v0.2 targets Linux explicitly. No package publication is needed to use the checkout.

| Old interface | v0.2 behavior |
| --- | --- |
| `$pi-agent-delegation` | Compatibility Skill links to the new instructions and explicitly selects Pi |
| `skills/pi-agent-delegation/scripts/pi-agent.mjs` | Raw-JSON facade over the shared core |
| `PI_AGENT_PI_BIN` | Accepted as Pi binary fallback behind local configuration |
| `PI_AGENT_DELEGATION_DIR` | Honored by the old script; use `HARNESS_DELEGATION_DIR` for the new CLI/MCP |
| `pi_*` terminal receipts | Old script can read status/wait/result without rewriting them |
| Active 0.1 supervisors | Use the original controller until stopped; no online schema migration |
| New IDs | `job_<uuid>`; do not assume a Pi-specific prefix |
| `--allow-env NAME` | Explicit migration error; move variable names to local `harnesses.pi.allow_env` |
| Worker without scope | Explicit error; supply `--write-scope '["authorized/path"]'` |
| `resume --session-file PATH` | Old facade accepts an existing Pi session file; new API uses `resume JOB_ID` |
| `steer`, `follow-up`, `run` | Preserved as convenient CLI operations |

Old script response payloads now use the shared state/receipt fields for new jobs; legacy historical receipts retain their original shape. This is not byte-for-byte compatibility for every undocumented export or field. Consumers should migrate to the versioned new envelope and `session.locator.session_file`. The old `wait` accepts longer waits; the new bounded wait protocol returns timeout without marking the job failed.

Keep the complete checkout when linking either Skill. The old self-contained script is now a facade importing the common implementation; copying only its directory is unsupported. Install the MCP dependency with `npm ci --ignore-scripts` if using MCP.

Do not move or edit old runtime files while old supervisors are active. Retain the original checkout/controller for their control socket protocol. Once stopped, use the old facade to read their receipts or explicitly continue their Pi session file. New jobs are created in the new default root unless configured otherwise.

No migration copies OAuth credentials, moves native histories, modifies Codex config, creates worktrees, merges changes, or injects results into Codex conversations.
