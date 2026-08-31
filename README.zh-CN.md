<h1 align="center">Pi Agent Delegation</h1>

<p align="center">
  <a href="README.md">English</a> |
  <strong>简体中文</strong>
</p>

<p align="center">
  <strong>通过 RPC 将边界明确的 Codex 工作委派给外部 Pi Agent。</strong>
</p>

<p align="center">
  <a href="skills/pi-agent-delegation/SKILL.md">
    <img alt="Codex Skill" src="https://img.shields.io/badge/Codex-Skill-2563eb?style=flat-square">
  </a>
  <a href="https://nodejs.org/">
    <img alt="Node.js 20+" src="https://img.shields.io/badge/Node.js-20%2B-172554?style=flat-square">
  </a>
  <img alt="传输方式" src="https://img.shields.io/badge/transport-Pi%20RPC-0f8f88?style=flat-square">
  <img alt="项目状态" src="https://img.shields.io/badge/status-experimental-d97706?style=flat-square">
</p>

<p align="center">
  <a href="#为什么需要它">为什么需要它</a>
  &middot;
  <a href="#功能">功能</a>
  &middot;
  <a href="#安装">安装</a>
  &middot;
  <a href="skills/pi-agent-delegation/SKILL.md">Skill 参考文档</a>
</p>

Pi Agent Delegation 提供 `pi-agent-delegation` Skill 和一个自包含控制器，让 Codex 可以把边界明确的 explorer、reviewer 和 worker 工作委派给 [Pi coding agent](https://github.com/badlogic/pi-mono)。Pi 通过官方 JSONL RPC 模式作为外部 Agent 运行；Codex 仍然负责调度并审计持久化回执。

运行时只依赖 Node.js 和 `pi` CLI，不依赖 Agent Runtime Kit（ARK）。生命周期设计借鉴了 ARK 的 Pi adapter，包括 RPC 响应关联、稳定 Session 定位、有限等待、实时 steer、取消和终态回执。

## 为什么需要它

普通的进程内委派仍应优先使用 Codex 原生 subagent。当调用方明确需要独立的外部 Agent runtime、Pi 自己的 provider/Session 配置，或者需要一个可在 Codex 原生 Agent 树之外持久检查和控制的 RPC job 时，Pi 才是合适的选择。

本项目把这条集成整理成窄而可审计的通道，避免每个 Codex task 重复实现进程监管和 JSONL 路由。它不会静默替代原生 subagent，也不会把 Pi job 伪装成 Codex Agent 树中的任务。

## 功能

| 功能 | 说明 |
| --- | --- |
| 有边界的角色 | 以 explorer、reviewer 或已授权 worker 启动 Pi |
| 每任务配置 | 选择 provider、模型、thinking 强度、工作目录、工具和超时 |
| 后台生命周期 | 启动、检查、等待、取消并读取稳定的终态回执 |
| 实时控制 | 通过 Pi RPC steer 当前工作或排入 follow-up |
| Session 延续 | 把已有 Pi Session 作为新的受监管 job 恢复 |
| 默认只读 | explorer/reviewer 只获得 `read`、`grep`、`find`、`ls` |
| 可审计状态 | 保存请求、事件、stderr、用量、最终文本、Session 定位和 Git 前后快照 |
| 凭证边界 | OAuth 文件留在 Pi 配置目录，默认过滤凭证类环境变量 |

## 安装

先安装 Pi 并配置 provider。使用 ChatGPT Plus/Pro 账号时，在 Pi 中运行 `/login`，选择 **OpenAI Codex**，然后完成 device-code 登录。

```bash
git clone https://github.com/xukp20/pi-agent-delegation.git
cd pi-agent-delegation
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/skills/pi-agent-delegation" \
  "${CODEX_HOME:-$HOME/.codex}/skills/pi-agent-delegation"
```

安装后重新加载 Codex，使其发现该 Skill。使用符号链接安装时，可以通过 `git pull --ff-only` 更新。

## 验证

```bash
node skills/pi-agent-delegation/scripts/pi-agent.mjs doctor
npm test
```

`doctor` 会报告 Node.js、Pi、指定 provider 和可刷新的 OAuth 配置是否可用，但不会输出凭证内容。

## CLI 示例

```bash
node skills/pi-agent-delegation/scripts/pi-agent.mjs start \
  --role reviewer \
  --cwd /path/to/repo \
  --task "检查 HEAD 的正确性，并优先返回 findings"

node skills/pi-agent-delegation/scripts/pi-agent.mjs status JOB_ID
node skills/pi-agent-delegation/scripts/pi-agent.mjs steer JOB_ID \
  --message "重点检查恢复语义"
node skills/pi-agent-delegation/scripts/pi-agent.mjs wait JOB_ID \
  --timeout-seconds 1800
node skills/pi-agent-delegation/scripts/pi-agent.mjs result JOB_ID
```

`run` 用于前台启动、等待并返回结果；`resume --session-file ...` 用于继续保存的 Pi Session。运行状态默认保存在 `~/.codex/runtime/pi-agent-delegation`。

## 安全边界

- Pi 是外部 Agent，不是 Codex 原生 subagent。Codex 必须独立检查变更并重新运行相称的验证。
- explorer/reviewer 没有 shell、edit 或 write 工具；只有获得实现授权的 worker 才会启用这些工具。
- 并发写入者应使用独立 worktree；控制器不会自动创建或合并 worktree。
- 控制器不会把 OAuth 凭证复制到请求、日志、回执或仓库。
- 控制器不会代替 worker commit、merge、push 或扩大外部权限。

## 仓库结构

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

## 兼容性

控制器面向 Pi 当前的 `--mode rpc` 协议和内置工具名。更新 Pi 后应重新运行 `doctor` 和测试套件。首个验证版本使用 Pi `0.82.0` 与 Node.js `22.23.1`。
