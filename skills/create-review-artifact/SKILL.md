---
name: create-review-artifact
description: Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds. Also use when explicitly asked to comment on an artifact, with or without submitting Review.
---

# Create Review Artifact

Coordinate one reviewable Markdown artifact for one explicit user request.

## Author AI feedback

When asked to comment on an artifact, with or without submitting Review, follow [references/ai-feedback.md](references/ai-feedback.md). This authors feedback rather than processes saved user feedback; do not enter the create/advance/wait flow for this request.

## Tools and Window Routing

1. Require the current tool catalog to expose `resolve_artifact_window`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`. Do not probe MCP resources or run filesystem commands to check availability. If a tool is unavailable, ask the user to run **AI Artifacts: Installer**, select their AI client, confirm with **OK**, **Run**, or **Enter**, restart their AI client, and start a new chat. Check only once per chat lifecycle unless a tool becomes unavailable, the MCP restarts, or a new chat begins.
2. Read [references/artifact-contract.md](references/artifact-contract.md) before calling `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, or `advance_and_wait_for_artifact`.
3. By default, call `create_artifact` directly without any prior window resolution:
   - The server routes directly to the currently focused VS Code window (or the sole live window).
   - If multiple live windows exist and focus is ambiguous, `create_artifact` returns `WINDOW_SELECTION_REQUIRED` with a list of active window candidates.
   - Compare candidate labels, open folders, and active files against user context. Select a candidate without asking when exactly one clearly matches. Ask the user only when candidates remain tied or ambiguous.
   - When retrying after `WINDOW_SELECTION_REQUIRED`, pass `connection: { targetMode: "explicit-window", selectionToken }`.
   - If you need to proactively discover active windows or check candidate labels before creating, call `resolve_artifact_window({ query })`.
## Session bridge

- For a standalone request, omit both `artifactConversationId` and `conversationName` for that request without clearing the chat's active Work Session.
- Otherwise, if the chat has an active Work Session, pass its ID as `artifactConversationId` to create or inspect. If it has no active Work Session, omit both Session arguments; the artifact remains independent.
- If the user explicitly requests a new Work Session or asks to join or switch Sessions, follow [work-session](../work-session/SKILL.md) for Session arguments and success-only context updates. Do not infer an active Session from artifact memberships, names, or recency.
- A standalone result has `session: null`; it does not clear an existing active Session. When the Session workflow supplies a normalized inspection, apply the artifact inspection and feedback rules below to that object.
- For `CONVERSATION_NOT_FOUND`, `CONVERSATION_REGISTRY_INVALID`, or `CONVERSATION_MIGRATION_REQUIRED`, retain the exact handle and current Session context and follow the Session recovery rules in [work-session](../work-session/SKILL.md). Do not silently switch to standalone or create another Session.

## Create and review

1. Write one complete Markdown document. Call `create_artifact` with `title`, `kind: "implementation-plan"` (or choose another appropriate fixed kind such as `plan`, `idea`, `analysis`, `design`, `spec`, `checklist`, `report`, `guide`, `note`, or an open descriptive slug if none fit), `markdown`. Apply **Session bridge** for optional Session arguments. Omit `connection` by default. Choose the kind that accurately reflects the document's purpose (for example, use `implementation-plan` or `plan` for actionable engineering plans, `spec` for specifications, `checklist` for task lists, etc.). The server stores the schema-v6 lifecycle under the global `~/.ai-artifacts/artifacts/<artifact-id>/` collection. Do not create or edit lifecycle files with filesystem tools.
2. Retain the exact returned global `artifactDirectory`, `reviewRound`, and complete committed connection metadata. Apply **Session bridge** to any returned Session context. When multiple artifacts exist in one chat, maintain an `artifactDirectory -> { reviewRound, windowInstanceId }` mapping. Initialize `windowInstanceId` from the committed connection metadata of `create_artifact`. If a handle is ambiguous, ask the user and never select by recency. Include the returned `artifactLink` in the chat message as a regular file link. It is not a deep link; it opens `artifact.md` in a plain Markdown/text editor. Tell the user to choose **Open Artifact Review** from the file's Explorer, editor, or editor-tab context menu to open the validated artifact in the review editor.
3. Call `wait_for_artifact_review` immediately on that exact handle and round.
4. Handle a submitted decision:
   - `revise`: obey `nextAction.type: "process-review-feedback"` and process every comment in `comments.comments` with **Unified feedback handling** below, using the returned round token. The waiting tool already returns the feedback; no additional inspect is needed just to fetch comments.
   - `approve`: read any remaining comments, then check `nextAction.type`:
     - If `nextAction.type: "execute-approved-plan"` (for `plan` or `implementation-plan`): execute the complete approved plan immediately in the current turn, including all in-scope code, file, workspace, and command actions. Do not stop after acknowledging approval, merely summarize future work, or ask for another implementation confirmation. Pause only for a genuine blocker or authority outside the approved scope. Do not create a new review round or wait again.
     - If `nextAction.type: "approved"` (for any other fixed or open kind): acknowledge the approval and conclude the review. Do not automatically implement code or start another review round.
   - `save`: ask for a destination in the workspace, copy the current Markdown there, and finish. Do not create a new round or wait again.
5. Repeat decision handling after every advanced round. Keep the same artifact directory for the entire request.

## Unified feedback handling

Apply this policy to all saved comments, whether they arrive from a Review (`revise`) submission or `inspect_artifact_review`. Treat Review-button feedback exactly like chat-inspected feedback:

1. Classify all comments together as question-only, change-only, mixed, or needing clarification.
2. Act by class:
   - Question-only: answer every question directly in user-visible chat, then call `advance_and_wait_for_artifact` without `markdown` so the artifact bytes and SHA stay unchanged.
   - Change-only: produce complete replacement Markdown, then call `advance_and_wait_for_artifact` with it.
   - Mixed: answer every question directly in user-visible chat, produce complete replacement Markdown containing the requested changes, then advance with it.
   - Needs clarification: ask the user in chat and do not consume the round token or advance until the answer is available.
3. Send every required chat answer and include `artifactLink` before starting `advance_and_wait_for_artifact`, because that tool waits for the next round.
4. Do not create or update a `## Review responses` section. Keep conversational answers in chat. If a replacement Markdown update touches an artifact containing a section previously generated for review answers, remove that generated section.

## Chat escape, reconnect, and chat updates

Before calling a lifecycle tool, require both a uniquely matching exact handle and a clear intent. If a request such as “look at the artifact” does not distinguish reconnecting, reading saved feedback, or editing directly, ask the user. Never takeover speculatively.

| Intent | Required flow |
|---|---|
| Pure reconnect to a target window | Call `inspect_artifact_review` with the exact handle, current round, and `intent: "reconnect"` to rebind an active window and emit an open request. For generic reconnect ("mở/reopen artifact"), pass `connection: { targetMode: "artifact-window", windowInstanceId }` using your cached ID if available; if the user asks to open in the current/focused window, omit `connection` to force sole/focused resolution; if the user specifies window X, resolve active windows and send `connection: { targetMode: "explicit-window", selectionToken }`. Update your cached `windowInstanceId` from the returned connection on success. If the result is `WINDOW_SELECTION_REQUIRED`, choose a returned candidate and retry the same inspect call with `connection: { targetMode: "explicit-window", selectionToken }`. |
| Resume waiting without reconnecting | Call `wait_for_artifact_review` with the exact handle and current round. |
| Read saved review comments or submission | Call `inspect_artifact_review` with the exact handle and `takeover: true`. |
| Explicitly update an empty round from chat | Call inspect with the exact handle, `expectedReviewRound`, and `intent: "explicit-chat-update"`; use `takeover: true` only when replacing a live waiter for a waiting update. |

### Session direct updates

For a Session direct update, follow the [Work Session skill's wait-mode selection](../work-session/SKILL.md#artifacts-while-a-session-is-active). Use the chat-update token to advance with complete changed Markdown and the selected wait mode. For `noWait: true`, inspect without takeover and leave any existing waiter attached. This exception applies only to explicit chat updates to existing artifacts as part of the active Session; it does not change the wait after creation or the handling of review feedback.

### After inspection

Inspection fields are flat: `comments.comments`, `roundToken`, `reviewRound`, and `artifactDirectory`.

- Takeover cancels and drains the old waiter; it does not end the artifact, advance the round, or edit lifecycle files.
- Reconnect evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity (when matching stored connection and live in registry), and unique focused window, or explicit candidate via selectionToken. Mismatch or stale affinity silently falls back to focused resolution and returns the new committed windowInstanceId to update your cache. Do not send or compare `connectionRevision`.
- If inspection has neither saved comments nor a submission and is not an explicit chat update, tell the user no feedback is saved and call `wait_for_artifact_review` for the same round. Do not advance.
- If feedback exists, process it with **Unified feedback handling**.
- A chat-update token requires complete replacement Markdown with a different SHA. Never ask the user to create dummy comments or click Review after an explicit chat update request.
- To reconnect after Proceed or Just save, inspect the exact artifact, advance without Markdown, and wait. Never repeat the previously approved or saved action.

### Fresh decisions vs saved submission snapshots

- **Commit results:** A `waited: false` result confirms a committed update, not a review decision. Record the returned round and continue the authorized work in the same turn; do not fetch comments or attach a waiter merely because decision or comments are absent. A later update needs a fresh inspection token.
- **Fresh decisions** arrive directly from `wait_for_artifact_review` or `advance_and_wait_for_artifact`. Handle their `nextAction` under **Create and review**, step 4.
- **Saved submission snapshots** returned by inspection represent past review submissions, not a new execution directive. If `submission.decision === "approve"`, acknowledge that the artifact was previously approved. Never re-execute approved code or repeat previous implementations when reconnecting.

## Structured recovery

Follow machine-readable recovery metadata returned by lifecycle errors. Keep the same exact artifact handle.

| Error code | Required recovery |
|---|---|
| `WINDOW_SELECTION_REQUIRED` | Ambiguous window context. If `expectedNextTool: "create_artifact"`, present candidates using window labels, ask user if ambiguous, and retry `create_artifact` with `connection: { targetMode: "explicit-window", selectionToken }`. If `expectedNextTool: "inspect_artifact_review"`, retry `inspect_artifact_review` on the same handle with `intent: "reconnect"` and `connection: { targetMode: "explicit-window", selectionToken }`. |
| `ROUND_TOKEN_INVALID_OR_EXPIRED`, `ROUND_TOKEN_ALREADY_CONSUMED`, `ROUND_MISMATCH`, `ROUND_STATE_CHANGED` | Inspect the same exact handle for current state and a fresh token. Do not replay old Markdown or actions. |
| `ROUND_TOKEN_IN_USE` | Do not issue another advance. Wait for the in-flight request, then inspect only if its result is unclear. |
| `ARTIFACT_ALREADY_WAITING` | Another live waiter already owns the exact artifact. Do not start a second wait. For resume-wait intent, keep awaiting the in-flight call; for pure reconnect, call `inspect_artifact_review` with `intent: "reconnect"` without takeover; use takeover only for saved feedback or an explicit direct update that replaces the waiter. |
| `ADVANCE_CANCELLED_BEFORE_COMMIT`, `ADVANCE_ROLLED_BACK` with `reuseRoundToken: true` | Retry the same advance only when the server explicitly confirms the token remains valid. |
| `ADVANCE_COMMITTED` | Do not replay. Follow the hinted operation on the reported round: wait for a waiting advance, or inspect to confirm state for a non-waiting update without automatically starting a waiter. |
| `WINDOW_NOT_FOUND` | No active VS Code window was found. Ask the user to open VS Code, then retry. |
| `WINDOW_SELECTION_EXPIRED` | Window selection token expired or window was closed. Retry `create_artifact` or `inspect_artifact_review` without connection to refresh candidate windows. |
| `WINDOW_CONNECTION_MISMATCH`, `WINDOW_CONNECTION_STALE` | Selected window is stale or closed. Retry without connection token to refresh candidates. |
| `ARTIFACT_CONNECTION_INVALID` | Stored routing data is invalid or malformed and cannot be repaired by the skill. Stop automated recovery, retain the exact handle, report the corrupt `artifact-connection.json`, and ask the user to repair or remove that optional routing file before reconnecting. Do not retry inspect/reconnect or edit lifecycle files yourself. |
| `ARTIFACT_CONNECTION_WRITE_FAILED` | Failed to update the connection state atomically. Retry `inspect_artifact_review` on the exact handle with `intent: "reconnect"`. |
| `ARTIFACT_NOT_FOUND` | The exact artifact handle no longer exists (retention cleanup, manual deletion, or filesystem loss). Non-retryable. Drop the stale handle mapping and inform the user that the artifact is permanently unavailable. Do not retry, scan for a replacement, or recreate the same artifact ID. |

Except for explicit non-retryable errors such as `ARTIFACT_CONNECTION_INVALID`, inspect the exact handle before retrying any error that does not prove both “not committed” and `reuseRoundToken: true`.

## Lifecycle rules

- Artifact lifetime is longer than waiter lifetime, which is longer than an individual chat-turn lifetime. Only globally archived artifacts are subject to configured retention; unarchived artifacts are kept. An exact handle may become permanently missing after deletion.
- Cancellation, chat-turn completion, or MCP restart detaches a waiter but never deletes or finishes an artifact.
- One independent user request owns one artifact directory and artifact ID. Only one live waiter may own it at a time.
- Advancing replaces the same `artifact.md` only when Markdown is supplied, increments the round, resets handled comments, and removes the old submission. It does not create revision history.
- Round tokens are exact-state, one-time capabilities. After MCP restart, inspect the exact artifact again to obtain a fresh token.
- Only the MCP server creates artifacts, advances rounds, resets comments, consumes tokens, and writes lifecycle metadata.
- Never edit lifecycle files directly, except `comments.json` and `review-submission.json` for explicitly requested **Author AI feedback**. Keep artifact creation, content updates and round management in the MCP tools.
- Write a coherent artifact, not a patch, changelog, task tracker, or progress report. For explicit updates to an existing artifact in the active Session, user-requested checklist/progress content may be updated under **Session direct updates**; this does not authorize automatic artifact creation.

## User Custom Rules

Instructions inside the `USER CUSTOM RULES` block below override the default rules in this skill when they conflict. Keep custom rules inside the markers so they are preserved across skill updates and reinstalls.

<!-- >>> USER CUSTOM RULES >>> -->
<!-- <<< USER CUSTOM RULES <<< -->
