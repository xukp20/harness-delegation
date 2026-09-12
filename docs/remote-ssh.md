# Native Codex and remote SSH

Install this repository, Node and the selected harness on the **Linux host that executes the repository work**. Use remote absolute binary/config/workspace paths. Native authentication remains on that host. CLI and MCP must use the same state root to share jobs and cooperative locks.

For native Desktop with a remote executor available:

```toml
[mcp_servers.harness_delegation]
command = "/absolute/remote/path/to/node"
args = ["/absolute/remote/path/to/harness-delegation/bin/harness-delegate.mjs", "mcp"]
experimental_environment = "remote"
tool_timeout_sec = 60
```

`experimental_environment="remote"` is an official Codex STDIO MCP option. Its availability and configuration placement depend on the installed Codex/remote executor version. Follow the [official MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp). This project does not patch or replace Codex to provide it.

For Codex CLI already running on the Linux host, omit `experimental_environment`; ordinary STDIO starts the server there. If remote MCP is unavailable, link the Skill from the remote checkout and use its CLI through the existing remote terminal tools. No companion app, HTTP listener, SSH tunnelling daemon or CodexHost is required.

The MCP server is a short-lived client of the job store/supervisor. Each job has detached Node and native processes, a private Unix control socket and persistent files. Reconnect by job ID; if the ID is lost use `task_list`. Results are retrieved explicitly and rendered as normal tool output, not native Codex child Threads.

Tests demonstrate child jobs surviving the launching CLI's exit and a real MCP STDIO client closing/reopening. This does **not** prove survival of Desktop task cancellation, remote executor cgroup cleanup, Linux logout policies or reboot. A detached process cannot override host process-tree policy. No systemd service is installed automatically; deployments needing stronger guarantees must validate their host lifecycle before relying on unattended jobs.

When supervision is lost, the bridge records uncertainty and does not reconnect to orphaned stdio or replay paid prompts. Stop any surviving native execution before resuming its stored conversation. Conversation resume never rolls back workspace files.
