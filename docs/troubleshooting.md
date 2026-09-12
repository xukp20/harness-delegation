# Troubleshooting installed MCP jobs

Use the registered STDIO command with a fresh MCP client, list the nine tools, then inspect the existing job with `task_get` (`result:true`) and bounded `task_read`. A successful tool call can return a failed job. Do not re-register MCP or edit native authentication merely because one model request failed.

## Direct works, MCP times out: check environment first

The MCP JavaScript SDK's `StdioClientTransport` defaults to a small environment whitelist; it does **not** include HTTP proxy variables. A shell-launched direct probe can therefore work while an otherwise identical MCP-launched job cannot reach the model endpoint. In the 2026-09-12 A/B check, explicitly forwarding the existing proxy environment made both Pi/BeeAPI and Grok model canaries succeed. This establishes an environment cause in that SDK reproduction, not a blanket diagnosis of every upstream timeout or of the installed Desktop process.

For operator-written SDK probes from this checkout, pass the same finite environment as the bridge, not all of `process.env`:

```js
import { safeEnvironment } from './src/common.mjs';
// Other Client/StdioClientTransport setup omitted.
const transport = new StdioClientTransport({
  command: '/usr/bin/node',
  args: ['/absolute/harness-delegation/bin/harness-delegate.mjs', 'mcp'],
  env: safeEnvironment(['HARNESS_DELEGATION_CONFIG', 'HARNESS_DELEGATION_DIR']),
});
```

An MCP host must supply required environment names before the bridge can forward them. Configure Codex's `env_vars` for the network path in use; remote Desktop needs the remote executor source, not the desktop machine's loopback proxy. See [remote setup](remote-ssh.md). The bridge does not discover proxy configuration, invent credentials, or automatically broaden its environment whitelist. Pi's Node launcher must also be configured to use the intended proxy; a wrapper may set `NODE_USE_ENV_PROXY=1` for a compatible Node runtime. No such wrapper/config change is performed by this project.

## Grok tool verification

Grok 1.0.30 does not reliably send `available_commands_update` before `session/new` returns. In an installed MCP/supervisor reproduction, native evidence contained initialize, MCP-server metadata and the new-session response, but no tool notification. Fresh temporary probes alone did not reproduce it. The bridge now requests `_x.ai/commands/list` for the actual session after new/load and compares the returned registered tools exactly. This is a no-model Grok extension, not standard ACP. Do not remove the exact allowlist check, infer success from a generated profile file, or enable default tools to bypass a mismatch.

`TOOL_PROFILE_MISMATCH` includes the expected/observed lists and source. Missing tools are a failure, not permission to proceed. A failed extension request also prevents prompting. Version upgrades need new no-model and fixture verification.

## Pi timeout provenance and retry policy

There are three distinct waits:

- `task_wait`: at most 45 seconds; expiration does not cancel or replay anything.
- RPC acknowledgement: normally 15 seconds; missing acknowledgement is `DELIVERY_UNKNOWN`. Inspect the original job; never resubmit under a new key automatically.
- Job execution: `timeout_seconds` (default 1,800), beginning after the native handshake. Expiration requests cancellation and records `timed_out`.

A Pi assistant can independently return `HARNESS_ERROR: Request timed out.` with `details.source=pi_assistant`. This proves the error came from native model execution, not which upstream network component failed. In the observed BeeAPI incident, Pi acknowledged prompt immediately, emitted assistant errors after approximately 10.5 seconds, and automatically retried three times; the total was about 56 seconds. Increasing the bridge deadline would not fix those native request errors.

The bridge now sends `abort_retry` when Pi announces retry backoff, preserving the original assistant error and emitting `retry.suppressed`. It does not call `set_auto_retry` (which persists user settings), alter credentials, or replay prompt. Provider SDK retries or a retry already in flight cannot be ruled out by this event-level control. Check provider availability/configuration with non-secret diagnostics; only after new evidence and explicit cost authorization consider a new tiny job. Reusing a request key retrieves the original job rather than restarting it.

Native logs are private evidence and can contain sensitive output. Share only selected timestamps, event names, job/session IDs and redacted errors, not auth files or entire runtime directories. Binary/handshake probes do not prove model availability.
