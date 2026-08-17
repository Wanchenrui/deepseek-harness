# Agent Note: Sealed Power Desktop runtime

Status: implemented

English | [中文](2026-08-17-sealed-power-desktop-runtime.zh.md)

## Problem

The general Harness roster, mutable profile overlays, generic shell tools, and direct Node.js file access do not form an acceptable default for a desktop product that reviews embedded power software. The product needs evidence-labelled workflows and a reversible source-editing mode, but must not imply target-board authority or let a different preset bypass the final policy guard. Esafenet-protected workspaces additionally admit content access according to process identity while direct Node.js reads can expose only encrypted container bytes.

## Decision

Ship a sealed `power` CLI profile whose fixed composition is `base + web-app + power-desktop`. The profile rejects home/profile patches, `--patch`, plugin mutation, and runtime fallback. Its roster is limited to `power-review` and `power-fix`; existing sessions cannot resume a non-Power preset through the same Host. The Desktop launcher always selects this profile and exposes no plugin-install surface. CLI and Desktop both canonicalize the workspace before creating or mounting anything and reject equality or either-direction containment with installation, resource, extracted-runtime, bundle, preset, configuration, and source-checkout roots.

The private [`apps/power-desktop-runtime`](../../../../apps/power-desktop-runtime/package.json) manifest owns the packaged Node.js dependency closure. It names the CLI and fixed bundle stack, supplies every required workspace peer at the deploy root, and has no code or lifecycle scripts. `verify-runtime-closure` checks both dependency-only runtime manifests and includes application packages in its traversal, so a package-level production dependency list cannot hide a missing application-provided peer.

Both presets assemble the same ordered power-engineering prompt, evidence projection, and final `power-policy` guard. Review exposes only workspace read/search and structured reporting. Fix adds workspace `write` and `edit`; neither preset exposes a generic shell, Web egress, target/debug transport, PWM/relay/protection action, or NVM mutation. The final guard validates every file/search path against `session.header.cwd`, including existing-path canonical containment, before the wider provider root can be reached. Workflow and report modes must match the mounted preset.

Use `fs-esafenet` as the sole filesystem provider for the Power bundle. On Windows it copies the fixed system Windows PowerShell executable once into a random provider-owned directory as `code.exe`, runs a package-owned encoded bridge with JSON standard input, and removes the alias on disposal. The bridge bounds content and diagnostics, restricts both reads and writes to the authorized workspace, rejects reparse-path traversal, keeps staging content owner-only through publication, checks exact prior bytes, and returns explicit content and metadata receipts. Metadata restoration failure leaves the committed target private and warns instead of inviting a duplicate write. It does not run per-file SHA-256 checks. The process alias is an explicit Esafenet compatibility choice, not a prohibition boundary or a model-controlled executable path.

Project the accepted snapshot's claims, evidence references, Build Receipt, safety/compatibility impacts, and findings into the existing read-only Power Workbench slots. The Renderer receives projection data only; it owns no filesystem bridge, API key, plugin management, debugger, device SDK, or physical action.

## Alternatives considered

**Rely on the default preset selection.** Rejected because the shipped roster could still select or resume general presets whose mounted tools and policy scope differ from the Power composition.

**Filter only the preset menu.** Rejected because direct session APIs and persisted resume state would remain bypasses. The allowlist therefore applies in the Host resolver, mount, recompose, copy, remove, resume, and fork paths as well as in the UI-visible roster.

**Expose arbitrary PowerShell for Esafenet.** Rejected because model-controlled commands, arguments, or environment would turn compatibility access into a general execution capability. The fixed bridge is the only admitted process surface.

**Hash every file operation or dirty build.** Rejected because exact bounded byte comparison supplies the filesystem stale-content check, while a build receipt records the Git revision plus clean/dirty worktree state. Neither path adds SHA-256 work. The one static prompt-version fingerprint and documentation pairing metadata remain separate build/protocol concerns.

**Archive the complete workspace or flatten the pnpm virtual store.** Rejected because following workspace junctions repeats the same package graph, while flattening selects one version for packages whose peer variants or versions must remain isolated. The checked-in production manifest instead supports a lockfile-derived hoisted deployment with nested conflicts preserved.

## Consequences

Power Desktop now has a fail-closed software-only authority boundary, transparent native filesystem tool schemas, replayable evidence projection, two explicit review/fix modes, and an auditable production dependency closure. No target-board provider, programming, reset, PWM, relay, contactor, precharge, protection-register write, or NVM action is present.

The Windows fallback starts one process per content operation and relies on a filter-compatible same-directory publication path. Exact-content and metadata guards reduce stale writes, but they are not an operating-system atomic compare-and-swap against unrelated external writers. A persistent Broker or editor bridge, LSP, domain graphs, log/waveform parsers, evidence cache, and independent critic remain P1 work; physical lab capability remains a separately authorized P2 product.
