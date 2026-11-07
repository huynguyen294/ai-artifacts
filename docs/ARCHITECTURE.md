# Architecture

```text
Codex skill
   | resolve (optional window discovery) / create / wait / inspect / advance-and-wait
   v
AI Artifacts MCP -- discovers live windows and coordinates review rounds
   |
   +-- ~/.ai-artifacts/artifacts/<id>/
   |     artifact.json + artifact.md + comments.json
   |     + optional submission + optional artifact-connection.json
   |
   +-- ~/.ai-artifacts/conversation-registry/<session-id>/
   |     conversation.json (v2) + layout.json + registered-artifacts/<artifact-id>.json
   |
   +-- ~/.ai-artifacts/session-types.json
   |
   v
VS Code extension windows -- publish heartbeats, match connection target, open editor / session tab
   |
   v
React webview -- renders ReviewApp (Markdown, comments, Sessions nav, Connect dialog) & SessionApp (two-column Session Manager)
```

## Ownership boundaries

- The skill chooses when an artifact is appropriate, calls create directly or resolves windows when ambiguous, retains an exact handle mapping, tracks `artifactConversationId`, writes complete Markdown, answers review questions in chat, and reacts to decisions.
- The MCP server discovers live VS Code windows, exclusively creates schema-v6 artifacts in global storage, commits schema-v1 window-routing requests, manages schema-v2 Work Sessions with fail-closed v1 preflight (`CONVERSATION_MIGRATION_REQUIRED`), and advances review rounds. It generates IDs and review sessions, validates paths and candidate selection tokens, owns transient waiter registration, issues one-time round tokens, and commits round transitions transactionally.
- Each extension host window publishes fresh canonical workspace roots plus its stable instance ID, focus hint, and active-file context. It validates connection targets and artifact bindings, opens only requests addressed to its own instance ID, serves sessions and artifact queries, executes validated Work Session metadata/layout/membership mutations, and writes user comments/submissions.
- The webview renders sanitized CommonMark/GFM, provides inline comments, session navigation, and Connect dialogs in `ReviewApp`, as well as two-column Work Session management in `SessionApp`, sending typed messages to the extension host. It has no direct filesystem or process access.
- `src/shared` is the single contract boundary used by the MCP, extension host, and webview.

## Lifetime model

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

An artifact is per-user data representing a review session. Its lifetime is bounded by the configured retention period (`agentPlus.artifactRetentionDays`, default 30 days); expired artifacts are permanently deleted when the extension activates. A waiter is an in-memory connection from one MCP request to one exact artifact round. A chat turn may end or interrupt that request without changing the artifact.

Cancellation and takeover alone close watchers/timers and release waiter ownership only. They do not edit `artifact.json`, `artifact.md`, `comments.json`, `review-submission.json`, or `artifact-connection.json`; only an explicit reconnect intent may commit new routing state during inspection. MCP restart loses active waiters and tokens, but a validated inspection can issue a fresh token from the persistent schema-v6 state.

## Lifecycle tools

1. `resolve_artifact_window` accepts an optional `query` string matched against candidate label, active file, and folder paths. It reads fresh VS Code window snapshots and returns candidates grouped by window; each candidate includes `candidateId`, `windowInstanceId`, `focused`, `label`, `folderCount`, `folders`, `activeFile`, and an opaque `selectionToken`. It returns `status: "matched"`, `status: "selection-required"`, or `status: "not-found"`. It is read-only and never creates lifecycle files.
2. `create_artifact` creates review round 1, registers the artifact under `~/.ai-artifacts/conversation-registry/<artifactConversationId>/` (accepting optional flat fields `artifactConversationId?: string` and `conversationName?: string`), commits connection revision 1, and immediately returns the exact handle, `artifactConversationId`, and connection metadata. By default, it routes to the currently focused window (or sole live window); when focus is ambiguous across multiple windows, it returns `WINDOW_SELECTION_REQUIRED` requiring retry with `connection: { targetMode: "explicit-window", selectionToken }`. The official skill always sends `kind: "implementation-plan"`.
3. `wait_for_artifact_review` attaches the single waiter for an expected round or immediately returns an existing submission. Accepts optional `artifactConversationId` and echoes it in the returned result.
4. `inspect_artifact_review` reads the current manifest, Markdown, comments, optional submission, connection state, and hashes, returning `artifactConversationId`. Accepts optional flat fields `artifactConversationId?: string` and `conversationName?: string` to register or update the artifact in the conversation drawer. With `intent: "reconnect"`, it re-evaluates the currently focused window (or explicit window candidate) and atomically increments the connection revision with a new open-request ID; ambiguous candidates require `connection.selectionToken`. With `takeover: true`, inspection first aborts and drains the prior waiter. It can grant a token from saved comments even before submission, or a chat-update token on an empty round when `intent: "explicit-chat-update"` is supplied.
5. `advance_and_wait_for_artifact` consumes an exact-state round token, optionally replaces Markdown, advances the round, resets comments/submission, and attaches a waiter for the new round. Accepts optional `artifactConversationId` and echoes it in the returned result. Omitting Markdown preserves its exact bytes and SHA. Both wait and advance preserve existing connection state and cannot rebind the artifact.

The default flow is create -> wait -> submitted decision. Both waiting tools return the complete validated `comments` document for every submitted decision, with the feedback list at `comments.comments`. This is the same snapshot validated against the round, artifact hash, comments hash, and submission, returned identically in text JSON and `structuredContent` without an extra inspection to fetch feedback. It applies equally to existing submissions and decisions received during an active wait, for every MCP client and model.

Review (`revise`) grants a round token and `nextAction.type: "process-review-feedback"` for any artifact kind. Its instruction applies the same feedback policy as chat inspection: answer questions visibly in chat before waiting, replace Markdown only for requested changes, then advance and wait in the same turn using the retained exact artifact handle, returned round, and token. Question-only Review preserves the current Markdown bytes/SHA. Feedback needing clarification leaves the token unconsumed until clarified; managed lifecycle files must never be edited directly, and conversational answers stay in chat. Proceed (`approve`) and Just save (`save`) end only the current round and do not automatically advance. For `plan` and `implementation-plan`, the Proceed result additionally carries `nextAction.type: "execute-approved-plan"`; this is runtime authorization to execute all approved in-scope actions immediately in the same turn. Approve for other kinds and save return no next action; neither terminal decision grants a round token, and both may return an empty comments list. Every lifecycle result includes an RFC 8089 `artifactUrl` and regular Markdown `artifactLink`; neither is a custom-editor deep link.

The chat-escape flow differs only in transport: it cancels the live waiter and inspects the exact retained handle instead of receiving a Review submission. Classification, chat answers, optional Markdown replacement, clarification, advancement, and waiting behavior are shared with Review. If no feedback exists, the skill reattaches to the same round unless the user explicitly requested edits in chat (via `intent: "explicit-chat-update"`). Reconnecting an already approved or saved artifact is explicit and must not repeat the prior command.

Only one waiter may own an artifact. Round tokens are in-memory, single-use, expire after one hour, and bind the artifact, session, round, artifact hash, comments hash, and submission presence/hash. Tokens have sources `submitted-review`, `chat-inspection`, or `chat-update` (which requires replacement Markdown with a different SHA). A token is consumed only after a successful transaction commit. Lifecycle errors retain readable text and add typed recovery metadata (`code`, retryability, next-tool hint, token reuse, same-handle requirement, and optional current round), preventing blind replay when commit state is uncertain.

## Persistent protocol

Schema v6 is the sole live lifecycle protocol:

- `artifact.json` identifies the schema-v6 artifact, title, session, and current round without repository ownership fields.
- `artifact.md` contains the complete current document.
- `comments.json` contains saved comments bound to the current round and artifact hash.
- `review-submission.json` appears after Review, Proceed, or Just save.
- `artifact-connection.json` is optional schema-v1 UI-routing state containing only `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`.
- Work Session registry under `~/.ai-artifacts/conversation-registry/<sessionId>/` stores schema-v2 `conversation.json` (`sessionId`, `title`, `instructions`, `typeId`, `createdAt`), `layout.json` (ordering across `working`, `references`, `archived` zones), and per-artifact index files under `registered-artifacts/<artifactId>.json`. Writes are atomic without file locks; `Session.updatedAt` is dynamically computed on read from `max(createdAt, ...registeredAt)`. Global session types are stored in `~/.ai-artifacts/session-types.json`.

Advancing always increments the round and resets handled comments. A question-only advance uses the existing Markdown unchanged. Schemas v3/v4/v5 are rejected and are not live-migrated.

`artifact.json` remains the source of truth for artifact ID; connection state never duplicates or overrides it. Connection revisions start at 1 and increment once per successful create/reconnect commit under an artifact-scoped lock. Revisions provide ordering and diagnostics, while unique open-request IDs deduplicate filesystem events. Connection writes are atomic and do not change Markdown bytes/SHA, comments, submission, review round, or round tokens.

## Workspace registry

Each running extension window writes an atomic snapshot under `~/.ai-artifacts/managed/workspaces/` (or `CODEX_ARTIFACTS_REGISTRY_DIRECTORY`) and refreshes it every 15 seconds. Schema-v2 snapshots expire after 45 seconds and contain canonical workspace folders (or empty array for folderless windows), focus state, and the active file/root when available. The registry publisher prunes snapshots, retaining at most 10 snapshots and removing files older than 7 days.

Window routing for creation defaults to the focused live window (or sole live window). Generic reconnect routing prioritizes: sole live window, validated advisory artifact-window affinity (where the agent's cached ID matches the stored connection and is fresh in the registry), and unique focused window. When multiple live windows exist and focus/affinity is ambiguous, `create_artifact` or `inspect_artifact_review` returns `WINDOW_SELECTION_REQUIRED` with candidates and opaque selection tokens. Agents present candidates using concise labels instead of raw UUIDs and retry using `connection: { targetMode: "explicit-window", selectionToken }`.

## Filesystem safety

- Artifact IDs are generated by the server and directories are created exclusively as direct children of `~/.ai-artifacts/artifacts/`.
- The exact global handle is canonicalized and bound to the manifest artifact ID. Nested, escaped, linked, workspace-local, and wrong-home paths are rejected before read or mutation.
- On POSIX, managed directories are tightened to owner-only `0700` and lifecycle files to `0600`. Windows relies on the user account and filesystem ACLs and makes no POSIX-mode guarantee.
- Canonical containment is checked before mutation; linked artifact storage paths are rejected.
- Create rollback may remove only the exact newly allocated directory.
- Advance stages the next round and restores prior files if commit fails. A narrow in-place fallback handles Windows editor locks.
- Activation cleanup: when the extension host activates, a best-effort asynchronous retention cleanup enumerates validated schema-v6 direct children of `~/.ai-artifacts/artifacts/`, checks `artifact.json.updatedAt` against the retention window, revalidates candidates immediately before deletion, and atomically renames expired artifact directories to managed cleanup staging (`~/.ai-artifacts/managed/cleanup/<artifactId>-<uuid>/`). Recursive deletion runs only on staged paths. Per-artifact atomic rename resolves multi-window races without a global lock. `EPERM`/`EBUSY`/`EACCES` errors skip the candidate without aborting the run. Legacy, malformed, mismatched-ID, linked, or escaped entries are skipped. Leftover staging entries from crashes are drained at the next activation. The cleanup process also prunes expired entries in `~/.ai-artifacts/conversation-registry/` and removes empty conversation folders.
- Missing-handle contract: when an exact artifact handle no longer exists (retention cleanup, manual deletion, or filesystem loss), load/inspect/wait/advance/reconnect return `ARTIFACT_NOT_FOUND` with `retryable: false` and `useSameArtifactHandle: false`. Active waiters detect the missing directory or manifest and terminate instead of waiting indefinitely. No tombstone, search-for-replacement, or recreation is attempted.
- Installer cleanup recognizes only extension-managed MCP blocks, hook entries, scripts, runtime files under `~/.ai-artifacts/managed/`, legacy `~/.vscode/ai-artifacts/` assets, registry snapshots, and managed skill directories. Unrelated user configuration is preserved, and user review data in `~/.ai-artifacts/artifacts/` is retained on uninstall. Uninstall does not run retention cleanup; cleanup staging in `~/.ai-artifacts/managed/cleanup/` may be removed by uninstall since it is managed state, and any artifact there has already passed the deletion commit point.

## Extension watcher and editor opening

The extension validates and creates the global collection root before registering a `RelativePattern` watcher for direct-child `artifact-connection.json` creation and change. Every extension window receives the filesystem event, performs bounded retry for transient create/replace races, and revalidates the root, artifact directory, connection file, manifest binding, and linked-path safety on every read attempt. A window ignores the request unless `connection.windowInstanceId` matches its own stable instance ID. The matching window may call `vscode.openWith` even when unfocused, provided `agentPlus.autoOpenArtifactReview` is enabled. Disabling auto-open does not prevent MCP from committing routing state.

Each window deduplicates successfully handled `openRequestId` values and coalesces concurrent work by canonical artifact path. Failed opens are not permanently deduplicated, so a later event can retry. Different artifacts remain independent, and VS Code's single-editor-per-document contract performs the final reuse/reveal behavior. Non-target validation failures remain silent in that window; the target window reports actionable failures without opening an unsafe artifact.

The manual **AI Artifacts: Open Artifact Review** command accepts an `artifact.md` URI from Explorer, the Markdown editor context menu, or its editor-tab context menu. Without an explicit URI, it uses the active `artifact.md` or Artifact Review URI when available, then falls back to a file picker rooted at the global collection. Every entry point shares the same `ArtifactReviewOpenCoordinator` and fail-closed validation boundary as the watcher: the artifact must be a direct child of the global collection with a valid schema-v6 manifest, matching identity, and safe non-linked paths before `vscode.openWith` runs. This provides a user-controlled return path when a chat `artifactLink` opens a normal Markdown editor rather than the review editor. The **AI Artifacts: Search Artifact** command (`agentPlus.searchArtifact`) provides an extension-local search UI via VS Code Quick Pick. It enumerates valid schema-v6 direct children in `~/.ai-artifacts/artifacts/` with bounded concurrency, filters in-memory on normalized title (accent-insensitive, case-insensitive, deterministic order, capped at 1,000 items), and revalidates and opens the selected artifact through the shared `ArtifactReviewOpenCoordinator`. Search is strictly local to the current window and does not call MCP, invoke window routing, or mutate connection state. Users can copy the exact artifact handle into AI chat using the **Connect** button in the review header. A chat `artifactLink` is only a regular file link and may open a normal Markdown editor depending on the client.

## Work Sessions and Activity Bar sidebar navigation

The legacy conversation drawer has been replaced by a first-class Work Session architecture and dedicated Activity Bar view:

1. **AI Artifacts Activity Bar View**: Provides two views (`agentPlus.recentArtifacts` and `agentPlus.sessions`), defaulted to visible on first load:
   - **Recent Artifacts**: Displays the 20 most recently updated artifacts (sorted by `updatedAt` desc) with quick access to full title search via **View all...** (`agentPlus.searchArtifact`).
   - **Sessions**: Displays v2 Work Sessions with their session type labels (`Conversation`, `Project`, `Feature`, `Fix`, or custom types), artifact counts, and dynamic `updatedAt` recency.
   - **Filter & Search Sessions**: Header actions on the Sessions view provide window-local filtering by session type (`agentPlus.filterSessions`, showing the active filter in `TreeView.description` and resetting to `All Types` if the selected type is deleted) and accent/case-insensitive title search across all v2 Work Sessions (`agentPlus.searchSessions`, independent of the active sidebar filter).
   - **Session Types Management**: A gear action (`agentPlus.manageSessionTypes`) on the Sessions view header opens a native VS Code QuickPick to create, rename, or delete global session types.
   - **Migration Detection**: Displays the count of legacy v1 conversations with an action to launch bulk migration.
2. **Work Session Manager (`agentPlus.workSession`)**: Opening a session renders `SessionApp` in a two-column layout:
   - **Main Column**: Displays the `Working` artifact zone, expanding to full width when the side panel is collapsed.
   - **Collapsible Side Panel**: Ordered as `Session Type` (with quick pick to assign or create a type) → `Instructions` (fixed-height Markdown textarea with explicit **Save**) → `References` zone → `Archived` zone. Per-session panel expanded/collapsed state is persisted in extension `globalState` (`workSessions.panelExpanded.<sessionId>`, default `true`).
   - **Artifact Organization**: Each artifact card provides a menu to move across `Working` / `References` / `Archived`, reorder (`Move Up` / `Move Down`), or remove the artifact from the session without deleting the underlying artifact files. Clicking an available artifact card opens it in the review editor via the shared `ArtifactReviewOpenCoordinator`.
   - **Scoped Refresh & Draft Preservation**: `ConversationArtifactService` classifies registry, manifest, and session-types watcher events into scoped `WorkSessionDataChange` batches (`metadata`, `membership`, `layout`, `artifact`, `types`, `support`). Unrelated background refreshes (artifact manifest edits, membership/layout updates, title/type changes) update only their target UI sections and never reset unsaved `Instructions` text or focus. If the persisted `instructions` field on disk actually changes (e.g., edited directly in `conversation.json` by an AI agent), `WorkSessionProvider` emits `workSessionInstructionsPatch` to update the textarea.
3. **Review App Sessions Navigation & Connect Dialog**:
   - The Review App header provides a **Sessions** button (gated on MCP version >= 12) to reveal the artifact's session.
   - Clicking **Connect** on MCP version >= 12 opens `ArtifactConnectDialog` to choose between **New Session** (instructs the agent to omit the existing session ID and establish a fresh session) and **Join Session** (links into an existing v2 session, with v1 conversations disabled and badged as requiring migration).
4. **Single & Bulk Migration**: The coordinator (`src/extension/session-migration-command.ts`) provides single migration (migrates v1 to v2 with a backup `conversation.v1.backup.json` and opens the session) and bulk migration with native confirmation dialogs and VS Code progress notification reporting. All Session Quick Input flows and notifications use unified English wording while preserving user-authored session titles, instructions, and type labels.

## Deployment and filesystem support

The supported v1.1.x topology requires a local desktop VS Code-compatible extension host and MCP process running as the same OS user, resolving the same home, and seeing the same `~/.ai-artifacts/` filesystem. Windows, macOS, and Linux are the declared local targets. Remote SSH, WSL, dev containers, Codespaces, browser/virtual workspaces, and split-host topologies are unsupported in v1.1.x because their producer/consumer filesystem boundary has not passed the release matrix.

## Integration asset versioning and skill customization

The extension tracks integration assets independently from the extension package version. `src/shared/contracts.ts` defines numeric, monotonically increasing `MCP_VERSION` and `SKILL_VERSION` values; they are not SemVer. A schema-v1 receipt at `~/.ai-artifacts/managed/integration-version.json` records the verified MCP runtime plus skill versions for `.agents` and `.claude` independently.

The Integration Manager commits only completed work. Base setup writes the MCP and `.agents` versions after both packaged assets are installed and verified. Claude writes its own skill receipt only after its independent install and verification succeeds. The receipt may therefore represent a valid partial install; a missing, invalid, absent, or mismatched asset entry is stale and is never replaced by an assumed baseline.

During activation, the upgrade notification compares the receipt with the bundled versions for the MCP runtime, the always-required `.agents` skill, and `.claude` when Claude is detected. Its persisted fingerprint contains the bundled versions and exact stale-asset set. The same fingerprint is suppressed after `Later`, while a version bump or partial install changes the fingerprint and remains actionable. An extension-only update with current receipts does not show another integration notification.

Skill reinstall snapshots the target before mutation, merges a valid non-official YAML `description:` and the exact contents of the `USER CUSTOM RULES` block into the packaged `SKILL.md`, stages the complete directory, and then swaps it atomically. `.agents` and `.claude` are merged from their own targets and never inherit each other's customizations. Unsupported or malformed frontmatter/markers fail closed before the first target rename and identify the target that the user must repair. `Ready` means the official assets are current after this merge; it does not validate the behavioral compatibility of custom rules.

## Compatibility

The current implementation uses numeric MCP version 12, numeric skill version 5, artifact schema v6, Work Session schema v2 (with automatic legacy v1 migration), and optional connection schema v1. The schema-v6 transition remains a hard protocol cutoff: the MCP tool catalog contains exactly five tools with `resolve_artifact_window` replacing `resolve_artifact_workspace`, while schema-v3/v4/v5 and workspace-local lifecycles remain untouched on disk but are not parsed, opened, advanced, or migrated. Updating the extension does not mutate an already installed runtime or skill, but reinstall is required only when the bundled MCP or skill version differs from its verified receipt. After reinstalling, users restart the affected AI client and start a fresh chat. Rolling back across incompatible asset versions likewise requires reinstalling the matching runtime/skill. Optional connection files remain preserved user artifact data and may be ignored by older code; they are never deleted during rollback or uninstall.
