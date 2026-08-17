# Power Desktop 运行时闭包

[English](README.md) | 中文

此私有的纯依赖 workspace 包是 DeepSeek Harness Power Desktop 的 deploy 根。它不携带可执行代码或生命周期脚本；其 `dependencies` 定义桌面打包器要物化的 Node.js 运行时文件树，CLI 和 Web 前端构建产物则另行加入。

## 闭包约定

manifest 直接列出 `@deepseek-ai/dsh` 和密封的 `base + web-app + power-desktop` bundle 栈。它还在 deploy 根提供该依赖图可达的全部非可选 workspace peer，因为 pnpm 无法根据单个包的生产依赖推断应用负责提供的 peer。[`verify-runtime-closure`](../../scripts/verify-runtime-closure.ts) 会遍历 workspace 依赖，并在缺少必要 peer 时失败。

桌面打包器依据共享锁文件 deploy 此 manifest，启用注入式 workspace 包和 hoisted `node_modules`。hoist 会把冲突版本保留在嵌套 `node_modules` 中，同时避免发布 workspace junction。打包器会在归档前拒绝未处理的构建脚本、虚拟 store 包条目和文件系统链接。

此包不是可运行应用，也不发布到 npm。Desktop 仓库负责随附 Node.js 与 pnpm 可执行文件，把 `@deepseek-ai/dsh` overlay 到 `apps/cli`，并加入 `apps/web/dist`；发布验收负责执行隔离的无密钥运行时 smoke。
