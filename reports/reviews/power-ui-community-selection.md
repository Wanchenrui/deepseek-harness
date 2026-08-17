# 功率软件 TUI 社区插件筛选与落地结论

审查日期：2026-08-14
社区入口：[GitHub `dsh-plugin` topic](https://github.com/topics/dsh-plugin)

## 结论

【工程判断】当前工程应先采用仓库内的纯 Client Cordis 插件搭建桌面工作台，不把第三方
TUI 直接加入默认运行时。原因不是社区项目缺乏价值，而是当前工程版本为 rc.5，较完整
的 Cordis 原生 TUI 候选已经面向 rc.6；另一类 Ink TUI 则是经 HTTP 接入的独立客户端，
不具备本工程 Client 插件的装配与卸载语义。

首期已落地 `@deepseek-ai/dsh-client-ui-power-workbench`。它把 UI 壳层拆成概览、主工作
区、检查侧栏三个 list slot，适合后续把波形、构建/Map、源码导航、静态分析、离线日志
以及受控目标只读能力做成独立插件。当前视图不连接目标板，也没有真实状态写入口。

## 候选评估

| 候选 | 已验证事实 | 适配判断 |
| --- | --- | --- |
| [`ccch1mneyyy/dsh-TUI`](https://github.com/ccch1mneyyy/dsh-TUI) | Cordis bundle、全屏 TUI、MIT；其包清单面向 DSH rc.6 | 交互结构最值得参考；待主工程版本对齐后，在隔离 profile 复评 |
| [`realchenwenqiao/dash`](https://github.com/realchenwenqiao/dash) | Cordis bundle，基于 `pi-tui`，包清单面向 DSH rc.6 | 可作为轻量原生 TUI 备选；当前不进入 rc.5 默认 bundle |
| [`MashedPotato817/dsh-tui`](https://github.com/MashedPotato817/dsh-tui) | Ink/React 独立终端程序，通过 HTTP 连接运行中的 `dsh web` | 适合远程旁路观察；不作为进程内 Client 插件基座 |
| [`jasper-zsh/dsh-plugin-file-manager`](https://github.com/jasper-zsh/dsh-plugin-file-manager) | 提供文件树、Git 状态与预览能力 | 高优先级参考：适合源码、Map、日志与报告导航，但需限制可见根目录 |
| [`fuhefei/dsh-sentinel`](https://github.com/fuhefei/dsh-sentinel) | 面向文件监视与唤醒工作流 | 只适合离线构建/仿真自动化；不得直接触发功率级动作 |
| [`dongsheng123132/dsh-audit-bundle`](https://github.com/dongsheng123132/dsh-audit-bundle) | 面向内容寻址的证据校验 | 高价值后续能力：可用于构建产物、日志、波形与测试证据追溯 |

## 功率软件方向的推荐组合

【工程判断】建议按以下顺序演进，且每一项独立占用工作台 slot：

1. 源码/报告/Map 文件导航，只读打开并限制工作区根目录；
2. 构建与静态分析证据面板，记录工具链版本和实际退出状态；
3. 串口日志、示波器与逻辑分析波形的离线导入和时间轴对齐；
4. 内容寻址的证据清单，固定固件、配置、日志与波形之间的对应关系；
5. 目标只读网关；只有取得任务级授权后才允许打开具体接口；
6. 受控写入网关；与 UI 分离，并由唯一物理执行所有者裁决状态许可与保护不变量。

【已验证事实】本次实现只完成第 0 层信息架构和 Session 投影展示，没有新增生产依赖，
没有修改保护阈值、死区、Trip、启停状态机、NVM 布局或任何目标固件。

## 待验证项

【未知项】社区候选在 Windows、当前仓库的实际 profile 以及未来 rc.6 对齐版本上的完整
启动与卸载行为尚未实测。版本升级后应先在隔离 profile 做安装、启动、重载、异常退出和
回退测试，再决定是否成为开发环境的可选插件；不得直接加入生产调试路径。
