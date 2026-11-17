---
name: work-session
description: Connect to or continue an AI Artifacts Work Session, applying its instructions and current artifact context across requests.
---

# Work Session

Manage one active Work Session in the current chat. A Session can be shared across agents and chats; its context contains metadata, Instructions, and artifact catalogs, not another chat's transcript.

## Entry and active context

1. Require `join_session` in the current tool catalog before joining or refreshing a Session. Check once for this workflow unless the tool becomes unavailable or the MCP restarts. Do not probe MCP resources or installed files to test tool availability. If unavailable, ask the user to run **AI Artifacts: Installer**, select their AI client, confirm with **OK**, **Run**, or **Enter**, restart that client, and start a new chat.
2. To join or switch to an exact Session, call `join_session({ sessionId })`. `join_session` accepts an exact UUID `sessionId` and optional `artifactId`; inspect options `expectedReviewRound`, `takeover`, `intent`, and `connection` are allowed only when `artifactId` is present. Join-only returns `{ session }` and resolves current Session v2 context without membership writes, artifact inspection, takeover, window routing, a waiter, or a round token. Continue the user's request without artifact wait/advance.
3. If the user asks to work in a Session but no exact ID is known and no Session is active, ask for its Connect prompt or exact ID. Never select by title, recency, artifact membership, PID, or AI client identity.
4. Keep at most one `activeSessionId` per chat, together with the current Instructions, `instructionsPath`, and catalog paths. Keep it for later related requests; loading the artifact skill does not itself require another Join. An explicit request to leave clears only the chat's active Session context, not the Session, memberships, or retained artifact handles.

## Session context and refresh

`join_session` returns full `SessionContext`, which extends `SessionHandle` (`sessionId`, `title`, `typeId`, `typeLabel`, `sessionDirectory`, `instructionsPath`, `layoutPath`, `createdAt`, derived `updatedAt`) with `instructions` and `catalog`. Each catalog has ordered `working`, `references`, and `archived` arrays. An available item contains `artifactId`, `title`, `kind`, `description`, exact `artifactDirectory` and `artifactPath`, and artifact `updatedAt`; an unavailable item contains only `artifactId` and `unavailable: true`. Descriptions are snippets, not the full artifact. Artifact kind is independent of Session type.

`create_artifact` and `inspect_artifact` return only a lightweight `SessionHandle` when Session-bound (or `session: null` when standalone), omitting `instructions` content and `catalog`. After `join_session` returns `SessionContext`, adopt its `sessionId`, `instructions`, and paths (`sessionDirectory`, `instructionsPath`, `layoutPath`), and replace the active Session catalog with the returned catalog; do not merge it with older snapshots. After `create_artifact` or `inspect_artifact` returns a non-null `SessionHandle`, adopt its `sessionId` and paths; if `sessionId` matches the already-active Session, preserve cached `instructions` and `catalog` without clearing them (noting that cached `catalog` does not include newly created/linked artifacts until refreshed via `join_session`). Preserve retained artifact review handles separately. Replacing active context does not move or remove memberships or invalidate those handles. Follow [Recovery](#recovery) on failure.

Apply Session guidance only to related requests. Mentions such as plan or blueprint are semantic references, not unconditional keyword triggers; an active Session does not make an unrelated request subject to its Instructions.

- Keep the Session Instructions in active chat memory from the initial Join (or when `join_session` returns fresh `session.instructions`). Because Instructions rarely change mid-session, do not re-read `instructionsPath` on every turn; re-read `instructionsPath` or refresh with Join-only only when the user asks to reload updated Instructions (or if cached Instructions are missing).
- Before acting on any related request or new task (including immediately upon joining when a role is assigned), perform a mandatory in-memory check against the active Instructions: identify your assigned role and the matching workflow step, complete any required role/session onboarding not yet done in this chat (such as reading `Session Context`, reading project rules `AGENTS.md`/`RULES.md`/`INSTRUCTION.md`, and loading referenced skills), and strictly follow the step's execution and handoff rules.
- Instructions come from the exact `instructions.md`; missing file means empty effective Instructions. Legacy inline `instructions` may be accepted by metadata readers but is not a fallback. Read/list does not migrate or rewrite metadata.
- When the request requires the latest artifacts, recent changes, current Session contents, or a current overview (including refreshing `catalog` after creating/linking artifacts or editing `layout.json`), refresh the snapshot with `join_session({ sessionId: activeSessionId })` before selecting an artifact, even if a previously known artifact has a valid path. Reuse a fresh `SessionContext` already returned by `join_session` for the same request.
- Otherwise, if the target artifact is already known unambiguously by exact ID and catalog path in the current Session context, read its current Markdown directly through `artifactPath`. A stable ID does not make cached Markdown current. AI may read Working, References, or Archived catalog artifacts through their exact returned paths; never crawl or recursively scan catalog directories. Reading reference material needs neither inspection nor takeover.
- If the target is unknown, call `join_session({ sessionId: activeSessionId })` once to obtain a current catalog snapshot, then read only the relevant artifacts through exact returned paths. If multiple candidates remain plausible, ask the user rather than choosing by recency.
- Reuse a fresh `SessionHandle` returned by create/inspect when you only need `sessionId`, `sessionDirectory`, `instructionsPath`, or `layoutPath` (for example, registering Session waiters, editing `instructions.md`, or organizing `layout.json`). Call `join_session` when you need a full `SessionContext` snapshot. Do not refresh the catalog before every file read or tool call. If a previously retained path is missing, refresh the catalog via `join_session` to resolve availability; do not scan for a replacement or recreate the missing artifact ID.

A catalog is a point-in-time snapshot, not a revision archive. Session `updatedAt` is derived from createdAt and membership registeredAt, not every artifact-content or Instructions edit; never use it alone to decide that those contents are unchanged. Retain the active Session ID and exact context paths in a requested handoff or compaction checkpoint. A new chat without that identity reconnects through the Session's Connect prompt or exact ID. This skill does not run a background watcher or automatically push external changes into the chat.

## Artifacts while a Session is active

Use [create-review-artifact](../create-review-artifact/SKILL.md) only when performing artifact lifecycle work: creation, inspection, saved review feedback, direct chat updates, review rounds, or lifecycle recovery. Preserve its exact handle, feedback, token, approval, and waiting rules. Join-only and reading catalog Markdown do not require loading that skill. Do not recursively reload a skill already in context.

Select Session arguments and context as follows:

| Request | Arguments | Context after success |
| --- | --- | --- |
| Create/inspect without an active Session | Omit artifactConversationId and conversationName | Remain without an active Session; result.session is null |
| Default create/inspect while S is active | artifactConversationId: S | Keep S; adopt the returned `SessionHandle` paths while keeping cached `instructions`/`catalog` |
| Explicit standalone while S is active | Omit both Session arguments for this request | Keep S; do not replace it with null |
| Explicit artifact creation with a new Session | conversationName, no old ID | Adopt the newly returned `SessionHandle` (and call `join_session` only if a full `SessionContext` snapshot is needed later) |
| Explicit Join or switch to T | join_session with exact sessionId: T | Adopt the returned `SessionContext` for T |

Create and ordinary inspect return a top-level `session` `SessionHandle` (`sessionId`, metadata, `sessionDirectory`, `instructionsPath`, `layoutPath`, without `instructions` or `catalog`) for a selected or newly created Session, or `session: null` for standalone. Only `join_session` returns full `SessionContext` snapshots. Default create/inspect register or refresh membership in the active Session, including from a plain artifact Inspect prompt; that prompt does not itself select a Session or request standalone operation. The MCP stores no per-chat active Session; supply arguments from chat context, never infer it from artifact memberships.

If both Session arguments are supplied to create/inspect, the ID takes precedence; the name neither renames nor creates a Session. For explicit New, omit the old `artifactConversationId`, and supply `conversationName`: use the user's name when provided, otherwise derive a concise name from the requested work. Omission alone never requests New Session creation. Do not create an artifact just to start an empty Session; empty Sessions can be created from the extension UI.

For artifact updates, follow the artifact skill's [Tool contract](../create-review-artifact/SKILL.md#tool-contract), applying any explicit user/Instructions wait-mode request. The artifact skill owns token/commit/result handling. A commit result with `waited: false` returns no new Session context or review decision: retain the active Session context and record the new artifact round separately.

If the user explicitly requests Session Join together with an artifact inspection, use `join_session({ sessionId, artifactId, ...inspectOptions })` for one call. Join has no wait option and always returns an inspection snapshot. Use takeover only for saved feedback or an explicit direct update that replaces a waiter; preserve existing waiters for `wait: false` updates and follow the artifact skill's reconnect rules. Takeover affects only the selected artifact, not the entire Session.

Join with an artifact returns `{ session, inspection }`; ordinary inspection fields are flat. Normalize `result.inspection` for the artifact skill: comments at `result.inspection.comments.comments`, token at `result.inspection.roundToken`, round at `result.inspection.reviewRound`, and exact handle at `result.inspection.artifactDirectory`. Do not inspect again merely to fetch comments already returned. Saved `inspection.submission` or ordinary inspect `submission` is historical state, not a fresh execution directive. Do not re-execute past approvals or repeat a prior save. Fresh decisions come from successful top-level `decision` results of public wait or create/inspect/update when they wait; use the artifact skill's result classification and existing `nextAction` contracts. Public inspect may return saved feedback immediately even with `wait: true`; Join itself never waits.

## Instructions and layout editing

Instructions contain rules, workflows, and other guidance for AI in this Session. They are mandatory rules for all related tasks: AI must consult the in-memory Instructions before each task to execute required role preparation (reading context artifacts, project rules, and referenced skills) and follow the prescribed workflow steps, while Session entry alone does not implicitly create a review artifact, modify project code, or grant approval. AI may edit the exact `instructions.md` when the user explicitly requests it; use raw Markdown, with no JSON fallback or dual-write.

When the user requests Session organization, AI may move or reorder existing Session artifacts by directly editing the sibling `layout.json`:

1. Use `join_session({ sessionId: activeSessionId })` to obtain current membership and exact paths, or reuse a fresh `SessionHandle` / `SessionContext` from the same request. Resolve targets by exact artifact ID from the catalog; clarify ambiguous targets. Read `layout.json` using the returned `layoutPath` (or resolve it beside `instructionsPath` / inside `sessionDirectory`), never from an assumed home directory or a scan. Layout editing does not add artifacts from outside that Session.
2. Read the current `layout.json` immediately before editing. Its complete shape is `{ "schemaVersion": 1, "working": ["artifact-id"], "references": [], "archived": [] }`, with artifact ID strings in all three arrays and no additional fields. If absent, initialize the arrays from the current catalog's artifact IDs in their returned order. If invalid or unreadable, report the problem rather than overwriting it with a cached snapshot.
3. Remove each moved ID from all three arrays, then insert it in the requested zone and position; append when no position was specified. Keep each ID at most once across zones, preserving all unaffected IDs and their relative order. Save complete valid JSON using atomic replacement when supported. Do not change metadata, membership files, timestamps, or artifact lifecycle files.
4. Refresh with `join_session({ sessionId: activeSessionId })` after saving and adopt the returned catalog to confirm placement. A failed refresh does not authorize blindly repeating the write.

Membership remains authoritative in `registered-artifacts/`. Registered IDs absent from layout are appended to Working on read; unknown IDs are ignored. Removing an ID from layout therefore does not remove membership. The `archived` array is this Session's Archived zone, not global artifact archiving. Layout changes do not update Session recency. User and agent saves use last-write-wins without conflict handling; do not add locks, conflict checks, merge protocols, or extra confirmation solely for concurrent editing.

Never directly edit `conversation.json`, `registered-artifacts/`, or managed artifact lifecycle files; use MCP tools such as `write_artifact_feedback` through the artifact skill for AI-authored feedback.

## Session waiters and requests

Use `wait_in_session` and `request_waiter_in_session` only when participating in the Session waiter workflow; their absence never blocks `join_session`-only work, Session Instructions, or artifact workflows. Waiters are advisory readiness signals.

- **Waiting (`wait_in_session`):** Call `wait_in_session({ sessionId, name?, waitingFor, artifactId? })` with an exact Session UUID and optional non-empty `name` and `artifactId`.
  - If `status: "requested"`, inspect `request` (`requestMessage` and optional resolved `artifact` summary) and act strictly within the Session Instructions and your assigned role/authority; waiters never replace artifact review tokens, grant `execute-approved-plan` permission, or bypass artifact approval rules.
  - If `status: "cancelled"` (`reason`: `waiter-removed`, `lease-expired`, or `session-deleted`) or an abort/runtime error (`isError: true`: `REQUEST_CANCELLED`, `SESSION_WAITER_LOCK_LOST`, `SESSION_WAITER_BUSY`, `SESSION_WAITER_IO_ERROR`), report it and stop without auto-rewaiting, replaying uncertain writes, recreating a deleted Session, or silently clearing retained handles; handle `CONVERSATION_*` and `ARTIFACT_NOT_FOUND` via [Recovery](#recovery), and fix/retry only pre-registration `INVALID_ARTIFACT_INPUT` errors.
- **Inspecting active waiters manually:** Without a read-only waiter list tool, resolve `waiters/` inside the Session's exact `sessionDirectory` (or beside `instructionsPath`; never scan outside the Session directory). Read `<waitId>.json` files (ignoring temp files and `.coordination.lock`) together with file `mtime` stats in batch, filter live leases using `mtimeMs + leaseTtlMs > Date.now()`, and select an exact `waitId` rather than guessing. Never manually write or edit files inside `waiters/` or `waiter-requests/` to simulate a waiter or request; an external Stop only removes the active waiter record.
- **Requesting a waiter (`request_waiter_in_session`):** Call `request_waiter_in_session({ sessionId, waitId, requestMessage, artifactId? })` with an exact active `waitId`. A `{ status: "sent" }` response confirms that the request was written, not that the target agent has received, claimed, or acted on it. On `SESSION_WAITER_NOT_WAITING`, refresh active waiters rather than guessing another slot; on `SESSION_WAITER_REQUEST_EXISTS`, stop without overwriting the existing request; on `SESSION_WAITER_BUSY` or `SESSION_WAITER_IO_ERROR`, stop automated retries and report the error.

## Recovery

A failure preserves the previous Session identity and context. Do not clear an ID, auto-create a Session, retry as standalone, or replay a saved approval merely because a request failed. Window-selection retries retain the original Session intent, IDs, name, artifact handle, round, takeover and inspect intent; explicit New keeps the old ID omitted and the chosen name.

| Error | Required action |
| --- | --- |
| CONVERSATION_NOT_FOUND | Stop automated recovery and inform the user that the exact Session was not found. |
| CONVERSATION_REGISTRY_INVALID | Stop automated recovery and report invalid or unsafe registry data; do not repair metadata or index files directly. |
| CONVERSATION_MIGRATION_REQUIRED | Present two choices: open an artifact in the legacy conversation and migrate it from the Review App, then retry the same ID; or explicitly start a new Session using the New flow above or the extension UI followed by Connect. Do not auto-retry or copy old memberships. |
| WINDOW_SELECTION_REQUIRED | For Join with artifact, retry join_session using the same exact Session/artifact and inspect intent with `connection: { targetMode: "explicit-window", selectionToken }` after selecting one clearly matching returned window or asking when ambiguous. Do not turn the retry into create/inspect or Join-only. |
| WINDOW_SELECTION_EXPIRED, WINDOW_CONNECTION_MISMATCH, WINDOW_CONNECTION_STALE | Refresh window candidates through the hinted original operation without the stale connection token, retaining the same Session/artifact intent. |
| ARTIFACT_NOT_FOUND or artifact lifecycle/token errors | Follow the artifact skill's exact-handle recovery. Do not guess a replacement, recreate an artifact ID, or replay an old action. |
