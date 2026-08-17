# Power policy

English | [中文](README.zh.md)

`@deepseek-ai/dsh-power-policy` applies fail-closed tool authority to one agent or preset scope. It does not execute hardware operations and cannot be mounted process-wide: the scoped mount is the unit of authority and disposal.

## Configuration

| Key | Required | Meaning |
|---|---:|---|
| `mode` | yes | `review` permits `read`, `read_image`, `grep`, `glob`, and `power_report`; `fix` additionally permits `write` and `edit`. |

The plugin selects native tool presentation, removes every schema outside the mode's fixed allowlist during `system-prompt/assemble`, and registers a monotonic `ctx.tools.guard()` that denies the same names at execution. The guard is the authority check; schema filtering reduces accidental calls but is not treated as enforcement.

Name authority is not enough for model-facing filesystem calls, so the final guard checks their path argument again. `read`, `read_image`, `write`, and `edit` require a string `file_path`; `glob` and `grep` accept an optional string `path`. Even when a search path is omitted, every filesystem call requires an absolute, existing directory in the session header's `cwd`. A supplied path must be non-blank, must be relative under both POSIX and Windows path rules, and must contain no parent component under either separator convention. The guard also examines bounded percent-decoded views so encoded absolute paths and traversal are denied.

The guard canonicalizes the session workspace and each existing target, then permits only the workspace itself or a descendant. Search, read, image-read, and edit targets must already exist. `write` may name a new in-workspace target; for that case the guard canonicalizes its deepest existing ancestor and checks the prospective lexical target. Missing workspace evidence, failed canonicalization, and a symlink or junction that already resolves outside all fail closed.

Shells, subprocesses, external Web or message egress, target-board and debugger operations, PWM or power-stage actuation, and destructive NVM operations are classified before the ordinary allowlist check and remain denied in both modes. These categories and the allowlists are security protocol constants rather than deployment tunables.

Denied calls return `POWER_POLICY_DENIED ` followed by JSON with `code`, `mode`, `tool`, and `category`. The payload never includes tool arguments. `HIGH_RISK_TOOL` distinguishes a fixed safety prohibition from `TOOL_NOT_ALLOWED`; `TOOL_ARGUMENTS_DENIED` reports a rejected workspace path without echoing it.

All registrations belong to the mounting fiber. Disposing or reloading the policy restores the surrounding composition's presentation, prompt assembly, and execution policy.

## Model Experience

### Filtered tool catalog

#### What the model sees

Every model request assembled for an agent covered by this scoped policy receives only its configured mode's native schemas: `review` exposes `read`, `read_image`, `grep`, `glob`, and `power_report`; `fix` also exposes `write` and `edit`. This package adds no system-prompt prose.

#### Token effect

Conditional and bounded by the retained tool schemas; disallowed schemas contribute zero tokens.

#### KV Cache effect

Stable while the mode and registered allowed-tool schemas remain unchanged. Switching modes or changing one retained schema changes the tool-catalog prefix.

## Known Limitations and Deferred Work

- **The workspace-path check is point-in-time** — the search executor does not request ripgrep's `--follow` mode, and the guard canonicalizes existing path components before dispatch. It does not hold an atomic filesystem lease, so a privileged concurrent actor could still replace a path component after the check. Deployment-level sandboxing, provider containment, and workspace ownership remain required.
- **Other argument policy belongs to the owning capability** — the final guard validates only each filesystem tool's path field and session-workspace containment. Tool-specific content, pattern, offset, image, mutation-intent, and receipt validation remain with their owning services.
- **High-risk classification is defense in depth** — unrecognized names still fail the fixed allowlist, but their denial category is `not_allowlisted` until the safety vocabulary names them explicitly.
