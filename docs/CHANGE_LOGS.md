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

## 2026-11-10 — Automatic activation integration upgrade, saved clients, and client drivers

- **Saved client tracking & upgrade coordinator (Phase 1):** Added strict schema-v1 selection persistence (`~/.ai-artifacts/managed/installed-clients.json`, never storing `"agents"`) via `src/extension/installed-client-state.ts`, updated only by explicit manual install/uninstall commands (`recordClientSelection: true`). Added `McpClientDriver.upgrade(context)` across all seven drivers (`copilot`, `cursor`, `codex`, `claude`, `windsurf`, `cline`, `antigravity`) and `upgradeDetectedIntegrations(context)` in `src/extension/workspace-integration.ts` to merge `saved ∪ detected` targets, deploy stale shared assets (`mcp`, `.agents` skills) once with incremental verified receipt commits, run driver definition reconciliation (`upgrade()` + `check()`) on every activation even when receipts match, selectively patch Codex `[mcp_servers.ai_artifacts.tools.join_session]` when targeting MCP 12+, keep Antigravity config/timeout/user rules/permissions and customized `create-review-artifact` blocks intact (updating `work-session` cleanly), report missing/conflicting setups as `setup-required` without auto-installing or running legacy hook cleanup, and isolate per-client errors as `failed`. Kept package (`1.1.4`), schema (`v6`), `MCP_VERSION` (`12`), `CREATE_REVIEW_ARTIFACT_SKILL_VERSION` (`4`), and `WORK_SESSION_SKILL_VERSION` (`1`) unchanged.
- **Activation controller & UI policy (Phase 2):** Replaced `maybeShowUpgradeNotification` (and its legacy `globalState` fingerprint suppression and `Run Installer` / `Later` buttons, leaving any stored legacy key unused on disk) with `runAutomaticIntegrationUpgrade(deps)` (`src/extension/upgrade-notification.ts`), wired non-blockingly in `activate(context)` (`src/extension/extension.ts`). Invokes `upgradeDetectedIntegrations(context)` first, refreshes integration support once in `finally`, stays silent when healthy/no-op/definition-only updates succeed, checks only shared `agents` receipts on empty reports (silent if current, warning if stale/missing/invalid, error on I/O failure), and presents at most one grouped warning (`setup-required`) or error (`failed` mixed with `setup-required`, or coordinator rejection preserving original error detail) citing the exact per-client Command Palette install command and `View Installation Guide` while keeping manual commands/aliases/Verify/Copy unchanged.
- **Documentation & tests:** Synchronized `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/INSTRUCTION.md`, `docs/COMPONENTS.md`, `CHANGELOG.md` (`[1.2.0] - Unreleased`), and `plans/auto-upgrade.md`; updated `test/upgrade-notification.test.ts` and `test/extension-command-recording.test.ts` alongside Phase 1 suites (`test/installed-client-state.test.ts`, `test/integration-upgrade.test.ts`, `test/mcp-client-drivers.test.ts`, `test/integration-verification.test.ts`, `test/workspace-integration.test.ts`).
- **Validation & boundary:** Verified using isolated temp homes and VS Code API mocks: `npm.cmd run check`, `npm.cmd run build`, `git diff --check`, and the full 57-file Vitest suite (`npx.cmd vitest run --maxWorkers=4`: 57 files, 794 passed, 3 skipped) passed after all code, test, and doc edits (`npm.cmd test` with unbounded default workers also passed 57/57 prior to appending this changelog entry, then hit intermittent 5000ms Windows worker-contention timeouts in existing integration/upgrade suites); Section 5.4 live VS Code Extension Development Host smoke tests and real AI client restart/new-chat verification were **not run**.

## 2026-11-10 — Antigravity installer, skill targets, notification, and documentation

- Added dedicated Antigravity client support via `AntigravityClientDriver` (`src/extension/mcp-clients/antigravity-client.ts`) and registered it in `getAllClientDrivers()` (`src/extension/mcp-clients/index.ts`), `workspace-integration.ts`, `base-cleanup.ts`, `extension.ts`, and `package.json`. Installs `ai_artifacts` into `~/.gemini/config/mcp_config.json` with `timeoutSeconds: 3600`, deploys `create-review-artifact` (preserving independent frontmatter `description:` and `USER CUSTOM RULES` fail-closed) and official `work-session` into `~/.gemini/config/skills/`, verifies both assets, and preserves unrelated MCP entries, skills, and user-managed rules during install and uninstall.
- Extended receipt schema (`antigravity?: number` in `installedSkillVersionsSchema` under `src/shared/contracts.ts`) and independent receipt commits after Antigravity verification (`verifyAndRecordAntigravityIntegration`), without auto-upgrade or bumping package, schema, MCP (`12`), review skill (`4`), or Work Session skill (`1`) versions.
- Extended `getDetectedSkillTargets()` (`src/extension/workspace-integration.ts`) to include `"antigravity"` after `"agents"` and optional `"claude"` when `AntigravityClientDriver.isDetected()` matches (`mcp_config.json` or `.gemini/antigravity/`). Updated `requiredSkillTargets()` and `assetLabel()` (`src/extension/upgrade-notification.ts`) so activation checks Antigravity receipts in canonical target order with deduplication and names `Antigravity review skill (.gemini/config)` / `Antigravity work session skill (.gemini/config)` accurately while keeping existing fingerprint suppression and `Run Installer` / `Later` actions unchanged.
- Updated `README.md` (compatibility table, install/uninstall commands, managed runtime and sibling skill paths across `.agents`/`.claude`/Antigravity, customization/verification/upgrade sections, plus optional user-managed Antigravity global-rule and MCP permission guidance exclusively in `README.md`), `CHANGELOG.md` (`[1.2.0] - Unreleased`), `docs/ARCHITECTURE.md`, `docs/INSTRUCTION.md`, `docs/COMPONENTS.md`, `docs/PHILOSOPHY.md`, and `test/release-contract.test.ts` (updated the 3-target receipt contract string while preserving existing version and lifecycle assertions).
- Automated validation: added Antigravity driver, installer/cleanup, detection, upgrade-notification, and release-contract tests using isolated temporary home directories (`vi.spyOn(os, "homedir")`). Typecheck (`npm.cmd run check`), full suite (`npm.cmd test`: 54 files, 787 passed, 3 skipped), production build (`npm.cmd run build`), and `git diff --check` passed. Live Extension Host and Antigravity runtime acceptance (real command install, reload/notification trigger, explicit and rule-based artifact prompts, and permission confirmation flow) were **not run**.

## 2026-11-09 — Minimal AI-authored comment and Review guidance

- Added a short route in `create-review-artifact` and one on-demand `references/ai-feedback.md` with two adjacent actions: generate AI comments only, or generate AI comments and submit that batch as `revise`. The reviewer preserves the existing waiter and does not enter the create/advance/wait flow or process other people's saved feedback.
- Scoped the direct-file exception to `comments.json` and the `revise` submission. The reference documents current manifest bindings, the existing general-feedback shape, exact file-byte hashes and atomic UTF-8 writes. Comment-only stops before submission; comment-and-submit generates its own batch. User/AI conflict handling and standalone submission of others' comments are excluded.
- Updated only the conflicting ownership statements and explicit trigger guidance in the artifact contract, Session skill, contributor instructions, architecture, component ownership and philosophy. Added the reference asset and official description to the installer's existing static lists so the reference is actually installed and its description is not mistaken for user customization. MCP, Artifact Store, schemas, installer algorithms and version counters are unchanged.
- Validation: typecheck, production build and full tests passed (54 files, 775 passed, 3 skipped). An isolated fixture used the reference's JSON comment template, verified Store loading and a pending waiter for comment-only, then verified delivery of a new AI batch and a valid Review token after direct submission. Installation tests verified the new reference is copied.
- Both skill audits passed with zero warnings. The Python validator could not run because PyYAML is absent; equivalent local YAML/frontmatter/name/placeholder checks passed. No installed integration or actual user artifact was modified; real IDE/agent UI behavior was not exercised.

## 2026-11-09 — Preserve waiters across non-waiting round advances

- Detached active waiter ownership from the attachment round. Both waiting tools validate the current manifest, Markdown, comments and submission already read from disk; Review tokens now bind the validated result's round and hashes. `expectedReviewRound` remains an attachment precondition, and writes retain their existing expected-round/token/state checks.
- Allowed `advance_and_wait_for_artifact` with `noWait: true` to commit while preserving an existing waiter. Waiting advances and duplicate waits still reject an existing waiter in the same MCP process. The UUID Session parameter boundary, commit result, token consumption, rollback and routing behavior are unchanged.
- Reused the existing artifact update lock so wait checks stay pending while lifecycle files are replaced. Deleted artifact directories still produce non-retryable `ARTIFACT_NOT_FOUND`; filesystem/snapshot errors outside an update are not silently ignored. No snapshot reload, notification protocol or new lockfile was added to the product flow.
- Clarified the existing Session direct-update skill flow without adding an inspect branch or changing takeover: inspection for a non-waiting update need not detach a waiter. Updated README, architecture, philosophy, contributor invariants and unreleased release notes. Kept package/MCP/skill versions and schemas unchanged.
- Consolidated the agent guidance in `create-review-artifact` and its contract: removed repeated explanations and lockfile internals, and kept the Work Session skill/reference unchanged. Runtime lock behavior remains documented in architecture; this wording cleanup does not change MCP behavior.
- Wording cleanup validation: 27 skill/release contract tests passed; both Codex skill audits passed with zero warnings. The Python skill validator could not run because PyYAML is absent; equivalent local YAML/frontmatter/name/placeholder checks passed using js-yaml. Net added wording across the four skill/reference files was reduced from 278 to 50 words relative to the pre-feature version.
- Added 16 regression cases, including both waiter entry points, sequential updates from another MCP process, current-round Review token usability/replay, terminal decisions, binding validation, commit/rollback lock windows, deletion and cancellation/takeover. A test-only stderr readiness marker makes active-waiter deletion tests deterministic; it is disabled outside the opted-in test process.
- Validation: `npm.cmd run check`, `npm.cmd test` (54 files, 773 passed, 3 skipped), and `npm.cmd run build` passed. The active-waiter deletion regression also passed 20 consecutive runs after synchronizing actual attachment.
- Runtime boundary: tests exercised the rebuilt MCP and Extension Store using isolated temporary artifact fixtures. Real agent/Extension Host manual acceptance, installed integration updates and restarting current MCP processes were not performed. Existing user artifacts were not touched. Concurrent advance/submit, multiple writers and stale-lock recovery remain outside this change.

## 2026-11-08 — Non-waiting direct updates within Work Sessions

- Added optional boolean `noWait` to `advance_and_wait_for_artifact`, defaulting to `false`. The non-waiting mode requires a UUID `artifactConversationId` before token claim or mutation, reuses the existing state-bound transaction and token consumption, and returns the committed round/hash and `waited: false` without registering a waiter or returning review feedback/a new token. The Session ID is a caller-supplied parameter boundary, not verification of Join state, registry existence, or membership.
- Kept the waiting result unchanged, including complete validated comments and decision directives. Non-waiting post-commit recovery directs inspection of the same handle rather than replaying or automatically waiting. Routing and artifact storage schemas are unchanged.
- Scoped the Session skill's default to explicit chat updates of existing Session artifacts, with an explicit request to wait taking precedence. Creation always waits; standalone requests and review-feedback processing retain their existing flow. The artifact skill delegates mode selection, distinguishes commit acknowledgements from review decisions, and permits only user-requested checklist/progress updates within this exception. Frontmatter, metadata, and customization markers are preserved.
- Synchronized both skill references, README, architecture, philosophy, contributor invariants, and component responsibilities. Kept MCP 12, artifact skill 4, and Work Session skill 1 for the same unreleased development cycle. Installed integrations and global user artifacts were not modified.
- Validation: typecheck, production build, and full suite passed (54 files, 757 passed, 3 skipped); focused lifecycle/skill tests passed (121 passed, 1 skipped). Both skill audits passed without warnings. The Python skill validator could not run because PyYAML is absent; equivalent frontmatter/name/placeholder/reference checks passed using local js-yaml.
- Runtime boundary: subprocess tests exercised the rebuilt MCP through two non-waiting updates, Extension Store reloads, and later review. Real agent continuation and Extension Host UI were not exercised; this chat's loaded integration still exposes the pre-change tool schema without `noWait`.

## 2026-11-08 — Rename MCP server entrypoint to remove obsolete -v4 suffix

- Renamed `src/integration/artifact-review-mcp-v4.ts` to `src/integration/artifact-review-mcp.ts` to reflect the active schema-v6 and numeric MCP version 12 architecture without misleading version-specific source suffixes.
- Updated the `build:integration` esbuild script in `package.json`, the literal source verification in `test/artifact-link-contract.test.ts`, and component ownership documentation across `docs/INSTRUCTION.md` and `docs/COMPONENTS.md`.
- No runtime behavior, bundled output path (`dist/integration/codex-artifacts-review-mcp.mjs`), installed managed runtime path (`~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs`), or MCP protocol contracts were changed.

## 2026-11-08 — Agent-directed Session layout organization

- Allowed the Work Session skill to move and reorder existing Session artifacts by directly editing `layout.json` when the user requests organization. Replaced the blanket layout-edit prohibition while retaining the boundaries for Session metadata, membership files, and managed artifact lifecycle files.
- Documented deriving the exact layout location from the returned `instructionsPath`, current-layout reads, schema-v1 zone arrays, preservation of unrelated placement, missing-layout initialization from a fresh catalog, and a Join-only refresh after saving. No MCP response fields, tools, runtime code, or storage schemas changed.
- Kept membership authoritative, Session recency unchanged by layout edits, and local Archived placement separate from global Archive state. User and agent writes use last-write-wins without conflict handling.
- Synchronized the Session skill reference, existing skill wording assertion, architecture, and contributor instructions. Kept Work Session skill version 1 for the same unreleased 1.2.0 development cycle; installed global skills and user Session files were not modified.
- Validation: 11 focused skill/context tests passed; the Codex skill audit passed with zero warnings, and local frontmatter/reference checks passed. The skill-creator validator could not run because PyYAML is absent. No live AI-client layout-edit behavior was tested.

## 2026-11-08 — Normalize the first Work Session skill release to version 1

- Set `WORK_SESSION_SKILL_VERSION` to 1 and synchronized its contract assertion plus current README, architecture, philosophy, and release notes in the working plan. Work Session skill versions 2/3 were development-only values, not published releases; earlier entries remain historical records.
- Follow the release-based versioning rule in `AGENTS.md`: use the release changelog as the released baseline and keep one asset version throughout an unreleased development cycle. MCP remains 12 and the artifact skill remains 4 for the planned extension 1.2.0 release; the package version bump is deferred.
- Existing receipt comparison remains unchanged: absent/invalid Session skill versions require installation, version 1 is current, and development receipts at 2/3 require reinstalling the matching version 1 assets. No installed receipts, global skill files, MCP runtime behavior, or file-dialog/editor URI behavior were changed.
- Validation after normalization: typecheck, production build, and the full test suite passed (52 files, 711 passed, 3 skipped). This is automated verification, not live AI-client installation evidence.

## 2026-11-08 — Session skill freshness and canonical documentation corrections

- Clarified approved Session skill precedence: latest/recent/current-content/overview requests refresh the catalog before artifact selection even when an older exact path is known; reuse fresh context already returned for the same request. Otherwise known exact artifacts are read directly from their current Markdown paths.
- Successful non-null Session results replace the active catalog instead of merging snapshots; retained artifact review handles remain separate. Updated the Session reference and existing wording checks together. No new tool, background watcher, or conflict-handling mechanism was introduced.
- Incremented only `WORK_SESSION_SKILL_VERSION` from 2 to 3 so installed Session skills can be detected as stale. MCP remains 12; the artifact skill remains 4. Synchronized current version descriptions in README and canonical docs; earlier entries and frozen planning payloads remain historical records.
- Corrected current docs for two-skill ownership, standalone/default/New arguments and success-only recovery, Instructions Markdown storage, lock-free Session writes, explicit migration, preservation of empty v2 Sessions, window routing without manifest workspace ownership, and per-skill/per-target receipts/customization boundaries.
- Replaced obsolete conversation drawer/New-Join prompt instructions with direct artifact Inspect and Start/Sessions navigation. Removed the provider-wide FIFO claim. Corrected Proceed by kind and Save without `nextAction` to match current runtime contracts.
- This entry covers the approved skill improvements and documentation audit corrections. Concurrent Phase 5 implementation is outside this change; these documentation corrections do not claim its completion or runtime validation.
- Validation: typecheck and build passed; 113 focused tests passed; the final full-suite run passed 702 tests with 3 skipped. The first full run had one waiter-deletion failure that passed in isolation and in the full rerun; no unrelated runtime fix was made. Session skill audit passed with zero warnings, and Markdown link/fence checks passed. The Python skill validator could not run because PyYAML is absent; no real AI-client behavior validation is claimed.

## 2026-11-08 — Phase 4.5 Stage 3 implementation: Two-skill installer, independent version receipts & cleanup

- Extended Base Integration installer (`src/extension/workspace-integration.ts`): deploys both `skills/create-review-artifact` and `skills/work-session` to `.agents/skills/`; validates all packaged assets before replacing targets.
- Enforced customization boundaries: `create-review-artifact` preserves user customizations (`description:` and `USER CUSTOM RULES`) via `replaceSkillDirectory`; `work-session` installs official assets atomically via `replaceOfficialSkillDirectory` without customization merge.
- Added Claude integration support for two skills (`src/extension/mcp-clients/claude-client.ts`): deploys and verifies both skills under `.claude/skills/`, ensuring relative sibling links resolve correctly.
- Implemented independent version receipts: records `skills` (version 4) and `sessionSkills` (version 2) independently per target (`agents` and `claude`) in `~/.ai-artifacts/managed/integration-version.json`.
- Enhanced upgrade notification (`src/extension/upgrade-notification.ts`, `src/extension/extension.ts`): detects stale `sessionSkills` independently from `skills` and MCP runtime when upgrading from older installations; alerts user to run installer.
- Enhanced verification report (`src/extension/integration-verification.ts`, `src/extension/workspace-integration.ts`): reports separate status for "Review skill" and "Work session skill", providing granular error details when base assets are missing or outdated.
- Synchronized canonical docs and release contract (`README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `test/release-contract.test.ts`): normalized version constants (`MCP_VERSION = 12`, `SKILL_VERSION = 4`, `WORK_SESSION_SKILL_VERSION = 2`), removed legacy `ArtifactConnectDialog` references, documented 6 MCP lifecycle tools (including `join_session`), and verified release contract assertions.
- Updated cleanup routine (`src/extension/mcp-clients/base-cleanup.ts`): uninstalls both `create-review-artifact` and `work-session` across `.agents/skills/` and `.claude/skills/` without touching unrelated user skills or review data.
- Updated integration verification and test suites (`test/workspace-integration.test.ts`, `test/mcp-client-drivers.test.ts`, `test/upgrade-notification.test.ts`, `test/integration-verification.test.ts`, `test/release-contract.test.ts`): validated full lifecycle installation, partial install state handling, and clean uninstallation.

## 2026-11-08 — Phase 4.5 Stage 2 implementation: Start Work Session, direct Inspect, two skills split & webview tests

- Implemented `startWorkSession` flow (`src/extension/artifact-review-provider.ts`, `src/webview/ReviewApp.tsx`): enables promoting standalone artifacts into a multi-artifact Work Session; prompts native input box prefilled with artifact title, creates session, registers artifact into Working zone, copies 3-line session connect prompt to clipboard, opens Session Manager tab, and safely rolls back newly created session on failure.
- Streamlined direct Inspect flow: removed `ArtifactConnectDialog.tsx` modal; clicking `Inspect artifact` directly copies exact 2-line inspect prompt template from `src/shared/artifact-connect-prompt.ts`.
- Enhanced Review App toolbar to handle 4 session states: unsupported MCP (< 12) disabled, loading disabled, zero sessions rendering "Start a work session" button with helper text, and 1+ sessions rendering "Sessions" toggle with count badge.
- Packaged frozen skill assets: split into two independent skills — standalone review lifecycle `skills/create-review-artifact/` (skill version 4) and multi-agent coordination `skills/work-session/` (session skill version 2), matching 100% SHA-256 LF hashes from `phase-4.5-wording/manifest.json`.
- Added Webview component test suite (`test/review-app.test.tsx`) asserting loading state, 4 toolbar session states, direct inspect button copied feedback, and absence of modal dialogs.
- Fixed `tsconfig.json` `include` list to add `"test/**/*.tsx"`, ensuring all React webview test suites are strictly typechecked by `npm run check`.
- Updated dev sandbox harness (`dev/main.tsx`) to mock `startWorkSession` and 2-line `copyArtifactConnectPrompt`.
- Synchronized package branding in `package.json` and `README.md` (`displayName`, 274-character description preserving all supported AI clients, Contents sub-navigation).

## 2026-11-08 — Phase 5 implementation: List Management, Archiving, Grid, Edit Metadata, Export & Cleanup

- Implemented Chặng 1 & 2: schema v1 UI state (`artifact-ui-state.json`, `session-ui-state.json`) with atomic read/write; single-artifact deletion coordinator and session deletion preserving artifacts; context menus for Recent Artifacts and Sessions views; Pin/Archive sorting; Search Archived in Quick Pick; Restore-only header for archived artifacts and sessions; and automatic cleanup of sessions archived for >= 30 days during extension activation.
- Hardened Chặng 1 & 2 findings (F1–F6 & 2 Lows): pre-validation of metadata schema v2 and exact ID in `deleteSession`; retention skips corrupt sessions; tree item normalizer for right-click context menus; reducer-backed `restoringSession` reset on error/patch; deletion commit point at staging rename; canonical root parent and regular file checks preventing symlink traverse; terminal deleted state message on ENOENT; scoped `artifactUiState` watcher events; diagnostic warnings replacing silent swallows.
- Implemented Chặng 3:
  - Responsive container-query grid layout for Working zone (1 col < 800px; 2 cols 800-1099px closed / 1 col open; 3 cols 1100px+ closed / 2 cols open) and fixed 2-column grid for side panel References/Archived zones.
  - In-session search input and kind filter selector across all zones; distinct kinds dynamically computed; helper texts for Working, References, Archived, and Instructions blocks.
  - Two-line description snippet rendered on artifact cards from Markdown plain text.
  - ReviewApp header order (`ROUND {round} · {kind}`) with native inline edit pencil buttons for renaming and changing artifact type (fixed kinds + discovered open kinds + Create new type with lowercase hyphenated validation); hidden when globally archived.
  - MCP review submission processing re-reads latest on-disk manifest to immediately reflect dynamic kind updates in `nextAction` (`execute-approved-plan` for plans vs `approved` for non-plans) across both wait flows.
  - Work Session ZIP export via `yazl`: exports root `Instructions.md` and numbered artifact Markdown files in `Working/`, `References/`, and `Archived/` folders to user-selected archive.
- Added comprehensive test suites: `test/work-session-export.test.ts`, `test/artifact-metadata-command.test.ts`, `test/session-app.test.tsx` (cards/grid/filter), `test/artifact-store.test.ts` (`updateMetadata`), and `test/review-wait-mcp.test.ts` (dynamic kind re-read during wait).

## 2026-11-08 — Phase 5 artifact metadata editing plan

- Extended Phase 5 Step 6 / Stage 3 with Review App header order (`ROUND` before type), native rename and type selection, and creation of open kinds using the existing artifact kind schema. No separate type registry is planned.
- Specified extension-owned patches limited to artifact `title` and `kind`, atomic writes with last-write-wins, unchanged `updatedAt`/review round/Markdown/comments/memberships, scoped metadata updates, and hidden edit controls in the globally archived header.
- Added the accompanying MCP result change: re-read and validate the same artifact/round manifest when processing a submission, using its current kind for both the returned kind and existing Proceed action policy across both wait flows. No new submission field, waiter restart, ownership change, or replay of historical approval.
- Detailed affected files, picker wording, implementation sequence, regression checks, and completion criteria; synchronized the main roadmap and notes. Planning-only update: no source implementation, runtime/global-data changes, or feature test results claimed. MCP Resources/Composer Mentions remain outside this addition.

## 2026-11-08 — Phase 4.5 Stage 2 README and branding specification

- Added `plans/work-session-artifact/phase-4.5-wording/readme-branding.md` with approved verbatim display name, package description retaining supported clients, README introduction, Work Session GIF caption, and Features & Usage contents structure.
- Scheduled this documentation/metadata work in Stage 2 after its UI/skill steps; Stage 3 retains final installer/version documentation verification. Existing skill payloads and hashes are unchanged.
- Recorded Stage 1 completion as owner-confirmed; no implementation review, tests, runtime validation, README/package edits, or GIF creation was performed in this planning update.

## 2026-11-07 — Phase 4.5 implementation guide and frozen skill wording

- Added `plans/work-session-artifact/plan-phase-4.5.md`: six steps in three stages for standalone artifacts, explicit Session creation/reuse, direct artifact Inspect, Start Session with open/copy, separate skills, independent version receipts, and validation. Phase 5 remains separate and follows the 4.5 baseline.
- Added six complete proposed skill assets under `phase-4.5-wording/`, an exact embedded-agent/UI text payload, and a normalized SHA-256 manifest. Future implementation must copy this wording rather than paraphrase it; supported installed artifact customization remains the sole exception.
- Scoped artifact editorial changes to the previously reviewed deduplication/reorganization. Session extraction and standalone semantics are listed separately from behavior-preserving editorial work. Review/feedback/token/Proceed/reconnect rules remain protected.
- Planned artifact skill version 7 and Work Session skill version 1, with independent per-target receipts. Existing artifact customization is retained; Session skill uses official assets without customization or a generalized customization framework. MCP stays at the reserved unreleased version 12.
- Updated the main roadmap, notes, the Phase 4 successor notice, and Phase 5 dependency. Documentation/wording proposals only; no application source, live integrations, runtime or global data was changed, and no implementation feature tests are claimed by this entry.
- Planning validation: both skill audits passed with zero warnings; seven frozen-content hashes, three unchanged live skill baselines, sixty relative links and twenty-three verbatim protected artifact clauses passed local checks. The Python skill validator could not run because PyYAML is absent; equivalent structural checks passed, without claiming that validator passed. Diff/whitespace checks passed; runtime/AI client behavior remains unverified.

## 2026-11-07 — Phase 4 Stage 3 implementation & review hardening: Instructions UI, Connect manager, native kind filters, Skill v6 bump and docs

- Implemented Instructions UI integration in Session Manager (`src/webview/SessionApp.tsx`): added "Open Markdown File" button to open `instructions.md` in external editor, scoped event synchronizer to handle instructions updates, and error banner dismiss.
- Added session connect prompt generator (`src/shared/session-connect-prompt.ts`) and "Connect" button in Session header: styled with synchronized chain link SVG icon, copying a single-call `join_session(sessionId)` directive for AI assistants.
- Added 8px left margin to the `＋` Add Artifact button next to `Working` in Session Manager.
- Hardened `openSessionInstructionsFile` in `src/extension/work-session-provider.ts`: injected safe `openTextDocument` using VS Code `showTextDocument` directly instead of `ArtifactReviewOpenCoordinator.open` (which rejected non-artifact Markdown files), adding session verification, symlink check, and atomic file creation `{ flag: "wx", mode: 0o600 }`.
- Decoupled session creation from document opening in `src/extension/session-create-command.ts`: failure to open the newly created session editor warns the user but returns the created `sessionId`.
- Enhanced `agentPlus.addSessionArtifact` in `src/extension/session-artifact-add-command.ts`: formatted kind labels in quick pick item descriptions, enabled dynamic query filtering with `alwaysShow: true`, and added pre-addition validation with `validateArtifactReviewTarget`.
- Hardened Recent Artifacts kind filtering in `src/extension/artifact-kind-filter-command.ts`: exported `ArtifactKindFilter` and type guard `isArtifactKindFilter` to validate filter inputs before propagation.
- Updated Codex MCP config (`src/extension/mcp-config.ts`): registered `[mcp_servers.ai_artifacts.tools.join_session]` in tool definitions and added `join_session` to `requiredTools`.
- Aligned `buildArtifactConnectPrompt` for new sessions (`src/shared/artifact-connect-prompt.ts`): prompts agent to call `inspect_artifact_review` with `takeover: true`, omits prior `artifactConversationId`, and instructs updating active session with returned `session.sessionId`.
- Skill contract updates (`skills/create-review-artifact/SKILL.md` & `references/artifact-contract.md`): declared `CONVERSATION_NOT_FOUND` as non-retryable, specified response normalization across entry tools, distinguished fresh execution directives from historical saved submissions, removed deprecated `instructions` field from schema-v2 metadata docs, and restored explicit `` `kind: "implementation-plan"` `` while retaining flexible fixed/open kinds.
- Unified artifact kind formatting: replaced raw slug display across `ReviewApp`, `SessionApp`, sidebar items, and search quick pick with `formatArtifactKindLabel`.
- Added native kind filter to Recent Artifacts tree view (`agentPlus.filterRecentArtifacts` in `src/extension/artifact-kind-filter-command.ts`): provides All Types, 10 fixed kinds, and Other, applying filter before recency sort and 20 cap; propagated active filter to `agentPlus.searchArtifact`.
- Switched Recent Artifacts view to `vscode.window.createTreeView` to dynamically render active filter indicator in view description (`Type: <Label>`).
- Audited and updated all product-owned UI wording, titles, tooltips, and aria-labels to English across Review App, Session Manager, Connect dialog, Tree Views, and Quick Picks.
- Incremented numeric `SKILL_VERSION` from 5 to 6 in `src/shared/contracts.ts` (keeping `MCP_VERSION = 12`); appended official Skill v6 description to `OFFICIAL_SKILL_DESCRIPTIONS` in `src/extension/mcp-clients/skill-helper.ts`.
- Synchronized canonical documentation (`README.md`, `docs/INSTRUCTION.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`) and updated release contract assertions in `test/release-contract.test.ts`.

## 2026-11-07 — Phase 4 Stage 2 implementation: join_session, inspect core, session context & proceed directives

- Implemented MCP tool 6 `join_session` (`src/integration/artifact-review-mcp-v4.ts`): supports join-only (returning `{ session: SessionContext }` read-only without touching waiters or seeding `session-types.json`) and join+artifact (returning `{ session, inspection }` in a single tool call sharing `executeInspectCore`).
- Extracted shared `executeInspectCore`: unified entry orchestration for `inspect_artifact_review` and `join_session`, including exact artifact handles, preflights, window routing, and selective takeover.
- Wrapped `readArtifactConnection` and session context resolution in the session/membership rollback boundary before connection commit, ensuring atomic cleanup on failure.
- Deferred in-memory token grants (`grantInspectedRound`) to after successful session commit, context resolution, and connection read, preventing token leaks on mid-flight failures.
- Enforced strict `join_session` input parsing: `takeover` must be a boolean; rejected `connection` when `intent !== "reconnect"` with `INVALID_ARTIFACT_INPUT`.
- Standardized review proceed directives: `isPlanProceedKind` emits `{ type: "execute-approved-plan", instruction: "Execute the approved plan immediately in this same turn..." }` for `plan` and `implementation-plan`; emits `{ type: "approved", instruction: "The user has approved this artifact. Acknowledge the approval and conclude the review. Do not automatically implement code or start another review round." }` for all non-plan kinds (`idea`, `checklist`, `spec`, `workaround`, etc.).
- Kept numeric `MCP_VERSION = 12` and deferred client driver/installer updates to Stage 3.
- Added comprehensive regression tests in `test/mcp-join-session.test.ts` (14/14 tests passed) and `test/session-type-registry.test.ts` (7/7 tests passed).
- Validation: full test suite passed (44 files, 626 passed, 3 skipped), `npm run check` clean, and all build bundles cleanly generated.

## 2026-11-07 — Detailed Phase 5 guide and confirmed UI/cleanup decisions

- Added `plans/work-session-artifact/plan-phase-5.md`: eight implementation steps in three reviewable stages covering separate UI state, shared deletion primitives, sidebar menus/search, Archived/Restore headers, archived Session cleanup, grid/cards/filter/helper text, human-readable ZIP export, and validation.
- Replaced the masonry proposal with ordered row-flow grid: Working uses 3/2/1 columns with the panel closed and 2/1/1 with it open; References/Archived remain two columns. Recorded modest equal side-panel padding and reuse of existing array-based menu ordering.
- Confirmed Archived editors hide other header actions and show a primary Restore button; Module is added only to the fresh types seed, without backfilling existing files or changing Conversation as the default assignment.
- Verified retention already calls `cleanupStaleConversations` to prune stale memberships/layout while preserving empty v2 Sessions. Planned reuse of that scanner and extraction of single-target deletion, keeping expiry selection in retention and reference cleanup best-effort.
- Synchronized the main roadmap, notes and the Phase 4 out-of-scope reference. Documentation only: no implementation, installed runtime, global data or Phase 4 progress was changed. No automated feature tests or Extension Host validation were run for this planning update.

## 2026-11-07 — Refined Phase 4 Stage 2–3 guide after source review

- Reviewed current MCP entry/commit/recovery paths, shared context/type lookup, provider events, existing prompt/skill assumptions and recent manager UI edits without changing application code.
- Added review checkpoints within the existing seven steps: mechanical inspect extraction before Join, frozen flat/nested response shapes, context resolution inside existing rollback boundaries before connection commits, entry-aware recovery and read-only context type lookup. These are pending implementation guidance, not claims that Join now exists.
- Detailed mixed Instructions event handling, typed host actions, prompt routing, manual Session/artifact Add flows, kind filter propagation from View all to Search, and skill normalization/fresh-decision handling while preserving user-owned chip/layout changes.
- Kept MCP 12, Stage 1 progress and all Phase 5 work separate. No ownership/transaction framework, locks, conflict handling or new migration was added to scope.
- Baseline verification: 8 existing test suites passed (145 tests passed, 1 skipped); no new runtime, Extension Host or AI client validation. Updated only `plans/work-session-artifact/plan-phase-4.md`, `plan.md`, `note.md`, and this documentation log; the user's separate Stage 1 review remains unchanged.

## 2026-11-07 — Phase 4 Stage 1 correction: MCP 12 and readable legacy Session metadata

- Restored numeric MCP_VERSION and the installed Work Session gate from the internal development bump 13 to the reserved, unreleased feature version 12. Provider/sidebar messages, assertions and gate fixtures now use 12, with 11 as the unsupported version. Skill remains 5; its planned update is separate.
- Kept strict Session v2 metadata validation while accepting an optional legacy `instructions` string, including empty and non-empty values. Existing Sessions are no longer rejected solely because that known field is present; unknown fields and invalid types remain invalid.
- Effective Instructions still come only from `instructions.md` (empty if missing). Reads/listing neither migrate nor rewrite legacy metadata. New metadata writes omit inline instructions; Instructions-only saves leave metadata untouched. No fallback, dual-write or global user-data conversion was added.
- Added isolated regression coverage for legacy metadata listing, absent Markdown, Markdown precedence, read-only behavior, and title/type writers omitting the old field while preserving Markdown and recency. Initial focused validation: 5 files / 93 tests passed. Final validation results are recorded in the Phase 4 correction checkpoint.
- Final correction validation: typecheck and all build targets passed; full test suite passed (43 files, 611 tests passed, 3 skipped). The release-contract check remains intact; historical versioned release notes were not changed. No real installed runtime, global Session data or Extension Host UI was modified or validated by these checks.
- Updated current README/architecture/project instructions/philosophy and roadmap/notes. The prior Stage 1 completion remains recorded; the correction does not implement Stage 2/3 or modify the user's separate review findings. Historical release notes and earlier planning records remain history; this entry supersedes their planned MCP 13 target and rejection of inline metadata.

## 2026-11-07 — Place Session Add actions in Phase 4 and More/Export in Phase 5

- Assigned manual empty Session creation from the Sessions view title and existing-artifact selection from Working to Phase 4 Step 5/Stage 3, reusing completed Stage 1 storage and membership APIs. This supersedes the earlier no-manual-Session restriction without reopening Stage 1.
- Kept manager More → Export ZIP/Archive/Delete in Phase 5, following the original phase allocation. The agreed human-readable ZIP layout does not add export work to Phase 4.
- Synchronized stale plan headers/notes with the recorded completion of Phase 4 Stage 1. MCP 13 exists in source; Skill remains 5 pending the planned bump to 6. No new tests or runtime validation are claimed by this documentation edit.
- Updated `plans/work-session-artifact/plan-phase-4.md`, `plan.md`, and `note.md`; no application code or user-owned review notes were modified.

## 2026-11-07 — Human-readable Session ZIP export format

- Recorded the agreed export format: a Session-title root folder, `Instructions.md`, and Working/References/Archived folders containing all artifact Markdown files, numbered in each zone's layout order and named from artifact titles with valid filesystem characters.
- Export preserves Markdown contents and excludes metadata JSON, memberships, lifecycle manifests, comments/submissions/review state and artifact IDs in filenames. This is a document package for human readers, with no lifecycle import/restore requirement or state/recency mutation.
- Planning only; updated `plans/work-session-artifact/plan.md` and `plans/work-session-artifact/note.md`. No application code or in-progress implementation was modified by this update.

## 2026-11-07 — Detailed Phase 4 implementation guide

- Extended planned Step 5 to audit all app, dialog, Tree View and native UI wording for remaining product-owned Vietnamese strings and convert them to English while preserving user-authored titles, types and content. Confirmed remaining strings in ArtifactConnectDialog, ReviewApp Session tooltips and Recent Artifacts sidebar states.
- Corrected planned Connect descriptions: New starts a work session from the same artifact; Join inspects it and continues one of its existing Sessions with that Session's full metadata/Instructions/catalog context. This does not transfer another AI chat transcript or merely link an artifact. Wording changes are planned with Phase 4 Connect implementation, not shipped by this documentation edit.
- Added `plans/work-session-artifact/plan-phase-4.md` with seven pending steps in three reviewable stages: Instructions/shared context and kinds; MCP Join and Proceed contracts; UI Connect/filter, skill and validation. This is planning only, with no application code or installed asset changes.
- Specified the final unpublished Session v2 format: metadata without inline instructions, a primary `instructions.md` file, raw Markdown textarea/Save/Open, and direct producer/consumer/fixture updates. Superseded the earlier inline-JSON fallback proposal; no runtime fallback, dual-write, schema v3 or read-time migration is planned.
- Defined a new `join_session` tool for Session-only context or optional artifact inspection through the shared inspect core in one call. Create/inspect also return context; catalog paths support selective filesystem reads without reference takeover or replaying prior approval.
- Recorded ten fixed artifact kinds plus open kinds, common labels, Recent All Types/fixed/Other filtering, execute-approved-plan for the two plan kinds, and approved for all other kinds while preserving complete feedback comments.
- Planned MCP 13 / Skill 6 from the verified source baseline 12 / 5, preserving artifact schema 6, Session schema 2 and installed-file checks. Those target versions are not yet implemented.
- Synchronized the roadmap and notes; Phase 5 UI organization and lifecycle controls remain separate. Validation of this documentation update is limited to document consistency, local links and diff checks, not runtime or implementation test results.

## 2026-11-07 — Planned Phase 5 sidebar menus, Pin/Archive and archived Session cleanup

- Assigned Recent Artifacts and Sessions item context menus, Pin/Unpin, Archive, Delete, and Search-to-editor Restore to Phase 5. Default-list context menus omit Restore because archived items are hidden there. Reuse the Phase 4 Connect and Instructions actions.
- Planned full sidebar item tooltips: artifact title plus kind label for Recent Artifacts, Session title plus Session type label for Sessions. Tooltip values are not truncated when the visible tree row is shortened.
- Search Artifacts and Search Sessions include existing archived items with an Archived description label. Opening a result does not restore it or reset cleanup eligibility. Archived artifacts show Restore in Review App; archived Sessions show Restore in Session Manager. Restore clears `archivedAt`, preserves pin state, and refreshes sidebar visibility under the current filter. No Restore button in Quick Pick or separate Archived management page is required.
- Planned extension-owned `artifact-ui-state.json` and `session-ui-state.json` beside their respective entities, with independent schema version 1, optional `pinned` (default false), and optional `archivedAt`. These do not modify strict MCP artifact/session metadata or require a MCP/schema bump solely for UI state.
- Pinned items sort first within the existing list limits; archive hides items regardless of pin state without changing membership, layout, or recency. Global artifact archive is separate from a Session's Archived layout zone.
- Planned activation-time deletion of Sessions archived for at least 30 days, measured from `archivedAt`; pin does not exempt cleanup. Deleting a Session removes only its own data and memberships, never the shared artifacts. Other Session cleanup policies remain deferred.
- Artifact Delete is global and removes referencing memberships/layout entries. Existing artifact retention remains based on manifest `updatedAt` and its configured retention period, with no pin/archive exemption.
- Planning only; no runtime changes. Affected files: `plans/work-session-artifact/plan.md` and `plans/work-session-artifact/note.md`.

## 2026-11-07 — Planned Instructions Markdown storage and Phase 5 helper text

- Recorded the Phase 4 decision to use a real `instructions.md` file as the primary instructions source, with the existing textarea and an Open Markdown file action. The agent context/skill should point to that file rather than instruct agents to edit session metadata. This storage change is planned, not implemented.
- Deferred fixed UI helper text for Working, References, Archived, and Instructions to Phase 5. Instructions describe rules, workflows, and other guidance for AI in the session; artifact descriptions for the Phase 4 catalog remain separate.
- Recorded the legacy inline-JSON fallback/migration approach as a proposal awaiting the detailed Phase 4 plan, not a committed schema change.
- Affected planning files: `plans/work-session-artifact/plan.md` and `plans/work-session-artifact/note.md`.

## 2026-11-07 — Work Session roadmap scope and upgrade guidance

- Extended the Phase 3 plan with a pending Step 7 in Stage 3 for the active Session contract: each AI chat keeps at most one default Session; explicit New/Join replaces that default after success. Preserved the recorded completion and validation of Steps 1–6; no skill/runtime change is shipped by this documentation update.
- Removed drag-and-drop and dnd-kit implementation requirements from the roadmap. Retained native Quick Pick type selection, Input Box title editing, textarea + Save instructions, and menu-based artifact move/reorder as the accepted interaction model.
- Removed the obsolete Phase 1+2 requirement to render session instructions through the artifact Markdown renderer.
- Added a short apology and explanation to README upgrade guidance for releases that require MCP or skill updates, preserving the existing rule that extension-only updates do not require integration reinstall.
- Affected files: `README.md`, `plans/work-session-artifact/plan.md`, `plan-phase-3.md`, `plan-phase-1-2.md`, `analyzed.md`, and `ideas.md`. Historical chat transcripts remain reference material.

## 2026-11-07 — Work Session Phase 3 Implementation (Session Manager, Scoped Refresh, Sidebar Filter/Search & English Quick Input)

### Changes

- **Scoped Change Pipeline & Partial Webview Refresh**:
  - Extended `ConversationArtifactService` (`src/extension/conversation-artifact-service.ts`) with typed `WorkSessionDataChange` batches (`metadata`, `membership`, `layout`, `artifact`, `types`, `support`), URI classification ignoring temporary/backup files, and deduplicated debounce scheduling.
  - Updated `WorkSessionProvider`, `ArtifactReviewProvider`, `RecentArtifactsTreeDataProvider`, and `WorkSessionsTreeDataProvider` to subscribe to scoped changes so unrelated updates never trigger full reloads or overwrite in-progress user input.
  - Added `workSessionSummaryPatch`, `workSessionArtifactsPatch`, and `workSessionInstructionsPatch` messages in `src/shared/contracts.ts`. `WorkSessionProvider` tracks `lastPersistedInstructions` per open session and emits `workSessionInstructionsPatch` only when `instructions` in `conversation.json` changes on disk (supporting external/AI edits to session instructions while ignoring title/type-only metadata writes and own-save echo events).
- **Active Session Contract & Skill v5 Bump (Step 7)**:
  - Standardized AI chat session tracking: each chat conversation maintains at most one active Work Session (`artifactConversationId`) in memory; default reuse continues unless the user explicitly requests New Session or Join Session.
  - Enforced success-only replacement: active session ID is updated only after lifecycle tool calls succeed; failures never cause unintended fallback or premature context switching.
  - Changing active session preserves all per-artifact handle mappings (`artifactDirectory -> { reviewRound, windowInstanceId }`); an artifact may belong to multiple Work Sessions concurrently.
  - Prompts in `artifact-connect-prompt.ts` updated to explicitly instruct agents on success-only replacement for `new` and `join` modes.
  - Bumped numeric `SKILL_VERSION` from 4 to 5 (keeping `MCP_VERSION = 12`).
- **Two-Column Work Session Manager (`SessionApp.tsx` & `WorkSessionProvider`)**:
  - Upgraded the `agentPlus.workSession` tab into an interactive manager while keeping `CustomReadonlyEditorProvider` and existing document URIs.
  - Main column renders the `Working` artifact zone (expanding when the side panel is collapsed); collapsible side panel renders `Session Type` → `Instructions` (fixed-height Markdown textarea with explicit **Save**) → `References` → `Archived`.
  - Per-session side panel expanded/collapsed preference is stored in extension `globalState` (`workSessions.panelExpanded.<sessionId>`, default `true`).
  - Added host-validated manager actions (`renameSession`, `saveSessionInstructions`, `selectSessionType` with quick type creation, `moveArtifact`, `reorderArtifact`, `removeArtifact`, `setSessionPanelExpanded`), gated on installed MCP version >= 12, with inline error reporting (`instructionsError` and dismissible `actionError` banner).
- **Sidebar Filter & Search Sessions**:
  - Registered `agentPlus.sessions` via `vscode.window.createTreeView` to display active filter indicators (`Type: <Label>`) on the view header description.
  - Added `AI Artifacts: Filter Sessions` (`agentPlus.filterSessions` in `src/extension/session-filter-command.ts`) to filter the Sessions tree view in-memory per window by a single session type or `All Types`, preselecting the active item and automatically resetting if the filtered type is deleted.
  - Added `AI Artifacts: Search Sessions` (`agentPlus.searchSessions` in `src/extension/session-search-command.ts`) to search across all v2 Work Sessions by normalized title (case- and diacritic-insensitive, `alwaysShow: true`, title-only matching) independent of the active sidebar filter.
- **Unified English Quick Input Wording & Stable Button Identity**:
  - Standardized all Session Quick Input titles, placeholders, confirmations, and notifications across `session-type-command.ts`, `session-filter-command.ts`, `session-search-command.ts`, `session-migration-command.ts`, `artifact-review-provider.ts`, and `extension.ts` in English while preserving user-provided session titles, instructions, and type labels.
  - Replaced tooltip-based button detection in `session-type-command.ts` with typed `SessionTypeActionButton` (`actionId: "rename" | "delete"`).

### Rationale

- Turns the read-only session viewer into a complete Work Session Manager without introducing a second editor tab or custom save/lock machinery.
- Scoped refresh events and `lastPersistedInstructions` comparison allow users to type session instructions without background artifact/membership/metadata updates clobbering their draft, while still receiving external instructions updates written to `conversation.json`.
- Native Quick Pick filter and search on the Sessions sidebar scale navigation across growing session lists while keeping all Session Quick Input flows consistent in English.

### Affected components or files

- Shared Contracts: `src/shared/contracts.ts`.
- Extension Host: `src/extension/conversation-artifact-service.ts`, `src/extension/work-session-provider.ts`, `src/extension/work-session-sidebar.ts`, `src/extension/session-type-command.ts`, `src/extension/session-filter-command.ts`, `src/extension/session-search-command.ts`, `src/extension/session-migration-command.ts`, `src/extension/artifact-review-provider.ts`, `src/extension/extension.ts`, `package.json`.
- Webview: `src/webview/SessionApp.tsx`, `src/webview/styles.css`.
- Documentation: `README.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `docs/CHANGE_LOGS.md`, `plans/work-session-artifact/plan-phase-3.md`.
- Tests: `test/artifact-contracts.test.ts`, `test/conversation-artifact-service.test.ts`, `test/work-session-provider.test.ts`, `test/session-app.test.tsx`, `test/work-session-sidebar.test.ts`, `test/session-type-command.test.ts`, `test/session-filter-command.test.ts`, `test/session-search-command.test.ts`, `test/session-migration-command.test.ts`, `test/artifact-review-provider.test.ts`, `test/release-contract.test.ts`.

## 2026-11-07 — Fix AI Artifacts Activity Bar registration

- Changed the container ID and its `contributes.views` key to `agentPlus-artifacts`; VS Code rejects dots in container IDs and otherwise falls back to placing the views in Explorer.
- Preserved the `AI Artifacts` title and the two existing Tree View IDs. Switched the Activity Bar icon from `layers` to the built-in `library` Codicon at the owner's request. Added a release-contract regression check for the container ID, view bindings, and icon selection.
- Synchronized the container ID in component documentation and the Phase 1+2 plan.

## 2026-11-07 — Work Session Phase 1+2 Implementation (Model v2, Sidebar Navigation, Connect Dialog & Migration)

### Changes

- **Work Session Schema v2 & Storage Architecture**:
  - Upgraded conversation registry to schema v2 (`WORK_SESSION_SCHEMA_VERSION = 2`), recording `sessionId`, `title`, `instructions` (Markdown string), `typeId`, and `createdAt` in `conversation.json`.
  - Separated layout into `layout.json` (`WORK_SESSION_LAYOUT_SCHEMA_VERSION = 1`) managing artifact ordering across three zones: `working`, `references`, and `archived`. Reconciled unassigned registered artifacts to the end of `working`.
  - Eliminated `.conversation.lock` and all file locks in favor of atomic writes (`writeAtomicJsonFile`) with last-write-wins semantics.
  - Dynamic `updatedAt`: computed on read from `max(createdAt, ...registeredAt)` across `registered-artifacts/<artifactId>.json`, preserving automatic recency sorting without metadata churn.
  - Global Session Types: stored in `~/.ai-artifacts/session-types.json` (`SESSION_TYPES_SCHEMA_VERSION = 1`) with seed defaults (`conversation`, `project`, `feature`, `fix`). Supported CRUD operations with case-insensitive uniqueness and safe re-assignment to default when deleting custom types in use.
  - Retention Cleanup: preserved empty v2 Work Sessions during periodic activation cleanup while pruning expired artifacts and legacy v1 entries.
- **MCP v12 Server & Skill v4 Fail-Closed Contract**:
  - Updated MCP server (`artifact-review-mcp-v4.ts`) to numeric `MCP_VERSION = 12` and skill to `SKILL_VERSION = 4`.
  - Implemented fail-closed preflight for both `create_artifact` and `inspect_artifact_review`: calls specifying a legacy v1 conversation ID immediately throw `ConversationMigrationRequiredError` with code `CONVERSATION_MIGRATION_REQUIRED` before mutating state or granting tokens.
  - Updated `create-review-artifact` skill to guide the AI to either advise the user to migrate the conversation or create a new Work Session.
- **Activity Bar "AI Artifacts" Sidebar**:
  - Contributed `agentPlus-artifacts` container to the Activity Bar with Codicons `layers` SVG icon (24×24, transparent background).
  - Provided two tree views defaulting to visible (`visibility: "visible"`):
    - `RecentArtifactsTreeDataProvider`: sorts artifacts by `updatedAt` desc, capped at 20 items, with a "View all..." item delegating to artifact search.
    - `WorkSessionsTreeDataProvider`: gated on installed MCP version >= 12, lists all v2 sessions with type badges, item count, and dynamic recency. Displays a migration banner item when legacy v1 conversations exist.
  - Contributed gear menu (`agentPlus.manageSessionTypes`) to the Sessions view header using a native VS Code QuickPick controller.
- **Dedicated Read-only Session Editor (`agentPlus.workSession`)**:
  - Implemented `WorkSessionProvider` (`CustomReadonlyEditorProvider`) opening `conversation.json`.
  - Multi-app webview discriminator (`data-app="session" | "review"`) in `webview-html.ts` allowing a single Vite build bundle (`dist/webview/review.js`) to render either `ReviewApp` or `SessionApp`.
  - `SessionApp` displays session metadata header, instructions rendered via Markdown, and artifact cards across `Working`, `References`, and `Archived` zones. Clicking cards safely opens the artifact review editor.
- **Review App Navigation, Connect Dialog & Migration Coordinator**:
  - Retired and deleted `ConversationArtifactsDrawer.tsx` and related CSS/tests.
  - Added a **Sessions** header toggle in `ReviewApp` (gated on MCP version >= 12) that reveals or opens the artifact's session.
  - Replaced direct copy on MCP version >= 12 with `ArtifactConnectDialog`, supporting **New Session** (omits previous session ID) and **Join Session** (selects an existing v2 session; legacy v1 targets are disabled with "Cần chuyển đổi v2" badge and tooltip).
  - Created `session-migration-command.ts` coordinating single migration (migrates v1 to v2 with `conversation.v1.backup.json` and opens the session) and bulk migration (native confirmation dialog, progress notification, and comprehensive result summary).

### Rationale

- Decouples MCP artifact registration from UI organization without locking files.
- Provides a centralized Activity Bar workspace navigation experience.
- Guarantees backward-safe data migration from v1 to v2 without data loss or silent schema mutations.

### Affected components or files

- Contracts & Shared: `src/shared/contracts.ts`, `src/shared/artifact-files.ts`, `src/shared/session-type-registry.ts`, `src/shared/conversation-artifact-registry.ts`, `src/shared/artifact-connect-prompt.ts`.
- MCP & Skill: `src/integration/artifact-review-mcp-v4.ts`, `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`.
- Extension Host: `src/extension/work-session-support.ts`, `src/extension/work-session-sidebar.ts`, `src/extension/session-type-command.ts`, `src/extension/session-migration-command.ts`, `src/extension/work-session-provider.ts`, `src/extension/conversation-artifact-service.ts`, `src/extension/artifact-review-provider.ts`, `src/extension/extension.ts`, `package.json`, `media/layers.svg`.
- Webview: `src/webview/SessionApp.tsx`, `src/webview/ArtifactConnectDialog.tsx`, `src/webview/ReviewApp.tsx`, `src/webview/main.tsx`, `src/webview/styles.css`, `dev/main.tsx`, `dev/mock-data.ts`.
- Deleted: `src/webview/ConversationArtifactsDrawer.tsx`, `test/conversation-artifacts-drawer.test.tsx`.
- Test Suites: `test/session-type-registry.test.ts`, `test/work-session-sidebar.test.ts`, `test/work-session-provider.test.ts`, `test/session-type-command.test.ts`, `test/session-migration-command.test.ts`, `test/artifact-connect-dialog.test.tsx`, `test/artifact-connect-prompt.test.ts`, `test/artifact-review-provider.test.ts`, `test/conversation-artifact-registry.test.ts`, `test/review-wait-mcp.test.ts`.

## 2026-11-06 — MCP Version 12 Preparation for Work Session Testing

- Increased the bundled numeric `MCP_VERSION` from 11 to 12 at the owner's request, allowing installed-version freshness tests to distinguish the old and new runtime assets. Kept the extension package at 1.1.4, skill at 3, and conversation registry at schema v1.
- Synchronized current-version references and existing contract assertions. This change only prepares the version marker; Session v2, UI gates, migration, and the proposed legacy-conversation inspect behavior are not implemented by this bump. No global integration assets are installed or replaced by this source change.
- Updated the Work Session plans: create against a v1 conversation requires migration or an explicit choice to create/open a new Session; clarified the proposed inspect branch that preserves artifact feedback/reconnect without mutating v1 membership. Session type assignment UI remains in Phase 3.

## 2026-11-06 — Work Session Phase 1+2 Planning (Not Implemented)

- Combined the Session model and sidebar/navigation implementation plans in `plans/work-session-artifact/plan-phase-1.md`, with proposed storage/migration, affected components, and validation scope.
- Documented global session types (`typeId` plus a user-level type list), management from the Sessions header settings action, and the explicit absence of a manual create-session button. Proposed a minimal read-only session editor as the navigation destination before the full manager phase.
- Synchronized `plan.md` and added the latest decisions to `analyzed.md`. This is planning documentation only: no runtime, schema, dependency, installed data, or release version has changed.

## 2026-11-04 — Version 1.1.4 Release Preparation

- Set the extension version to `1.1.4` in package and lock metadata, updated the README VSIX installation example, and synchronized the release-contract assertions with the existing `1.1.4` changelog entry.
- Kept the bundled numeric MCP version 11 and skill version 3. The package bump does not change their independent freshness contract.
- Included the owner-only atomic test fixture correction. Copilot installer/provider improvements are deferred to a later change; no tag or publication is performed by this preparation.

## 2026-11-04 — Complete Review Feedback for All MCP Clients

### Changes

- Both `wait_for_artifact_review` and `advance_and_wait_for_artifact` return the complete validated comments document for every submitted decision, with the feedback list at `comments.comments` in both text JSON and `structuredContent`.
- A `revise` result includes `nextAction.type: "process-review-feedback"` for every artifact kind, alongside the existing state-bound submitted-review token. The instruction covers chat answers, requested Markdown edits, question-only preservation, clarification, and immediate advancement on the same artifact.
- Kept terminal decision semantics, input contracts, schema-v6 storage, token validation, transactions, and inspect recovery unchanged. The implementation is shared across clients and models, with no client-specific branch.
- Updated the official skill and contract to consume feedback directly from completed waits. Inspect remains available for saved feedback, reconnect, and recovery.
- Increased the bundled MCP asset version from 10 to 11 and skill asset version from 2 to 3. During initial implementation, package metadata remained at 1.1.3; the subsequent 1.1.4 preparation is recorded above. Existing installers deploy the updated assets and record verified per-target receipts; clients must restart and open a fresh chat afterward.

### Rationale

- The server already read and validated comments but omitted their content from wait results, making agents depend on an extra inspection just to retrieve submitted feedback.
- Returning the same validated snapshot and an explicit continuation action makes the default review contract complete independently of the client's model or harness. Automated contract coverage and real agent continuation remain separate validation claims.

### Affected components or files

- MCP response/type, decision actions, tool descriptions, shared integration versions, and protocol regression tests.
- Official `create-review-artifact` skill and reference contract, with customization points preserved.
- README, architecture, philosophy, component ownership, contributor instructions, and version/documentation contract tests.

## 2026-11-02 — Skill Customization & Independent Integration Asset Versioning

### Changes

- Separated integration compatibility from the extension package version:
  - Released the feature as extension version `1.1.3` while keeping numeric MCP version 10 and skill version 2 unchanged.
  - Added numeric `MCP_VERSION = 10` and `SKILL_VERSION = 2` counters; they are monotonic integers rather than SemVer.
  - Added the schema-v1 receipt `~/.ai-artifacts/managed/integration-version.json` with independent fields for the MCP runtime, shared `.agents` skill, and Claude `.claude` skill.
  - Base setup commits MCP and `.agents` versions only after both assets verify; Claude commits its own target only after Claude install and verification succeeds, preserving truthful partial-install state.
- Added customization-preserving skill replacement:
  - Preserves a valid YAML `description:` when it differs from current or historical official descriptions.
  - Preserves the exact content inside the `USER CUSTOM RULES` markers.
  - Merges `.agents` and `.claude` from their own installed targets so customization does not leak between clients.
  - Rejects malformed frontmatter or marker layouts before the first target rename and keeps staged whole-directory replacement, rollback, and obsolete-file cleanup.
- Replaced package-version upgrade prompts with receipt-based stale-asset notifications:
  - Missing or invalid receipts make required assets stale; invalid receipts also emit a diagnostic.
  - Notification state fingerprints the bundled numeric versions and exact stale-asset set, so `Later` suppresses only the same state and partial installs remain visible.
  - Extension-only updates with current receipts do not request integration reinstall.
- Documented supported customization locations, recovery steps, the limited meaning of `Ready`, numeric asset versions, receipt ownership, and restart/new-chat requirements after an actual asset reinstall.

### Rationale

- Users need stable customization points that survive official skill updates without treating arbitrary edits as extension-owned content.
- Independent numeric asset versions avoid unnecessary reinstall prompts for UI or documentation releases while still making MCP and skill compatibility explicit.
- Per-target receipts ensure a failed or partial installation is never reported as fully current.

### Affected components or files

- Shared contracts and paths: `src/shared/contracts.ts`, `src/shared/artifact-files.ts`
- MCP handshake: `src/integration/artifact-review-mcp-v4.ts`
- Skill and installer: `skills/create-review-artifact/SKILL.md`, `src/extension/mcp-clients/skill-helper.ts`, `src/extension/mcp-clients/claude-client.ts`, `src/extension/workspace-integration.ts`
- Upgrade notification: `src/extension/upgrade-notification.ts`, `src/extension/extension.ts`
- Documentation: `README.md`, `docs/PHILOSOPHY.md`, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`, `CHANGELOG.md`, `docs/CHANGE_LOGS.md`
- Regression coverage: `test/artifact-contracts.test.ts`, `test/skill-contract.test.ts`, `test/workspace-integration.test.ts`, `test/mcp-client-drivers.test.ts`, `test/upgrade-notification.test.ts`, `test/release-contract.test.ts`

## 2026-10-26 — README Compatibility Matrix & Supported Agents Documentation Cleanup

### Changes

- Streamlined the **Compatibility & Supported Agents** table in `README.md`:
  - Removed the `Supported Features` column to eliminate redundant phrasing (*"multi-round review"*, *"inline feedback"*, *"full lifecycle"*, etc.) that misleadingly implied feature disparities across supported AI clients.
  - Standardized the `Integration Type` column:
    - Updated **Claude** to `MCP Server (claude.json) + Skill` to reflect automated skill deployment.
    - Updated **Cline** to `MCP Server (cline_mcp_settings.json) + Skill` for consistency with other skill-capable clients.
  - Removed redundant `Supported environments` subsection to keep onboarding requirements concise.

### Rationale

- All supported AI coding agents connect through the unified schema-v6 MCP server and share the same core review lifecycle (creation, inline feedback, multi-round iterations, waiter reconnect, and Proceed execution). Distributing synonyms across rows diluted documentation clarity. The simplified table focuses strictly on the client environment and integration type/config target.

### Affected components or files

- `README.md`
- `docs/CHANGE_LOGS.md`

## 2026-10-18 — Claude Code Automatic Agent Skill Deployment & Lifecycle Sync

### Changes

- Added automatic Agent Skill deployment and synchronization for Claude Code:
  - `src/extension/mcp-clients/skill-helper.ts`: Extracted shared skill sync helpers (`replaceSkillDirectory`, `sameFile`, `REVIEW_SKILL_ASSETS`) to eliminate circular dependencies between `workspace-integration.ts` and client drivers.
  - `src/extension/mcp-clients/claude-client.ts`: Updated `ClaudeClientDriver` to automatically install the `create-review-artifact` skill to `~/.claude/skills/create-review-artifact/` upon `install()`, verify its presence (`SKILL.md`) alongside MCP configuration during `check()`, and remove it upon `uninstall()`, while safely preserving all other user skills in `~/.claude/skills/`.
  - `src/extension/mcp-clients/base-cleanup.ts`: Included `~/.claude/skills/create-review-artifact` in `cleanupBaseMcpServer` so full extension uninstall clears all deployed artifacts review skills.
  - `src/extension/mcp-clients/index.ts`: Updated `getAllClientDrivers` to pass `sourceSkillDirectory` down to `ClaudeClientDriver`.
  - `src/extension/workspace-integration.ts`: Updated `checkAllIntegrations`, `installAllDetectedIntegrations`, and `installClaudeIntegration` to supply `paths.sourceSkill`.
- Test suite updates:
  - `test/mcp-client-drivers.test.ts`: Added unit tests verifying Claude driver skill deployment, missing skill detection, and clean skill removal on uninstall and base cleanup.
  - `test/workspace-integration.test.ts`: Added end-to-end integration test verifying Claude skill installation and uninstallation alongside an unrelated Claude skill (`unrelated-claude`), ensuring non-interference.
- Documentation:
  - Updated `README.md` and `docs/CHANGE_LOGS.md` to document Claude Code's dual MCP + Skill automated lifecycle.

### Rationale

- Claude Code searches `~/.claude/skills/<skill-name>/` for personal agent skills instead of `~/.agents/skills/`. Previously, users had to manually copy the review skill into `.claude/skills/`. Automating skill deployment during Claude client installation ensures a seamless, zero-friction setup matching the other supported AI clients.

### Affected components or files

- `src/extension/mcp-clients/skill-helper.ts`
- `src/extension/mcp-clients/claude-client.ts`
- `src/extension/mcp-clients/base-cleanup.ts`
- `src/extension/mcp-clients/index.ts`
- `src/extension/workspace-integration.ts`
- `test/mcp-client-drivers.test.ts`
- `test/workspace-integration.test.ts`
- `README.md`
- `docs/CHANGE_LOGS.md`

## 2026-10-18 — Cline MCP Installer & Client Driver Support

### Changes

- Added dedicated configuration driver for the Cline VS Code extension (`ClineClientDriver`):
  - `src/extension/mcp-clients/cline-client.ts`: Manages MCP server configuration in the extension's `cline_mcp_settings.json` within VS Code global storage (`<user-data-dir>/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`). Standalone Cline installations are not detected or configured.
  - Implements `McpClientDriver` with `mcpServers` stdio configuration, reusing atomic JSON helpers (`upsertJsonMcpServer` and `removeJsonMcpServer`).
- Extended integration management:
  - `src/extension/mcp-clients/index.ts`: Exported `ClineClientDriver` and updated `getAllClientDrivers` to include Cline with optional custom configuration path support.
  - `src/extension/workspace-integration.ts`: Added dynamic path resolver `getClineConfigPath(context)` using `context.globalStorageUri`, added `installClineIntegration` and `uninstallClineIntegration`, and integrated Cline into `installAllDetectedIntegrations`, `uninstallAllDetectedIntegrations`, and `checkAllIntegrations`.
- Registered Command Palette commands:
  - `package.json` and `src/extension/extension.ts`: Added `agentPlus.installClineIntegration` ("AI Artifacts: Install Integration for Cline") and `agentPlus.uninstallClineIntegration` ("AI Artifacts: Uninstall Integration for Cline").
- Test suite updates:
  - `test/mcp-client-drivers.test.ts`: Added unit tests for Cline driver installation, check status, and atomic uninstallation preserving unrelated servers.
  - `test/workspace-integration.test.ts`: Updated multi-client integration test to cover all six supported AI clients (GitHub Copilot, Cursor, Codex, Claude, Windsurf, Cline).
- Documentation:
  - Updated `README.md`, `docs/INSTRUCTION.md`, and `docs/COMPONENTS.md` to document Cline as a supported MCP client and detail its installation commands.

### Rationale

- Cline is one of the most widely used open-source autonomous coding agents for VS Code. Adding a dedicated non-destructive MCP installer allows Cline users to seamlessly review Codex-generated and agent-created artifacts using the standard `ai_artifacts` review lifecycle.

### Affected components or files

- `src/extension/mcp-clients/cline-client.ts`
- `src/extension/mcp-clients/index.ts`
- `src/extension/workspace-integration.ts`
- `src/extension/extension.ts`
- `package.json`
- `test/mcp-client-drivers.test.ts`
- `test/workspace-integration.test.ts`
- `README.md`
- `docs/INSTRUCTION.md`
- `docs/COMPONENTS.md`
- `docs/CHANGE_LOGS.md`

## 2026-10-18 — Artifacts in Conversations, Conversation Registry v1, and MCP server 10.0.0

### Changes

- Added Conversation Registry (schema v1) under `~/.ai-artifacts/conversation-registry/<artifactConversationId>/`:
  - `src/shared/conversation-artifact-registry.ts`: Multi-process safe registry tracking conversation metadata (`conversation.json`) and per-artifact index entries (`registered-artifacts/<artifactId>.json`), guarded by atomic `.conversation.lock`. Includes stale conversation cleanup integrated into retention cleanup.
  - Upgraded MCP server runtime to `10.0.0` in `src/integration/artifact-review-mcp-v4.ts`: accepts optional flat fields `artifactConversationId?: string` and `conversationName?: string` on `create_artifact` and `inspect_artifact_review`, automatically commits conversation registration, rolls back registration if connection commit fails, returns `artifactConversationId` on create/inspect, and echoes it on wait/advance when supplied.
  - Added new machine-readable error codes `CONVERSATION_NOT_FOUND` (retryable by resetting conversation context) and `CONVERSATION_REGISTRY_INVALID` (non-retryable registry corruption).
- Added Extension-side Conversation Artifacts Support:
  - `src/extension/conversation-artifact-service.ts`: Resolves artifacts registered in a conversation with bounded concurrency (`8`) and validates `artifact.json` and `artifact.md` integrity.
  - `src/extension/artifact-review-open.ts`: Extended `ArtifactReviewOpenCoordinator.open` to support preview and tab options (`{ preview, preserveFocus }`).
  - `src/extension/artifact-review-provider.ts`: Added asynchronous non-blocking message queue for store mutations (`addComment`, `removeComment`, `submitReview`) while running read operations (`listConversationArtifacts`, `openConversationArtifact`) concurrently with monotonic request tracking.
- Added Webview Conversation Artifacts Sidebar Drawer:
  - `src/webview/ConversationArtifactsDrawer.tsx`: Sidebar drawer in the review editor listing all artifacts in the conversation with instant title/ID search, status badges (`Current`, `Waiting`, `Approved`, `Revised`, `Saved`), and standard review editor tab opening.
  - `src/webview/focus-trap.ts`: Reusable focus trap management coordinating keyboard navigation between the review content, comments drawer, and conversation artifacts drawer with mutual exclusion.
- Retention cleanup integration:
  - Extended `src/extension/artifact-retention.ts` to prune invalid/expired entries from `~/.ai-artifacts/conversation-registry/` and delete empty conversation directories alongside expired artifacts.
- Documentation & Skills:
  - Updated `SKILL.md` and `artifact-contract.md` to guide AI agents in tracking `artifactConversationId` across the conversation lifecycle and recovering from `CONVERSATION_NOT_FOUND`.
  - Updated `README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, and `docs/COMPONENTS.md` for MCP server 10.0.0, conversation registry schema v1, and drawer navigation semantics.
- Added **Open Artifact Review** context-menu recovery path:
  - Explorer, Markdown editor, and editor-tab context menus expose the command for file-backed `artifact.md` files.
  - The command reuses `ArtifactReviewOpenCoordinator` and its global-root, manifest-identity, and linked-path validation before opening the review editor, so a regular chat file link that opens as plain Markdown can be safely reopened for review.

### Rationale

- In complex engineering workflows, a single agent conversation often produces multiple related artifacts (for example, architecture designs, phased implementation plans, test checklists). Users needed a fast, low-friction way to discover, browse, and switch between these related documents directly inside the review editor without losing their place or having to search manually through the command palette.
- The conversation registry decouples artifact grouping from artifact identity: each artifact remains independent and schema-v6 compliant, while grouping is tracked through a dedicated multi-process safe index.

### Affected components and files

- `src/shared/contracts.ts`, `src/shared/artifact-files.ts`, `src/shared/conversation-artifact-registry.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/conversation-artifact-service.ts`, `src/extension/artifact-review-open.ts`, `src/extension/artifact-review-provider.ts`, `src/extension/artifact-retention.ts`, `src/extension/extension.ts`
- `src/webview/ReviewApp.tsx`, `src/webview/ConversationArtifactsDrawer.tsx`, `src/webview/focus-trap.ts`, `src/webview/styles.css`
- `src/extension/extension.ts`, `src/extension/artifact-review-open.ts`, `package.json`
- `skills/create-review-artifact/SKILL.md`, `skills/create-review-artifact/references/artifact-contract.md`
- `README.md`, `CHANGELOG.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/CHANGE_LOGS.md`

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
