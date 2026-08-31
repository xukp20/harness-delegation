<h1 align="center">Pi Agent Delegation</h1>

<p align="center">
  <strong>English</strong> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <strong>Delegate bounded Codex work to external Pi agents over RPC.</strong>
</p>

<p align="center">
  <a href="skills/pi-agent-delegation/SKILL.md">
    <img alt="Codex Skill" src="https://img.shields.io/badge/Codex-Skill-2563eb?style=flat-square">
  </a>
  <a href="https://nodejs.org/">
    <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-172554?style=flat-square">
  </a>
  <img alt="Transport" src="https://img.shields.io/badge/transport-Pi%20RPC-0f8f88?style=flat-square">
  <img alt="Status" src="https://img.shields.io/badge/status-experimental-d97706?style=flat-square">
</p>

<p align="center">
  <a href="#why-this-exists">Why</a>
  &middot;
  <a href="#capabilities">Capabilities</a>
  &middot;
  <a href="#install">Install</a>
  &middot;
  <a href="skills/pi-agent-delegation/SKILL.md">Skill Reference</a>
</p>

Pi Agent Delegation provides the `pi-agent-delegation` skill and a self-contained controller for delegating bounded explorer, reviewer, and worker jobs from Codex to the [Pi coding agent](https://github.com/badlogic/pi-mono). Pi runs as an external worker through its official JSONL RPC mode; Codex remains the orchestrator and audits the persisted result.

The runtime requires only Node.js and the `pi` CLI. It does not depend on Agent Runtime Kit (ARK), although its lifecycle design borrows proven ideas from ARK's Pi adapter: correlated RPC responses, stable session locators, bounded waits, live steering, cancellation, and terminal receipts.

## Why This Exists

Codex subagents are the default choice for ordinary in-process delegation. Pi is useful when the caller deliberately wants an independent external agent runtime, Pi's provider/session configuration, or a persistent RPC job that can be inspected and controlled outside Codex's native agent tree.

This project turns that integration into a narrow, auditable channel instead of asking each Codex task to recreate process supervision and JSONL routing. It does not silently replace native subagents and does not make Pi jobs appear inside the Codex agent tree.

## Capabilities

| Capability | What it provides |
| --- | --- |
| Bounded roles | Start Pi as an explorer, reviewer, or authorized worker |
| Per-job configuration | Select provider, model, thinking level, working directory, tools, and timeout |
| Detached lifecycle | Start, inspect, wait, cancel, and retrieve a stable terminal receipt |
| Live control | Steer active work or enqueue a follow-up through the Pi RPC session |
| Session continuation | Resume a persisted Pi session as a new supervised job |
| Read-only defaults | Explorer and reviewer roles receive only `read`, `grep`, `find`, and `ls` |
| Auditable state | Persist request, events, stderr, usage, final text, session locator, and before/after Git snapshots |
| Credential boundary | Keep Pi OAuth files outside the repository and filter credential-like environment variables by default |

## Install

Install Pi first and configure a provider. For a ChatGPT Plus/Pro account, open Pi, run `/login`, choose **OpenAI Codex**, and complete the device-code login.

```bash
git clone https://github.com/xukp20/pi-agent-delegation.git
cd pi-agent-delegation
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/skills/pi-agent-delegation" \
  "${CODEX_HOME:-$HOME/.codex}/skills/pi-agent-delegation"
```

Reload Codex after installation so the skill is discovered. A linked install can be updated with `git pull --ff-only`.

## Verify

```bash
node skills/pi-agent-delegation/scripts/pi-agent.mjs doctor
npm test
```

`doctor` reports whether Node.js, Pi, the selected provider, and refreshable OAuth configuration are available. It never prints credential contents.

## CLI Example

```bash
node skills/pi-agent-delegation/scripts/pi-agent.mjs start \
  --role reviewer \
  --cwd /path/to/repo \
  --task "Review HEAD for correctness and return findings first"

node skills/pi-agent-delegation/scripts/pi-agent.mjs status JOB_ID
node skills/pi-agent-delegation/scripts/pi-agent.mjs steer JOB_ID \
  --message "Focus on recovery semantics"
node skills/pi-agent-delegation/scripts/pi-agent.mjs wait JOB_ID \
  --timeout-seconds 1800
node skills/pi-agent-delegation/scripts/pi-agent.mjs result JOB_ID
```

Use `run` for a foreground start-wait-result cycle and `resume --session-file ...` to continue a saved Pi session. Runtime state defaults to `~/.codex/runtime/pi-agent-delegation`.

## Safety Boundaries

- Pi is an external agent, not a native Codex subagent. Codex must independently inspect changes and rerun proportionate verification.
- Explorer and reviewer jobs have no shell, edit, or write tool. Worker jobs receive those tools only when implementation is authorized.
- Concurrent writers should use separate worktrees. The controller does not create or merge worktrees automatically.
- The controller does not copy OAuth credentials into requests, logs, receipts, or this repository.
- It does not commit, merge, push, or broaden external permissions on behalf of a worker.

## Repository Layout

```text
pi-agent-delegation/
├── README.md
├── README.zh-CN.md
├── LICENSE
├── package.json
├── tests/
└── skills/
    └── pi-agent-delegation/
        ├── SKILL.md
        ├── agents/openai.yaml
        ├── references/protocol.md
        └── scripts/pi-agent.mjs
```

## Compatibility

The controller targets Pi's current `--mode rpc` protocol and built-in tool names. Run `doctor` and the test suite after updating Pi. The first validated release used Pi `0.82.0` and Node.js `22.23.1`.
