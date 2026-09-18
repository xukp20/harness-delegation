# Named external profiles

Harness Delegation is the execution interface for external Pi/Grok jobs. Directed Delegation can optionally select and brief those jobs alongside native Codex subagents. Neither tool emulates the other's lifecycle.

## Configure and select

Use the installed `directed-delegation` Skill's `scripts/delegation.py` CLI to add a user profile. Resolve its installed path from the Skill catalog rather than assuming a repository layout. The following is an example profile file for an already configured Grok installation:

```json
{
  "backend": "harness",
  "harness": "grok",
  "harness_options": {"thinking": "low"},
  "guidance": "Use for bounded implementation with explicit write scope and focused tests."
}
```

Register the profile with `profile put my-implementer --file profile.json`, then inspect `profile resolve my-implementer`. The profile ID is user-defined; the model need not be part of its name. Pi profiles can specify their existing `provider` and `model` inside `harness_options`. Omitted options keep the harness's configured defaults. A profile does not prove binary, authentication or model availability.

## Dispatch

Take the resolved external `harness` and `harness_options`, and combine them with the current assignment's `cwd`, `task`, `role`, scopes, acceptance criteria, timeout and request key. Submit this using the existing MCP `task_start` or CLI `start --request-file request.json`. Do not pass the profile's guidance or its whole registry record as extra API fields. Guidance belongs in the task brief; profile selection is not permission to broaden tools or write scope.

The lead resolves explicit user overrides before dispatch. There is no hidden profile resolver inside the Harness runtime and no change to its persisted request schema. Native provider-mode routing only maps native roles. A provider policy can separately allow external harnesses, but never changes the account/model chosen inside a Pi profile. A blocked native route must not silently escape through an external executor.

## Read and verify

Use status-only waits, cursor-based progress and an explicit final result as described in [the protocol](protocol.md). External jobs retain their own job IDs, native sessions and supported controls. Pi supports steering; Grok does not. Neither a successful profile resolution nor a completed job establishes acceptance of the task.

Adding a model to an existing Pi/Grok profile is configuration work. Adding another harness requires a supported adapter, capability checks and validation; adding a profile alone cannot provide a new protocol implementation.

If an operator intentionally shares a Provider Delegation credential with Pi, the provider tool's explicit `credential --provider-id ID` command reads its stable private bundle (or configured environment variable) independently of native mode activation. Connect it through the harness's existing credential-command mechanism only when authorized. Its stdout is a secret for the auth consumer, not diagnostic output to display or store in a profile. Do not read a token from the transient public Codex provider block: disabling native routing removes that block.
