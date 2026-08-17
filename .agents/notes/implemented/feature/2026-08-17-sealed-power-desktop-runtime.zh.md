# Agent Note: 密封的 Power Desktop 运行时

Status: implemented

[English](2026-08-17-sealed-power-desktop-runtime.md) | 中文

## 问题

通用 Harness roster、可变 profile overlay、通用 shell 工具和 Node.js 直接文件访问，不能作为嵌入式功率软件审查桌面产品的可接受默认边界。产品需要带证据标签的工作流和可回滚源码修改模式，但不能暗示已获得目标板权限，也不能允许其他 preset 绕过最终策略 Guard。Esafenet 受保护工作区还会按进程身份决定内容访问，而 Node.js 直接读取可能只能看到加密容器字节。

## 决策

发布密封的 `power` CLI profile，固定组合为 `base + web-app + power-desktop`。该 profile 拒绝 home/profile patch、`--patch`、插件变更和运行时 fallback；roster 仅包含 `power-review` 与 `power-fix`，既有会话不能通过同一 Host 恢复非 Power preset。Desktop 启动器始终选择此 profile，且不暴露插件安装界面。CLI 与 Desktop 都会在创建或挂载任何内容前规范化 workspace，并拒绝它与安装、resource、提取运行时、bundle、preset、配置及源码 checkout 根相等或在任一方向上互相包含。

私有的 [`apps/power-desktop-runtime`](../../../../apps/power-desktop-runtime/package.json) manifest 统一定义打包后的 Node.js 依赖闭包。它列出 CLI 与固定 bundle 栈，在 deploy 根提供全部必要 workspace peer，且不包含代码或生命周期脚本。`verify-runtime-closure` 会检查两份纯依赖运行时 manifest，并把应用包纳入遍历，因此包级生产依赖列表无法掩盖缺少由应用提供的 peer。

两个 preset 装配相同顺序的功率工程提示词、证据投影和最终 `power-policy` Guard。review 只开放工作区读取、搜索和结构化报告；fix 额外开放工作区 `write` 与 `edit`。二者都不开放通用 shell、Web 外发、目标/调试传输、PWM/继电器/保护动作或 NVM 变更。最终 Guard 会依据 `session.header.cwd` 验证每个文件/搜索路径，包括既有路径的规范包含关系，之后才可能触达更宽的 provider 根。工作流和报告模式必须与已挂载 preset 一致。

Power bundle 只使用 `fs-esafenet` 文件系统提供方。在 Windows 上，它会把固定的系统 Windows PowerShell 可执行文件复制一次到随机的提供方自有目录并命名为 `code.exe`，运行包自有编码桥接脚本，模型数据只经标准输入 JSON 传入，并在销毁时删除别名。桥接器限制内容和诊断大小，把读写约束在已授权工作区，拒绝重解析路径穿越，让暂存内容直至发布都保持仅所有者可访问，比较先前精确字节，并返回明确的内容与元数据回执。元数据恢复失败会让已提交目标保持私有并发出警告，而不会诱发重复写入。它不做逐文件 SHA-256 校验。进程别名是明确的 Esafenet 兼容选择，不是禁止边界，也不是模型可控制的可执行文件路径。

已接受快照中的 Claim、证据引用、Build Receipt、安全/兼容影响和发现项会投影到既有只读 Power Workbench slot。Renderer 只接收投影数据，不拥有文件桥、API Key、插件管理、调试器、设备 SDK 或物理动作。

## 曾考虑的替代方案

**只依赖默认 preset 选择。** 不采用，因为已发布 roster 仍能选择或恢复通用 preset，而它们挂载的工具与策略作用域不同于 Power 组合。

**只过滤 preset 菜单。** 不采用，因为直接会话 API 和持久化恢复状态仍可绕过。allowlist 因此同时作用于 Host 的解析、挂载、重组、复制、删除、恢复和 fork 路径，以及 UI 可见 roster。

**为 Esafenet 暴露任意 PowerShell。** 不采用，因为模型可控制命令、参数或环境会把兼容访问变成通用执行能力。固定桥接器是唯一允许的进程面。

**为每次文件操作或 dirty 构建计算哈希。** 不采用，因为有界精确字节比较已提供文件系统陈旧内容检查，构建回执则记录 Git 修订版本和工作树 clean/dirty 状态；两条路径都不增加 SHA-256 工作。唯一保留的静态提示词版本指纹和文档配对元数据属于不同的构建/协议问题。

**归档完整 workspace 或拍平 pnpm 虚拟 store。** 不采用，因为跟随 workspace junction 会重复展开同一包图，而拍平会为必须保持隔离的 peer variant 或多版本包只选择一个版本。检入的生产 manifest 改为支持由锁文件派生的 hoisted deploy，并保留嵌套的冲突版本。

## 后果

Power Desktop 现在具有失败关闭的软件专用权限边界、透明的原生文件系统工具 schema、可重放证据投影、明确的 review/fix 两种模式，以及可审计的生产依赖闭包。产品中不存在目标板提供方，也不存在烧录、复位、PWM、继电器、接触器、预充、保护寄存器写入或 NVM 动作。

Windows fallback 每次内容操作启动一个进程，并依赖过滤器兼容的同目录发布路径。精确内容与元数据 Guard 降低了陈旧写入风险，但并非针对无关外部写入方的操作系统原子 compare-and-swap。持久化 Broker 或编辑器桥、LSP、领域图、日志/波形解析器、证据缓存和独立 critic 仍属于 P1；物理实验室能力仍属于需要单独授权的 P2 产品。
