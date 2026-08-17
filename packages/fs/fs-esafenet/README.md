# @deepseek-ai/dsh-fs-esafenet

English | [中文](README.zh.md)

The Esafenet-compatible Service Provider for the `ctx.fs` capability seam. Protected source files may reject direct Node.js content I/O while admitting a process named `code.exe`, so this provider keeps path identity and metadata in `dsh-fs-local` and routes only bounded content operations through a package-owned PowerShell bridge.

```ts ignore-check
import { EsafenetFileSystem } from '@deepseek-ai/dsh-fs-esafenet'

await ctx.plugin(EsafenetFileSystem, {
  cwd: process.cwd(),
  operationTimeoutMs: 30_000,
  maxTextBytes: 16 * 1024 * 1024,
  processIdentity: 'code-alias',
})
```

## Security boundary

- On Windows, the provider copies the fixed system Windows PowerShell executable once into a random provider-private directory as `code.exe`, launches only that absolute path, and removes the alias on disposal. Non-Windows hosts use a fixed absolute `pwsh` installation path. Model-controlled paths and content travel as JSON on standard input; callers cannot supply an executable, command, script fragment, environment entry, or argument.
- The provider advertises and enforces the shared sandbox policy. Reads and `workspace-write` mutations are both restricted to the session workspace, path components containing junctions or symlinks are rejected by the bridge, `read-only` denies mutations, and `danger-full-access` is not admitted.
- Writes stage owner-only UTF-8 content next to the target, flush it before publication, compare the previously observed bytes again, and require an explicit commit receipt. Private mode or DACL is applied before the first content byte and remains on the staging path through publication; the intended creation metadata or existing target metadata is restored on the published path immediately afterwards. A restoration failure leaves the committed content owner-only, emits a degraded metadata receipt and host warning, and never reports the content as uncommitted. `createIfAbsent` and `replaceIfVersion` remain fail-closed, and mutations are serialized per canonical target inside the process. The bridge uses exact byte comparison rather than per-file hashes.
- Text reads are byte-bounded, reject NUL content and invalid UTF-8, and never fall back to an arbitrary shell tool. The review preset therefore needs no general PowerShell capability.

## Behavior

`resolve`, `processPath`, `fileUrl`, `contains`, `stat`, `lstat`, and `listDir` retain `dsh-fs-local` semantics. `readText`, `streamText`, `readBytes`, `writeText`, and `editText` use the fixed bridge. Literal edits normalize CRLF for matching and restore the source line-ending style on disk. A cancellation before publication returns `FS_ABORTED`. If transport is lost while a write may already have committed, the provider performs one signal-independent exact-content read: matching content returns the committed result; otherwise the original typed error is preserved.

## Model Experience

### Filesystem tool execution

#### What the model sees

Only the ordinary `read`, `read_image`, `write`, and `edit` tools. Result text and diff behavior remain provider-neutral. Permission denials keep the standard `FS_SANDBOX_DENIED` code, while Esafenet access exposes no command surface or new model-visible syntax.

#### Token effect

None. The provider does not add tool schemas or prompt instructions.

#### KV Cache effect

None. The provider changes execution behind existing tool schemas and does not add prompt text.

## Known Limitations and Deferred Work

- The Windows `code.exe` alias is an Esafenet compatibility mechanism, not an executable-signing or same-user tamper boundary. The source is the fixed system Windows PowerShell path and the copied file is checked as a regular file with the expected size; no per-operation SHA-256 calculation is performed. `processIdentity: 'native'` bypasses the alias only when the deployment already admits the fixed PowerShell executable.
- The P0 bridge starts one process per content operation. `streamText` emits bounded character chunks only after the bounded whole-file read; a persistent Broker or editor bridge is deferred to P1.
- Target identity and metadata still use `dsh-fs-local`. Deployments where Esafenet also blocks Node.js metadata calls need the P1 Broker provider rather than this fallback.
- Freshness uses the local provider's metadata version token plus exact pre-publication content comparison. An unrelated external writer can still race after the final comparison. Windows replacement under an Esafenet filter uses the filter-compatible same-directory move path; crash atomicity is not claimed without an opt-in protected-fixture acceptance test.
- The bridge handles UTF-8 text only. Encoding detection, legacy code pages, and transparent editor-buffer reads belong to the future Broker/VS Code provider.
