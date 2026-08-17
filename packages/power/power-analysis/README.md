# @deepseek-ai/dsh-power-analysis

English | [中文](README.zh.md)

Replayable, evidence-labelled analysis state for photovoltaic microinverter, storage, microgrid-control, and related embedded power-software work.

## What it does

The function plugin registers the `power_report` model tool and an authority-matched command set drawn from `/locate`, `/review`, `/incident`, `/requirement`, and `/fix`. Each registered command requires a task, writes an initial `power/analysis-state` event, and queues a fixed domain prompt through `agent.followup(createUserMessage(...))`. The prompt requires evidence labels, compatibility disclosure, real build receipts, and the package's no-hardware-execution rule.

`power_report` accepts the complete current `PowerAnalysisSnapshot`; partial updates are not supported. It rejects a snapshot whose `mode` differs from the configured authority. A successful call appends a complete post-change `power/analysis-state` event to the calling agent's session. The event is the authoritative UI/replay state, while the ordinary `tool/call` and `tool/result` records retain exactly what the model saw and submitted.

## Configuration

`mode` is `review` or `fix` and defaults conservatively to `review`. Review authority registers only `/locate`, `/review`, `/incident`, and `/requirement`, and accepts only snapshots with `mode: review`; it never registers `/fix`. Fix authority registers only `/fix` and accepts only snapshots with `mode: fix`. The command surface and report executor therefore enforce the same authority instead of relying on prompt wording or schema visibility.

## Snapshot and projection

Schema version 1 contains the workflow and mode, lifecycle status, original task, summary, evidence-labelled claims, findings, unknowns, build verification, API/ABI/NVM compatibility, safety boundary, and RFC 3339 timestamps. Every state event carries the complete snapshot; replay is last-write-wins and requires no prior in-memory state.

When `ctx.sessionProjections` is present, the plugin registers the `power/analysis` key. Its initial value is `null`, unrelated events preserve the same state reference, and a valid `power/analysis-state` event replaces the whole value. `./client` re-exports only the client-safe types and declaration merge for `SessionProjectionMap`.

## Evidence rules

Every `Claim` has exactly one label: `VERIFIED_FACT`, `CODE_INFERENCE`, `ENGINEERING_JUDGMENT`, or `UNKNOWN`. Facts and code inferences require at least one precise `EvidenceRef`; engineering judgments require both a basis and pending verification; unknowns require pending verification. Finding claim identifiers must resolve to claims in the same snapshot, and duplicate claim identifiers are rejected.

Evidence references identify a source class, artifact, and precise locator, with an optional revision. The package does not invent evidence or infer that a command ran: it validates the report structure presented by the model and persists that exact accepted state.

## Build and compatibility receipts

Compilation is an explicit discriminated claim. `build.declaration: compiled` accepts only a successful receipt containing `exitCode: 0`, exact command, working directory, start and finish timestamps, source revision, clean/dirty worktree state, and summary. Failed builds require a non-zero exit code. `not-run` requires a reason and a null receipt. Finish timestamps cannot precede start timestamps. Version and worktree state deliberately replace a mandatory diff digest: the receipt records execution context without forcing a SHA-256 calculation that cannot by itself prove the command ran.

Compatibility is stated independently for API, ABI, and NVM as `unchanged`, `compatible-change`, `breaking-change`, or `unknown`. Any breaking classification requires both migration and rollback text.

## Safety boundary

This P0 package never grants target-board authority. Every accepted snapshot fixes target-board execution, energized power-stage operation, physical PWM/relay/contactor/precharge actuation, and target NVM clear to `not-performed`, with target authorization fixed to `not-granted`. It also rejects common positive natural-language claims that hardware was flashed, energized, reset, or actuated on a best-effort basis; natural-language matching is not an authorization record. The structured `safetyBoundary` is the only authoritative execution state. The workflow prompts repeat this limit; the package contains no target transport, programmer, debugger, serial, PWM, relay, or protection-register operation.

Source changes to protection thresholds, dead time, trip configuration, or safe defaults remain possible only in an authorized source-edit workflow and must be disclosed as `SafetyParameterChange` entries with old value, new value, basis, and evidence. The boolean disclosure flag must agree with whether entries exist.

## Commands

Review configuration exposes the four read-only workflows; fix configuration exposes only `/fix`. Mode/workflow mismatches and configuration-authority mismatches are rejected in later reports. Empty command input returns `Usage: /<workflow> <task>` without appending state or waking the agent. Command input is stored in the domain snapshot and the queued model message; command lifecycle logging therefore need not duplicate it.

## Invariant companion

`@deepseek-ai/dsh-power-analysis/invariant` validates existing and newly appended package events when the invariant registry is enabled. It checks the event discriminator and version, then applies the same complete snapshot validation used by `power_report`. Invalid persisted state fails loudly instead of becoming a projection value.

## Export shape

The main entry is a function/namespace plugin and exports `name`, `inject`, `Config`, and `apply` with no default export. `./types` and `./client` expose the shared client-safe vocabulary; `./invariant` exposes the package invariant companion.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`power_report(snapshot)` schema catalog entry](../../../docs/tool-catalog.md#tool-package-map). The `snapshot` parameter is JSON because the accepted format has relational rules that JSON Schema cannot express; the description names every required top-level field, the evidence obligations, the build-receipt rule, the fixed physical-execution values, and the configured authority. Runtime validation rejects unknown keys, incomplete or contradictory reports, and authority-mismatched modes before any domain event is appended.

#### Token effect

The tool definition has a fixed prompt cost. Each call retains the complete snapshot in tool-call history, so token growth scales with claim, finding, and evidence volume until compaction.

#### KV Cache effect

The definition is prefix-stable while plugin visibility is unchanged. Accepted report arguments and compact acknowledgements append after the reusable prefix.

### Workflow messages and results

#### What the model sees

Each command queues one fixed workflow message containing the JSON-quoted user task, workflow-specific review instruction, evidence labels, receipt requirements, and the no-hardware-execution rule. A successful report returns `Power analysis snapshot accepted at event <seq>; status: <status>.` Validation failures are ordinary error tool results and leave the projection unchanged.

#### Token effect

Each workflow begins with one bounded instruction message. Report-call cost is proportional to the complete snapshot; there is no hidden second model message derived from the projection event.

#### KV Cache effect

Workflow and tool-result messages are append-only. Changing workflow selection or tool visibility changes only the later request suffix.

## Known Limitations and Deferred Work

- The package records evidence references but does not itself read source, datasheets, logs, or waveforms; filesystem, LSP, log, and waveform providers remain separate capabilities.
- The two configuration modes authorize source-analysis behavior only; neither grants target-board execution. A future hardware layer requires an independently reviewed authorization model and cannot reinterpret these version-1 `not-performed` fields.
- Natural-language execution-claim rejection covers common English and Chinese positive assertions; the fixed structured safety fields remain the enforceable authority record.
- The package does not parse compiler output. A build receipt proves only the command metadata and exit status supplied by the actual tool path; callers and audit tooling must bind those fields to captured execution results.
