# Work Session contract

## Tool and returned context

`join_session` accepts an exact UUID `sessionId` and optional `artifactId`. Inspect options `expectedReviewRound`, `takeover`, `intent`, and `connection` are allowed only when `artifactId` is present. Join-only resolves current Session v2 context without membership writes, artifact inspection, takeover, window routing, a waiter, or a round token.

`session` contains `sessionId`, `title`, `typeId`, `typeLabel`, `createdAt`, derived `updatedAt`, `instructions`, `instructionsPath`, and `catalog`. Each catalog has ordered `working`, `references`, and `archived` arrays. An available item contains `artifactId`, `title`, `kind`, `description`, exact `artifactDirectory` and `artifactPath`, and artifact `updatedAt`; an unavailable item contains only `artifactId` and `unavailable: true`. Descriptions are snippets, not the full artifact. Read the current Markdown at `artifactPath` when needed.

A catalog snapshot is a point-in-time read, not a revision archive. Session `updatedAt` is derived from createdAt and membership registeredAt. It does not track every artifact-content or Instructions edit; never use it alone to decide that those contents are unchanged. Artifact kind is independent of Session type.

A successful non-null Session context replaces the active catalog rather than merging with earlier snapshots; retained artifact review handles remain separate. Requests for the latest artifacts, recent changes, current Session contents, or a current overview require a fresh catalog before artifact selection, even when an old exact path is known. Reuse a fresh catalog already returned for the same request. Otherwise, a known exact artifact can be read directly through its current path without refreshing the catalog first.

Instructions come from the exact `instructions.md`; missing file means empty effective Instructions. Legacy inline `instructions` may be accepted by metadata readers but is not a fallback. Read/list does not migrate or rewrite metadata. The raw Markdown file is the user- and AI-editable Instructions source when explicitly requested.

## Direct layout editing

The returned context includes `instructionsPath`, not a separate Session directory, `conversationPath`, or `layoutPath`. Resolve `layout.json` in the same directory as that exact `instructionsPath`; `conversation.json` is also a sibling but must not be edited. Do not reconstruct the location from an assumed home directory or scan for a Session.

When the user requests moving or reordering artifacts within a Session:

1. Use `join_session({ sessionId: activeSessionId })` to obtain current membership and exact paths, or reuse a fresh Session context already returned for the same request. Resolve each target by exact artifact ID from its catalog; clarify ambiguous targets. Layout editing does not add artifacts from outside that Session.
2. Read the current sibling `layout.json` immediately before editing. Its complete shape is `{ "schemaVersion": 1, "working": ["artifact-id"], "references": [], "archived": [] }`, with artifact ID strings in all three arrays and no additional fields. If absent, initialize the three arrays from the current catalog's artifact IDs in their returned order. If an existing file is invalid or unreadable, report the problem rather than overwriting it with a cached snapshot.
3. Remove each moved artifact ID from all three arrays, then insert it in the requested zone and position; append when no position was specified. Keep each ID at most once across the zones, preserving all unaffected IDs and their relative order. Save complete valid JSON, using atomic file replacement when supported by the file tool. Do not change metadata, membership files, timestamps, or artifact lifecycle files.
4. Refresh with `join_session({ sessionId: activeSessionId })` after saving and adopt the returned catalog to confirm the resulting placement. A failed refresh preserves the active identity and does not authorize recreating the Session or blindly repeating the write.

Membership remains authoritative in `registered-artifacts/`. Registered IDs absent from layout are appended to Working when the Session is read; unknown IDs in layout are ignored. Removing an ID from layout alone therefore does not remove the artifact from the Session. The `archived` array is only this Session's Archived zone, not global artifact archiving. Layout changes do not update Session recency. User and agent writes use last-write-wins; do not add locks, conflict checks, merge protocols, or extra confirmation solely for concurrent editing.

## Session selection and success-only updates

| Request | Arguments | Context after success |
| --- | --- | --- |
| Create/inspect without an active Session | Omit artifactConversationId and conversationName | Remain without an active Session; result.session is null |
| Default create/inspect while S is active | artifactConversationId: S | Keep S; adopt the fresh returned context |
| Explicit standalone while S is active | Omit both Session arguments for this request | Keep S; do not replace it with null |
| Explicit artifact creation with a new Session | conversationName, no old ID | Adopt the newly returned Session |
| Explicit Join or switch to T | join_session with exact sessionId: T | Adopt T |

If both Session arguments are supplied to create/inspect, the ID takes precedence; the name neither renames nor creates a Session. Do not send both for a New request. Omission alone never requests New Session creation. The MCP stores no per-chat active Session; the agent supplies these arguments from chat context. Only explicit Session intent or a known active ID supplies membership context; artifact memberships cannot identify the chat's active Session.

Window-selection retries retain the exact original Session intent, IDs, name, artifact handle, round, takeover and inspect intent. A retry for explicit New keeps the old ID omitted and the chosen name. A failure never authorizes an automatic fallback or active-context replacement.

## Optional artifact inspection

Join-only returns `{ session }`. Adopt it on success and continue the user's request; do not call artifact wait/advance.

Join with an artifact returns `{ session, inspection }`. Read comments at `result.inspection.comments.comments`, the token at `result.inspection.roundToken`, the round at `result.inspection.reviewRound`, and the exact handle at `result.inspection.artifactDirectory`. Adopt `result.session` only after success, then apply the artifact skill to the normalized inspection object. Do not call inspect again merely to fetch comments already returned in this object.

Create and ordinary inspect return a top-level `session` object when a Session was selected or created, or `session: null` for standalone. Ordinary inspection fields remain flat. Saved `inspection.submission` or ordinary inspect `submission` is historical state, not a fresh execution directive. Do not re-execute past approvals or repeat a prior save; use the artifact skill's reconnect and feedback rules. Fresh decisions come from wait/advance and keep their existing nextAction contracts.

## Recovery

| Error | Required action |
| --- | --- |
| CONVERSATION_NOT_FOUND | Stop automated recovery, retain the current context, and inform the user that the exact Session was not found. Do not clear the ID, create a replacement, or retry standalone without user instructions. |
| CONVERSATION_REGISTRY_INVALID | Stop automated recovery and retain the exact context. Report invalid or unsafe registry data; do not repair metadata or index files directly. |
| CONVERSATION_MIGRATION_REQUIRED | Present two choices: open an artifact in the legacy conversation and migrate it from the Review App, then retry the same ID; or explicitly start a new Session. Starting a new Session requires a name without the old ID on create/inspect, or creation through the extension UI followed by Connect. Merely dropping the ID produces standalone behavior and does not create a Session. Do not auto-retry or copy old memberships. |
| WINDOW_SELECTION_REQUIRED | For Join with artifact, retry join_session using the same exact Session/artifact and inspect intent with `connection: { targetMode: "explicit-window", selectionToken }` after selecting one clearly matching returned window or asking when ambiguous. Do not turn the retry into create/inspect or Join-only. |
| WINDOW_SELECTION_EXPIRED, WINDOW_CONNECTION_MISMATCH, WINDOW_CONNECTION_STALE | Refresh window candidates through the hinted original operation without the stale connection token, retaining the same Session/artifact intent. |
| ARTIFACT_NOT_FOUND or artifact lifecycle/token errors | Follow the artifact skill's exact-handle recovery. Do not guess a replacement, recreate an artifact ID, or replay an old action. |

Takeover affects only the selected artifact, not the entire Session. Reading a catalog artifact does not require takeover or create an approval. Session entry does not implicitly create a review artifact or authorize unrelated changes.
