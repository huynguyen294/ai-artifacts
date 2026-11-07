# Codex Artifacts MCP contract

## Tools

Read this contract before calling `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, `advance_and_wait_for_artifact`, or `join_session`.

`resolve_artifact_window` accepts an optional `query` string matched against candidate label, active file, and folder paths. It reads every fresh VS Code window snapshot and returns candidates grouped by window; each candidate includes `candidateId`, `windowInstanceId`, `focused`, `label`, `folderCount`, `folders`, `activeFile`, and an opaque `selectionToken`. It returns `status: "matched"`, `status: "selection-required"`, or `status: "not-found"`. It is read-only and never creates lifecycle files.

`create_artifact` accepts `title`, lowercase `kind`, complete `markdown`, optional `connection: { targetMode: "explicit-window", selectionToken }`, and optional flat parameters `artifactConversationId?: string` and `conversationName?: string`. When `connection` is omitted, the server automatically targets the currently focused VS Code window (or the sole live window). If multiple windows exist and none or multiple are focused, it returns `WINDOW_SELECTION_REQUIRED` with candidate windows and selection tokens. The server stores the schema-v6 lifecycle in global AI Artifacts storage (`~/.ai-artifacts/artifacts/<server-generated-id>/`) and registers the artifact in the conversation registry (`~/.ai-artifacts/conversation-registry/<artifactConversationId>/`). Creation results include `artifactDirectory`, `artifactId`, `artifactConversationId`, `session` (full session context when registered into a session), `artifactUrl` (RFC 8089 `file:///...` URI), `artifactLink` (`[${title}](${artifactUrl})`), and committed connection metadata (`schemaVersion`, `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`). `artifactLink` is a regular file link, not a deep link; it opens `artifact.md` in a plain Markdown/text editor. The user can choose **Open Artifact Review** from that file's Explorer, editor, or editor-tab context menu to reopen the validated artifact in the review editor.

`wait_for_artifact_review` accepts `artifactDirectory`, `expectedReviewRound`, optional `takeover`, and optional `artifactConversationId`. It returns an existing submission immediately or owns the single transient waiter until Review, Proceed, Just save, cancellation, or takeover. Every submitted decision returns the complete validated `comments` document described in **Review result** below. A `revise` result includes `nextAction.type: "process-review-feedback"`, a one-time `roundToken`, `artifactUrl`, `artifactLink`, and echoes `artifactConversationId` when provided by the caller. It maintains existing connection state without mutating `artifact-connection.json`.

For an `approve` result whose artifact kind is `plan` or `implementation-plan`, the result includes `nextAction.type: "execute-approved-plan"` and an explicit instruction to execute the approved plan immediately in the same turn. Treat this as execution authorization, not an acknowledgement request. For any other fixed or open kind, `approve` returns `nextAction.type: "approved"`, concluding the review without automatic code execution.

`inspect_artifact_review` accepts the exact `artifactDirectory`, optional `expectedReviewRound`, optional `takeover`, optional `intent` (such as `"reconnect"` or `"explicit-chat-update"`), optional `connection` (`{ targetMode: "artifact-window", windowInstanceId }` for advisory affinity or `{ targetMode: "explicit-window", selectionToken }` for explicit candidate targeting), and optional flat parameters `artifactConversationId?: string` and `conversationName?: string`. It immediately returns the validated manifest, Markdown, comments, optional submission, round, hashes, `artifactConversationId`, `session` (full session context when the artifact belongs to a session), `artifactUrl`, and `artifactLink`. It returns a `roundToken` when saved comments or a submission make the round consumable, or when `intent` is `"explicit-chat-update"` on an empty round. When `intent` is `"reconnect"`, it evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity (when matching stored connection and live in registry), and unique focused window, or explicit candidate via `selectionToken`. Writes connection state atomically, and returns the committed connection metadata. Focus is not required when targeting via `selectionToken` or matching advisory affinity.

`advance_and_wait_for_artifact` accepts the exact `artifactDirectory`, `expectedReviewRound`, `roundToken`, optional `artifactConversationId`, plus optional complete replacement `markdown`. It transactionally advances the same artifact and waits for the next round while preserving existing connection state. Its completed wait returns the same **Review result** contract for the new round, including that round's `comments` and applicable `nextAction`; results echo `artifactConversationId` when provided by the caller. Omitting Markdown preserves the exact `artifact.md` bytes and SHA while resetting handled comments and removing the old submission.

`join_session` accepts `sessionId` (uuid string), optional `artifactId` (string), and when `artifactId` is provided, optional inspect parameters: `expectedReviewRound`, `takeover`, `intent`, and `connection`. When `artifactId` is omitted, it operates strictly in join-only mode and returns `{ session }` containing full session context, instructions path, instructions content, and catalog without inspecting an artifact or starting a waiter. When `artifactId` is provided, it derives the canonical artifact handle and returns `{ session, inspection }` where inspection contains flat artifact inspection fields and nested comments at `inspection.comments.comments`.

## Review result

Both waiting tools return the same client-independent feedback contract in text JSON and `structuredContent`, whether a submission already exists or arrives during the wait. Every `revise`, `approve`, and `save` result includes `comments: { schemaVersion, artifactId, reviewRound, artifactSha256, comments }`. Read the feedback list at `result.comments.comments`; each comment retains its `id`, `createdAt`, `body`, block metadata, and selection anchor. The document is the same snapshot validated against the returned round, artifact hash, comments hash, and submission. `approve` and `save` may have an empty comments list.

| Decision | `nextAction.type` | Round token |
|---|---|---|
| `revise`, any artifact kind | `process-review-feedback` | One-time `roundToken`, source `submitted-review` |
| `approve`, kind `plan` or `implementation-plan` | `execute-approved-plan` | None |
| `approve`, another kind | `approved` | None |
| `save` | None | None |

`process-review-feedback` includes an instruction to apply the shared feedback policy: process every comment, answer questions visibly in chat and include `artifactLink` before waiting, supply complete replacement Markdown only for requested edits, and omit Markdown for question-only feedback. If clarification is needed, ask without consuming the token or advancing. Otherwise advance and wait in the same turn using the retained exact `artifactDirectory`, the returned `reviewRound` as `expectedReviewRound`, and `roundToken`. Never edit managed lifecycle files directly or insert conversational answers into the artifact. Inspect remains available for chat feedback, reconnect, and recovery; the default submitted-review flow already has its comments.

## Availability and lifetime

The skill requires all six tools once when starting an artifact lifecycle in the current chat. Use the current tool catalog; do not probe MCP resources or the filesystem. It does not repeat the check in later rounds unless a tool becomes unavailable, the MCP restarts, or a new chat begins. If the catalog is incomplete, ask the user to run **AI Artifacts: Install All Detected Integrations** (or the install command for their specific client), restart that AI client, and start a new chat.

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

The artifact is per-user data whose lifetime is bounded by configured retention (`agentPlus.artifactRetentionDays`, default 30 days). When the extension activates, validated expired artifacts are permanently deleted based on `artifact.json.updatedAt`. Retention eligibility evaluates `updatedAt` directly: creating an artifact sets this timestamp, and successfully advancing a review round (including question-only or unchanged-Markdown advances) updates it. Inspecting, searching, reopening, reconnecting, waiting, saving comments, and submitting decisions do not modify `updatedAt` and do not extend retention. A waiter is an in-memory connection for one exact artifact round. Cancellation, takeover, turn completion, or MCP restart may detach the waiter but never deletes or ends the artifact. Proceed and Just save end only the submitted round. An exact handle may become permanently missing after retention cleanup; the agent must not retry, scan for a replacement, or recreate the same artifact ID. To preserve content beyond the retention window, the user must complete Just save, Copy Markdown, or export content manually.

## Directory

```text
~/.ai-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json    # present only after submission
  artifact-connection.json  # optional window-routing state

~/.ai-artifacts/conversation-registry/<artifactConversationId>/
  conversation.json         # schema-v2 session metadata
  instructions.md           # canonical session instructions markdown
  layout.json               # working, references, archived zone arrays
  registered-artifacts/     # per-artifact index
    <server-generated-id>.json
```

All lifecycle files are server- or extension-owned. Agents must not create, update, or repair them directly. Schema v6 is the only supported lifecycle contract. Older schemas are unsupported and are not live-migrated.

`artifact.json` is schema-v6 and does not store workspace location: `{ schemaVersion: 6, kind, artifactId, title, createdAt, updatedAt, reviewRound, reviewSessionId }`. Optional `artifact-connection.json` is schema-v1 UI-routing state only: `{ schemaVersion, windowInstanceId, connectionRevision, openRequestId, source, updatedAt }`. `connectionRevision` orders successful commits and `openRequestId` deduplicates filesystem events. Create and reconnect may commit this file; wait and advance preserve it unchanged.

`conversation.json` is schema-v2 session metadata for the Work Session: `{ schemaVersion: 2, sessionId, title, typeId, createdAt }`. `instructions.md` stores canonical session instructions in raw Markdown. While conversation registry JSON metadata is server-managed, AI agents are permitted to edit `instructions.md` upon explicit user request. `layout.json` manages ordered artifact placement in Working, References, and Archived zones. Referenced artifacts in `session.catalog` may be read directly at their canonical paths. Individual entries under `registered-artifacts/<artifact-id>.json` record registered artifact memberships. Expired or deleted artifacts and empty conversation entries are pruned during automatic retention cleanup.

## Chat and Work Session active context

A Work Session may be shared across multiple AI chat conversations concurrently. Each chat conversation maintains at most one active session ID (`activeSessionId`) in memory at any given time. The MCP parameter `artifactConversationId` carries this Work Session ID (not a chat conversation ID or reviewSessionId).

| User / caller intent | ID sent to create/inspect | Context after success |
|---|---|---|
| Initial (no active session yet) | Omit `artifactConversationId` | Retain returned session ID as active context |
| Default turn (holding active session S) | Send S | Continue using S for future turns |
| Create artifact with explicit New Session request | Omit ID (even if holding S) | Replace active context with newly returned ID |
| Inspect artifact with explicit New Session request | Omit ID (even if holding S) | Replace active context with newly returned ID; keep exact artifact handle |
| Join specific Session T | Send exact ID T | Set active context to T upon success |

Rules:
- Only commit the new active session ID after the lifecycle tool call succeeds. If a tool fails, do not automatically retry against the old session.
- Replacing the active session ID does not delete the old session, migrate its artifacts, or affect artifact memberships.
- Window-selection retry preserves the caller's intent and target session; it does not inject old session IDs into a New Session request.
- Changing the active session ID preserves all existing `artifactDirectory -> { reviewRound, windowInstanceId }` mappings; an artifact may belong to multiple Work Sessions concurrently.
- Never infer an active session from artifact membership, session title, newest session, PID, or AI client identity. Lifecycle responses from `wait_for_artifact_review` and `advance_and_wait_for_artifact` echo round context and do not alter the chat's active session.

## Handle ownership

After create, use only the exact `artifactDirectory` returned by creation or retained from an interrupted waiter. Keep an `artifactDirectory -> { reviewRound, windowInstanceId }` mapping when a chat owns multiple artifacts, tracking the committed `windowInstanceId` from create and reconnect success. Never select “the latest artifact” or infer a handle from cwd. If the handle is missing or ambiguous, ask the user.

Treat the returned `artifactDirectory` as the exact global handle after creation. Never scan global storage to discover an artifact.

## Intent decision table

| User intent | Tool flow |
|---|---|
| Pure reconnect to a target window | Call `inspect_artifact_review` with the exact handle, current round, and `intent: "reconnect"` to rebind an active window and emit an open request. Generic reconnect passes cached `connection: { targetMode: "artifact-window", windowInstanceId }`; current-window intent omits affinity; named-window intent uses explicit selection token; after `WINDOW_SELECTION_REQUIRED`, retry the same inspect flow with `connection: { targetMode: "explicit-window", selectionToken }`. |
| Resume waiting without reconnecting | Wait on the exact handle and same round. |
| Read saved comments/submission | Inspect the exact handle with `takeover: true`. |
| Update an empty round directly from chat | Inspect with exact handle, round, takeover, and `intent: "explicit-chat-update"`. |
| Join session without artifact | Call `join_session({ sessionId })`. |
| Inspect artifact and join session | Call `join_session({ sessionId, artifactId, takeover: true, ... })`. |
| Intent or handle is ambiguous | Ask the user before any lifecycle call. Never takeover speculatively. |

If inspection finds no feedback, reattach to the same round without advancing. Takeover only aborts and drains the old waiter; it does not mutate lifecycle files.

## Round tokens and structured recovery

A round token is in-memory, single-use, expires after one hour, and binds the exact artifact, session, round, artifact hash, comments hash, and submission presence/hash. Any intervening change rejects it. Tokens are consumed only after a successful round commit. A chat-update token requires non-empty replacement Markdown with a different SHA.

Lifecycle errors keep human-readable text and may include:

```ts
type ArtifactRecoveryError = {
  code: string;
  retryable: boolean;
  expectedNextTool?: "create_artifact" | "inspect_artifact_review" | "wait_for_artifact_review" | "advance_and_wait_for_artifact" | "resolve_artifact_window" | "join_session";
  reuseRoundToken: boolean;
  useSameArtifactHandle: boolean;
  currentReviewRound?: number;
};
```

Recovery rules:

- `WINDOW_SELECTION_REQUIRED`: ambiguous window context; retry with the chosen candidate's `connection: { targetMode: "explicit-window", selectionToken }` using `expectedNextTool` (`create_artifact`, `inspect_artifact_review`, or `join_session`); present candidates to the user with concise labels instead of raw UUIDs.
- Invalid/expired/consumed tokens, wrong round, or changed state: inspect the same exact handle; do not replay old Markdown or actions.
- Token in use: wait for the in-flight request; do not advance concurrently.
- Active waiter: do not start a second wait. Keep awaiting the in-flight call for resume-wait intent; use inspect with `intent: "reconnect"` and no takeover for pure reconnect; use takeover only for saved feedback or an explicit direct update.
- Confirmed cancellation before commit or confirmed rollback may set `reuseRoundToken: true`.
- `ADVANCE_COMMITTED` means the round changed successfully but waiting did not finish; never replay, and continue on the reported round.
- `WINDOW_NOT_FOUND`: no live VS Code window is open. Ask the user to open VS Code, then retry.
- `WINDOW_SELECTION_EXPIRED`: window selection token expired or window was closed. Retry without connection token to refresh candidate windows.
- `WINDOW_CONNECTION_MISMATCH`, `WINDOW_CONNECTION_STALE`: selected window candidate is stale or closed. Retry without connection token to refresh candidate windows.
- `ARTIFACT_CONNECTION_INVALID`: optional routing state is malformed or invalid and the skill cannot repair it. Stop automated recovery, retain the exact handle, report the corrupt `artifact-connection.json`, and ask the user to repair or remove it before reconnecting. Do not retry inspect/reconnect or edit lifecycle files directly.
- `ARTIFACT_CONNECTION_WRITE_FAILED`: failed to update the connection state atomically; retry `inspect_artifact_review` on exact handle with `intent: "reconnect"`.
- `CONVERSATION_NOT_FOUND`: the provided `artifactConversationId` or target `sessionId` was not found in the registry (`retryable: false`). Retain the current context, stop automated recovery, and ask the user for instructions. Do not silently clear the ID, auto-create a replacement session, or guess another session ID.
- `CONVERSATION_REGISTRY_INVALID`: stored conversation registry files are invalid, corrupt, or violate path safety (`retryable: false`). Stop automated recovery, retain the exact handle, and notify the user.
- `CONVERSATION_MIGRATION_REQUIRED`: the provided `artifactConversationId` references a conversation v1 record that must be migrated before use (`retryable: false`). Stop automated recovery and present the user with two choices: (1) Migrate the conversation from the Review App and retry with the same ID, or (2) Drop the v1 ID and retry without an ID to create a new Session v2.
- `ARTIFACT_NOT_FOUND`: the exact artifact handle no longer exists (retention cleanup, manual deletion, or filesystem loss). Non-retryable with `useSameArtifactHandle: false`. Drop the stale handle mapping and inform the user. Do not retry, scan, or recreate.
- Unless the error is explicitly non-retryable, if commit state is uncertain, inspect the same exact handle before retrying.

## Decisions and chat feedback

- Review (`revise`) and chat-inspected feedback use the same classification and response policy.
- Question-only: answer visibly in chat before advancing without Markdown, preserving bytes and SHA.
- Change-only: advance with complete replacement Markdown.
- Mixed: answer visibly in chat, then advance with complete replacement Markdown.
- Needs clarification: ask in chat and leave the round unconsumed.
- Do not create or update `## Review responses`; conversational answers belong in chat.
- Proceed (`approve`): for `plan` and `implementation-plan`, obey `nextAction.type: "execute-approved-plan"` and execute the complete approved plan immediately in the same turn; do not stop at acknowledgement, summarize future work, request another confirmation, or auto-advance. For non-plan kinds, `nextAction.type: "approved"` concludes the review without automatic code execution.
- Saved submission snapshots from `inspect_artifact_review` or `join_session` (`inspection.submission`) represent historical review records, not new execution directives; do not re-execute past approvals upon reconnecting or joining.
- Just save (`save`): save as requested and do not auto-advance.
- Explicit reconnect after Proceed/Just save: inspect, advance without Markdown, and wait. Never repeat the prior action merely because the artifact was reconnected.
