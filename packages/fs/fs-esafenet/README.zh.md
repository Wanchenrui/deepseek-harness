# @deepseek-ai/dsh-fs-esafenet

[English](README.md) | 中文

这是用于 `ctx.fs` 能力 seam 的 Esafenet 兼容 Service Provider。受保护源码可能拒绝 Node.js 直接进行内容 I/O，同时允许名为 `code.exe` 的进程，因此本提供方把路径身份与元数据留在 `dsh-fs-local`，仅通过包自有的 PowerShell 桥接器执行有界内容操作。

```ts ignore-check
import { EsafenetFileSystem } from '@deepseek-ai/dsh-fs-esafenet'

await ctx.plugin(EsafenetFileSystem, {
  cwd: process.cwd(),
  operationTimeoutMs: 30_000,
  maxTextBytes: 16 * 1024 * 1024,
  processIdentity: 'code-alias',
})
```

## 安全边界

- 在 Windows 上，本提供方会把固定的系统 Windows PowerShell 可执行文件复制一次到随机的提供方私有目录，并命名为 `code.exe`；只启动该绝对路径，并在销毁时移除别名。非 Windows 主机使用固定绝对路径下的 `pwsh`。模型控制的路径与内容仅通过标准输入中的 JSON 传递；调用方不能提供可执行文件、命令、脚本片段、环境项或参数。
- 本提供方会声明并强制执行共享沙箱策略。读取和 `workspace-write` 变更都只允许会话工作区；桥接器拒绝包含 junction 或符号链接的路径分量；`read-only` 拒绝变更，且不接受 `danger-full-access`。
- 写入会在目标旁暂存仅所有者可访问的 UTF-8 内容，发布前强制刷新并再次比较先前观测到的精确字节，随后要求明确的提交回执。首个内容字节写入前就会施加私有 mode 或 DACL，并且暂存路径在发布前始终保持私有；发布后立即在最终路径恢复新建时预期或既有目标的元数据。恢复失败时，已提交内容保持仅所有者可访问，桥接器返回降级元数据回执并写入宿主警告，绝不会把已提交内容误报为未提交。`createIfAbsent` 与 `replaceIfVersion` 继续以失败关闭方式工作，进程内的变更按规范目标逐一串行执行。桥接器使用精确字节比较，不做逐文件哈希。
- 文本读取受字节上限约束，会拒绝 NUL 内容与无效 UTF-8，且绝不回退到任意 shell 工具。因此 review preset 不需要通用 PowerShell 能力。

## 行为

`resolve`、`processPath`、`fileUrl`、`contains`、`stat`、`lstat` 与 `listDir` 保留 `dsh-fs-local` 语义。`readText`、`streamText`、`readBytes`、`writeText` 与 `editText` 使用固定桥接器。字面量编辑会先将 CRLF 规范化后再匹配，并在写回磁盘时恢复源码的换行风格。发布前取消返回 `FS_ABORTED`。若写入可能已经提交时传输中断，本提供方会执行一次不受原取消信号影响的精确内容读取：内容相同则返回已提交结果，否则保留原始类型化错误。

## 模型体验

### 文件系统工具执行

#### 模型看到什么

仅有普通的 `read`、`read_image`、`write` 与 `edit` 工具。结果文本与 diff 行为保持提供方无关。权限拒绝继续使用标准 `FS_SANDBOX_DENIED` 代码，而 Esafenet 访问本身不会暴露命令面或新的模型可见语法。

#### Token 影响

无。本提供方不新增工具 schema 或提示词指令。

#### KV Cache 影响

无。本提供方只改变既有工具 schema 背后的执行方式，不增加提示词文本。

## 已知限制与延期工作

- Windows `code.exe` 别名是 Esafenet 兼容机制，不是可执行文件签名或同用户篡改边界。源文件来自固定的系统 Windows PowerShell 路径，复制件只检查为普通文件且大小符合预期；每次操作不计算 SHA-256。只有当部署环境已经允许固定 PowerShell 可执行文件时，才能用 `processIdentity: 'native'` 绕过别名。
- P0 桥接器为每次内容操作启动一个进程。`streamText` 先完成有界的整文件读取，再发出有界字符分片；持久化 Broker 或编辑器桥接器延期到 P1。
- 目标身份和元数据仍使用 `dsh-fs-local`。如果某个部署中的 Esafenet 还会阻止 Node.js 元数据调用，则应使用 P1 Broker 提供方，而不是本 fallback。
- 新鲜度使用本地提供方的元数据版本 token，并在发布前比较精确内容。无关外部写入方仍可能在最终比较后竞争。Windows 在 Esafenet 过滤器下使用过滤器兼容的同目录移动路径；未通过启用式受保护夹具验收前，不承诺崩溃原子性。
- 桥接器只处理 UTF-8 文本。编码检测、旧代码页以及透明编辑器缓冲区读取属于未来 Broker/VS Code 提供方的范围。
