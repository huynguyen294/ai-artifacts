# Codex Artifacts MCP contract

## Tools

Read this contract before calling `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, or `advance_and_wait_for_artifact`.

`resolve_artifact_window` accepts an optional `query` string matched against candidate label, active file, and folder paths. It reads every fresh VS Code window snapshot and returns candidates grouped by window; each candidate includes `candidateId`, `windowInstanceId`, `focused`, `label`, `folderCount`, `folders`, `activeFile`, and an opaque `selectionToken`. It returns `status: "matched"`, `status: "selection-required"`, or `status: "not-found"`. It is read-only and never creates lifecycle files.

`create_artifact` accepts `title`, lowercase `kind`, complete `markdown`, optional `connection: { targetMode: "explicit-window", selectionToken }`, and optional flat parameters `artifactConversationId?: string` and `conversationName?: string`. When `connection` is omitted, the server automatically targets the currently focused VS Code window (or the sole live window). If multiple windows exist and none or multiple are focused, it returns `WINDOW_SELECTION_REQUIRED` with candidate windows and selection tokens. The server stores the schema-v6 lifecycle in global AI Artifacts storage (`~/.ai-artifacts/artifacts/<server-generated-id>/`). Creation results include `artifactDirectory`, `artifactId`, `session` (`null` for standalone or full context for the selected or newly created Work Session), optional `artifactConversationId` and `conversationName` when a Session is selected or created, `artifactUrl` (RFC 8089 `file:///...` URI), `artifactLink` (`[${title}](${artifactUrl})`), and committed connection metadata (`schemaVersion`, `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`). `artifactLink` is a regular file link, not a deep link; it opens `artifact.md` in a plain Markdown/text editor. The user can choose **Open Artifact Review** from that file's Explorer, editor, or editor-tab context menu to reopen the validated artifact in the review editor.

`wait_for_artifact_review` accepts `artifactDirectory`, `expectedReviewRound`, optional `takeover`, and optional `artifactConversationId`. `expectedReviewRound` is checked at attachment only; after non-waiting advances, results and Review tokens use the current validated submission round. It returns an existing submission immediately or owns the single transient waiter until Review, Proceed, Just save, cancellation, or takeover. Every submitted decision returns the complete validated `comments` document described in **Review result** below. A `revise` result includes `nextAction.type: "process-review-feedback"`, a one-time `roundToken`, `artifactUrl`, `artifactLink`, and echoes `artifactConversationId` when provided by the caller. It maintains existing connection state without mutating `artifact-connection.json`.

For an `approve` result whose artifact kind is `plan` or `implementation-plan`, the result includes `nextAction.type: "execute-approved-plan"` and an explicit instruction to execute the approved plan immediately in the same turn. Treat this as execution authorization, not an acknowledgement request. For any other fixed or open kind, `approve` returns `nextAction.type: "approved"`, concluding the review without automatic code execution.

`inspect_artifact_review` accepts the exact `artifactDirectory`, optional `expectedReviewRound`, optional `takeover`, optional `intent` (such as `"reconnect"` or `"explicit-chat-update"`), optional `connection` (`{ targetMode: "artifact-window", windowInstanceId }` for advisory affinity or `{ targetMode: "explicit-window", selectionToken }` for explicit candidate targeting), and optional flat parameters `artifactConversationId?: string` and `conversationName?: string`. It immediately returns the validated manifest, Markdown, comments, optional submission, round, hashes, optional `artifactConversationId` and `conversationName` when a Session is selected or created, `session` (`null` for standalone or full context for that selected or newly created Session), `artifactUrl`, and `artifactLink`. It returns a `roundToken` when saved comments or a submission make the round consumable, or when `intent` is `"explicit-chat-update"` on an empty round. When `intent` is `"reconnect"`, it evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity (when matching stored connection and live in registry), and unique focused window, or explicit candidate via `selectionToken`. Writes connection state atomically, and returns the committed connection metadata. Focus is not required when targeting via `selectionToken` or matching advisory affinity.

`advance_and_wait_for_artifact` accepts the exact `artifactDirectory`, `expectedReviewRound`, `roundToken`, optional `artifactConversationId`, optional `noWait?: boolean` (default `false`), plus optional complete replacement `markdown`. It transactionally advances the same artifact and, by default, waits for the next round while preserving existing connection state. Its completed wait returns the same **Review result** contract for the new round, including that round's `comments` and applicable `nextAction`; results echo `artifactConversationId` when provided by the caller. Omitting Markdown preserves the exact `artifact.md` bytes and SHA while resetting handled comments and removing the old submission.

With `noWait: true`, a valid UUID `artifactConversationId` is required before token claim or mutation. This is a request-parameter boundary; the caller supplies its active Session ID, and advance does not verify Join state, registry existence, or membership. Boolean type, token/state checks, commit/rollback, token consumption, and routing preservation otherwise keep the same rules. The successful commit result returns `artifactId`, `artifactDirectory`, `artifactPath`, `artifactUrl`, `artifactLink`, `reviewSessionId`, the new `reviewRound` and `artifactSha256`, `kind`, `title`, `artifactConversationId`, and `waited: false`, identically in text JSON and `structuredContent`. It attaches no waiter and contains no `decision`, `comments`, `nextAction`, or new round token. An existing waiter is preserved; waiting advances still reject it within the same MCP process. A post-commit `ADVANCE_COMMITTED` error hints inspection of the same handle instead of waiting; never replay that commit.

The [Work Session skill](../../work-session/SKILL.md#artifacts-while-a-session-is-active) owns wait-mode selection for direct updates. Creation still requires the immediate wait, and standalone requests and review-feedback processing keep their existing wait behavior. See **Fresh decisions vs saved submission snapshots** in the artifact skill to handle a commit result without treating absent feedback as an incomplete review response.

## Optional Work Session arguments

Create and inspect use the same selection rules: `artifactConversationId` registers in that exact existing Session; `conversationName` without an ID creates a new Session; omitting both leaves the artifact independent. If both are supplied, the ID takes precedence and the name does not rename or create a Session. A standalone request does not read or mutate the Session registry and does not infer a Session from existing memberships.

Create and inspect always return a top-level `session` field. Standalone returns `session: null` without flat `artifactConversationId` or `conversationName`. A selected or newly created Session returns its context and the existing flat Session fields. Artifact handles, rounds, connection metadata, inspection fields, and review tokens keep their current contracts. The MCP does not store the chat's active Session; the caller supplies any Session arguments.

For active context, explicit New/Join, catalog refresh, Instructions, and Session recovery, follow [work-session](../../work-session/SKILL.md). Do not call Join merely because an artifact already has memberships.

## Review result

Both waiting tools, when waiting for review, return the same client-independent feedback contract in text JSON and `structuredContent`, whether a submission already exists or arrives during the wait. Every `revise`, `approve`, and `save` result includes `comments: { schemaVersion, artifactId, reviewRound, artifactSha256, comments }`. Read the feedback list at `result.comments.comments`; each comment retains its `id`, `createdAt`, `body`, block metadata, and selection anchor. The document is the same snapshot validated against the returned round, artifact hash, comments hash, and submission. `approve` and `save` may have an empty comments list.

| Decision | `nextAction.type` | Round token |
|---|---|---|
| `revise`, any artifact kind | `process-review-feedback` | One-time `roundToken`, source `submitted-review` |
| `approve`, kind `plan` or `implementation-plan` | `execute-approved-plan` | None |
| `approve`, another kind | `approved` | None |
| `save` | None | None |

`process-review-feedback` includes an instruction to apply the shared feedback policy: process every comment, answer questions visibly in chat and include `artifactLink` before waiting, supply complete replacement Markdown only for requested edits, and omit Markdown for question-only feedback. If clarification is needed, ask without consuming the token or advancing. Otherwise advance and wait in the same turn using the retained exact `artifactDirectory`, the returned `reviewRound` as `expectedReviewRound`, and `roundToken`. Never edit managed lifecycle files directly or insert conversational answers into the artifact. Inspect remains available for chat feedback, reconnect, and recovery; the default submitted-review flow already has its comments.

## Availability and lifetime

The artifact skill requires its five tools once when starting an artifact lifecycle in the current chat. Use the current tool catalog; do not probe MCP resources or the filesystem. It does not repeat the check in later rounds unless a tool becomes unavailable, the MCP restarts, or a new chat begins. If the catalog is incomplete, ask the user to run **AI Artifacts: Installer**, select their AI client, confirm with **OK**, **Run**, or **Enter**, restart that AI client, and start a new chat.

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

The artifact is per-user data. Only globally archived artifacts are subject to configured retention (`agentPlus.artifactRetentionDays`, default 90 days). When the extension activates, validated expired archived artifacts are permanently deleted based on `artifact-ui-state.json.archivedAt`, when `now >= archivedAt + retentionDays`. Missing UI state or `archivedAt` means unarchived and preserves the artifact regardless of age, without migration; malformed or unreadable state is skipped. Restore clears `archivedAt`, and archiving again starts a new retention period. Pin, review-round advances, and `artifact.json.updatedAt` do not reset or exempt archive retention. A Session's Archived layout zone does not archive artifacts globally. A waiter is an in-memory connection for one exact artifact. Cancellation, takeover, turn completion, or MCP restart may detach the waiter but never deletes or ends the artifact. Proceed and Just save end only the submitted round. An exact handle may become permanently missing after retention cleanup; the agent must not retry, scan for a replacement, or recreate the same artifact ID. To preserve archived content beyond its retention window, restore the artifact or save a copy with Just save, Copy Markdown, or manual export before cleanup.

## Directory

```text
~/.ai-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json    # present only after submission
  artifact-connection.json  # optional window-routing state
  artifact-ui-state.json    # optional Pin/Archive state; archivedAt drives retention
```

Lifecycle management remains server- or extension-owned. Agents must not create, update, or repair these files directly, except `comments.json` and a `revise` submission in `review-submission.json` for explicitly requested [AI-authored feedback](ai-feedback.md). Schema v6 is the only supported lifecycle contract. Older schemas are unsupported and are not live-migrated.

`artifact.json` is schema-v6 and does not store workspace location: `{ schemaVersion: 6, kind, artifactId, title, createdAt, updatedAt, reviewRound, reviewSessionId }`. Optional `artifact-connection.json` is schema-v1 UI-routing state only: `{ schemaVersion, windowInstanceId, connectionRevision, openRequestId, source, updatedAt }`. `connectionRevision` orders successful commits and `openRequestId` deduplicates filesystem events. Create and reconnect may commit this file; wait and advance preserve it unchanged.

## Handle ownership

After create, use only the exact `artifactDirectory` returned by creation or retained from an interrupted waiter. Keep an `artifactDirectory -> { reviewRound, windowInstanceId }` mapping when a chat owns multiple artifacts, tracking the committed `windowInstanceId` from create and reconnect success. Never select “the latest artifact” or infer a handle from cwd. If the handle is missing or ambiguous, ask the user.

Never scan global storage to discover an artifact.

## Intent decision table

| User intent | Tool flow |
|---|---|
| Pure reconnect to a target window | Call `inspect_artifact_review` with the exact handle, current round, and `intent: "reconnect"` to rebind an active window and emit an open request. Generic reconnect passes cached `connection: { targetMode: "artifact-window", windowInstanceId }`; current-window intent omits affinity; named-window intent uses explicit selection token; after `WINDOW_SELECTION_REQUIRED`, retry the same inspect flow with `connection: { targetMode: "explicit-window", selectionToken }`. |
| Resume waiting without reconnecting | Wait on the exact handle and same round. |
| Read saved comments/submission | Inspect the exact handle with `takeover: true`. |
| Update an empty round directly from chat | Inspect with exact handle, round, and `intent: "explicit-chat-update"`; takeover only when replacing a live waiter for a waiting update. Use the Session-selected wait mode for a direct Session update. |
| Intent or handle is ambiguous | Ask the user before any lifecycle call. Never takeover speculatively. |

If inspection finds no feedback and is not an explicit chat update, reattach to the same round without advancing. An explicit chat-update token requires changed replacement Markdown; follow the selected wait mode. Takeover only aborts and drains the old waiter; it does not mutate lifecycle files.

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

For exact retry and stop actions, follow [Structured recovery](../SKILL.md#structured-recovery) in the already loaded skill. `ARTIFACT_NOT_FOUND` is non-retryable and returns `useSameArtifactHandle: false`. Session-specific errors use the Session bridge. The recovery payload and token binding above remain authoritative technical details.

## Decisions and chat feedback

Follow [Create and review](../SKILL.md#create-and-review), [Unified feedback handling](../SKILL.md#unified-feedback-handling), [After inspection](../SKILL.md#after-inspection), and [Fresh decisions vs saved submission snapshots](../SKILL.md#fresh-decisions-vs-saved-submission-snapshots) in the already loaded skill. The Review result schema and decision-to-nextAction table above remain unchanged. These links do not require reloading the entire skill.
