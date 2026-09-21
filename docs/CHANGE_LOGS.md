# Documentation change logs

This document records meaningful changes to how the project behaves and how it is documented. Its purpose is to help maintainers and AI assistants quickly track architectural and behavioral decisions that alter the system's state, keeping code, behavior, and documentation aligned.

Changes documented here include:

- Product, extension host, MCP server, webview, or agent skill behavior.
- Architecture, ownership boundaries, lifecycle, data flow, schema, or contracts.
- Product intent, philosophy, non-goals, or the semantics of review decisions.
- Workspace rules, filesystem safety, compatibility, or migration paths.
- Content in instructions or documentation that modifies how humans or AI understand and work on the project.

Minor typos, formatting fixes, or cosmetic wording adjustments that do not change technical semantics do not need to be recorded here. Versioned release notes are kept in `CHANGELOG.md` at the repository root; this file focuses on behavior, architecture, and documentation decisions, even when not tied to an immediate release.

Each entry includes the date, category, summary of changes, rationale, and affected components or files.

## 2026-09-21 — Automatic artifact retention cleanup and bounded lifetime model

### Changes

- Added automatic artifact retention cleanup to extension activation:
  - Implemented core retention logic in `src/extension/artifact-retention.ts` with bounded concurrency, schema-v6 validation, TOCTOU-safe revalidation, atomic rename to managed cleanup staging (`~/.ai-artifacts/managed/cleanup/`), recursive deletion of staged paths, and crash-safe drain of leftover staging entries.
  - Added machine-scoped setting `agentPlus.artifactRetentionDays` (default 30, minimum 1) controlling the retention window based on `artifact.json.updatedAt`.
  - Integrated asynchronous cleanup into `src/extension/extension.ts` activation without blocking activation or commands.
  - Per-artifact atomic rename resolves multi-window races without requiring a global lock. `EPERM`/`EBUSY`/`EACCES` errors skip the candidate and continue.
- Updated artifact lifetime model from "persistent until explicit deletion" to "bounded by configured retention":
  - Artifacts are automatically and permanently deleted when the extension activates if their `updatedAt` exceeds the retention window.
  - An exact artifact handle may become permanently missing after retention cleanup; the AI skill and MCP contract now document `ARTIFACT_NOT_FOUND` as a non-retryable error with `useSameArtifactHandle: false`.
  - Active MCP waiters terminate with `ARTIFACT_NOT_FOUND` when their artifact is deleted, rather than waiting indefinitely.
  - Users must use **Just save**, **Copy Markdown**, or manual export to preserve content beyond the retention window.
- Updated all project documentation to reflect bounded lifetime:
  - `docs/INSTRUCTION.md`: critical invariants updated for retention-bounded lifetime and activation cleanup.
  - `docs/PHILOSOPHY.md`: section heading, lifetime model, implementation status updated to 1.0.1, and explicit `updatedAt` retention semantics (advance refreshes; open/search/wait/comment/submit do not).
  - `docs/ARCHITECTURE.md`: added activation cleanup, deletion boundary, missing-handle contract; updated compatibility and topology references to 1.0.1 / 1.0.x.
  - `docs/COMPONENTS.md`: extension entry responsibilities, lifetime description, removed stale `workspace root` from file protocol table, verification ownership table.
  - `skills/create-review-artifact/SKILL.md`: `ARTIFACT_NOT_FOUND` recovery row and bounded lifetime rules.
  - `skills/create-review-artifact/references/artifact-contract.md`: availability/lifetime section, `updatedAt` retention semantics, corrected `useSameArtifactHandle: boolean` in `ArtifactRecoveryError`, and `ARTIFACT_NOT_FOUND` recovery rules.
  - `README.md`: retention warning, uninstall data retention, version references updated to 1.0.1 / 1.0.x, VSIX paths, behavior section.
  - `CHANGELOG.md`: 1.0.1 release entry.
- Bumped extension version from 1.0.0 to 1.0.1 in `package.json` and synchronized `package-lock.json`.
- Updated test suites:
  - `test/release-contract.test.ts`: updated for 1.0.1 release contract, synchronized package-lock metadata, and verified `agentPlus.artifactRetentionDays` configuration contribution.
  - `test/skill-contract.test.ts`: added `ARTIFACT_NOT_FOUND` to expected recovery error codes, verified `useSameArtifactHandle: boolean`, and added bounded retention documentation tests.

### Rationale

- Artifact review data is temporary by nature — proposals, plans, and drafts that serve their purpose during the review cycle. Without automatic cleanup, the global collection at `~/.ai-artifacts/artifacts/` grows unboundedly. A configurable retention period balances disk hygiene with reasonable time for users to export valuable content.
- The deletion mechanism uses atomic rename to managed staging before recursive deletion, ensuring that partially deleted artifact directories never appear in the live collection and that multi-window races are resolved without coordination locks.

### Affected components and files

- `src/extension/artifact-retention.ts`, `src/extension/extension.ts`
- `src/integration/artifact-review-mcp-v4.ts` (waiter termination on `ARTIFACT_NOT_FOUND`)
- `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`
- `test/artifact-retention.test.ts`, `test/review-wait-mcp.test.ts`
- `package.json`, `README.md`, `CHANGELOG.md`
- `docs/INSTRUCTION.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/CHANGE_LOGS.md`

## 2026-09-20 — Cross-platform path normalization and POSIX CI test hardening

### Changes

- Normalized cross-platform path separators in window candidate formatting:
  - Added `candidateBasename` helper in `src/shared/window-routing.ts` to convert `\` to `/` before extracting the basename with `path.posix.basename`.
  - Updated `formatWindowCandidateLabel` and `buildWindowCandidates` to use `candidateBasename` for workspace files and folder names, ensuring consistent label and folder extraction across Windows, Linux, and macOS even when snapshots contain Windows-style paths.
- Hardened test suites for POSIX/Linux CI runner compatibility:
  - Updated `test/artifact-contracts.test.ts` to use `path.join` and shared artifact constants instead of hardcoded Windows backslash paths for `artifactPaths` validation.
  - Updated `test/artifact-connection.test.ts` to branch the expected `fs.lstat` retry count (`process.platform === "win32" ? 2 : 3`), accounting for POSIX owner-only permission enforcement (`enforceOwnerOnlyDirectory`) executed on Linux/macOS.

### Rationale

- Ensures all release tests pass deterministically on GitHub Actions (`ubuntu-latest` runner) and prevents candidate label formatting errors when handling cross-platform or remote workspace paths on POSIX environments.

### Affected components and files

- `src/shared/window-routing.ts`
- `test/artifact-contracts.test.ts`, `test/artifact-connection.test.ts`
- `docs/CHANGE_LOGS.md`

## 2026-09-20 — Extension-local artifact search and Quick Pick command

### Changes

- Added VS Code command `AI Artifacts: Search Artifact` (`agentPlus.searchArtifact`):
  - Implemented pure search core in `src/extension/artifact-search.ts`:
    - `normalizeArtifactTitleSearch`: Unicode NFD decomposition, strip combining marks, normalize `đ`/`Đ` to `d`, collapse whitespace, lowercase, and trim.
    - `discoverSearchableArtifacts`: enumerates direct-child schema-v6 artifacts under `~/.ai-artifacts/artifacts/` with bounded concurrency (`16`), skips symlinks/invalid entries, and deterministically sorts (`normalizedTitle` -> `title` -> `artifactId`).
    - `filterSearchableArtifacts`: in-memory substring filtering on title, capping output at `MAX_QUICK_PICK_ITEMS = 1000` while reporting `totalMatches`.
  - Implemented testable Quick Pick controller in `src/extension/artifact-search-command.ts`:
    - Injected dependencies (`createQuickPick`, `discoverArtifacts`, `openArtifact`, `showErrorMessage`).
    - Formats Quick Pick items (`label`: title, `description`: kind + round, `detail`: timestamps + artifactId) with `alwaysShow: true` to prevent native VS Code fuzzy filter interference.
    - Responsive in-memory filter on `onDidChangeValue` without disk re-scans.
    - Clean lifecycle management, cancellation on hide, disabled UI on accept, and error containment.
  - Wired command in `src/extension/extension.ts` and `package.json` to open selected artifacts via `ArtifactReviewOpenCoordinator.open`.
  - Search is strictly extension-local: does not query MCP, invoke window routing, read or write `artifact-connection.json`, or alter review rounds.
  - Documented Connect button workflow in Artifact Review header for copying exact artifact handles into AI chat sessions.

### Rationale

- Provides an intuitive, native UI mechanism to locate and open existing artifacts directly from VS Code without manual file dialogs or exposing search as an MCP tool.

### Affected components and files

- `src/extension/artifact-search.ts`, `src/extension/artifact-search-command.ts`
- `src/extension/extension.ts`, `package.json`
- `test/artifact-search.test.ts`, `test/artifact-search-command.test.ts`
- `README.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `docs/CHANGE_LOGS.md`, `CHANGELOG.md`

## 2026-09-20 — Advisory artifact-window affinity for reconnect

### Changes

- Added advisory artifact-window affinity for `inspect_artifact_review(intent: "reconnect")`:
  - Defined strict `artifactWindowConnectionInputSchema` (`targetMode: "artifact-window"`, `windowInstanceId: UUID`) and union `reconnectConnectionInputSchema` in `src/shared/contracts.ts`.
  - Excluded `connectionRevision` from agent input to ensure reconnect validity depends purely on ID equality and live registry presence rather than optimistic lock semantics.
  - Implemented pure selector `selectReconnectWindowTarget` in `src/shared/window-routing.ts` with deterministic resolution hierarchy: `sole live window -> valid artifact affinity -> unique focused window -> ambiguous selection required`.
  - Reconnect preflight reads current connection before takeover to fail-closed early on malformed files (`ARTIFACT_CONNECTION_INVALID`).
  - Mismatch or stale affinity is treated as an expected refresh path rather than an error, silently falling back to focused resolution and returning the newly committed window instance ID.
  - Reject `artifact-window` input on `create_artifact` and non-reconnect `inspect_artifact_review`.
  - Updated tool declaration schema for `inspect_artifact_review` to accept `oneOf` connection modes (`artifact-window` and `explicit-window`).
  - Updated `create-review-artifact` skill and artifact contract references to track `artifactDirectory -> { reviewRound, windowInstanceId }` in chat working state.
  - Documented intent-driven connection behavior: generic reconnect sends cached affinity hint; "current window" intent omits hint; "window X" intent uses explicit selection tokens.

### Rationale

- In multi-window workflows, users expect reconnecting an existing artifact to reopen in its original window even if another window has gained focus in the meantime, while still allowing explicit overrides and clean fallbacks when windows close.

### Affected components and files

- `src/shared/contracts.ts`, `src/shared/window-routing.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`
- `test/window-routing.test.ts`, `test/review-wait-mcp.test.ts`, `test/skill-contract.test.ts`
- `docs/CHANGE_LOGS.md`, `CHANGELOG.md`, `README.md`, `docs/INSTRUCTION.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`

## 2026-09-19 — Token consume timing fix and dead code cleanup

### Changes

- Fixed race condition in explicit-window token flow: `windowTokenStore.consume` was called before validating that the target window snapshot still exists. If the window closed between token mint and artifact creation, the token was irreversibly consumed and the agent could not retry. Token is now consumed only after snapshot validation succeeds; on failure, the token is released for retry.
- Corrected error classification: when an explicit selection token is valid but its target window is no longer in the registry, the error is now `WINDOW_SELECTION_EXPIRED` (not `WINDOW_NOT_FOUND`). `WINDOW_NOT_FOUND` is reserved for the case where no windows exist at all.
- Applied the same fix to both `resolveCreateTarget` (create path) and `handleInspectTool` reconnect path.
- Removed `WORKSPACE_SELECTION_TTL_MS` alias from `contracts.ts` (zero consumers, transitional artifact from workspace→window rename).
- Removed `artifactConnectionHintSchema` and `ArtifactConnectionHint` type from `contracts.ts` (zero consumers, not used by MCP 9 handlers).
- Updated test assertion in `review-wait-mcp.test.ts` to expect `WINDOW_SELECTION_EXPIRED` instead of `WINDOW_NOT_FOUND` for the stale-token scenario.

### Rationale

- Token consumption must be atomic with the operation it gates. Consuming before validation creates a one-way failure: the agent loses the token but gains nothing, forcing a full re-resolve cycle.
- Error codes drive agent recovery behavior. `WINDOW_NOT_FOUND` signals "resolve windows again from scratch" while `WINDOW_SELECTION_EXPIRED` signals "your selection was valid but the window disappeared" — the latter allows more targeted recovery.

### Affected components and files

- `src/integration/artifact-review-mcp-v4.ts` (lines 474–484, 1337–1348)
- `src/shared/contracts.ts` (removed `WORKSPACE_SELECTION_TTL_MS`, `artifactConnectionHintSchema`, `ArtifactConnectionHint`)
- `test/review-wait-mcp.test.ts` (line 1419)

## 2026-09-19 — Schema v6 lifecycle cutover, focused-window routing, and MCP 9.0.0

### Changes

- Cut over artifact manifest to schema v6, completely eliminating `location.workspaceRoot` and decoupling artifact review sessions from workspace folder ownership. Artifacts belong to review sessions in global storage.
- Replaced tool `resolve_artifact_workspace` with `resolve_artifact_window`. MCP server surface remains five tools: `resolve_artifact_window`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`.
- Implemented focused-first window routing: `create_artifact` and `inspect_artifact_review` automatically route to the currently focused VS Code window (or sole live window) without preflight workspace queries. When multiple live windows exist and focus is ambiguous, requests return `WINDOW_SELECTION_REQUIRED` with candidate summaries and single-use opaque `selectionToken` (`targetMode: "explicit-window"`).
- Separated window routing from connection persistence: `src/shared/window-routing.ts` manages routing resolution while `src/shared/artifact-connection.ts` manages connection persistence and file locking.
- Added bounded snapshot pruning to `src/shared/workspace-registry.ts` and `src/extension/workspace-registry-publisher.ts`, retaining at most 10 snapshots and removing files older than 7 days. Added support for folderless windows (`folders: []`).
- Bumped MCP server version to `9.0.0`. Older schemas (v3, v4, v5) are unsupported and rejected.
- Updated skills, references, documentation, and test suite across all components.

### Rationale

- Artifacts represent human review sessions for proposals, plans, and architectural drafts, which are global to the user rather than owned by a single folder. Requiring workspace resolution and repository ownership proof created unnecessary friction and failures when working across windows or empty workspaces.
- Window routing based on user focus directly reflects user intent in multi-window workflows. Explicit selection tokens provide a clean, deterministic fallback when focus is ambiguous.

### Affected components and files

- `src/shared/contracts.ts`, `src/shared/artifact-validation.ts`, `src/shared/window-routing.ts`, `src/shared/artifact-connection.ts`, `src/shared/workspace-registry.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/workspace-registry-publisher.ts`, `src/extension/mcp-config.ts`
- `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`
- `package.json`, `README.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `CHANGELOG.md`, `docs/CHANGE_LOGS.md`
- Full test suite

## 2026-09-18 — Window-routed artifact connections and MCP 8.0.0 cutover

### Changes

- Changed workspace resolution from one focused context to fresh candidates grouped by live VS Code window. Focus remains a ranking hint, while each selection token binds an exact `windowInstanceId + workspaceRoot` tuple.
- Added optional schema-v1 `artifact-connection.json` as UI-routing state containing only the target window, connection revision, open-request ID, source, and timestamp. `artifact.json` remains the source of truth for artifact identity and workspace ownership.
- Made create commit the initial connection and made `inspect_artifact_review` with reconnect intent revalidate/rebind a live target window. Tagged-file evidence remains ownership proof; its optional connection token only disambiguates the window.
- Replaced focus-gated comments-file auto-open with per-window `artifact-connection.json` create/change handling. Non-target windows ignore requests; the matching window can open while unfocused, deduplicates successful request IDs, and retains same-artifact single-flight coordination.
- Kept the public MCP surface at exactly five tools. Wait and advance preserve connection state and cannot rebind.
- Kept extension/package version at unreleased `1.0.0`, artifact schema at v5, and connection schema at v1; increased the bundled MCP runtime to 8.0.0 for the breaking grouped-resolver and reconnect contract.
- Updated the production skill, artifact contract, MCP self-description, current-state documentation, release notes, and integration contract expectations as one atomic cutover.

### Rationale

- Focus alone cannot identify the intended VS Code window when the same workspace is open more than once. Persisting a narrow routing request lets every extension window observe the same filesystem event while only the selected instance opens the artifact.
- Separating artifact identity from optional UI routing preserves schema-v5 lifecycle compatibility, exact-handle recovery, and user data during uninstall or rollback.
- A major MCP version prevents an older installed skill/runtime pair from silently interpreting the new resolver and reconnect semantics incorrectly.

### Compatibility, deployment, and rollback boundary

- Extension 1.0.0, MCP 8.0.0, artifact schema v5, connection schema v1, and the matching skill must be installed together. Updating the extension alone is insufficient; integrations must be reinstalled and the AI client restarted.
- Optional connection files are user artifact data. Uninstall and rollback must not delete or migrate them; older code may ignore them.
- Automated source/build verification does not prove installed-host or multi-window behavior. Those claims remain gated on the final exact-build manual verification.

### Affected components and files

- `src/shared/workspace-registry.ts`, `src/shared/contracts.ts`, `src/shared/artifact-connection.ts`, `src/shared/artifact-files.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/artifact-review-open.ts`, `src/extension/extension.ts`, `src/extension/workspace-registry-publisher.ts`
- `skills/create-review-artifact/`
- `package.json`, `README.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `CHANGELOG.md`
- Workspace registry, artifact connection, MCP lifecycle, extension open, skill contract, release contract, and integration test suites

## 2026-09-16 — Consolidate installer assets and workspace registry under ~/.ai-artifacts/managed

### Changes

- Relocated extension-managed MCP server runtime from `~/.vscode/ai-artifacts/` to `~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs`.
- Relocated live workspace heartbeat registry snapshots from `~/.vscode/ai-artifacts/workspaces/` to `~/.ai-artifacts/managed/workspaces/`.
- Introduced canonical path helpers in `src/shared/artifact-files.ts`: `aiArtifactsRoot`, `artifactCollectionRoot`, `managedAssetsRoot`, `managedRuntimeDirectory`, `managedMcpScriptPath`, and `managedWorkspaceRegistryDirectory`.
- Enforced owner-only permissions on POSIX for managed directories (`0700`) and runtime/registry files (`0600`).
- Updated integration installers, verifiers, and client drivers (Codex, Cursor, Claude Code, Windsurf, GitHub Copilot) to target the new managed runtime path.
- Established strict cleanup boundaries: uninstall removes `~/.ai-artifacts/managed/`, legacy `~/.vscode/ai-artifacts/`, and managed skills, while permanently preserving user review data in `~/.ai-artifacts/artifacts/`.

### Rationale

- Separating user review data (`artifacts/`) from extension-managed runtime state (`managed/`) under `~/.ai-artifacts/` creates a clean single product root without entangling assets in `~/.vscode/`.
- Decouples AI Artifacts from VS Code-specific folders, reflecting multi-client support (Cursor, Claude, Windsurf, Codex).
- Eliminates Windows file-locking conflicts on running runtime scripts during upgrades.

### Affected components and files

- `src/shared/artifact-files.ts`
- `src/shared/artifact-validation.ts`
- `src/shared/workspace-registry.ts`
- `src/extension/workspace-integration.ts` (renamed from `workspace-integration-v4.ts`)
- `src/extension/mcp-clients/base-cleanup.ts`
- `src/extension/mcp-clients/json-mcp-helper.ts`
- `src/extension/extension.ts`
- `test/global-artifact-path.test.ts`
- `test/workspace-registry.test.ts`
- `test/workspace-integration.test.ts`
- `test/mcp-client-drivers.test.ts`
- `test/mcp-config.test.ts`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `docs/INSTRUCTION.md`
- `docs/PHILOSOPHY.md`
- `CHANGELOG.md`
- `plans/installer.md`

## 2026-09-16 — Global schema-v5 storage and v1.0.0 compatibility cutoff

### Changes

- Moved the live lifecycle from workspace-local directories to the per-user `~/.ai-artifacts/artifacts/<artifactId>/` collection.
- Made schema v5 the only supported manifest/comments/submission contract and MCP server 7.0.0 the matching runtime. Schemas v3/v4 are rejected and are not live-migrated.
- Kept workspace identity in `artifact.json` as `location.workspaceRoot`; creation still requires tagged-file or resolver-token evidence, while later lifecycle calls use the exact global artifact handle.
- Replaced workspace watcher globs with a validated global-root watcher, focused-window auto-open, exact-handle command opening, and same-artifact single-flight coordination.
- Defined `artifactLink` as a regular encoded file link rather than a deep link.
- Added owner-only POSIX directory/file modes for global lifecycle data and documented Windows ACL behavior separately.
- Hardened reinstall to replace stale runtime/skill assets and remove obsolete files; verify reports configured clients as outdated when shared assets drift.
- Kept uninstall ownership narrow: managed config/runtime/skill/registry state is removed, but `~/.ai-artifacts/` and unrelated user configuration are retained.
- Removed the active `.codex-artifacts` custom-editor selector and synchronized release metadata to extension version 1.0.0.

### Rationale

- A single global collection lets artifacts outlive workspace movement and transient editor/MCP connections while preserving explicit repository ownership in the manifest.
- A hard v5 cutoff avoids ambiguous mixed-version writes and makes upgrade/rollback behavior explicit: reinstall the runtime and skill that match the extension version.
- Focus-gated opening and exact-handle validation prevent cross-window focus stealing and wrong-artifact binding.
- Artifact content can contain sensitive project information, so storage permissions and uninstall retention must be explicit rather than inherited from ambient defaults.

### Support and operational boundary

- Local desktop Windows, macOS, and Linux are supported when the extension host and MCP process run as the same OS user and see the same user filesystem.
- Remote SSH, WSL, dev containers, Codespaces, browser/virtual workspaces, and split-host topologies are unsupported in v1.0.0 because they have not passed the release matrix.
- Updating the extension alone does not update installed integrations. Users must reinstall all integrations, restart the AI client, and start a new chat.

### Affected components and files

- `src/shared/contracts.ts`, `src/shared/artifact-files.ts`, `src/shared/artifact-validation.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/artifact-store.ts`, `src/extension/artifact-review-open.ts`, `src/extension/extension.ts`
- `src/extension/workspace-integration-v4.ts`, `src/extension/mcp-config.ts`, `src/extension/mcp-clients/`
- `skills/create-review-artifact/`
- `package.json`, `package-lock.json`, `README.md`
- `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`
- Global lifecycle, watcher/open, skill/link, MCP, store, registry, and integration test suites

## 2026-09-11 — Clickable Artifact Review Link in MCP Server and Agent Chat

### Changes

- Implemented `toArtifactFileUrl` using Node.js built-in `pathToFileURL` (`node:url`) conforming to RFC 8089 with forward-slash normalization and explicit percent-encoding for parentheses (`%28`, `%29`).
- Implemented `formatArtifactLink` adhering strictly to CommonMark 0.31.2: sanitizes newline characters into single spaces and backslash-escapes `\`, `[`, and `]`.
- Enhanced `artifactHandle` (consumed by `create_artifact` and `inspect_artifact_review`) to return `artifactUrl` and preformatted markdown link `artifactLink`.
- Enhanced `grantSubmittedRound` (consumed by `wait_for_artifact_review` and `advance_and_wait_for_artifact`) to return `artifactUrl` and `artifactLink`.
- Updated `skills/create-review-artifact/SKILL.md` to instruct AI Agents to emit `artifactLink` into user-visible chat upon creating new artifacts and before advancing/waiting on subsequent rounds.
- Updated `skills/create-review-artifact/references/artifact-contract.md` to document the presence of `artifactUrl` and `artifactLink` in the tool response contract.
- Added comprehensive unit tests in `test/review-wait-mcp.test.ts` (covering spaces, `#`, `()`, and complex title formatting) and `test/skill-contract.test.ts`.

### Rationale

- When creating or updating an artifact across multiple rounds, if the user inadvertently closes the artifact review tab or if the extension auto-open event is missed, users previously lacked an intuitive way to restore the custom review editor without searching the filesystem or triggering a reconnect.
- Returning an RFC 8089 `file:///...` markdown link enables users to simply click the link in the AI Agent chat window to reopen the `agentPlus.artifactReview` custom editor seamlessly, while avoiding intrusive watcher-based tab focus stealing.

### Affected components and files

- `src/integration/artifact-review-mcp-v4.ts`
- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`

## 2026-09-11 — Skill Copy Command and Independent Skill Verification

### Changes

- Registered Command Palette command `agentPlus.copyReviewSkill` (`AI Artifacts: Copy create-review-artifact Skill Markdown`) to copy the bundled agent review skill directly to the clipboard.
- Decoupled Agent Skill verification (`skillAssetsAreCurrent`) from MCP server script verification (`baseScriptIsCurrent`) in `src/extension/workspace-integration-v4.ts`.
- Updated `checkAllIntegrations` signature and return contract to independently report `skillCurrent` alongside `baseCurrent`.
- Updated `agentPlus.verifyGlobalIntegration` notification to prioritize Skill status first, before Base runtime and Client status.
- Re-architected Codex TOML configuration parser in `src/extension/mcp-config.ts` using Table-Aware Section Scanning (`findManagedBlockBounds`) and semantic key validation (`hasManagedCodexArtifactsMcp`), eliminating fragile literal string comparisons and fixing false-negative `missing` reports caused by displaced comment markers.
- Hardened `stripBlock` and `removeCodexArtifactsMcp` against configuration data loss by stopping block removal at the first unrelated table header and pruning orphaned end markers.
- Updated `README.md` documentation covering manual skill setup and the updated verification checklist order.
- Added unit test suites `test/workspace-integration.test.ts` and extended `test/mcp-config.test.ts` and `test/mcp-client-drivers.test.ts`.
- Bumped extension version to `0.9.3`.

### Rationale

- Provides an immediate manual fallback for users whose AI environments do not automatically pick up global skills from `~/.agents/skills/`.
- Gives users clear, distinct visibility into whether the Agent Skill is deployed and up to date, eliminating false confidence when only the MCP server script was ready.
- Eliminates false-negative Codex detection and prevents catastrophic deletion of intervening configurations (`node_repl`, `desktop`, `plugins`) when external tools/formatters move comments.

### Affected components and files

- `package.json`
- `src/extension/workspace-integration-v4.ts`
- `src/extension/extension.ts`
- `src/extension/mcp-config.ts`
- `src/extension/mcp-clients/codex-client.ts`
- `README.md`
- `test/workspace-integration.test.ts`
- `test/mcp-config.test.ts`
- `test/mcp-client-drivers.test.ts`
- `CHANGE_LOGS.md`
- `docs/CHANGE_LOGS.md`

## 2026-09-09 — MCP Client Uninstallation Engine (Dual Hook & Command Support)

### Changes

- Implemented comprehensive uninstallation architecture combining automatic extension lifecycle hook (`vscode:uninstall`) and manual Command Palette commands (`agentPlus.uninstall*`).
- Extended `McpClientDriver` interface with `uninstall(): Promise<boolean>`.
- Implemented `removeJsonMcpServer` helper in `src/extension/mcp-clients/json-mcp-helper.ts` providing atomic deletion of `ai_artifacts` server configurations from JSON configurations (VS Code User `mcp.json`, Cursor `mcp.json`, Claude `~/.claude.json`, and Windsurf `mcp_config.json`).
- Exported `removeCodexArtifactsMcp` in `src/extension/mcp-config.ts` to cleanly extract the managed MCP TOML block from `~/.codex/config.toml`.
- Added `cleanupBaseMcpServer` in `src/extension/mcp-clients/base-cleanup.ts` to remove centralized MCP runtime server scripts (`~/.vscode/ai-artifacts/`) and deployed agent skills (`~/.agents/skills/create-review-artifact/`) without touching workspace project repositories.
- Created standalone, pure Node.js entry point `src/extension/uninstall-entry.ts` compiled via esbuild into `dist/uninstall.cjs` (10KB) invoked by VS Code's `"vscode:uninstall"` hook without dependency on the `vscode` extension API.
- Registered Command Palette commands: `agentPlus.uninstallAllIntegrations`, `agentPlus.uninstallCopilotIntegration`, `agentPlus.uninstallCodexIntegration`, `agentPlus.uninstallCursorIntegration`, `agentPlus.uninstallClaudeIntegration`, and `agentPlus.uninstallWindsurfIntegration`.
- Added unit and integration tests verifying clean uninstallation across all 5 drivers, JSON/TOML cleanup, and base asset removal.

### Rationale

- Ensures complete lifecycle management so that users can seamlessly disconnect or remove AI Artifacts without manual file editing, broken JSON/TOML syntax, or orphaned background runtime files.
- Guarantees zero project data loss by strictly segregating client configuration cleanup from workspace artifact history.

### Affected components and files

- `package.json`
- `src/extension/mcp-clients/index.ts`
- `src/extension/mcp-clients/json-mcp-helper.ts`
- `src/extension/mcp-clients/codex-client.ts`
- `src/extension/mcp-clients/copilot-client.ts`
- `src/extension/mcp-clients/cursor-client.ts`
- `src/extension/mcp-clients/claude-client.ts`
- `src/extension/mcp-clients/windsurf-client.ts`
- `src/extension/mcp-clients/base-cleanup.ts`
- `src/extension/mcp-config.ts`
- `src/extension/uninstall-entry.ts`
- `src/extension/workspace-integration-v4.ts`
- `src/extension/extension.ts`
- `test/mcp-client-drivers.test.ts`
- `README.md`
- `CHANGE_LOGS.md`

## 2026-09-09 — Standardized .ai-artifacts Storage with 100% Backwards Compatibility

### Changes

- Migrated default artifact storage directory from `.codex-artifacts/` to `.ai-artifacts/` across shared constants (`src/shared/artifact-files.ts`), MCP server creation runtime (`src/integration/artifact-review-mcp-v4.ts`), and skill reference contracts (`skills/create-review-artifact/references/artifact-contract.md`).
- Implemented non-breaking dual-directory validation in `src/shared/artifact-validation.ts` (`assertArtifactDirectory`), accepting both `.ai-artifacts` (primary) and `.codex-artifacts` (legacy).
- Extended VS Code Custom Editor declaration in `package.json` with multi-pattern selectors for both `.ai-artifacts` and `.codex-artifacts`.
- Updated filesystem watcher in `src/extension/extension.ts` to listen for new comments across both directories (`**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json`).
- Updated file staging prefix in `src/integration/stamp-origin.ts` to `.ai-artifacts-...tmp`.
- Bumped extension version to `0.9.2`.

### Rationale

- Completes the re-branding from Codex-specific tooling to platform-agnostic AI Artifacts without stranding existing user artifacts or causing file lock issues on Windows.

### Affected components and files

- `package.json`
- `.gitignore`
- `.vscodeignore`
- `src/shared/artifact-files.ts`
- `src/shared/artifact-validation.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/integration/stamp-origin.ts`
- `src/extension/extension.ts`
- `skills/create-review-artifact/references/artifact-contract.md`
- `test/artifact-store.test.ts`
- `test/review-wait-mcp.test.ts`
- `README.md`
- `CHANGE_LOGS.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `plans/migrate-to-ai-artifacts.md`

---

## 2026-09-09 — Multi-Client MCP Architecture and Dedicated Installers

### Changes

- Relocated centralized MCP runtime storage to `~/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs` and moved live workspace heartbeat registry snapshots to `~/.vscode/ai-artifacts/workspaces/`.
- Built modular MCP client drivers under `src/extension/mcp-clients/` supporting:
  - **GitHub Copilot (VS Code)**: User global configuration in `Code/User/mcp.json` with the official `"servers"` key and `"type": "stdio"`, resolving cross-platform (Windows `%APPDATA%\Code\User`, macOS, Linux) and preserving existing custom server definitions.
  - **Cursor**: `~/.cursor/mcp.json`.
  - **Codex**: `~/.codex/config.toml` unified with `[mcp_servers.ai_artifacts]` and `# >>> AI Artifacts review MCP >>>` markers, including automatic backwards-compatible migration of legacy `[mcp_servers.codex_artifacts]` blocks and encapsulated legacy hook cleanup.
  - **Claude Code**: `~/.claude.json`.
  - **Windsurf**: `~/.codeium/windsurf/mcp_config.json`.
- Standardized MCP server naming: unified to `ai_artifacts` across all client drivers and configurations.
- Stdio transport conformity: enforced `"type": "stdio"` when upserting to VS Code native `"servers"` container in `Code/User/mcp.json`.
- Provided dedicated installer commands in the VS Code Command Palette for each environment plus `AI Artifacts: Install All Detected Integrations` and `AI Artifacts: Copy MCP Configuration JSON`.
- Refined extension icon at `media/icon.png` with smooth transparent corners for light and dark themes.
- Preserved repository-level `.codex-artifacts` directory naming and schema v4 contracts.

### Rationale

- Eliminates coupling to the `.codex` folder for developers working in Cursor, Claude, or Copilot.
- Enables single-click, non-destructive configuration across diverse AI coding environments while preserving existing custom configurations.

### Affected components

- Shared Registry: `src/shared/workspace-registry.ts`
- MCP Drivers: `src/extension/mcp-clients/`
- Integration Service: `src/extension/workspace-integration-v4.ts`
- Extension Entrypoint: `src/extension/extension.ts`
- Manifest: `package.json`
- Tests: `test/mcp-client-drivers.test.ts`
- Documentation: `README.md`, `CHANGE_LOGS.md`, `docs/CHANGE_LOGS.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`

---

## 2026-09-09 — Product branding and release automation — AI Artifacts and CI/CD workflow

### Changes

- Rebranded product from "Codex Artifacts" to **AI Artifacts - Interactive Planning & Review** (`ai-artifacts`), expanding positioning and documentation to support the open Model Context Protocol (MCP) across multiple AI coding agents (Codex, Cursor, Windsurf, Claude, etc.).
- Created and integrated the official extension icon at `media/icon.png` (256x256 px).
- Unlocked public distribution in `package.json`: removed `private: true`, configured publisher `huynguyen294`, icon, categories, SEO keywords, and bumped version to `0.9.1`.
- Refined the `package` script with `clean:releases` so `releases/` is always wiped before packaging, retaining only the single latest version VSIX (`releases/ai-artifacts-0.9.1.vsix`).
- Added CI/CD workflow at `.github/workflows/release.yml` triggered on `v*` tag pushes to automatically run typechecks, unit tests, build, and publish a GitHub Release with the VSIX artifact attached.
- Added `.env*` and `old-releases/**` to `.vscodeignore` and `.gitignore` to prevent environment leaks and exclude legacy builds from VSIX packaging.

### Rationale

- Broadens product reach to developer communities using Cursor, Windsurf, and Claude rather than remaining restricted to Codex alone.
- Automates releases according to modern CI/CD standards and guarantees clean, deterministic VSIX bundles.

### Affected components

- Metadata: `package.json`
- Assets: `media/icon.png`
- Documentation: `README.md`, `CHANGE_LOGS.md`, `docs/CHANGE_LOGS.md`
- Packaging & Git: `.vscodeignore`, `.gitignore`
- CI/CD: `.github/workflows/release.yml`

---

## 2026-09-08 — MCP API and skill orchestration — Workspace resolver and structured recovery

### Changes

- Added read-only `resolve_artifact_workspace` tool; the resolver reads the fresh focused registry and returns name/path candidates with a selection token. The skill automatically selects a uniquely high-confidence candidate and prompts the user only when ambiguous.
- Resolver normalizes separators in search queries and workspace names; in multi-root workspaces with no match, it returns all fresh folders for the same context with `matchMode: "all-available"`, while `not-found` strictly indicates an empty fresh scope.
- Resolver immediately returns a single workspace folder as `matched`/`single-folder` even when the query differs, relieving the agent from inferring cardinality outside MCP.
- Resolver reads strictly one unique VS Code workspace context: it never merges folders across windows during ambiguous focus, returning `WORKSPACE_CONTEXT_AMBIGUOUS` to request window focus, while deduplicating identical heartbeats from the same context.
- Reduced create evidence to two types: `tagged-file` and `resolved-workspace`; removed `single-workspace`, `active-file`, `explicit-user-path`, and `explicit-user-folder` from the writable create contract.
- Official skill always sends `kind: "implementation-plan"`, checks tool availability once per chat lifecycle, and maintains exact request/workspace-to-handle mappings across multiple artifacts.
- `resolve_artifact_workspace` is the only MCP tool called before reading `artifact-contract.md`; after selecting a workspace, the skill reads the contract before performing workspace research, artifact drafting, or calling remaining lifecycle tools.
- Added intent decision table with fail-safe rule: ask if intent or handle is unclear; never take over speculatively.
- Added structured recovery metadata for lifecycle errors with a same-handle/no-blind-replay policy. Only confirmed pre-commit cancellations or rollbacks allow token reuse.
- Retained schema v4, full replacement Markdown, pure reconnect, and Proceed behavior; no changes to Artifact Store, provider, webview, or renderer.
- Bumped extension to `0.9.0` and MCP server to `6.0.0`; synchronized README, architecture, components, philosophy, skill contract, installer approvals, and tests.
- Verified with typecheck, 76/76 tests across 12 test files, and full production build.

### Rationale

- Streamlines agent workspace inference down to two clear flows while preserving fast, fail-closed MCP verification.
- Prevents misattributing workspaces/artifacts in multi-root or multi-handle sessions and enables agents to recover from machine-readable state rather than parsing error strings or blindly replaying.

### Affected components and documentation

- `src/shared/workspace-registry.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/mcp-config.ts`
- `skills/create-review-artifact/`
- `test/workspace-registry.test.ts`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`
- `test/mcp-config.test.ts`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `docs/PHILOSOPHY.md`
- `CHANGE_LOGS.md`

---

## 2026-09-06 — Lifecycle and MCP API — Explicit chat update on empty review rounds

### Changes

- Extended MCP tool `inspect_artifact_review` with parameters `intent: "explicit-chat-update"` and `expectedReviewRound`.
- Added `source: "chat-update"` to `RoundGrant`. Grants a `chat-update` token when the user requests artifact edits directly from chat on an empty round (no comments or submissions saved on disk).
- MCP rejects chat-update intent if saved feedback or submissions already exist; validates round before takeover and revalidates after takeover so stale requests do not terminate valid waiters.
- In `advance_and_wait_for_artifact`, requires `chat-update` tokens to provide new `markdown` with a different SHA from the current document, preventing empty advances.
- Maintained fail-closed behavior: standard `inspect_artifact_review` calls on an empty round do not issue a token, ensuring pure reconnects reattach to the same round without changing data or advancing rounds.
- Updated `create-review-artifact` skill and contract to distinguish 3 flows: Pure reconnect, Saved comment inspection, and Explicit chat update.
- Bumped extension to `0.8.0` and MCP server to `5.1.0`. Updated `docs/ARCHITECTURE.md` and `docs/PHILOSOPHY.md`.
- Synchronized `package-lock.json`, `README.md`, `docs/COMPONENTS.md`, and regression tests for empty-round eligibility, stale-round waiter safety, token state binding, and Enter/Shift+Enter/IME support.
- Verified with typecheck, 67/67 tests across 12 test files, and full production build.

### Rationale

- Resolves deadlocks when users request artifact edits directly in chat without UI comments: previous inspections issued no token on empty rounds, preventing agents from advancing, while agents could not instruct users to click Review because the UI and backend disabled Review when comment count was 0.

### Affected components and documentation

- `src/integration/artifact-review-mcp-v4.ts`
- `package.json`
- `package-lock.json`
- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`
- `test/selection-comment-popover.test.ts`
- `README.md`
- `docs/COMPONENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PHILOSOPHY.md`
- `CHANGE_LOGS.md`
- `docs/CHANGE_LOGS.md`

---

## 2026-09-06 — Webview UX — Enter to submit comment & Text auto-wrap

### Changes

- Updated textarea in `SelectionCommentPopover` to support pressing `Enter` to quickly submit a comment when text is present (`body.trim()`).
- Supported `Shift + Enter` to insert normal newlines inside the textarea.
- Added `!event.nativeEvent.isComposing` check to prevent unintended submissions during IME composition (e.g., Vietnamese Telex/VNI, Japanese, Chinese).
- Added `wrap="soft"` attribute to `<textarea>`.
- Updated CSS in `styles.css` (`overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;`) for `.comment-popover textarea`, `.comment-detail-popover p`, and `.comment-body` in the sidebar drawer so text wraps cleanly, preventing horizontal layout overflow even with long URLs or unbroken strings.

### Rationale

- Improves review UX by enabling keyboard-driven comment submissions (Enter) without requiring mouse interaction.
- Prevents horizontal overflow rendering bugs when users enter or inspect comments with long continuous words or URLs.

### Affected components and documentation

- `src/webview/SelectionCommentPopover.tsx`
- `src/webview/styles.css`
- Webview bundle (`dist/webview/review.js`, `dist/webview/review.css`)

---

## 2026-08-31 — Documentation and distribution — README onboarding

### Changes

- Rewrote README introduction for end-users, removing internal waiter jargon from initial descriptions.
- Added VS Code requirements, Node runtime/build versions, VSIX installation paths, and source build workflows via `npm ci`.
- Clarified that skills reside in `~/.agents/skills`, while MCP scripts and `config.toml` adhere to `CODEX_HOME`.
- Documented auto-open as default behavior with configurable settings and manual fallbacks; aligned **View comments** drawer labels with Review, Proceed, Just save, and Copy Markdown semantics.
- Restored compatibility guidance for schema v4, read-only schema v3, and preserved unmigrated legacy data.
- Added links to Philosophy, Architecture, Components, Project Instructions, artifact contract, changelog, TODO, and MIT License.
- Documented stable VSIX alias alongside versioned packages; no changes to runtime, MCP API, or artifact schema.
- Added Git repository metadata in `package.json` to allow VSCE to resolve relative markdown links during packaging.

### Rationale

- Previous README assumed pre-existing VSIX packages, lacked runtime prerequisites, introduced internal jargon prematurely, and omitted several installation/review details. The revised onboarding supports direct repository checkouts and builds while keeping deep contract specifications in specialized docs.

### Affected components and documentation

- `README.md`
- `package.json` repository metadata
- Release VSIX generated from current source
- `CHANGE_LOGS.md` and this documentation change log

---

## 2026-08-31 — Proceed semantics — Runtime execution directive

### Changes

- Classified both `plan` and `implementation-plan` as executable plans upon user Proceed.
- `wait_for_artifact_review` returns `nextAction.type: "execute-approved-plan"` with instructions mandating immediate execution of all code, file, workspace, and command actions within the approved plan scope in the same turn.
- Skill must not pause at acknowledgements, describe future work, or prompt for additional execution confirmation; pauses are permitted only for genuine blockers or out-of-scope permissions.
- Expanded `implementation-plan` selection rules for plans directly guiding code, file, workspace, or command changes; `plan` remains executable for other proposal types.
- Reconnect via inspection avoids re-emitting runtime directives, preventing reconnects from re-executing previously approved actions.

### Rationale

- Previous tool results returned only `decision: "approve"`, relying on model inference to combine `kind` with skill instructions. Actionable artifacts classified as `plan` could cause agents to merely acknowledge Proceed without implementing. Runtime directives make execution authority explicit data in MCP results rather than relying on prompt conventions.

### Affected components and documentation

- MCP results and initialization instructions
- Bundled skill and artifact contract
- README, Architecture, Philosophy, Components, project instructions, and 0.7.0 release notes
- MCP lifecycle tests and skill contract tests

---

## 2026-08-31 — Review semantics — Unified feedback handling

### Changes

- Aligned Review submissions (`revise`) and chat inspection under a single unified feedback classifier and action policy.
- Question-only feedback always answers questions visibly in chat, then advances without transmitting Markdown; change-only updates complete Markdown; mixed answers in chat and updates Markdown; needs-clarification defers token consumption.
- Removed creation and updating of `## Review responses` in artifacts. Conversational answers are no longer embedded in review documents.
- Preserved internal transport distinctions: Review receives submitted-review tokens from waiters, while chat escape receives chat-inspection tokens via takeover/inspection.

### Rationale

- Users expect the Review button and "read the review" chat commands to yield identical observable behavior. A single unified policy prevents diverging comment-handling behaviors and keeps artifacts focused on clean document content rather than conversation transcripts.

### Affected components and documentation

- Agent behavior: bundled skill and artifact contract
- MCP guidance: initialization instructions; no changes to tool APIs, token validation, or persistent schema
- Documentation: README, Architecture, Philosophy, Components, project instructions, and 0.7.0 release notes
- Regression contract: skill contract and MCP initialization tests

---

## 2026-08-31 — Lifecycle architecture and behavior — Chat escape/reconnect

### Changes

- Standardized lifetime hierarchy: `artifact lifetime > waiter lifetime > chat-turn lifetime`: artifacts are persistent workspace state; waiters and round tokens are transient process state.
- Split MCP lifecycle into `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`.
- Added chat escape so AI agents can take over waiters, read unsubmitted comments, answer questions in chat, revise artifacts as needed, and start new rounds.
- Allowed question-only advancement to preserve Markdown bytes and SHA; no-comment inspection reattaches to the same round.
- Established that Proceed and Just save conclude rounds without deleting artifacts; reconnect is an explicit action that never repeats past commands.
- Enforced exact artifact handles; eliminated latest-artifact heuristics and working directory inferences.
- Converted update grants to exact-state round grants; unified waiter cancellation and takeover detach semantics.

### Rationale

- Former lifecycles coupled artifact persistence too tightly to a single pending MCP tool call, requiring UI comments to return exclusively via the Review button. Decoupling artifacts from waiters preserves default UX while enabling natural conversation, post-cancellation reconnection, and direct in-chat Q&A without altering schemas or UI.

### Affected components and documentation

- MCP lifecycle: `src/integration/artifact-review-mcp-v4.ts`
- Managed integration: `src/extension/mcp-config.ts`, extension `0.7.0`, MCP server `5.0.0`
- Agent contract: `skills/create-review-artifact/SKILL.md`, `references/artifact-contract.md`, `agents/openai.yaml`
- Current state docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`
- Regression coverage: `test/review-wait-mcp.test.ts`, `test/mcp-config.test.ts`, `test/skill-contract.test.ts`
- No changes to artifact schema v4, webview, provider, Artifact Store, Markdown renderer, or workspace registry.
