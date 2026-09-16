# Phase 0 Verification Report

- Executed at: 2026-09-14 16:13:33 +07:00
- Baseline package: `ai-artifacts@0.9.3`
- Phase scope: repository baseline, contract freeze, and runtime-host support classification
- Runtime behavior changed: No

## Components changed

- Planning evidence only: this verification report.
- No runtime, test, package, skill, generated bundle, or installed integration source was edited during Phase 0.

## Baseline worktree

Initial `git status --short`:

```text
 D plans/move-ai-artifacts-to-global.md
?? plans/move-artifacts-to-global/
```

Initial `git diff --stat`:

```text
plans/move-ai-artifacts-to-global.md | 299 -----------------------------------
1 file changed, 299 deletions(-)
```

- The deleted old plan and the untracked replacement plan directory predated Phase 0 and are treated as Chú's existing work.
- `git diff --stat` emitted an LF-to-CRLF warning for `AGENTS.md`; `git status --short` did not report `AGENTS.md` as modified.
- Status after test/build was unchanged, apart from this report remaining inside the already-untracked plan directory.
- Production build outputs are written below `dist/`; `dist/` is ignored by `.gitignore` and no `dist` or `releases` files are tracked.

## Contract freeze

Phase 0 locks the following target contract:

- Schema v5 is the only supported lifecycle schema; v3/v4 are not migrated or viewable.
- Artifact lifecycle files are stored only under `~/.ai-artifacts/artifacts/<artifact-id>/`.
- `location.workspaceRoot` remains target-repository metadata and does not determine the storage directory.
- Workspace Registry, publisher, workspace evidence/selection tokens, and all five MCP tools remain active.
- Workspace evidence is supplied on create; later lifecycle calls use the exact handle and preserve the current registry revalidation behavior.
- The extension ensures the safe global collection root exists before registering its watcher.
- Only the focused editor window auto-opens watcher events.
- Watcher and command flows use `vscode.openWith`; `artifactLink` remains an ordinary `file://` link, not a deep link or custom-editor guarantee.
- POSIX managed directories target mode `0700` and lifecycle/transaction files target mode `0600`; Windows uses inherited ACLs.
- Uninstall never removes `~/.ai-artifacts`.

## Runtime-host support matrix

The global store is supported only when the MCP producer and extension consumer resolve the same user home and can access the same filesystem path.

| Environment | Phase 0 classification | Required boundary/evidence |
| --- | --- | --- |
| Local VS Code | Supported target | MCP and extension run as the same OS user and resolve the same home/global root. |
| Local Cursor | Supported target | MCP and extension run as the same OS user and resolve the same home/global root. |
| WSL | MANUAL_REQUIRED | Supported only when MCP and extension host run in the same WSL distribution/user and see the same global root. Windows-host MCP paired with a WSL extension host is unsupported. |
| Remote SSH | MANUAL_REQUIRED | Supported only when MCP runs on the same remote host/user/filesystem as the workspace extension host. |
| Dev container | MANUAL_REQUIRED | Supported only when MCP and extension host share the same container filesystem and home mapping. |
| Codespaces | MANUAL_REQUIRED | Must prove both producer and consumer run against the same remote home and that the declared editor client can launch the installed MCP. |
| Different machines, homes, containers, or unshared filesystems | Unsupported | No cross-host synchronization, transport, or path translation is included in v1.0.0. |

Phase 5 must run the manual matrix for every environment ultimately declared supported. A MANUAL_REQUIRED entry that is not proven before release must be documented as unsupported rather than inferred to work.

## Automated verification

- `npm.cmd run check` -> PASS, exit code 0.
  - TypeScript completed with `tsc --noEmit`.
- `npm.cmd test` -> PASS, exit code 0.
  - Integration bundle built successfully.
  - 14/14 test files passed.
  - 110/110 tests passed.
  - Vitest duration: 3.53s.
- `npm.cmd run build` -> PASS, exit code 0.
  - Extension bundle built.
  - Uninstall bundle built.
  - Webview built; 282 modules transformed.
  - Shiki and Mermaid enhancement bundles built.
  - MCP integration bundle built.

## Static and data-safety checks

- `git status --short` before and after verification showed no new tracked runtime/source changes.
- Build outputs remained ignored under `dist/`.
- No install, reinstall, uninstall, migration, cleanup, or real-home artifact command was executed.
- Existing dirty/untracked plan work was preserved.

## Manual checks

- Local/remote runtime behavior: MANUAL_REQUIRED in later phases as classified in the support matrix.
- No GUI behavior was marked PASS during Phase 0.

## Regressions found

- None in the baseline check, test, or build pipeline.

## Remaining risks

- Global containment, symlink/junction rejection, and POSIX permissions are target-state requirements for Phase 1 and are not implemented by this baseline.
- Schema-v5 producer/consumer/skill cutover remains pending Phase 2.
- First-artifact watcher race and focused-window behavior remain pending Phase 3.
- Conditional WSL/remote/Codespaces support remains unproven until the Phase 5 manual matrix.
- Installed integrations still require the documented reinstall/restart workflow after the eventual update.

## Stability and gate decision

- Stability score: 5/5 for the Phase 0 baseline.
- Gate decision: PASS.
- Reason: all baseline commands passed, existing worktree changes were preserved, the target contract is explicit, and every host topology is classified without claiming unverified remote support.
