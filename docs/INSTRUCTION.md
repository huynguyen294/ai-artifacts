# Project instructions

## Project

AI Artifacts is a VS Code extension for reviewing AI-generated Markdown through a local, MCP-owned review lifecycle and organizing shared work across agents and chats in Work Sessions.

- Package version source of truth: `package.json`
- Current and only supported artifact schema: `v6`
- Artifact storage: global per-user `~/.ai-artifacts/artifacts/`
- Conversation registry: global per-user `~/.ai-artifacts/conversation-registry/` (schema v2 Work Sessions, with legacy v1 detection and migration)
- Compatibility: schemas `v3`/`v4`/`v5` and workspace-local lifecycles are unsupported and are not live-migrated
- Primary environment: VS Code extension host, local MCP server, and React webview
- Filesystem support: extension host and MCP process must see the same user home and filesystem

## Read first

Before changing behavior, read the smallest relevant set in this order:

1. `docs/PHILOSOPHY.md` for product intent, lifecycle meaning, and non-goals.
2. `docs/ARCHITECTURE.md` for current boundaries and safety invariants.
3. `skills/create-review-artifact/SKILL.md` and its referenced contract for artifact behavior; `skills/work-session/SKILL.md` for Session entry, Instructions, and context refresh.
4. The implementation and tests for the area being changed.
5. `CHANGELOG.md` and any current tracked roadmap for recent migration context and known follow-up work.

`plans/`, `ASSESSMENT.md`, and `HIGHLIGHTS.md` may describe historical designs or older snapshots. Do not treat them as the current architecture without verifying them against the files above.

If product intent, documentation, tests, and implementation disagree, call out the conflict and resolve it deliberately. Do not silently preserve or introduce contradictory behavior.

## Critical invariants

- Create or update an artifact only when the user explicitly requests an artifact. Explicit review inspection/reconnect may resume an exact known artifact; a plan or document type alone does not trigger the lifecycle.
- One independent user request owns one artifact ID and directory.
- Review replaces the same `artifact.md`, advances `reviewRound`, resets review state, and does not retain revision history.
- Review submissions and chat-inspected comments use one feedback policy: answer questions visibly in chat, update Markdown only for requested changes, and preserve Markdown/SHA for question-only rounds.
- Both waiting tools return the complete validated comments document at `comments` for every submitted decision, with feedback at `comments.comments`. A `revise` result includes `nextAction.type: "process-review-feedback"` and its state-bound token for every artifact kind; agents do not need an extra inspection just to fetch submitted feedback.
- For explicit chat updates to existing artifacts as part of the active Work Session, the Session skill defaults to `noWait: true` unless the user asks to wait. Advance requires a valid UUID `artifactConversationId` for this mode before token claim/mutation, without validating Join state or registry membership. It commits and consumes the token normally, then returns the new round/hash and `waited: false` without creating a waiter or returning a decision, comments, nextAction, or new token. Any existing waiter remains attached. Waiting advances still reject an existing waiter in the same MCP process. The agent records the round and continues authorized work. Creation always waits; standalone requests and review-feedback processing retain their existing flow.
- Proceed on `plan` or `implementation-plan` returns `execute-approved-plan` and authorizes immediate execution in the same turn; acknowledgement without execution is incorrect. For any other fixed or open kind, Proceed returns `approved`, concluding review without automatic code execution.
- Just save returns the validated `save` decision and comments without a `nextAction` or round token; the artifact skill handles the requested Markdown save without executing the proposed work.
- Artifact creation/inspection is standalone when both Session arguments are omitted. An active chat Session supplies `artifactConversationId` by default, except for an explicit standalone request, which preserves that active context. Explicit New uses `conversationName` without the old ID; only success replaces active context. Session errors never authorize silently clearing an ID, creating a replacement, or retrying standalone.
- The Session skill keeps at most one active Session per chat. Successful non-null Session results replace the active catalog, never merge old snapshots, while retained artifact review handles remain separate. Related requests read current Instructions and exact artifact paths; requests for latest artifacts, recent changes, current contents, or an overview refresh the catalog before selection even when an old path is known. Reuse fresh context already returned for the same request. Join-only is read-only and does not inspect, take over, or start an artifact waiter.
- For user-requested Session organization, the Session skill may directly edit `layout.json` beside the exact returned `instructionsPath` to move or reorder existing members across Working, References, and Archived. Read the current layout before writing and refresh the catalog afterward. This changes neither membership nor global Archive state or Session recency; user and agent saves use last-write-wins without conflict handling. Direct edits to `conversation.json`, `registered-artifacts/`, and managed artifact lifecycle files remain prohibited.
- The MCP server creates schema-v6 artifacts only beneath the canonical global collection, owns the transient waiter registry and round tokens, and commits review-round transitions.
- The extension host validates bindings and writes user comments and create-once submissions.
- The skill must not create, edit, repair, or bypass lifecycle files directly, except that an explicit AI comment request may write `comments.json` and an explicit comment-and-submit request may also create a `revise` submission in `review-submission.json`. This authors the AI's own feedback without advancing the round or taking over its waiter; it does not submit other people's saved comments.
- Waiters bind an exact artifact identity rather than its attachment round. `expectedReviewRound` remains an attachment precondition; submitted results and tokens use the current validated on-disk round. Wait checks remain pending while the artifact directory exists and an update lock is present; a deleted directory ends the wait with `ARTIFACT_NOT_FOUND`.
- Round tokens are in-memory, one-time, exact-state-bound, and expiring. Cancellation or restart preserves artifact state; recover only by inspecting an exact retained artifact handle.
- Artifact lifetime exceeds waiter lifetime, which exceeds chat-turn lifetime. Only globally archived artifacts are subject to configured retention (`agentPlus.artifactRetentionDays`, default 90 days), measured from `artifact-ui-state.json.archivedAt`. Activation cleanup permanently deletes validated expired archived artifacts after re-reading Archive state; `artifact.json.updatedAt` is not a retention clock. Missing UI state or `archivedAt` means unarchived and preserves the artifact without migration; malformed or unreadable state is skipped. Restore removes eligibility, and archiving again starts a new retention period. Cancellation and takeover must not mutate lifecycle files.
- Work Session registry (`~/.ai-artifacts/conversation-registry/<sessionId>/`, schema v2) manages session metadata (`title`, `typeId`, `createdAt`), primary Instructions in `instructions.md`, and separate layout zones (`layout.json` with `working`, `references`, `archived`). Strict metadata parsing accepts an optional legacy `instructions` string so existing v2 Sessions remain readable; effective instructions come only from Markdown (empty if missing), new metadata writes omit the inline field, and reads do not migrate or rewrite data. Independent membership files in `registered-artifacts/<artifactId>.json` are the single source of truth for session membership; dynamic `Session.updatedAt` is derived from `max(createdAt, ...registeredAt)`. Concurrency is handled via atomic writes without lockfiles. Retention cleanup prunes expired artifacts and empty legacy v1 directories while preserving empty v2 Work Sessions. Navigation to and within sessions is window-local and never mutates `artifact-connection.json` or review state.
- Schema v6 is the only readable and writable lifecycle. Schema-v3/v4/v5 and workspace-local artifacts are rejected and are not live-migrated.
- Artifact and archived Work Session cleanup share `agentPlus.artifactRetentionDays` (default 90 days, minimum 1) and its normalization/default. Activation reads the setting once and passes it to both cleanups. Session expiry uses `session-ui-state.json.archivedAt`; Session deletion preserves artifacts, and unarchived Sessions are kept.
- Artifacts are owned by review sessions, not repository paths; `artifact.json` contains no `location.workspaceRoot` field.
- After creation, wait/inspect/advance/reconnect use the exact global artifact handle.
- Window routing defaults to the currently focused live window (or sole live window). Generic reconnect prioritizes sole live window, validated advisory artifact-window affinity, and unique focused window. When multiple live windows exist and focus/affinity is ambiguous, `create_artifact`, `inspect_artifact_review`, or `join_session` returns `WINDOW_SELECTION_REQUIRED` with candidate tokens. Focus is only a ranking hint; it is not routing identity.
- `artifact.json` is the source of truth for artifact identity. Optional schema-v1 `artifact-connection.json` contains only UI-routing state (`windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, `updatedAt`).
- Create and explicit reconnect may commit connection state. Wait and advance preserve that state and must not rebind or emit another open request. Reconnect recovery always keeps the exact artifact handle and never calls a workspace resolver after creation.
- Fail before filesystem mutation when window selection is required, ambiguous, stale, or unsafe.
- Preserve unrelated user skills, hooks, MCP configuration, and project files during install, upgrade, cleanup, or migration.
- Preserve user review data in `~/.ai-artifacts/artifacts/` during integration or extension uninstall. Only exact extension-owned runtime assets under `~/.ai-artifacts/managed/` are removable managed state. Retention cleanup is the only automatic artifact deletion path and runs only when the extension activates, not during uninstall. Reinstall activation may delete archived artifacts whose archive retention period has expired.
- Treat artifact Markdown, comments, and decisions as potentially sensitive local data. Preserve owner-only POSIX modes and never claim POSIX-mode guarantees on Windows.
- Automatic integration upgrade and manual reinstall depend on the bundled numeric `MCP_VERSION`, `CREATE_REVIEW_ARTIFACT_SKILL_VERSION`, and `WORK_SESSION_SKILL_VERSION` versus the verified receipts in `~/.ai-artifacts/managed/integration-version.json`, together with each client's required MCP definition checks; extension-only changes with current receipts must not force reinstall or asset rewrites.
- These three asset versions are independent monotonic integers, not SemVer or aliases for the extension package version. `SKILL_VERSION` is a compatibility alias for `CREATE_REVIEW_ARTIFACT_SKILL_VERSION`, not the Session skill version. Missing, invalid, absent, or mismatched receipt entries are stale.
- Extension activation invokes `runIntegrationActivation` non-blockingly and reads `~/.ai-artifacts/managed/integration-version.json` once before any client detection or upgrade: read I/O failures report one Error citing **`AI Artifacts: Installer`**; `missing` receipts skip detection/upgrade and invite new users with **`Run Installer`** once until clicked (`globalState` key `installer.onboardingAccepted`, persisted before opening Installer; dismiss leaves it unset and accepted state alone never triggers upgrade); `valid` or `invalid` snapshots pass directly into `runAutomaticIntegrationUpgrade` -> `upgradeDetectedIntegrations(context, installedVersion)`.
- `upgradeDetectedIntegrations(context, installedVersion)` merges `saved ∪ detected` clients without modifying `~/.ai-artifacts/managed/installed-clients.json` (returning an empty report with no disk writes or warning fallback when none exist), derives staleness from the caller-supplied existing snapshot without re-reading the receipt to branch, reconciles required client definitions via `upgrade(context)` without post-upgrade `check()` calls, never returns `setup-required`, isolates per-client exceptions as `failed`, refreshes support views once in `finally`, stays silent on empty/unchanged/`updated` runs, and surfaces at most one Error notification citing **`AI Artifacts: Installer`** and `View Installation Guide` on failures or coordinator rejection.
- The grouped manual entry points are `AI Artifacts: Installer` (`agentPlus.installer`) and `AI Artifacts: Uninstall` (`agentPlus.uninstall`). Installer uses `listInstallableClients(context)` to list all seven supported clients cleanly (`Detected`/`Saved` badges and config path, status-free without calling driver `check()`), preselects `saved ∪ detected`, and accepts OK, Run, or Enter; Uninstall uses `listInstallerClients(context)` (isolating driver `check()` exceptions as `configuration-conflict`), starts empty, and accepts OK or Enter. Empty selection or dismissal performs no mutation. Installer uses `src/extension/install-notification.ts` (`Reload Window` on success/partial plus external client restart/new-chat guidance, one Error without `Reload Window` on failure, and `onDidInstall`/view-refresh errors isolated diagnostically). The earlier all-detected/per-client commands and Reinstall aliases are removed; recovery messages across activation, auto-upgrade, and Verify cite **`AI Artifacts: Installer`**, and the Work Sessions `unsupported` item opens `agentPlus.installer`, and manual `AI Artifacts: Verify All Integrations` retains `checkAllIntegrations()` + `Ready` semantics.
- Grouped install prepares shared runtime and skills once, then installs selected clients sequentially without a post-install `check()` pass, merging only successful clients into the saved list. Grouped uninstall removes each selected client's private integration and saved ID independently, then cleans shared assets once only when no supported client still uses or may use them, saved-state inspection is determinate, and no selected removal failed. Per-client failures do not stop other selected clients; shared install preparation failures stop the operation before client installation.
- The receipt stores `mcpVersion`, artifact skill versions in `skills`, and Session skill versions in `sessionSkills`; both maps track `agents`, `claude`, and `antigravity` independently. Shared base setup commits the runtime and both Agents skill receipts after all three steps succeed (and automatic upgrade commits each completed shared asset incrementally); Claude and Antigravity receipts are committed after each client's own installation succeeds (without implying read-back content verification). Preserve other entries on partial updates. Never mark a partial failure current.
- Preserve only the declared skill customization points (`description:` and `USER CUSTOM RULES`) during automatic upgrade or reinstall of `create-review-artifact`. Work Session skill assets are replaced officially without customization. If target frontmatter or markers cannot be preserved deterministically, fail closed before replacing the target.
- Keep **What's New & Tips** (`agentPlus.openWhatsNew`, `WhatsNewPanelController`, `WhatsNewApp`) isolated from review/session lifecycles and integration mutations: pure `src/shared/whats-new-releases.ts` metadata has no `?raw` imports, every shipped release maps to non-empty Markdown in `src/webview/whats-new-content.ts` (preview `1.2.0` currently sets `preview: true`, `notify: true` for testing), local PNG/GIF assets live under `media/whats-new/`, external links only, no video/YouTube embeds. Preserve the panel ready/visible gate and ACK handshake.
- Keep What's New notifications upgrade-only and non-blocking, with separate notification history and no welcome/Tips popup or Tips command. Share one pre-install/upgrade `integration-version.json` snapshot with `runIntegrationActivation`; never reread after Installer/upgrade to classify a user. On missing notification baseline, `valid` or `invalid` receipt evidence records optional `legacyIntegration: true` and allows the current exact opt-in release to claim once unless a higher version is already observed. Missing/unreadable receipt evidence bootstraps silently; existing notification baselines are never reclassified. Later upgrades require `currentVersion > max(baseline.version, valid observed stable receipts)`. Local file-URI storage uses exclusive `"wx"` per-version claims before UI; reload/downgrade/dismiss/error never reclaims or catches up, manual opens never mutate history, and integration counters never stand in for extension SemVer. See `docs/ARCHITECTURE.md`.

## Change guidelines

- Preserve existing uncommitted work and avoid unrelated rewrites.
- Change shared contracts before or together with every affected producer, consumer, fixture, and test.
- Keep path and workspace checks fail-closed. Do not weaken them for convenience.
- Keep lifecycle transitions transactional and preserve the Windows editor-lock fallback.
- Do not edit generated `dist/`, packaged VSIX files, or installed global integration assets directly. Change their sources and rebuild.
- When behavior or ownership changes, update `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, the skill contract, and changelog only where relevant.
- Prefer focused tests during iteration, then run the complete validation before handoff.

## Ownership map

- `src/integration/artifact-review-mcp.ts`: numeric MCP version 12/schema-v6 tools, window resolution, Work Session creation/reuse with fail-closed v1 preflight, connection commits, artifact creation, waiter ownership/takeover, complete review feedback results, round grants, inspection, and transactional round commits.
- `src/shared/conversation-artifact-registry.ts`: schema-v2 Work Session persistence, layout reconciliation, dynamic `updatedAt`, single migration with backup, and retention pruning.
- `src/shared/session-type-registry.ts`: global session types registry (`~/.ai-artifacts/session-types.json`).
- `src/extension/work-session-sidebar.ts`: Activity Bar `AI Artifacts` TreeDataProviders for Recent Artifacts (cap 20 + View all) and Work Sessions v2 (including window-local type filtering).
- `src/extension/session-create-command.ts`: QuickPick native controller for creating a new Work Session v2 with optional session type selection.
- `src/extension/session-artifact-add-command.ts`: QuickPick native controller with dynamic title/kind search for adding existing artifacts to a Work Session's Working zone.
- `src/extension/artifact-kind-filter-command.ts`: QuickPick native controller for filtering Recent Artifacts tree view by artifact kind or All Kinds.
- `src/extension/session-type-command.ts`: QuickPick native controllers for global session types management and session type selection/quick-create.
- `src/extension/session-filter-command.ts`: QuickPick native controller for filtering the Sessions sidebar by session type or All Types.
- `src/extension/session-search-command.ts`: QuickPick native controller for accent/case-insensitive title search across all v2 Work Sessions.
- `src/extension/session-migration-command.ts`: single and bulk migration coordinator.
- `src/extension/work-session-provider.ts`: CustomReadonlyEditorProvider for `agentPlus.workSession` tab, handling scoped data refresh patches, external instructions sync, per-session panel preference (`globalState`), and session/artifact management actions.
- `src/extension/conversation-artifact-service.ts`: extension-side conversation artifacts & sessions discovery, validation, session/layout mutation wrappers, and scoped watcher notifications (`WorkSessionDataChange`).
- `src/extension/artifact-store.ts`: trusted artifact loading, comment writes, and submission writes.
- `src/extension/workspace-registry-publisher.ts`: live VS Code workspace heartbeat.
- `src/extension/artifact-search.ts`: schema-v6 discovery with pin/archive flags, title normalization/filtering, and `compareArtifactsByRecency` shared by Search and Recent (pinned first, `updatedAt` descending, artifact ID ascending). Discovery itself retains alphabetical order for other callers.
- `src/extension/artifact-search-command.ts`: Quick Pick controller applying the kind filter, then caching a copy in Recent order before title filtering and the 1,000-item cap, including archived artifacts, with safe cancellation/open coordination.
- `src/extension/integration-activation.ts`: non-blocking activation/onboarding controller (single-read receipt check, `Run Installer` onboarding gated on missing receipt + `installer.onboardingAccepted`, direct existing-snapshot handoff to upgrade).
- `src/extension/integration-install-command.ts`: checkbox Installer controller using status-free `listInstallableClients`, detected/saved preselection, OK/Run/Enter confirmation, progress, isolated `onDidInstall`, and shared install notifications.
- `src/extension/install-notification.ts`: shared install outcome notifier for `AI Artifacts: Installer` (`Reload Window` action, outside-window client restart/new-chat guidance, Error reporting, UI/reload/diagnostic error containment).
- `src/extension/integration-uninstall-command.ts`: checkbox Uninstall controller, empty initial selection, OK/Enter confirmation, progress, and aggregate removal results.
- `src/extension/workspace-integration.ts`: centralized MCP installation, status-free client listing (`listInstallableClients`), statusful listing for Uninstall/Verify (`listInstallerClients`), grouped selected-client install/uninstall coordinators, remaining-client shared cleanup decisions, selective shared runtime/skill synchronization, automatic upgrade coordinator (`upgradeDetectedIntegrations(context, installedVersion)`), per-target version receipts, customization-preserving skill replacement, and legacy cleanup.
- `src/extension/installed-client-state.ts`: strict schema-v1 persistence for manually selected MCP client IDs under `~/.ai-artifacts/managed/installed-clients.json`.
- `src/extension/upgrade-notification.ts`: activation automatic upgrade controller (refreshes support once, silent on empty/unchanged/updated outcomes, single Error citing `AI Artifacts: Installer` and `View Installation Guide` on failures or coordinator rejection) plus shared stale-asset helpers.
- `src/extension/mcp-clients/`: dedicated configuration and upgrade drivers for Codex, Cursor, Claude Code, Windsurf, GitHub Copilot (VS Code), Cline, and Antigravity.
- `src/extension/extension.ts`: VS Code activation entry point registering commands (including `agentPlus.openWhatsNew`), Activity Bar views, panel/custom-editor providers, retention cleanup, and non-blocking `runIntegrationActivation` and `runWhatsNewNotification` triggers.
- `src/extension/whats-new-panel.ts`: standalone `agentPlus.whatsNew` `WebviewPanel` controller managing `media/whats-new` CSP/roots via `webview-html.ts`, `show()` / `showVersion(version)` target queuing, ready/visible gating, ACK clearing, and disposal.
- `src/extension/whats-new-notification.ts`: upgrade-only What's New notification controller matching exact `notify: true` runtime releases, presenting non-modal Info popups (`View what's new`), routing clicks to `openVersion`, and isolating diagnostics cleanly from activation and integrations.
- `src/extension/whats-new-notification-state.ts`: local file-URI notification history, optional legacy-integration bootstrap eligibility, immutable exclusive `"wx"` version receipts, and strict stable `X.Y.Z` comparison.
- `src/webview/`: review UI and typed messages to the extension host; includes `ReviewApp.tsx` (Sessions button, Start a work session flow, and direct Inspect prompt), `SessionApp.tsx` (two-column Session Manager with Working main column and collapsible Type / Instructions / References / Archived side panel), and `WhatsNewApp.tsx` (What's New cards, collapsed Feature/Bug fix lists, full release Markdown, Tips, and bundled `media/whats-new/` PNG/GIF rendering); no direct filesystem or process access.
- `src/shared/`: shared schemas, file contracts, artifact-connection safety/persistence, validation, grouped workspace registry rules, pure release metadata (`whats-new-releases.ts`), and strict What's New panel protocol (`whats-new-protocol.ts`).
- `src/shared/session-connect-prompt.ts`: builder for agent takeover/join prompts targeting a specific Work Session.
- `skills/create-review-artifact/`: review artifact lifecycle orchestration contract.
- `skills/work-session/`: multi-agent work session orchestration contract.
- `test/`: executable regression coverage for contracts and failure behavior.

## Validation

From the repository root, run:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

On shells where `npm` is directly executable, the equivalent `npm run ...` commands are fine.

For lifecycle changes, cover at least create, wait, takeover inspection, Review, question-only and Markdown advancement, Proceed, Just save, reconnect, token state binding/replay, cancellation, concurrency, rollback, and explicit rejection of unsupported schemas as applicable.

For workspace changes, cover grouped-window results, focus-as-ranking-hint behavior, single-folder matching, unique cross-window matches, duplicate workspace paths across windows, tagged-file evidence, separator-normalized exact/similar matches, unique high-confidence agent choice, tied user selection, all-available fallback, empty-scope not-found, stale/replayed window/workspace selection tokens, registry changes, exact-root matching, containment, and linked-path rejection as applicable.
