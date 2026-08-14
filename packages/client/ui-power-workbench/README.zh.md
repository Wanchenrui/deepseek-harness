# @deepseek-ai/dsh-client-ui-power-workbench

[English](README.md) | 中文

Power Workbench 为 Web Client 增加面向功率软件工作的桌面式只读工程视图。它围绕 PWM/ADC 时序、控制环/PLL/MPPT、保护与状态机、NVM 与标定、离线波形证据以及构建/反汇编证据组织当前 Session 投影。页面中的数字只描述当前已加载的 Session 窗口，不代表设备遥测。

该包是纯 Client Cordis 插件。它注册一个 `conversation.view` 条目及三个 session 作用域的子槽位：

- `power.workbench.overview`：紧凑状态或证据摘要；
- `power.workbench.workspace`：主要工程域工具；
- `power.workbench.inspector`：安全、来源与授权检查视图。

每个默认面板都是普通且相互独立的 slot contribution。未来的仿真、波形、构建、源码导航或目标只读插件无需导入工作台组件或修改壳层，即可替换或扩展某一区域。Contribution 接收由共享 Session snapshot 派生的小型、目标无关 owner value，并保持为纯 props React 组件。

已发布包有意不提供设备网关或写入动作。它不会打开 J-Link、串口、CAN 或调试接口，也绝不拥有 PWM、继电器、接触器、预充或保护寄存器的执行权。未来的硬件集成必须位于经过独立审查的 Host 边界之后，并拥有自己的任务级授权与审计证据。

## 模型体验

无。工作台只在浏览器中渲染既有 Session 投影；这里没有任何内容进入或改变模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 初始面板展示 Session 进度与扩展拓扑，不展示 MCU 遥测或实测电气量。
- 仿真、波形解码、源码导航、构建证据与目标只读适配器目前仅提供扩展点；本包不随附设备网关。
- 2026 年 8 月审查的社区 TUI 包要么面向更新的 Harness 版本，要么作为独立 HTTP 客户端运行，因此当前 rc.5 工作区没有把它们安装为运行时依赖。
