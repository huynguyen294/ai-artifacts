# Phase 3 Progress Report

- Updated at: 2026-09-16 15:23:20 +07:00
- Baseline package: `ai-artifacts@0.9.3`
- Completed substeps: 3A1, 3A2, 3B, 3C, 3D
- Current checkpoint: Phase 3 global watcher and safe custom-editor open work is complete and verified
- Phase 3 final gate: PASS

## Components changed so far

- `src/shared/artifact-validation.ts`
  - Added the exact global artifact-handle boundary reused by extension storage and review opening.
- `src/extension/artifact-store.ts`
  - Reuses the shared exact-handle validation rather than maintaining a second path contract.
- `src/extension/artifact-review-open.ts`
  - Validates an exact global `artifact.md` URI and its manifest before calling the injected `openWith` boundary.
  - Separates watcher setup and create-event handling from the VS Code composition root for deterministic tests.
  - Ensures the global collection root exists and is safe before watcher registration.
  - Coordinates validated opens by canonical artifact path and coalesces concurrent requests for the same artifact while keeping different artifacts independent.
  - Removes every single-flight entry after success or error so later explicit opens can reuse/reveal the editor normally.
- `src/extension/extension.ts`
  - Activates asynchronously so root validation completes before watcher registration.
  - Watches the global collection with `RelativePattern(<global-root>, "*/comments.json")` and create events only.
  - Preserves the auto-open setting and focused-window guard.
  - Opens validated artifacts through `vscode.openWith` using the Artifact Review view type.
  - Routes both watcher and command opens through one coordinator instance.
  - Uses the active Artifact Review tab URI without scanning tabs; when no review tab is active, the command opens the standard file picker at the global collection root.
  - Disposes the watcher through `context.subscriptions` and reports root setup failures without installing an unsafe watcher.
- `test/artifact-review-open.test.ts`
  - Covers exact-handle validation, invalid/nested/linked targets, manifest mismatch, safe-open failure behavior, focus/setting guards, activation order, first-artifact delivery, invalid events, and lifecycle-transition eligibility.
  - Covers same-artifact and duplicate-watcher single-flight behavior, different-artifact isolation, cleanup after success/error, shared production coordinator wiring, no tab-list scan, and `supportsMultipleEditorsPerDocument: false`.
  - Proves an invalid command/coordinator target is rejected before the injected `openWith` boundary.
- `test/artifact-link-contract.test.ts`
  - Statically rejects `reviewUrl`, URI-handler registration, and `onUri` activation from source/package contracts.
  - Locks MCP `pathToFileURL` usage plus regular-file-link wording in the production skill and artifact contract.
- `test/review-wait-mcp.test.ts`
  - Extends the real MCP create/inspect URL fixture to cover a path containing spaces, `#`, parentheses, an en dash, Vietnamese text, and Omega, plus a title containing brackets, backslash, newline, parentheses, and Unicode.

## 3A1 evaluation

- Behavior completed: testable watcher/open foundation with one shared global path-safety contract.
- Manual verification: `NOT_REQUIRED`; production watcher behavior was not the acceptance boundary for this substep.
- Decision: `PASS`.

## 3A2 evaluation

### Automated verification

- `npm.cmd exec vitest run test/artifact-review-open.test.ts` -> PASS, exit code 0, 1/1 file and 16/16 tests passed.
- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd test` -> PASS, exit code 0, 17/17 files passed, 200 tests passed, 3 platform-specific tests skipped.
- `npm.cmd run build` -> PASS, exit code 0.
- `git diff --check` -> PASS, exit code 0; only line-ending notices were emitted.

### Manual verification

All manual data and VS Code profiles were isolated under `%LOCALAPPDATA%\Temp\agent-plus-phase3a2-manual`; no real `~/.ai-artifacts` path was used.

- `first artifact` -> PASS. A new VS Code profile used `home-fresh-c`; the extension created `.ai-artifacts/artifacts` at 14:45:40 before any artifact existed, and the first artifact created afterward auto-opened in focused window C.
- `window A` -> PASS. With A focused, the new artifact auto-opened in A.
- `window B` -> PASS. With B focused, the next artifact auto-opened in B.
- `no focused window` -> PASS. With focus outside VS Code, neither A nor B auto-opened the new artifact.
- Temporary diagnostic logging used during the initial manual investigation was removed before the final automated gate; it did not alter watcher, focus, validation, or open behavior.

### Decision

- Manual verification: `PASS`.
- Regressions found: none.
- Remaining risks: duplicate concurrent open requests and editor reuse/dedup are intentionally deferred to 3B; command-path integration and regular-file link behavior remain for 3C.
- Stability assessment: 3A2 meets its watcher/focus acceptance criteria, but Phase 3 remains below its final 4/5 target until 3B-3D pass.
- Substep decision: `PASS`.
- Ready for next substep: `YES` (3B).

## 3B evaluation

### Automated verification

- `npm.cmd exec vitest run test/artifact-review-open.test.ts` -> PASS, exit code 0, 1/1 file and 21/21 tests passed.
- Same-artifact concurrent requests -> exactly 1 injected `openWith` call.
- Two concurrent duplicate watcher events -> exactly 1 injected `openWith` call.
- Different artifacts -> 2 independent injected `openWith` calls.
- Sequential requests after success -> 2 calls, proving success cleanup.
- Retry after injected `openWith` error -> second call succeeds and total calls are 2, proving error cleanup.
- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd test` -> PASS, exit code 0, 17/17 files passed, 205 tests passed, 3 platform-specific tests skipped.
- `npm.cmd run build` -> PASS, exit code 0.
- `git diff --check` -> PASS, exit code 0; only line-ending notices were emitted.

### Manual verification

- Same active artifact opened through the command twice -> PASS. VS Code reused/revealed the existing review tab and created no duplicate tab.
- Close and reopen the same artifact -> PASS. With no active review tab, the command opened the picker at the global artifacts root; selecting the exact `artifact.md` reopened the review normally.
- Open a second, different artifact -> PASS. The new artifact opened in a separate review tab while the first artifact tab remained available.
- Command UX regression found and fixed during the gate: custom editors are not exposed through `activeTextEditor`, so the command now reads only the active `TabInputCustom` when it is the Artifact Review view. It does not enumerate or focus tabs; it still calls the shared coordinator and `vscode.openWith`.
- The isolated Windows profile initially lacked a `Desktop` shell directory, which caused the native file dialog to show a location warning even though it opened at the correct global root. Adding an empty `Desktop` directory to the disposable profile removed the harness-only warning.

### Data-safety incident and resolution

- One discarded host launch invoked `code.cmd` directly from an elevated shell. After the extension host restarted, Windows dropped the intended home override and the extension created empty `C:\Users\Admin\.ai-artifacts` and `C:\Users\Admin\.ai-artifacts\artifacts` directories.
- Inspection proved both directories were newly created, contained no files, and had no sibling entries. The test host was stopped and both empty directories were removed explicitly.
- The manual gate was restarted with the previously verified child-process launcher. Before fixtures were created, the isolated root existed and `C:\Users\Admin\.ai-artifacts` did not; the same absence check passed again after the final full gate.
- No real artifact, lifecycle file, integration config, or existing user data was created, changed, or removed.

### Decision

- Manual verification: `PASS`.
- Regressions found: the command fallback UX issue was fixed and retested; no unresolved 3B regression remains.
- Remaining risks: regular file-link wording/behavior remains for 3C; Phase 3 consolidated manual and safety audit remains for 3D.
- Stability assessment: shared open coordination and real VS Code reuse/reveal behavior meet 3B acceptance criteria, but Phase 3 remains below its final 4/5 target until 3C-3D pass.
- Substep decision: `PASS`.
- Ready for next substep: `YES` (3C).

## 3C evaluation

### Automated verification

- `npm.cmd exec vitest run test/artifact-link-contract.test.ts test/artifact-review-open.test.ts test/skill-contract.test.ts test/review-wait-mcp.test.ts` -> PASS, exit code 0, 4/4 files passed, 82 tests passed, 1 platform-specific test skipped.
- URL/link fixture -> PASS. `artifactUrl` percent-encodes spaces, `#`, parentheses, en dash, Vietnamese text, and Omega; it contains no raw backslash, `#`, `(`, or `)`.
- Title/link fixture -> PASS. `artifactLink` escapes brackets/backslash, flattens the newline, retains readable Unicode/title punctuation, and points exactly to `artifactUrl` on create and inspect.
- Invalid command/coordinator target -> PASS. Validation rejects an outside-root handle before the injected `openWith` function is called.
- Exact static forbidden-contract search across `package.json`, `src`, `skills`, and `test` -> PASS with no `reviewUrl`, `review_url`, `registerUriHandler`, or `onUri:` matches.
- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd test` -> PASS, exit code 0, 18/18 files passed, 208 tests passed, 3 platform-specific tests skipped.
- `npm.cmd run build` -> PASS, exit code 0.
- `git diff --check` -> PASS, exit code 0; only line-ending notices were emitted.

### Manual verification

- A disposable host F used an isolated home named `home phase3c # (Unicode Ω)` with its own profile and global artifacts root. Before and after the gate, `C:\Users\Admin\.ai-artifacts` did not exist.
- Regular link click -> PASS. Chú clicked the encoded `file://` Markdown link and confirmed it opened the exact `phase3c-link-001/artifact.md` file. No custom-editor guarantee was required or inferred from the link.
- Command custom-editor open -> PASS. With that file active in host F, **AI Artifacts: Open Artifact Review** opened the Artifact Review custom editor with the expected review controls.
- The first special-path launcher attempt exposed PowerShell 5 UTF-8-without-BOM mojibake in a disposable folder name. It created only an alternate directory under the temp harness; host E was stopped, the launcher was changed to construct Omega from `[char]`, and the complete manual gate was rerun successfully in clean host F. No production source or real user data was involved.

### Decision

- Manual verification: `PASS`.
- Regressions found: none in the regular-link or command contract.
- Remaining risks: only the consolidated Phase 3 audit/manual gate in 3D remains. Historical product docs that still imply file links guarantee the custom editor remain intentionally deferred to Phase 5 per the approved plan.
- Stability assessment: 3C meets its automated, static, and manual acceptance criteria; Phase 3 remains below its final 4/5 target until 3D passes.
- Substep decision: `PASS`.
- Ready for next substep: `YES` (3D).

## 3D evaluation

3D added no behavior. It reran the complete automated gate and repeated every watcher manual case affected by the shared coordinator introduced after 3A2.

### Automated verification

- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd exec vitest run test/artifact-review-open.test.ts` -> PASS, exit code 0, 1/1 file and 22/22 watcher/open-coordinator tests passed.
- `npm.cmd exec vitest run test/artifact-link-contract.test.ts test/skill-contract.test.ts` -> PASS, exit code 0, 2/2 files and 10/10 link/skill contract tests passed.
- `npm.cmd exec vitest run test/global-artifact-path.test.ts test/artifact-store.test.ts` -> PASS, exit code 0, 2/2 files passed, 53 tests passed, 2 POSIX-only tests skipped on Windows.
- `npm.cmd test` -> PASS, exit code 0, 18/18 files passed, 208 tests passed, 3 platform-specific tests skipped.
- `npm.cmd run build:extension` -> PASS, exit code 0.
- `npm.cmd run build` -> PASS, exit code 0.
- Exact forbidden-contract search -> PASS; no `reviewUrl`, `review_url`, `registerUriHandler`, or `onUri:` exists in `package.json`, `src`, `skills`, or `test`.
- `git diff --check` -> PASS, exit code 0; only line-ending notices were emitted.

### Consolidated manual gate

- `fresh-home first artifact` -> PASS. Hosts G/H shared a new `home-phase3d-final`; the extension created the collection root before any artifact existed, and the first artifact auto-opened only in focused host G.
- `focused two-window routing, G` -> PASS. G opened the first artifact and H did not.
- `focused two-window routing, H` -> PASS. H opened the second artifact while G retained the first.
- `no focused window` -> PASS. With focus outside VS Code, neither G nor H opened the third artifact.
- `same-URI reuse/reveal` -> PASS. The current production command called `openWith` for the active custom-editor URI and VS Code reused the single existing review tab.
- `close/reopen same artifact` -> PASS. The fallback picker reopened the exact artifact after its tab was closed.
- `second-artifact isolation` -> PASS. A second artifact opened in its own review tab without replacing or duplicating the first artifact tab.
- `regular link click` -> PASS. The encoded link with spaces, `#`, parentheses, and Omega opened the exact Markdown file as a regular file link.
- `command custom-editor open` -> PASS. Running **AI Artifacts: Open Artifact Review** for that file opened the expected custom review editor.

### Path and data safety

- Shared exact-handle/global-root validation remained the only path-safety boundary for Store, command, and watcher opens.
- Automated direct-child, escape, linked-directory, linked-file, manifest-binding, and managed-file coverage passed.
- All successful manual fixtures lived under `%LOCALAPPDATA%\Temp\agent-plus-phase3a2-manual`.
- The earlier discarded 3B host-launch incident created only two new empty directories at `C:\Users\Admin\.ai-artifacts`; inspection proved they contained no files, they were removed immediately, and every later preflight/final check confirmed the real path does not exist.
- No real artifact, lifecycle file, integration config, or pre-existing user data was created, modified, or deleted.

### Phase 3 decision

- Manual verification: `PASS`.
- Regressions found: none unresolved.
- Remaining risks: when no VS Code window is focused, auto-open is intentionally skipped and the existing command is the fallback. Remote filesystem support remains constrained by the Phase 0 rule that MCP and extension must see the same filesystem.
- Stability score: `4/5`.
- Gate decision: `PASS`.
- Ready for next phase: `YES` (Phase 4 installed integration synchronization).

## Phase 3 Verification Report

- Components changed: shared global-handle validation, Extension Store reuse of that validation, global watcher/safe-open helper, extension composition root, MCP URL coverage, and Phase 3 contract tests.
- Files changed:
  - `src/shared/artifact-validation.ts`
  - `src/extension/artifact-store.ts`
  - `src/extension/artifact-review-open.ts`
  - `src/extension/extension.ts`
  - `test/artifact-review-open.test.ts`
  - `test/artifact-link-contract.test.ts`
  - `test/review-wait-mcp.test.ts`
  - `plans/move-artifacts-to-global/implementation.md`
  - `plans/move-artifacts-to-global/phase-3-progress.md`
- Focused commands: PASS; 22 watcher/open tests, 10 link/skill tests, and 53 path/store tests passed with 2 platform skips.
- Phase gate commands: PASS; typecheck, 208-test full suite, extension build, full build, forbidden-contract search, and diff check all completed successfully.
- Static checks: PASS; shared coordinator wiring, `supportsMultipleEditorsPerDocument: false`, no tab-list scan, no URI handler/deep-link contract, and regular-file-link wording are locked by tests.
- Filesystem/data-safety checks: PASS; final real artifact root absent and isolated fixture roots validated.
- Manual checks: `PASS`; every required critical case has user-confirmed evidence.
- Regressions found: none unresolved.
- Remaining risks: accepted focus guard and same-filesystem remote-support constraint only.
- Stability score: `4/5`.
- Gate decision: `PASS`.
