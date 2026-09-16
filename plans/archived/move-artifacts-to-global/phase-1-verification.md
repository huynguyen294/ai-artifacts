# Phase 1 Verification Report

- Executed at: 2026-09-15 14:39:32 +07:00
- Baseline package: `ai-artifacts@0.9.3`
- Phase scope: additive global path, filesystem validation, and owner-only permission foundation
- Runtime storage behavior changed: No

## Components changed

- Shared artifact paths: `src/shared/artifact-files.ts`
  - Added `globalArtifactsRoot()` with production `os.homedir()` behavior and an explicit isolated-home test seam.
  - Added shared POSIX owner-only mode constants: directory `0700`, file `0600`.
- Shared artifact validation: `src/shared/artifact-validation.ts`
  - Added lexical direct-child and artifact-id validation for the global collection root.
  - Added async `lstat`/`realpath` validation for the global root and artifact directories.
  - Added safe segment-by-segment root creation and owner-only POSIX hardening.
  - Added lifecycle/lock/staging/backup filename allowlisting, symlink rejection, regular-file validation, and POSIX file hardening.
- Path-safety tests: `test/global-artifact-path.test.ts`
  - Added isolated temp-home coverage for global paths, path escapes, prefix collisions, case semantics, links/junctions, managed transaction targets, permissions, and root isolation.

No MCP producer, extension consumer, skill, schema, package metadata, installed integration, or v4 runtime path was switched during this phase.

## Implemented contract

- Production global root resolves to `path.join(os.homedir(), ".ai-artifacts", "artifacts")`.
- Tests inject an absolute temporary home directly; no environment variable overrides production behavior.
- `.ai-artifacts` and `artifacts` are created one segment at a time and rejected when either segment is a symbolic link/junction or non-directory.
- A global artifact directory must be absolute, a direct child of the collection root, and have a basename exactly equal to its validated artifact id.
- Filesystem validation rechecks directory entries with `lstat`, canonicalizes with `realpath`, and rejects linked artifact directories.
- Managed file validation accepts only lifecycle files, `.artifact-update.lock`, and `.tmp-*`/`.next-*`/`.previous-*` transaction targets directly inside the artifact directory.
- Existing managed POSIX directories/files are tightened to `0700`/`0600`; failure to harden propagates before the caller proceeds.
- Windows retains inherited ACL behavior while keeping lexical, junction, and regular-file checks.

## Automated verification

- `npm.cmd run check` -> PASS, exit code 0.
  - TypeScript completed with `tsc --noEmit`.
- `npx.cmd vitest run test/global-artifact-path.test.ts test/artifact-store.test.ts` -> PASS, exit code 0.
  - 2/2 test files passed.
  - 30 tests passed; 1 POSIX-only permission test was explicitly skipped on Windows.
- `npm.cmd test` -> PASS, exit code 0.
  - Integration bundle built successfully.
  - 15/15 test files passed.
  - 131 tests passed; 1 POSIX-only test skipped on Windows.
- `npm.cmd run build` -> PASS, exit code 0.
  - Extension, uninstall, webview, enhancement, and MCP integration bundles built successfully.
- Static search for `globalArtifactsRoot`, `assertGlobalArtifactDirectory`, and async safety helpers found the expected shared definitions and focused test coverage only.

## Safety evidence

- Root-absent fixtures created exactly `.ai-artifacts/artifacts` beneath injected temporary homes.
- Nested paths, outside-root paths, `artifacts-evil` sibling prefixes, invalid ids, and artifact-id mismatches were rejected.
- `.ai-artifacts`, `artifacts`, and artifact-directory junction/symlink fixtures were rejected.
- Every lifecycle file class plus lock, temporary, staged, and backup targets was covered by managed-path validation; linked targets were rejected before access.
- A fixture performed lexical validation, replaced the artifact directory with a link, and confirmed async revalidation failed closed.
- Two independently injected temporary homes resolved to different roots.
- The production resolver test mocked `os.homedir()`; every filesystem-mutating test supplied a temporary home. No test or command created artifacts beneath the real user home.
- Existing v4 artifact-store regressions continued to pass unchanged.

## Platform boundary

- Windows junction rejection passed in this execution.
- POSIX mode assertions are present and will execute on POSIX; they are correctly marked not applicable in this Windows run.
- Windows ACL tightening is outside the implementation scope; Windows uses inherited ACLs as frozen in Phase 0.

## Existing worktree preservation

- The pre-existing deletion of `plans/move-ai-artifacts-to-global.md` was not modified or restored.
- The pre-existing untracked `plans/move-artifacts-to-global/` work was preserved and this report was added within it.
- Build outputs remained ignored under `dist/`.

## Remaining work

- Schema v5 and MCP/extension runtime integration remain Phase 2.
- File creation/copy/rename/rollback call sites do not use the new `0600` mode and validation helpers until the atomic Phase 2 cutover.
- Watcher root creation, focused-window auto-open behavior, and first-artifact race handling remain Phase 3.
- POSIX permission behavior still needs execution on a POSIX CI or manual environment before release.

## Stability and gate decision

- Stability score: 5/5 for the additive Phase 1 boundary.
- Gate decision: PASS on the current Windows development environment.
- Reason: focused path-safety tests, full v4 regressions, typecheck, and production build all passed; the runtime storage contract remains unchanged; POSIX-only assertions are implemented and explicitly deferred to a POSIX execution environment.
