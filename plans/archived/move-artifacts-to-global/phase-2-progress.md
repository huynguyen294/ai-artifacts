# Phase 2 Progress Report

- Updated at: 2026-09-16 11:43:57 +07:00
- Baseline package: `ai-artifacts@0.9.3`
- Completed internal checkpoints: 2A, 2B1, 2B2, 2B2.1 stabilization, 2C1, 2C2, 2C3, 2D1, 2D2, 2E
- Current checkpoint: Phase 2 atomic schema-v5/global-storage cutover is complete and verified on the current Windows development environment
- Phase 2 atomic gate: PASS

## Components changed so far

- `src/shared/contracts.ts`
  - Switched the shared artifact contract to schema v5 only.
  - Removed legacy v3/v4 schemas and compatibility types.
- `src/shared/artifact-validation.ts`
  - Switched manifest/comments/submission parsing and binding to v5 only.
  - Kept the Phase 1 global direct-child, symlink/junction, managed-file, and permission helpers as the single path-safety contract.
- `src/integration/artifact-review-mcp-v4.ts`
  - Bumped MCP server identity from `6.0.0` to `7.0.0`.
  - Moved create/load to the injected-or-production global artifacts root while retaining `location.workspaceRoot` as repository metadata and registry validation input.
  - Routed lifecycle reads, new writes, copy/rename replacement, rollback, and cleanup through managed-file validation.
  - Preserved the five-tool surface, workspace resolver/evidence behavior, waiter ownership, round-token state binding, transaction order, rollback, and Windows editor-lock fallback.
  - Creates artifact directories with `0700` and files with `0600` on POSIX; existing managed files are hardened before access.
  - Added a bounded retry window for transient lifecycle JSON parse failures during initial context loading and waiter submission reads.
  - Updated the public `create_artifact` description to schema v5/global storage and clarified that `workspaceRoot` is ownership metadata rather than a storage path.
  - Updated initialization instructions to require the exact returned global handle and forbid scanning global storage or a workspace to discover artifacts.
- `src/extension/artifact-store.ts`
  - Loads schema-v5 artifacts only from an exact global `artifact.md` handle.
  - Validates the global direct-child directory, exact artifact filename, artifact ID, transaction lock, and every managed lifecycle file before reading.
  - Retains `location.workspaceRoot` as review metadata without deriving storage from it.
  - Removed schema-v3/v4 read-only branches while preserving round, session, artifact hash, and comments hash bindings.
  - Revalidates the exact global directory plus managed source/target paths immediately before write, link, rename, copy, and cleanup operations.
  - Creates owner-only temporary files, preserves atomic comment replacement/Windows copy fallback, and retains create-once submission semantics.
  - Revalidates submit-time Markdown/comments reads and restores owner-only permissions after rename, hard-link, or copy replacement.
- `test/artifact-contracts.test.ts`
  - Added v5 positive contract coverage and v3/v4 rejection coverage.
- `test/artifact-store.test.ts`
  - Moved Store fixtures to isolated temporary global homes.
  - Added v3/v4 rejection, exact-handle, outside-root, ID/binding, linked-directory, linked-file, and linked-lock coverage.
  - Added comment add/remove, Review/Proceed/Just-save, temporary-link, fallback target-swap, failed-write cleanup, create-once race, and POSIX permission coverage.
- `test/review-wait-mcp.test.ts`
  - Moved fixtures to isolated temporary global homes and schema v5.
  - Added global placement, exact-handle, collision, rollback, linked lifecycle/transaction target, transaction residue, and POSIX permission coverage.
  - Added deterministic regressions for incomplete submission JSON, incomplete comments during waiter attach, incomplete comments beside a complete submission, and persistently malformed submission JSON.
  - Added an MCP-create -> Store-load/comment/submit -> MCP-wait/advance -> Store-reload round trip on one real cross-component fixture.
  - Added fail-closed cross-boundary coverage for different global roots and schema, review-round, artifact-hash, and review-session mismatches.
  - Kept both producer and consumer on the fixture's injected temporary user home; the different-root case verifies that the Store neither scans nor creates its configured collection root.
  - Added regression assertions for the schema-v5/global create-tool description and `workspaceRoot` metadata semantics.
- `skills/create-review-artifact/SKILL.md`
  - Describes schema-v5 lifecycle files in the global collection while preserving resolver, five-tool, exact-handle, feedback, recovery, and Proceed semantics.
  - Defines `artifactLink` as a regular file link without promising deep-link or custom-editor behavior.
- `skills/create-review-artifact/references/artifact-contract.md`
  - Replaced workspace-local and schema-v3/v4 compatibility wording with the global schema-v5-only contract.
  - Retains `workspaceRoot` as target ownership metadata and requires exact global handles after creation without resolver reuse or global scanning.
- `test/skill-contract.test.ts`
  - Locks schema-v5 global storage, workspace metadata, exact global handles, and regular-file-link wording against regression.
- `test/workspace-integration.test.ts`
  - Installs the real built MCP bundle and production skill into an isolated temporary home.
  - Verifies installed MCP aliases and all installed skill assets byte-match their source files.
  - Verifies the generated Codex config has exactly the resolver plus four lifecycle tools.
  - Starts the temp-installed MCP, validates its five-tool catalog, creates a global schema-v5 artifact, and round-trips an Extension Store submission back through the installed waiter.
  - Confirms the installed flow writes only beneath the injected temporary global home and does not create workspace-local artifact storage.

## 2B2.1 Windows waiter stabilization

Repeated full-suite runs exposed a real filesystem race rather than a test-only timing issue. On Windows, `fs.watch` or a newly received wait request can observe `comments.json` or `review-submission.json` while the replacement entry is visible but its contents are temporarily empty or zero-filled. The previous implementation treated the resulting `JSON.parse` error as permanent and closed the waiter.

The stabilization keeps the lifecycle fail-closed:

- Only `SyntaxError` from lifecycle JSON parsing is retried.
- Each attempt re-reads the managed files and repeats path/file validation.
- The retry window is bounded to approximately one second, matching the existing waiter polling interval.
- Schema, binding, hash, path, permission, and workspace errors still fail immediately.
- Persistently malformed JSON still returns an error after the bounded window.

Final stress evidence:

- Five consecutive full-suite runs passed.
- Every run: 16/16 test files passed, 164 tests passed, 2 POSIX-only tests skipped on Windows.
- No waiter failure occurred after retry coverage was applied to both initial context loading and submission snapshot reads.

## Verification evidence

- `npm.cmd run check` -> PASS, exit code 0.
- `npx.cmd vitest run test/artifact-store.test.ts` -> PASS.
  - 32 tests passed; 1 POSIX-only test skipped on Windows.
- `npx.cmd vitest run test/global-artifact-path.test.ts test/artifact-store.test.ts` -> PASS.
  - 53 tests passed; 2 POSIX-only tests skipped on Windows.
- 2C3 gate `npx.cmd vitest run test/artifact-store.test.ts test/review-wait-mcp.test.ts` -> PASS.
  - 82 tests passed; 2 POSIX-only tests skipped on Windows.
- 2D1 gate `npx.cmd vitest run test/skill-contract.test.ts` -> PASS.
  - 8 tests passed.
- Combined 2D1 producer/skill gate -> PASS.
  - `test/skill-contract.test.ts` plus `test/review-wait-mcp.test.ts`: 58 tests passed; 1 POSIX-only test skipped on Windows.
- 2D2 gate `npx.cmd vitest run test/mcp-config.test.ts test/workspace-integration.test.ts` -> PASS.
  - 11 tests passed.
- 2E preflight focused gate -> PASS.
  - `test/review-wait-mcp.test.ts` plus `test/workspace-integration.test.ts`: 57 tests passed; 1 POSIX-only test skipped on Windows.
- Focused waiter stabilization tests -> PASS.
  - Transient submission, transient attach comments, transient submitted comments, and persistent malformed JSON cases passed.
- Five consecutive `npm.cmd test` runs -> PASS.
  - Each run had 164 passing tests and 2 POSIX-only skips.
- Post-2D2 `npm.cmd test` -> PASS.
  - 16/16 test files passed; 184 tests passed; 3 POSIX-only tests skipped on Windows.
- 2E atomic focused gate -> PASS.
  - 7/7 test files passed; 130 tests passed; 3 POSIX-only tests skipped on Windows.
- 2E atomic full-suite gate `npm.cmd test` -> PASS.
  - 16/16 test files passed; 184 tests passed; 3 POSIX-only tests skipped on Windows.
- 2E typecheck and build gates -> PASS.
  - `npm.cmd run check`, `npm.cmd run build:integration`, `npm.cmd run build:extension`, and `npm.cmd run build` all exited with code 0.
- Final active-source contract audit -> PASS.
  - No legacy v3/v4 compatibility types, schema wording, workspace-persistence wording, or workspace artifact-discovery instruction remains in the Phase 2 shared/MCP/Store/production-skill sources.
- `npm.cmd run build` -> PASS for extension, uninstall, webview, enhancements, and MCP integration bundles.
- `git diff --check` -> PASS; only line-ending conversion warnings were reported.
- Every MCP and Store test injects a temporary user home. No test used the real global artifacts root.
- Skill frontmatter/name/description validation equivalent to `skill-creator` `quick_validate.py` -> PASS. The Python validator itself could not import its optional `yaml` dependency in this environment.

## 2E preflight hardening

- The MCP initialization contract now says later lifecycle calls use only the exact returned global `artifactDirectory`; it explicitly forbids discovery by scanning global storage or a workspace and inference from cwd.
- The atomic gate now builds the ignored MCP integration bundle before running the temp-installed focused test, so the sequence is reproducible from a clean checkout.
- The atomic gate now includes `npm.cmd test` for the repository's full test suite and ends with `git diff --check`.
- The complete 2E command sequence was subsequently run as one final gate and passed without requiring additional behavior changes.

## Safety evidence retained

- `artifact.json`, `artifact.md`, `comments.json`, `review-submission.json`, and the update lock are rejected when linked before managed reads.
- Linked or non-regular Store write targets and pre-created linked temporary entries are rejected before mutation.
- Targets swapped to links between initial validation and Windows copy fallback are rejected on immediate revalidation without touching the linked target.
- Failed comment/submission writes preserve the previous valid lifecycle state and remove Store-created temporary files.
- Pre-created linked lock, staged, and backup entries fail closed, retain the previous round/token state, and do not touch linked targets.
- Successful advance, injected rollback, and Windows editor-lock fallback leave no lock/staging/backup residue.
- Existing lifecycle files are hardened before managed reads/writes. POSIX assertions cover `0700` artifact directories and `0600` lifecycle files after create, successful advance, submission, and rollback.
- Windows permission behavior remains inherited ACL as frozen in Phase 0; POSIX mode tests remain present but require a POSIX CI/manual execution before release.

## Remaining atomic Phase 2 work

- None. The completed Phase 2 unit is ready for its checkpoint commit.
- Keep the user-owned `AGENTS.md` change outside that commit.

## Stability and checkpoint decision

- Phase 2 automated-gate stability: 5/5 on the current Windows development environment.
- Checkpoint decision: PASS; ready for one complete Phase 2 commit and then Phase 3.
- Product release decision: NOT READY. Phase 3 and the later installation/documentation/release gates remain outstanding, and POSIX permission assertions still require a POSIX CI/manual run before release.
