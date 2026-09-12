# Harness Delegation

[English](README.md)

通过原生 Codex Desktop / CLI 将边界明确的任务委派给 **Pi** 和 **Grok Build**。共享 job core（任务核心）提供 JSON CLI、STDIO MCP 和 Codex Skill；外部任务不会伪装成 Codex 原生 subagent，结果由 Codex 显式读取并独立验收。

项目从 **Pi Agent Delegation** 演进而来，不依赖 ARK、CodexHost、app-server 代理、Desktop 注入或专用 UI。

## 安装与配置

当前支持 **Linux、Node.js 22+**；恢复判断依赖 Linux `/proc`，本版不支持 macOS / Windows。先单独安装 Pi / Grok 并完成原生认证。

```bash
git clone https://github.com/xukp20/harness-delegation.git
cd harness-delegation
npm ci --ignore-scripts
node bin/harness-delegate.mjs doctor
```

配置位于 `~/.config/harness-delegation/config.json`。可通过 `HARNESS_DELEGATION_CONFIG` 指定其他文件：

```json
{
  "schema_version": 1,
  "harnesses": {
    "pi": {"binary": "/absolute/path/to/pi", "provider": "openai-codex", "model": "gpt-5.6-luna"},
    "grok": {"binary": "/absolute/path/to/grok", "model": "grok-4.6"}
  }
}
```

`allow_env` 只填写明确需要传递的环境变量名称，不能填写凭据值。默认状态目录是 `~/.local/state/harness-delegation`；`HARNESS_DELEGATION_DIR` 可覆盖。需要互相协调的 CLI / MCP 必须使用同一私有、本机状态目录。

Skill 应从完整 checkout 链接：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/skills/harness-delegation" "${CODEX_HOME:-$HOME/.codex}/skills/harness-delegation"
```

Codex MCP 配置示例：

```toml
[mcp_servers.harness_delegation]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/harness-delegation/bin/harness-delegate.mjs", "mcp"]
tool_timeout_sec = 60
```

远端 Desktop executor 可按实际版本添加 `experimental_environment = "remote"`；普通远端 CLI 使用本地 STDIO 配置即可。详细说明见 [远端部署](docs/remote-ssh.md)。不需要本地 companion。安装后重新加载 Codex。

## 使用

```bash
node bin/harness-delegate.mjs start --harness grok \
  --cwd /absolute/repo --role reviewer \
  --task "审查 parser 的变更，给出带文件位置的具体问题" \
  --request-key parser-review-1
node bin/harness-delegate.mjs wait JOB_ID --timeout-seconds 30
node bin/harness-delegate.mjs result JOB_ID
```

MCP 工具为 `harness_list`、`task_start`、`task_list`、`task_get`、`task_read`、`task_wait`、`task_send`、`task_cancel`、`task_resume`。CLI 支持对应操作及 `run`、`steer`、`follow-up` 等别名。Pi 使用自己的 JSONL RPC；Grok 使用 ACP v1 加自身扩展，二者不会强行统一 wire protocol（通信格式）。

同一 request key（幂等键）重试返回同一个任务，不重复启动。worker 必须声明 `write_scope`；同一 Git worktree 的写任务排他，只读任务可以并行。Grok 首版不支持 steer/follow-up，不会偷偷取消后重新发送。

## 安全与恢复边界

- 工具列表和提示词不是 OS sandbox（操作系统沙箱）；Pi 没有内置权限系统。工具继承启动用户的实际权限。
- scope、Git 前后快照和 bridge 锁不能约束其他程序，也不能替代独立审查与测试。并发写入者使用独立 worktree。
- Grok 使用明确的精简工具 profile 和私有 native Home，通过符号链接引用原生认证文件；禁止默认工具注入、subagent、leader 和自动更新。存在不支持的可执行项目配置时明确拒绝。
- session resume 只继续对话，不恢复工作区文件，不重放不确定的 native command。
- 普通 CLI 返回和 MCP 重连与 job 生命周期分离；不承诺主机重启、logout/cgroup 清理后继续执行。supervisor 丢失时记录 `lost`，不假装成功。
- 日志私有且有界，已知环境秘密会脱敏；模型/工具原始输出仍可能包含敏感信息，不应公开整个 runtime 目录。

旧 Skill、脚本和历史终态回执的兼容路径见 [迁移说明](docs/migration.md)。旧 active supervisor 不在线迁移。新的 worker 必须提供写入范围，旧 `--allow-env` 迁移到本机配置。

## 更新、卸载和验证

更新前结束任务，或保留 active supervisor 对应的旧 checkout。执行 `git pull --ff-only`、`npm ci --ignore-scripts`、`npm run check` 和 `npm test`。卸载只移除本项目 MCP 条目和 Skill 链接；状态、session、认证和 worktree 默认保留，也不会自动取消任务。

`doctor` 只验证 binary/version，不证明认证有效，不调用模型。`scripts/probe.mjs pi|grok` 创建并加载临时 session，不发送 prompt。真实 canary 与 fake 测试分开，详见 [验证记录](docs/verification.md)。完整契约见 [协议文档](docs/protocol.md)。
