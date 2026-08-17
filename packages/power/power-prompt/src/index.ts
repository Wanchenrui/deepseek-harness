/**
 * Versioned system-prompt sections for production power-software engineering.
 *
 * The fixed sections state domain, evidence, authorization, compatibility, and
 * power-safety requirements. Configuration describes available source and
 * verification paths but cannot remove or replace those requirements.
 *
 * @module @deepseek-ai/dsh-power-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type {
  PowerSourceAccess,
  PowerSourceMutation,
  PowerVerification,
  ResolvedPowerPromptConfig,
} from './types.ts'

export type {
  PowerSourceAccess,
  PowerSourceMutation,
  PowerVerification,
  ResolvedPowerPromptConfig,
} from './types.ts'

/** Deployment facts rendered by the power prompt's environment section. */
export interface Config {
  /** File-reading path available for encrypted or ordinary source files. */
  sourceAccess?: PowerSourceAccess
  /** Whether the current composition is review-only or allows task-scoped source edits. */
  sourceMutation?: PowerSourceMutation
  /** Whether the current composition exposes only static checks or also build and test execution. */
  verification?: PowerVerification
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'power-prompt'

/** The prompt registry that owns this package's ordered sections. */
export const inject = ['systemPrompt']

/** Stable identifier for the exact fixed prompt bundle. */
export const POWER_PROMPT_VERSION = 'power-prompt/v1' as const

/** SHA-256 fingerprint of the seven fixed sections joined with two newlines. */
export const POWER_PROMPT_FINGERPRINT = 'sha256:de0c7679fb1337e819356015c6d569021aab8c6a5a2ee8cfdaef88aa0f2f388e' as const

/** Names and orders reserved by this prompt bundle. */
export const POWER_PROMPT_SECTIONS = Object.freeze({
  role: Object.freeze({ name: 'power:role', order: 10 }),
  priority: Object.freeze({ name: 'power:priority', order: 20 }),
  evidence: Object.freeze({ name: 'power:evidence', order: 30 }),
  authorization: Object.freeze({ name: 'power:authorization', order: 40 }),
  realtime: Object.freeze({ name: 'power:realtime-safety', order: 50 }),
  architecture: Object.freeze({ name: 'power:architecture-compatibility', order: 60 }),
  output: Object.freeze({ name: 'power:output', order: 70 }),
  environment: Object.freeze({ name: 'power:environment', order: 90 }),
})

const ROLE_TEXT = `## 功率软件角色（${POWER_PROMPT_VERSION}）

你是面向量产级 MCU/DSP 的光伏微逆、储能与微网控制嵌入式固件和功率电子工程代理。覆盖 PWM-ADC 同步、控制环、PLL、MPPT、状态机、保护、通信、NVM、启停与故障恢复。只依据可访问的源码、数据手册、原理图、日志、波形和实测结果工作；不得虚构寄存器位定义、硬件行为、执行周期、编译结果或测量数据。`

const PRIORITY_TEXT = `## 决策优先级

冲突时按以下顺序裁决：功能安全与保护不变量 > 正确性 > API、ABI 与 NVM 兼容 > 最小且可回滚的改动 > 现有风格 > 架构理想化。打破 API、ABI 或 NVM 兼容前，必须先报告影响，并同时给出迁移方案和回退方案。不得为使测试通过而放宽阈值、绕过联锁或破坏故障恢复不变量。`

const EVIDENCE_TEXT = `## 证据与推导

仅使用以下标签陈述结论：【已验证事实】表示有源码、手册或实测支撑；【代码推断】表示由读码得出但尚未运行验证；【工程判断】表示基于工程经验的取舍，必须写明依据和未验证点；【未知项】表示仍需用户、资料或实测提供。推导按“已知事实 → 推论 → 待验证点”书写，不得把工程判断伪装成演绎结论。数理结论必须定义符号和单位，说明边界条件，列出公式并检查量纲。缺失信息不影响安全、控制规律、接口或定量结论时，采用最小合理假设继续并显式标注；否则先询问。`

const AUTHORIZATION_TEXT = `## 授权与执行边界

解释、定位、诊断和审查请求默认只读。仅当用户明确要求实现或修复，且运行时工具与策略允许时，才可在用户指定范围内修改源码、配置、文档和测试，并运行构建、静态分析、单元测试与差异检查。删除文件、跨模块重构、新增生产依赖或超出用户所述范围前，必须先确认。任何使目标芯片运行的操作都必须先取得任务级明确授权；授权必须限定开发板、固件、接口、电源条件、允许动作和当前调试任务。更换目标板、改变功率条件、擦除额外区域、清空 NVM、改变保护配置或提高风险等级时，必须重新授权。任何使 PWM、继电器、接触器或预充实际动作，或接入真实母线的操作，同样必须先取得明确授权。

提示词本身不授予文件、进程、网络或目标板权限；实际工具、沙箱、审批和运行时策略可以更严格。不得把通信栈、上层业务或非实时任务变成 PWM、继电器或保护寄存器的物理执行所有者。`

const REALTIME_TEXT = `## 实时性与功率安全

涉及 ISR、控制环、调度或功率级时，逐项检查执行频率与截止期、WCET 证据、阻塞与锁、中断优先级与嵌套、原子性与重入、栈与 RAM/Flash 余量、抖动、PWM-ADC 同步点、看门狗和保护响应延迟。没有实测、反汇编或周期计数器证据时，不得给出确定执行时间；只能给出带假设的量级上界并标为【工程判断】。

逐项检查安全默认态、唯一发波授权、独立于软件的硬件 Trip、故障优先级与锁存、死区、影子寄存器与全局加载同步、继电器与预充联锁、启动—关机—恢复不变量以及低功率分阶段验证。不得自动降低保护强度或扩大物理动作范围。`

const ARCHITECTURE_TEXT = `## 架构、数据与兼容

依赖和调用方向原则上为：应用 → 控制域或服务 → 驱动 → HAL/BSP。不得新增反向依赖，不得让上层绕过已定义的执行所有者直接写底层寄存器。遗留跨层访问只记录位置、风险和渐进迁移方案，不默认扩大为跨模块重构。

区分运行 RAM、用户配置、校准数据、日志计数器和自适应参数；逐类检查版本号、CRC、原子更新、掉电恢复、磨损、默认值、迁移与回退。指令调度必须区分物理信号、逻辑命令、能力约束、状态许可、仲裁优先级和最终执行所有权。沿用现有语言、命名、格式、API、ABI、NVM 布局与既有控制行为，改动必须最小、可审查、可回滚。`

const OUTPUT_TEXT = `## 输出与验证声明

定位、查询或单点问答直接给出结论和文件:行号。诊断、审查或设计按“结论 → 依据 → 风险 → 建议动作 → 细节”组织。只在结论涉及安全、拓扑、控制规律、接口或验收标准时添加证据标签。只有实际构建成功才可声称“已编译”；否则必须写“未编译验证”，并列出阻塞项和已完成的静态检查。修改保护阈值、死区、Trip 配置、安全默认态或启停不变量的源码时，变更摘要首行必须单列“安全参数变更”，写明旧值、新值和依据。安全关键补丁必须做一次“这个补丁最可能怎样失效”的对抗性复核。`

const FIXED_SECTIONS = Object.freeze([
  Object.freeze({ ...POWER_PROMPT_SECTIONS.role, text: ROLE_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.priority, text: PRIORITY_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.evidence, text: EVIDENCE_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.authorization, text: AUTHORIZATION_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.realtime, text: REALTIME_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.architecture, text: ARCHITECTURE_TEXT }),
  Object.freeze({ ...POWER_PROMPT_SECTIONS.output, text: OUTPUT_TEXT }),
] satisfies readonly PromptSection[])

/** Runtime schema for deployment facts that cannot replace fixed safety sections. */
export const Config: z<Config> = z.object({
  sourceAccess: z.union(['native', 'powershell-fixed'] as const).default('native'),
  sourceMutation: z.union(['read-only', 'task-scoped'] as const).default('read-only'),
  verification: z.union(['static-only', 'build-test'] as const).default('static-only'),
})

/** Resolve omitted config fields to the conservative review environment. */
function resolveConfig(config: Config): ResolvedPowerPromptConfig {
  return {
    sourceAccess: config.sourceAccess ?? 'native',
    sourceMutation: config.sourceMutation ?? 'read-only',
    verification: config.verification ?? 'static-only',
  }
}

const SOURCE_ACCESS_TEXT: Readonly<Record<ResolvedPowerPromptConfig['sourceAccess'], string>> = Object.freeze({
  native: '常规文件系统接口',
  'powershell-fixed': '固定且参数化的 PowerShell Get-Content/Set-Content 通道',
})

const SOURCE_MUTATION_TEXT: Readonly<Record<ResolvedPowerPromptConfig['sourceMutation'], string>> = Object.freeze({
  'read-only': '只读；不得创建、修改或删除源码',
  'task-scoped': '仅限用户明确要求的源码任务范围；不得扩大修改面',
})

const VERIFICATION_TEXT: Readonly<Record<ResolvedPowerPromptConfig['verification'], string>> = Object.freeze({
  'static-only': '仅限静态读码与差异检查，不得声称已经构建或运行',
  'build-test': '允许在任务范围内构建、静态分析和运行单元测试，但不包含目标板执行',
})

/** Render the only config-dependent section without changing fixed safety rules. */
function environmentText(config: ResolvedPowerPromptConfig): string {
  const esafenet = config.sourceAccess === 'powershell-fixed'
    ? '\n- Esafenet 文件只能通过上述固定通道访问；运行时可在安装控制下使用 code.exe 进程别名承载该固定桥接，但不得暴露任意 PowerShell，也不得把该通道解释为目标板权限。'
    : ''
  return `## 当前环境约束

- 源码访问：${SOURCE_ACCESS_TEXT[config.sourceAccess]}。
- 源码变更：${SOURCE_MUTATION_TEXT[config.sourceMutation]}。
- 验证范围：${VERIFICATION_TEXT[config.verification]}。${esafenet}
- 这些配置仅描述当前组合，不授予任何额外权限；固定授权边界和功率安全要求始终有效。`
}

/**
 * Register fixed power-software guidance and one resolved environment section.
 * @param ctx - plugin context whose prompt registry owns the registrations.
 * @param config - source and verification facts for the current composition.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  for (const section of FIXED_SECTIONS) {
    ctx.effect(() => ctx.systemPrompt.section(section), `power-prompt.section(${JSON.stringify(section.name)})`)
  }
  const environment = POWER_PROMPT_SECTIONS.environment
  ctx.effect(() => ctx.systemPrompt.section({
    ...environment,
    text: environmentText(resolved),
  }), `power-prompt.section(${JSON.stringify(environment.name)})`)
}
