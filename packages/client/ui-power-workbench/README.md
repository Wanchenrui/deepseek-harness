# @deepseek-ai/dsh-client-ui-power-workbench

English | [中文](README.zh.md)

Power Workbench adds a desktop-style, read-only engineering view to the Web Client for power-software work. It organizes the current Session projection around PWM/ADC timing, control/PLL/MPPT, protection and state machines, NVM and calibration, offline waveform evidence, and build/disassembly evidence. Session counters describe only the currently loaded event window, while the separate typed `power/analysis` projection carries the latest accepted domain report. Neither source is device telemetry.

The package is a pure Client Cordis plugin. It registers one `conversation.view` entry and three session-scoped child slots:

- `power.workbench.overview` for compact status or evidence summaries;
- `power.workbench.workspace` for primary engineering-domain tools;
- `power.workbench.inspector` for safety, provenance, and authorization views.

Each default panel is an ordinary independent slot contribution. A future simulation, waveform, build, source-navigation, or target-read plugin can replace or extend a region without importing the workbench component or changing its shell. Contributions receive a small target-neutral owner value derived from the shared Session snapshot and the optional `power/analysis` projection, and remain pure-props React components.

The shipped package intentionally provides no device gateway and no write action. It does not open J-Link, serial, CAN, or debug interfaces, and it never owns PWM, relay, contactor, precharge, or protection-register execution. A future hardware integration must live behind an independently reviewed Host boundary with its own task-level authorization and audit evidence.

## Projection Contract

The shell reads `power/analysis` through the standard session-projection hook and passes the exact same immutable snapshot to all three child slots. A missing or `null` value renders an explicit empty state rather than reusing an older result or inventing domain status.

When present, the default panels expose only fields from the validated `PowerAnalysisSnapshot` contract:

- workflow, mode, lifecycle status, and report summary;
- claim, evidence-reference, finding, and unknown counts plus a bounded finding preview;
- the explicit build declaration, including “not compiled” when no successful receipt exists;
- API, ABI, and NVM compatibility classifications;
- the fixed P0 target-authorization and physical-execution boundary, together with any disclosed safety-parameter source changes.

This package is a projection consumer only. Slash workflows and report validation remain Host responsibilities, and the browser cannot promote a report into target-board authority.

## Model Experience

None, as this browser-only Session projection registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- The initial panels present Session progress and extension topology, not MCU telemetry or measured electrical quantities.
- The analysis card is a concise report projection, not a full evidence-artifact browser; source, log, waveform, and build-detail viewers remain extension points.
- Simulation, waveform decoding, source navigation, build evidence, and target-read adapters are extension points only. No device gateway ships in this package.
- Community TUI packages reviewed in August 2026 target a newer Harness release or run as a separate HTTP client, so none is installed as a runtime dependency of this rc.5 workspace.
