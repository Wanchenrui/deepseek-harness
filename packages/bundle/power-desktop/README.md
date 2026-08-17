# `@deepseek-ai/dsh-power-desktop`

English | [中文](README.zh.md)

The Power Desktop distribution layer applied after [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md). [`cordis.patch.yml`](cordis.patch.yml) selects the shipped `power-review` preset, replaces the ordinary filesystem provider with [`dsh-fs-esafenet`](../../fs/fs-esafenet/README.md), and closes model-facing network, command, telemetry, remote-title, and physical-execution paths. The package has no runtime API; the profile composer resolves its patch through `dsh.bundle.patch`.

## Composition

The two shipped presets share the versioned [`power-prompt`](../../power/power-prompt/README.md), fail-closed [`power-policy`](../../power/power-policy/README.md), durable [`power-analysis`](../../power/power-analysis/README.md), workspace instructions, filesystem tools, and fixed-argv ripgrep discovery. Neither preset mounts a persona in complete mode or exposes Web, Bash, PowerShell, terminal, code-runtime, subagent, target-board, or power-actuation tools.

| Preset | Standing file policy | Model-visible mutation | Verification |
|---|---|---|---|
| `power-review` (default) | `read-only` | none; `write` and `edit` are hidden and denied at execution | static evidence only |
| `power-fix` | `workspace-write` | `write` and `edit` under the session workspace | static evidence only in P0 |

Each preset mounts its own isolated `sandboxPolicy` beside `tool-fs`. The host permission switch is disabled, so no session permission event can override those modes. The approval policy is `never`, which rejects one-shot elevation before interactive dispatch. The final guard binds `read`, `read_image`, `write`, `edit`, `glob`, and `grep` paths to the session workspace, while the sealed profile independently rejects any workspace that contains or is contained by installation-owned code or configuration.

## Security properties

- The base process sandbox Service Provider remains enabled. The assembled composition disables `fs-sandbox`, mounts exactly one `fs-esafenet` provider, and retains the observation policy. Protected content crosses only the provider's fixed protocol through the sandboxed process path.
- Generic Bash and PowerShell executors and tools, terminal paths, editor-process tools, and the code runtime are absent or disabled. The separate process sandbox remains enabled for Esafenet. Filesystem discovery uses packaged ripgrep with fixed arguments through the subprocess seam; it does not expose a command string.
- External Web search and its DeepSeek provider, OpenTelemetry session export, and first-prompt LLM title generation are disabled. Ordinary chat model traffic remains the selected product route.
- No target-board, programmer, debugger, serial, PWM, relay, precharge, contactor, NVM-clear, or power-stage tool is mounted. Selecting either preset does not authorize physical execution.

## Model Experience

### Preset-composed surface

#### What the model sees

`power-review` exposes `read`, `glob`, `grep`, and `power_report`; `power-fix` additionally exposes `write` and `edit`. Both receive the fixed Chinese power-software safety and evidence sections, the selected environment section, and the `/locate`, `/review`, `/incident`, `/requirement`, and `/fix` workflow prompts.

#### Token effect

Each request carries the fixed power prompt, one short environment section, and the selected native tool schemas. Workflow user messages and `power_report` call/results add only their ordinary durable transcript text after they occur.

#### KV Cache effect

The fixed prompt sections and native tool schemas are stable within one preset. Switching presets starts a different session composition and changes only the environment section and the two mutation schemas.

## Known Limitations and Deferred Work

- Windows Esafenet content operations require the fixed system Windows PowerShell binary to run through the provider-owned `code.exe` alias; non-Windows use requires a fixed absolute `pwsh` installation. Provider startup or confinement failure is fatal, with no direct-Node or arbitrary-shell fallback.
- P0 has no specialized build/static-analysis runner, LSP bridge, waveform decoder, or target-board provider. `power-fix` therefore reports verification as static-only and must not claim a build receipt.
- Agent presets are fixed when a session starts. Changing review/fix authority requires starting a blank session on the other preset; the in-session permission switch is intentionally unavailable.
- The bundle package still follows ordinary patch precedence when embedded in another custom profile. The shipped `power` profile is different: it rejects profile/home patches, `--patch`, and plugin mutation, and `dsh --profile power --dump-default-config` remains the read-only recovery diagnostic.
