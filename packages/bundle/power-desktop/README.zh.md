# `@deepseek-ai/dsh-power-desktop`

[English](README.md) | 中文

Power Desktop 发行层应用于 [`dsh-base`](../base/README.md) 和 [`dsh-web-app`](../web-app/README.md) 之后。[`cordis.patch.yml`](cordis.patch.yml) 选择随附的 `power-review` preset，以 [`dsh-fs-esafenet`](../../fs/fs-esafenet/README.md) 替换普通文件系统提供方，并关闭面向模型的网络、命令、遥测、远程标题和物理执行路径。本包没有运行时 API；profile 组合器通过 `dsh.bundle.patch` 解析其补丁。

## 组合

两个随附 preset 共同使用版本化的 [`power-prompt`](../../power/power-prompt/README.md)、失败关闭的 [`power-policy`](../../power/power-policy/README.md)、持久化的 [`power-analysis`](../../power/power-analysis/README.md)、工作区指令、文件系统工具和固定参数的 ripgrep 检索。二者都不挂载 complete 模式 persona，也不暴露 Web、Bash、PowerShell、终端、代码运行时、子代理、目标板或功率动作工具。

| Preset | 固定文件策略 | 模型可见变更 | 验证 |
|---|---|---|---|
| `power-review`（默认） | `read-only` | 无；`write` 和 `edit` 对模型隐藏，并在执行层拒绝 | 仅静态证据 |
| `power-fix` | `workspace-write` | 会话工作区内的 `write` 和 `edit` | P0 仅静态证据 |

每个 preset 都在 `tool-fs` 旁挂载自己隔离的 `sandboxPolicy`。宿主权限切换已禁用，因此会话权限事件不能覆盖这些模式。审批策略为 `never`，会在进入交互分发前拒绝一次性提权。最终 Guard 会把 `read`、`read_image`、`write`、`edit`、`glob` 和 `grep` 路径绑定到会话工作区；封闭 profile 还会独立拒绝包含安装持有代码/配置或被其包含的任何 workspace。

## 安全属性

- 基础进程沙箱 Service Provider 保持启用。最终组合禁用 `fs-sandbox`，只挂载一个 `fs-esafenet` 提供方，并保留观察策略。受保护内容只能通过沙箱进程路径上的提供方固定协议传输。
- 通用 Bash 与 PowerShell 执行器和工具、终端路径、编辑器进程工具及代码运行时均不存在或已禁用。独立的进程沙箱保持启用，供 Esafenet 使用。文件系统检索通过 subprocess 接缝以固定参数调用随包 ripgrep，不暴露命令字符串。
- 外部 Web 检索及其 DeepSeek 提供方、OpenTelemetry 会话导出和首提示词 LLM 标题生成均已禁用。普通对话模型流量仍走产品所选模型路由。
- 不挂载目标板、烧录器、调试器、串口、PWM、继电器、预充、接触器、NVM 清空或功率级工具。选择任一 preset 都不会授权物理执行。

## 模型体验

### Preset 组合的模型表面

#### 模型可见内容

`power-review` 暴露 `read`、`glob`、`grep` 和 `power_report`；`power-fix` 另外暴露 `write` 和 `edit`。二者都会收到固定的中文功率软件安全与证据分节、所选环境分节，以及 `/locate`、`/review`、`/incident`、`/requirement` 和 `/fix` 工作流提示词。

#### Token 影响

每个请求都携带固定功率提示词、一个简短环境分节和所选原生工具 schema。工作流用户消息及 `power_report` 调用与结果只会在实际发生后增加其普通持久化会话文本。

#### KV Cache 影响

固定提示词分节和原生工具 schema 在一个 preset 内保持稳定。切换 preset 会启动不同的会话组合，只改变环境分节和两个变更工具 schema。

## 已知限制与延期工作

- Windows Esafenet 内容操作要求固定的系统 Windows PowerShell 二进制通过提供方自有的 `code.exe` 别名运行；非 Windows 则要求固定绝对路径下的 `pwsh`。提供方启动或约束失败会直接报错，不会回退到 Node.js 直读或任意 Shell。
- P0 没有专用构建或静态分析运行器、LSP 桥、波形解码器或目标板提供方。因此 `power-fix` 将验证报告为仅静态，且不得声称拥有构建凭据。
- Agent preset 在会话启动时固定。变更 review/fix 权限必须使用另一个 preset 启动空白会话；会话内权限切换被有意禁用。
- 本 bundle 包嵌入其他自定义 profile 时仍服从普通 patch 优先级；已发布的 `power` profile 则不同，它拒绝 profile/home patch、`--patch` 与插件变更，并保留 `dsh --profile power --dump-default-config` 作为只读恢复诊断。
