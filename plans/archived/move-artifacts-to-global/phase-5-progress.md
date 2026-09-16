# Phase 5 Progress Report

- Updated at: 2026-09-16 16:24:00 +07:00
- Release target: public VS Code/Cursor extension `ai-artifacts@1.0.0`
- Supported environment: local desktop Windows, macOS, and Linux when the extension host and MCP process share the same user home and filesystem
- Current decision: READY
- Phase 5 final gate: PASS

## Components changed

- Package metadata and release selector
  - Bumps the extension and lockfile to `1.0.0`.
  - Keeps only the global `.ai-artifacts/artifacts/**/artifact.md` custom-editor selector.
- Release documentation
  - Documents schema v5, global per-user storage, `location.workspaceRoot`, the five-tool MCP surface, focused auto-open, regular file links, reinstall/restart requirements, sensitive local data, and uninstall retention.
  - Explicitly limits v1.0.0 to local same-filesystem hosts; remote/split-host environments are unsupported.
- Installed integration synchronization
  - Replaces managed runtime/skill assets atomically, removes legacy managed assets, detects stale installations, and preserves unrelated client configuration and global artifact data.
- Release contracts
  - Locks package/lockfile version, the global-only editor selector, and required v1.0.0 documentation claims.

## Final automated verification on Windows

- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd test` -> PASS, 19/19 test files passed, 213 tests passed, 3 platform-specific tests skipped.
- `npm.cmd run build` -> PASS, exit code 0.
- `npm.cmd run package` -> PASS; produced `releases/ai-artifacts-1.0.0.vsix` with 17 entries, 1.54 MB.
- `git diff --check` -> PASS; only Git line-ending notices were emitted.
- Runtime dependency audit, `npm.cmd audit --omit=dev` -> PASS, 0 vulnerabilities.
- Full dependency audit at high threshold -> PASS with 4 disclosed moderate, development-only findings in the `@vscode/vsce` packaging chain; upstream reports no fix available.
- Package audit -> PASS: the VSIX contains the built extension, uninstall hook, MCP bundle, webview assets, and production skill/contract; it excludes source, tests, plans, docs, and local artifact roots.
- Bundled MCP/skill hash comparison -> PASS against the built/source assets used by this working tree.

The three skipped Windows tests are platform-specific: two POSIX permission cases and one Windows-only comparison counterpart. On `ubuntu-latest`, the POSIX cases execute instead of being skipped.

## Manual and host verification

### Current packaged VSIX E2E — owner-confirmed PASS

- AI called `create_review_artifact` through the installed integration and created a schema-v5 artifact in the real global collection.
- With `agentPlus.autoOpenArtifactReview=true`, the focused VS Code window automatically opened Artifact Review.
- With `agentPlus.autoOpenArtifactReview=false`, a second artifact was created without opening the review editor.
- **AI Artifacts: Open Artifact Review** opened the exact second artifact manually.
- AI called `wait_for_artifact_review` with the exact global handle; **Just save** completed the waiter successfully.
- The create response exposed the exact global handle and a regular file `artifactLink`, not a deep link.

### Reused manual evidence — PASS

- Phase 3 verified fresh-home first-artifact watching, focused routing across two VS Code windows, no-focused-window suppression, same-URI reuse, close/reopen, different-artifact isolation, regular file-link behavior, and command-driven custom-editor opening.
- Phase 2/3 automated gates cover revise/advance, question-only SHA preservation, Proceed/Just save, cancellation/takeover/reconnect, transactional rollback, and the Windows editor-lock fallback.
- Phase 4's disposable five-client fixture verifies install, stale detection, reinstall, uninstall, unrelated-config preservation, and global-artifact retention without mutating real client configurations.

### Real user data boundary

- `C:\Users\Admin\.ai-artifacts` now exists because the owner explicitly ran the Phase 5 end-to-end tests.
- It contains the user-approved manual artifacts, including `phase5-e2e-auto-open-*`; Phase 5 did not delete or rewrite them outside the tested lifecycle.
- The artifacts are retained intentionally under the product's uninstall/data-retention contract.

## Accepted release evidence

1. **Ubuntu POSIX CI — ACCEPTED AS RELEASE-PIPELINE GATE**
   - The existing GitHub release workflow runs `npm ci`, `npm run check`, `npm test`, and `npm run package` on `ubuntu-latest` before publishing.
   - The owner accepts this blocking release job as the authoritative POSIX execution. A failed job prevents publication; a green job confirms the POSIX tests executed rather than skipped.
   - Required behavior: managed directories remain `0700`; lifecycle, lock, staging, and backup files remain `0600` through create, comment/submission, advance, and rollback paths.
2. **Five-client compatibility — OWNER-ACCEPTED**
   - The five-client configuration and lifecycle are strongly covered by disposable integration tests, and the current AI client passed a real packaged-VSIX E2E run.
   - The owner explicitly accepts the isolated five-client fixture plus the current-client packaged E2E as sufficient v1.0.0 release evidence. Real smoke tests were not independently run on every client, so this remains a documented residual evidence limitation rather than an open gate.

## Readiness assessment

Default readiness weights were fixed before the conclusion:

| Dimension | Weight | Evidence score |
| --- | ---: | ---: |
| Architecture, contracts, and maintainability | 15 | 14 |
| Correctness and automated testing | 20 | 19 |
| Security, privacy, and trust boundaries | 15 | 13 |
| Reliability, concurrency, and recovery | 15 | 14 |
| Build, install, upgrade, rollback, and uninstall | 15 | 13 |
| Compatibility, documentation, and support | 10 | 9 |
| Field and operational evidence | 10 | 7 |
| **Weighted readiness** | **100** | **89/100** |

- Technical/code quality: release-candidate quality; no unresolved P0/P1 code regression was found.
- Product maturity: release candidate, not mature; evidence is one real-client packaged E2E plus extensive automated/isolated-host coverage.
- Evidence confidence: high for Windows core lifecycle and packaging; medium for POSIX until the blocking release workflow runs and for clients covered by isolated fixtures rather than real-host smoke tests.
- P0: none in the current supported local/same-filesystem scope.
- P1: none open; the owner accepted the bounded five-client real-host evidence limitation for v1.0.0.
- P2: four moderate development-only `vsce` dependency findings with no upstream fix.

## Decision

- Local Windows automated gate: PASS.
- Packaged VSIX core manual gate: PASS.
- Documentation/package consistency: PASS.
- POSIX permission gate: PASS as a blocking release-pipeline condition; publication remains impossible unless the Ubuntu job succeeds.
- Five-client compatibility evidence: PASS by explicit owner acceptance of automated isolated coverage plus one real packaged-VSIX E2E.
- Stability score: `5/5` for the declared v1.0.0 release process and supported topology.
- Publish decision: READY. The normal Ubuntu release workflow must still finish successfully before GitHub publishes the VSIX.
