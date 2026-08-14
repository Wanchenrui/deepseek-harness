# Agent Note: Extensible power-software workbench

Status: implemented

English | [中文](2026-08-14-power-software-workbench.zh.md)

## Problem

The shipped Web Client offers general conversation and trajectory surfaces but no first-class desktop workspace organized around embedded power-software evidence. The repository reports call for a power UI without coupling the browser to a debugger or device SDK. Community TUI candidates are useful interaction references, but the current candidates either depend on Harness rc.6 while this workspace is rc.5 or operate as a separate HTTP client. Adding one directly would create a version or lifecycle boundary before the visual contract is established.

## Decision

Add `@deepseek-ai/dsh-client-ui-power-workbench` as a default, pure Client Cordis plugin. It registers a desktop-style `conversation.view` between Chat and Trajectory and renders only facts derived from the shared Session snapshot. It has no Host half, no device SDK, no command buttons, and no physical-state write path.

The view shell owns layout only. Three named, session-scoped list slots divide overview, primary workspace, and inspector responsibilities. Default panels are registered through the same public slot mechanism that third-party panels use, so domain features can be added, removed, or replaced without editing the shell. The owner currency remains target-neutral and deliberately excludes hardware telemetry.

The UI states the execution boundary in product copy: the browser presents intent and evidence, a future independently reviewed gateway would exclusively own debug or communication transports, and the MCU/FPGA/hardware Trip retains real-time and final protection ownership. Authority never propagates from a lower-risk validation stage to a higher-risk one.

## Alternatives considered

**Install a community full-screen TUI now.** Rejected for this baseline because the Cordis-native candidates inspected target rc.6, while the standalone Ink client connects through HTTP rather than the in-process Client lifecycle. Neither is a safe drop-in dependency for the current rc.5 default bundle.

**Create a second Electron or terminal desktop runtime.** Rejected because it would duplicate lifecycle, settings, and distribution work before the domain surface and extension contract are stable.

**Build one monolithic power dashboard component.** Rejected because every new waveform, build, source, or target adapter would then edit the same safety-sensitive presentation module. Named child slots preserve independent ownership and teardown.

## Consequences

The default Web composition now exposes a responsive power-software desktop view without any new external production dependency. Unit coverage pins the Session derivation and registration/disposal contract; assembled-browser coverage proves the shipped Loader mounts the view, its child contributions, and its narrow-viewport layout. Hardware data and target actions remain deferred to separately authorized Host plugins. The visible cards are therefore an extensible information architecture, not a claim that target connectivity or electrical measurements exist.
