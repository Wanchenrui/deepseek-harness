# Power Desktop runtime closure

English | [中文](README.zh.md)

This private dependency-only workspace package is the deploy root for DeepSeek Harness Power Desktop. It carries no executable code or lifecycle script; its `dependencies` define the Node.js runtime tree that the desktop packager materializes beside the separately built CLI and Web frontend artifacts.

## Closure contract

The manifest names `@deepseek-ai/dsh` and the sealed `base + web-app + power-desktop` bundle stack directly. It also supplies every non-optional workspace peer reached from that graph at the deploy root, because pnpm cannot infer application-owned peer providers from a package's production dependencies. [`verify-runtime-closure`](../../scripts/verify-runtime-closure.ts) traverses workspace dependencies and fails when a required peer is absent.

The desktop packager deploys this manifest from the shared lockfile with injected workspace packages and a hoisted `node_modules`. Hoisting preserves conflicting versions in nested `node_modules` directories without publishing workspace junctions. The packager rejects unresolved build scripts, virtual-store package entries, and filesystem links before archiving the runtime.

This package is not a runnable application and is not published to npm. The Desktop repository supplies the bundled Node.js and pnpm executables, overlays `@deepseek-ai/dsh` at `apps/cli`, and adds `apps/web/dist`; release validation performs the isolated keyless runtime smoke.
