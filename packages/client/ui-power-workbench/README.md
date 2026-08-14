# @deepseek-ai/dsh-client-ui-power-workbench

English | [中文](README.zh.md)

Power Workbench adds a desktop-style, read-only engineering view to the Web Client for power-software work. It organizes the current Session projection around PWM/ADC timing, control/PLL/MPPT, protection and state machines, NVM and calibration, offline waveform evidence, and build/disassembly evidence. The figures on the page describe only the currently loaded Session window; they are not device telemetry.

The package is a pure Client Cordis plugin. It registers one `conversation.view` entry and three session-scoped child slots:

- `power.workbench.overview` for compact status or evidence summaries;
- `power.workbench.workspace` for primary engineering-domain tools;
- `power.workbench.inspector` for safety, provenance, and authorization views.

Each default panel is an ordinary independent slot contribution. A future simulation, waveform, build, source-navigation, or target-read plugin can replace or extend a region without importing the workbench component or changing its shell. Contributions receive a small target-neutral owner value derived from the shared Session snapshot and remain pure-props React components.

The shipped package intentionally provides no device gateway and no write action. It does not open J-Link, serial, CAN, or debug interfaces, and it never owns PWM, relay, contactor, precharge, or protection-register execution. A future hardware integration must live behind an independently reviewed Host boundary with its own task-level authorization and audit evidence.

## Model Experience

None, as this browser-only Session projection registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends provider requests.

## Known Limitations and Deferred Work

- The initial panels present Session progress and extension topology, not MCU telemetry or measured electrical quantities.
- Simulation, waveform decoding, source navigation, build evidence, and target-read adapters are extension points only. No device gateway ships in this package.
- Community TUI packages reviewed in August 2026 target a newer Harness release or run as a separate HTTP client, so none is installed as a runtime dependency of this rc.5 workspace.
