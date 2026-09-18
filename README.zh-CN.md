# Harness Delegation

[English](README.md)

通过原生 Codex Desktop / CLI 将边界明确的任务委派给 **Pi**、**Grok Build** 和 **DSH**。共享 job core（任务核心）提供 JSON CLI、STDIO MCP 和 Codex Skill；外部任务不会伪装成 Codex 原生 subagent，结果由 Codex 显式读取并独立验收。

项目从 **Pi Agent Delegation** 演进而来，不依赖 ARK、CodexHost、app-server 代理、Desktop 注入或专用 UI。

既可直接使用，也可由 `directed-delegation` 的自定义 profile（执行配置）选中，再使用本工具执行外部任务。统一入口负责选择、简报与验收，本工具负责 Pi/Grok/DSH 的实际接口和恢复规则；原生 subagent 的 provider 路由不会修改外部 harness 的认证或模型。详见[命名配置接入](docs/named-profiles.md)。

CLI/MCP 默认精简返回：等待只返回状态，`task_read` 无损合并相邻文本片段，最终正文通过 `task_get(result=true)` 获取。查询时用 `detail=true`（CLI `--detail`）查看完整诊断；原始证据仍保留在磁盘。读取后使用 `next_cursor` 继续，即使可见事件为空也应推进；`has_more` 表示还有已保存事件。错误、清理不确定性及截断信息不会隐藏。详见[协议说明](docs/protocol.md#operations)。

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
    "grok": {"binary": "/absolute/path/to/grok", "model": "grok-4.6"},
    "dsh": {"binary": "/absolute/path/to/dsh", "provider": "your-provider", "model": "your-model"}
  }
}
```

`allow_env` 只填写明确需要传递的环境变量名称，不能填写凭据值。第三方 provider 的名称、地址、模型和 key 环境变量都属于本机配置，adapter 不绑定具体供应商，也不会复制凭据值。默认状态目录是 `~/.local/state/harness-delegation`；`HARNESS_DELEGATION_DIR` 可覆盖。需要互相协调的 CLI / MCP 必须使用同一私有、本机状态目录。

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
- 项目检查从 canonical cwd（真实路径）到已验证的 Git worktree root（工作树根目录），包含根目录；边界外的用户配置不再误判为项目配置，因此 home 下的普通仓库可正常使用。项目内指向用户配置的符号链接仍拒绝；无法可靠解析 worktree 边界时保留全祖先保守检查，非 Git 目录仍可能被拒绝。
- session resume 只继续对话，不恢复工作区文件，不重放不确定的 native command。
- 普通 CLI 返回和 MCP 重连与 job 生命周期分离；不承诺主机重启、logout/cgroup 清理后继续执行。supervisor 丢失时记录 `lost`，不假装成功。
- 日志私有且有界，已知环境秘密会脱敏；模型/工具原始输出仍可能包含敏感信息，不应公开整个 runtime 目录。

旧 Skill、脚本和历史终态回执的兼容路径见 [迁移说明](docs/migration.md)。旧 active supervisor 不在线迁移。新的 worker 必须提供写入范围，旧 `--allow-env` 迁移到本机配置。

## 更新、卸载和验证

更新前结束任务，或保留 active supervisor 对应的旧 checkout。执行 `git pull --ff-only`、`npm ci --ignore-scripts`、`npm run check` 和 `npm test`。卸载只移除本项目 MCP 条目和 Skill 链接；状态、session、认证和 worktree 默认保留，也不会自动取消任务。

`doctor` 只验证 binary/version，不证明认证有效，不调用模型。`scripts/probe.mjs pi|grok` 创建并加载临时 session，不发送 prompt。真实 canary 与 fake 测试分开，详见 [验证记录](docs/verification.md)。完整契约见 [协议文档](docs/protocol.md)。

Grok 1.0.30 在 prompt 前通过 `_x.ai/commands/list` 扩展精确校验 live session（活动会话）的真实工具列表，不把可能缺失的通知当作就绪保证。Pi 模型错误保留 `error.details.source=pi_assistant`，与 RPC 送达不明和桥接执行 deadline 区分。桥接会中止观察到的 Pi 自动重试等待，不修改原生设置，也不重发 prompt。发起新的付费尝试前请参考 [故障排查](docs/troubleshooting.md)。

若 shell 直连成功而 MCP 超时，先检查 MCP host（宿主进程）的代理环境。SDK STDIO 客户端默认不继承代理；Codex 可用 `env_vars` 显式转发必要变量，远程 Desktop 应选择 remote 来源。详见 [远程配置](docs/remote-ssh.md)；桥接无法转发宿主未提供的变量。
