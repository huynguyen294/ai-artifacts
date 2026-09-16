# Phase 4 Progress Report

- Updated at: 2026-09-16 15:35:08 +07:00
- Baseline package: `ai-artifacts@0.9.3`
- Baseline checkpoint: `c5e5099 feat: complete global artifact watcher and safe review opening`
- Current checkpoint: installed integration synchronization is implemented and verified on isolated fixtures
- Phase 4 final gate: PASS

## Components changed

- `src/extension/workspace-integration-v4.ts`
  - Preflights the packaged MCP bundle and every production skill asset before replacing installed assets.
  - Writes the current MCP runtime through the existing atomic-file helper.
  - Replaces the installed skill directory from a staged copy, removing obsolete files rather than merging them into the current skill.
  - Restores the previous skill if the staged replacement fails; if restoration also fails, it retains the recovery directory and reports its exact path.
  - Removes the legacy MCP filename and legacy skill during reinstall instead of recreating a compatibility alias.
  - Reports `assetsUpdated` from actual source/installed drift and legacy cleanup state.
  - Marks configured clients `outdated` whenever the shared runtime or production skill differs from source; synchronized clients report `ready`.
- `src/shared/artifact-files.ts`
  - Removes unused `.codex-artifacts` directory constants left after the schema-v5 global cutover.
- `test/workspace-integration.test.ts`
  - Adds one isolated five-client install/reinstall/uninstall fixture.
  - Locks the exact five-tool Codex config, current MCP/skill bytes, legacy asset cleanup, stale asset detection, and `ready -> outdated -> ready` verification transition.
  - Proves reinstall preserves unrelated Codex, Cursor, Claude, Windsurf, and Copilot configuration.
  - Proves uninstall removes managed runtime/skill/config and workspace registry assets while preserving the global artifact directory and unrelated configuration.

## Verification

- `npm.cmd run check` -> PASS, exit code 0.
- `npm.cmd exec vitest run test/skill-contract.test.ts test/workspace-integration.test.ts test/mcp-config.test.ts test/mcp-client-drivers.test.ts` -> PASS, 4/4 files and 41/41 tests passed.
- `npm.cmd run build` -> PASS, exit code 0.
- `npm.cmd test` -> PASS, 18/18 files passed, 209 tests passed, 3 platform-specific tests skipped.
- `git diff --check` -> PASS; only Git line-ending notices were emitted.
- Real-home safety check -> PASS; `C:\Users\Admin\.ai-artifacts` does not exist after the gate.

## Static audit

- Removed active shared declarations for `.codex-artifacts` artifact storage.
- `reviewUrl`, `registerUriHandler`, and `onUri:` matches are limited to negative regression assertions; no active deep-link contract exists.
- Remaining legacy MCP/config/hook/skill strings in Phase 4 source and tests are cleanup targets or cleanup regression fixtures.
- The old `.codex-artifacts` custom-editor selector remains only in `package.json`; its removal is explicitly assigned to Phase 5 by the approved plan.
- The bundled integration source/output filename and MCP server name still use historical `codex-artifacts` branding; they do not enable schema-v3/v4 artifact compatibility.

## Phase 4 decision

- Manual verification: `NOT_REQUIRED`; all install, reinstall, verify, uninstall, and data-preservation operations ran against disposable home/config fixtures.
- Real integrations modified: none.
- Regressions found: none unresolved.
- Remaining risks: users must reinstall integrations and restart their AI client after upgrade; remote environments remain outside the v1.0.0 supported release matrix as fixed in Phase 0.
- Documentation and removal of the old custom-editor selector remain deferred to Phase 5 as planned.
- Stability score: `4/5`.
- Gate decision: `PASS`.
- Ready for next phase: `YES` (Phase 5 docs, packaging, and full release validation).
