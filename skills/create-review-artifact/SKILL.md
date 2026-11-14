---
name: create-review-artifact
description: Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds. Also use when explicitly asked to comment on an artifact, with or without submitting Review.
---

# Create Review Artifact

Coordinate one reviewable Markdown artifact for one explicit user request.

## Author AI feedback

When asked to comment on an artifact, with or without submitting Review, follow [references/ai-feedback.md](references/ai-feedback.md). This authors feedback rather than processes saved user feedback; do not enter the create/advance/wait flow for this request.

## Tools and Window Routing

1. Require the current tool catalog to expose `resolve_artifact_window`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact`, and `update_artifact`. Do not probe MCP resources or run filesystem commands to check availability. If a tool is unavailable, ask the user to run **AI Artifacts: Installer**, select their AI client, confirm with **OK**, **Run**, or **Enter**, restart their AI client, and start a new chat. Check only once per chat lifecycle unless a tool becomes unavailable, the MCP restarts, or a new chat begins.
2. Use the tool and result contract below for normal lifecycle calls. Read [references/storage-protocol.md](references/storage-protocol.md) only when investigating persisted schemas or raw window-resolution data.
3. By default, call `create_artifact` directly without any prior window resolution:
   - The server routes directly to the currently focused VS Code window (or the sole live window).
   - If multiple live windows exist and focus is ambiguous, `create_artifact` returns `WINDOW_SELECTION_REQUIRED` with a list of active window candidates.
   - Compare candidate labels, open folders, and active files against user context. Select a candidate without asking when exactly one clearly matches. Ask the user only when candidates remain tied or ambiguous.
   - When retrying after `WINDOW_SELECTION_REQUIRED`, pass `connection: { targetMode: "explicit-window", selectionToken }`.
   - If you need to proactively discover active windows or check candidate labels before creating, call `resolve_artifact_window({ query })`.

### Tool contract

| Tool                       | Inputs and behavior                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_artifact`          | `title`, lowercase `kind`, complete `markdown`; optional `wait` defaults to `true`. Creates the artifact, then waits internally and returns its handle plus the review result. `wait: false` returns the create handle immediately. Apply Session bridge and window targeting below.                                                                                                     |
| `inspect_artifact`         | Exact `artifactDirectory`; optional `expectedReviewRound`, `takeover`, `intent`, `connection`, Session arguments, and `wait` (default `false`). Returns a validated snapshot. With `wait: true`, waits internally only when there are no saved comments, submission, or chat-update token to return. `intent: "explicit-chat-update"` requires `expectedReviewRound` and an empty round. |
| `update_artifact`          | Exact `artifactDirectory`, `expectedReviewRound`, `roundToken`; optional complete `markdown` and `wait` (default `true`). Commits the next round and waits internally. `wait: false` commits without waiting and preserves any existing waiter. This tool does not accept or echo `artifactConversationId`.                                                                              |
| `wait_for_artifact_review` | Exact `artifactDirectory`, `expectedReviewRound`; optional `takeover` and `artifactConversationId`. Use for wait-only/resume. The expected round is checked at attachment only; an attached waiter can receive a later validated round after non-waiting updates. The result/token belong to that submitted round.                                                                       |

Use `wait: false` for update only when the user or specific Instructions/workflow requests a non-waiting update; otherwise keep `wait: true`. An active Session alone does not select non-waiting mode. Create/review and saved-feedback processing keep their waiting flow unless explicitly directed otherwise.

Review results are flat and identical in text JSON and `structuredContent`: every `revise`, `approve`, or `save` includes the complete validated `comments` document, with feedback at `comments.comments`, matching the returned round/hashes/submission. A `revise` result also supplies `nextAction.type: "process-review-feedback"`, a one-time `roundToken`, and `roundTokenSource: "submitted-review"`. Create preserves its handle and applicable Session/connection; inspect preserves Markdown/manifest from the same validated snapshot as its review result. Classify results under **Fresh decisions vs saved submission snapshots** before acting.

Create/inspect retain `artifactDirectory`, `artifactId`, `artifactPath`, `artifactUrl`, `artifactLink`, `reviewSessionId`, `reviewRound`, `artifactSha256`, and `kind`, with applicable `session` and `connection`. Inspect also returns `markdown`, `manifest`, `comments`, hashes and optional `submission`/token. Use returned links and validated fields rather than reconstructing them.

An `artifactLink` is a regular file link. It is not a deep link; it opens `artifact.md` in a plain Markdown/text editor. Whenever sending an artifact link, remind the user to choose **Open Artifact Review** from the file's Explorer, editor, or editor-tab context menu.

## Session bridge

- For a standalone request, omit both `artifactConversationId` and `conversationName` for that request without clearing the chat's active Work Session.
- Otherwise, if the chat has an active Work Session, pass its ID as `artifactConversationId` to create or inspect. If it has no active Work Session, omit both Session arguments; the artifact remains independent.
- If the user explicitly requests a new Work Session or asks to join or switch Sessions, follow [work-session](../work-session/SKILL.md) for Session arguments and success-only context updates. Do not infer an active Session from artifact memberships, names, or recency.
- A standalone result has `session: null`; it does not clear an existing active Session. When the Session workflow supplies a normalized inspection, apply the artifact inspection and feedback rules below to that object.
- Create/inspect with neither Session argument remain standalone. `conversationName` without an ID explicitly creates a new Session; when both are supplied, the ID takes precedence and the name does not rename or create a Session. Session results retain the flat Session fields and a top-level context; update has no Session arguments or context result.
- For `CONVERSATION_NOT_FOUND`, `CONVERSATION_REGISTRY_INVALID`, or `CONVERSATION_MIGRATION_REQUIRED`, retain the exact handle and current Session context and follow the Session recovery rules in [work-session](../work-session/SKILL.md). Do not silently switch to standalone or create another Session.

## Create and review

1. Write one complete Markdown document. Call `create_artifact` with `title`, `kind: "implementation-plan"` (or choose another appropriate fixed kind such as `plan`, `idea`, `analysis`, `design`, `spec`, `checklist`, `report`, `guide`, `note`, or an open descriptive slug if none fit), `markdown`, and `wait: true`. Apply **Session bridge** for optional Session arguments. Omit `connection` by default. Choose the kind that accurately reflects the document's purpose (for example, use `implementation-plan` or `plan` for actionable engineering plans, `spec` for specifications, `checklist` for task lists, etc.). The server stores the schema-v6 lifecycle under the global `~/.ai-artifacts/artifacts/<artifact-id>/` collection. Do not create or edit lifecycle files with filesystem tools.
2. Retain the exact returned global `artifactDirectory`, `reviewRound`, and complete committed connection metadata. Apply **Session bridge** to any returned Session context. When multiple artifacts exist in one chat, maintain an `artifactDirectory -> { reviewRound, windowInstanceId }` mapping. Initialize `windowInstanceId` from the committed connection metadata of `create_artifact`. If a handle is ambiguous, ask the user and never select by recency. Include the returned `artifactLink` in the chat message.
3. Process the review result returned by create directly; do not call a second wait after create has already waited. The handle/link becomes available when the tool returns, including recovery after a completed create; do not split create and wait just to display the link before its internal wait.
4. Handle a submitted decision:
   - `revise`: obey `nextAction.type: "process-review-feedback"` and process every comment in `comments.comments` with **Unified feedback handling** below, using the returned round token. The waiting tool already returns the feedback; no additional inspect is needed just to fetch comments.
   - `approve`: read any remaining comments, then check `nextAction.type`:
     - If `nextAction.type: "execute-approved-plan"` (for `plan` or `implementation-plan`): execute the complete approved plan immediately in the current turn, including all in-scope code, file, workspace, and command actions. Do not stop after acknowledging approval, merely summarize future work, or ask for another implementation confirmation. Pause only for a genuine blocker or authority outside the approved scope. Do not create a new review round or wait again.
     - If `nextAction.type: "approved"` (for any other fixed or open kind): acknowledge the approval and conclude the review. Do not automatically implement code or start another review round.
   - `save`: ask for a destination in the workspace, copy the current Markdown there, and finish. Do not create a new round or wait again.
5. Repeat decision handling after every advanced round. Keep the same artifact directory for the entire request.

## Unified feedback handling

Apply this policy to all saved comments, whether they arrive from a Review (`revise`) submission or `inspect_artifact`. Treat Review-button feedback exactly like chat-inspected feedback:

1. Classify all comments together as question-only, change-only, mixed, or needing clarification.
2. Act by class:
   - Question-only: answer every question directly in user-visible chat, then call `update_artifact` without `markdown` so the artifact bytes and SHA stay unchanged.
   - Change-only: produce complete replacement Markdown, then call `update_artifact` with it.
   - Mixed: answer every question directly in user-visible chat, produce complete replacement Markdown containing the requested changes, then advance with it.
   - Needs clarification: ask the user in chat and do not consume the round token or advance until the answer is available.
3. Send every required chat answer and include `artifactLink` before starting `update_artifact`. Use the returned `reviewRound` as `expectedReviewRound`, the exact retained `artifactDirectory`, and the one-time token. Select the wait mode under **Tool contract**.
4. Do not create or update a `## Review responses` section. Keep conversational answers in chat. If a replacement Markdown update touches an artifact containing a section previously generated for review answers, remove that generated section.

## Chat escape, reconnect, and chat updates

Before calling a lifecycle tool, require both a uniquely matching exact handle and a clear intent. If a request such as “look at the artifact” does not distinguish reconnecting, reading saved feedback, or editing directly, ask the user. Never takeover speculatively.

| Intent                                     | Required flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pure reconnect to a target window          | Call `inspect_artifact` with `wait: false`, the exact handle, current round, and `intent: "reconnect"`. Reconnect evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity, then unique focused window, or an explicit candidate via selectionToken. For generic reconnect, pass cached `connection: { targetMode: "artifact-window", windowInstanceId }` when available; mismatched/stale affinity falls back to focused resolution. For the current/focused window, omit `connection`; for a named window, resolve candidates and pass `connection: { targetMode: "explicit-window", selectionToken }`. On `WINDOW_SELECTION_REQUIRED`, choose a candidate and retry the same inspect call with `connection: { targetMode: "explicit-window", selectionToken }`. Cache the returned `windowInstanceId` on success. Do not send or compare `connectionRevision`. |
| Resume waiting without reconnecting        | Call `wait_for_artifact_review` with the exact handle and current round.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Read saved review comments or submission   | Call `inspect_artifact` with the exact handle, `wait: false`, and `takeover: true`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Inspect and continue waiting for review    | Call `inspect_artifact` with `wait: true`; saved feedback/submission or a chat-update token returns immediately, otherwise the same call waits. Use takeover only when intentionally replacing a live waiter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Explicitly update an empty round from chat | Call inspect with `wait: false`, the exact handle, `expectedReviewRound`, and `intent: "explicit-chat-update"`; use `takeover: true` only when replacing a live waiter for a waiting update.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Direct updates from chat

Use the chat-update token to call `update_artifact` with complete changed Markdown and the wait mode from **Tool contract**. For `wait: false`, inspect without takeover and leave any existing waiter attached.

### After inspection

Inspection fields are flat: `comments.comments`, `roundToken`, `reviewRound`, and `artifactDirectory`.

- Takeover cancels and drains the old waiter; it does not end the artifact, advance the round, or edit lifecycle files.
- If inspection has neither saved comments nor a submission and is not an explicit chat update, do not advance. For an inspect-and-wait request, the `wait: true` call already waits internally. After a read-only/reconnect inspection, call public wait only if the requested workflow requires resuming review; pure inspection stays immediate.
- A chat-update token requires complete replacement Markdown with a different SHA. Never ask the user to create dummy comments or click Review after an explicit chat update request.
- To open a new review after Proceed or Just save, inspect the exact artifact with `wait: false`, then call `update_artifact` without Markdown and with `wait: true`. Never repeat the previously approved or saved action.

### Fresh decisions vs saved submission snapshots

- **Commit results:** A `waited: false` result confirms a committed update, not a review decision. It returns the handle/link, new round/hash, kind/title, and no `decision`, `comments`, `nextAction`, or new round token. Record the returned round and continue the authorized work in the same turn; do not fetch comments or attach a waiter merely because decision or comments are absent. A later update needs a fresh inspection token.
- **Errors:** Check `isError` before processing decision fields; follow recovery metadata and retain any completed create/inspection handle, Session, and connection. A failed follow-up wait does not roll back the completed operation. If create succeeded before cancellation, reuse its exact handle. If cancellation leaves no `artifactDirectory`, guide the user to click **Inspect** on the artifact if it is still open, or reopen it from **AI Artifacts** (library icon) → **Recent Artifacts** and click **Inspect**. Ask them to paste the copied prompt into chat to recover the exact handle. Never create a duplicate just because waiting failed.
- **Fresh decisions** are successful top-level `decision` results from `create_artifact`, `inspect_artifact`, or `update_artifact` when they wait, or from `wait_for_artifact_review`. Handle their `nextAction` under **Create and review**, step 4. A revise includes its validated comments/token; approve/save may have empty comments and no token.
- **Saved submission snapshots** returned by inspection represent past review submissions, not a new execution directive. If `submission.decision === "approve"`, acknowledge that the artifact was previously approved. Never re-execute approved code or repeat previous implementations when reconnecting.
- Inspect can return a saved snapshot even with `wait: true`; neither the wait argument nor a round token alone identifies a fresh decision. `join_session.inspection` always remains an inspection snapshot.

## Structured recovery

When a lifecycle tool reports an error, read [references/recovery.md](references/recovery.md) for its recovery metadata and required action. Keep the exact handle and never replay committed operations; `ARTIFACT_NOT_FOUND` is terminal, so drop that stale handle.

## Lifecycle rules

- Artifact lifetime is longer than waiter lifetime, which is longer than an individual chat-turn lifetime: `artifact lifetime > waiter lifetime > chat-turn lifetime`. An exact handle may become permanently missing after deletion.
- Cancellation, chat-turn completion, or MCP restart detaches a waiter but never deletes or finishes an artifact.
- One independent user request owns one artifact directory and artifact ID. Only one live waiter may own it at a time.
- Advancing replaces the same `artifact.md` only when Markdown is supplied, increments the round, resets handled comments, and removes the old submission. It does not create revision history.
- Round tokens are in-memory, single-use, expire after one hour, and bind the exact artifact/review session, round, artifact/comments hashes, and submission presence/hash. Consume them only through a successful update; any intervening state change rejects the token. After MCP restart, inspect the exact artifact again to obtain a fresh token.
- Create and explicit reconnect may commit routing state. Wait and update preserve it unchanged; they do not rebind windows or emit open requests. Never scan storage or infer an artifact handle from cwd.
- Only the MCP server creates artifacts, advances rounds, resets comments, consumes tokens, and writes lifecycle metadata.
- Never edit lifecycle files directly, except `comments.json` and `review-submission.json` for explicitly requested **Author AI feedback**. Keep artifact creation, content updates and round management in the MCP tools.
- Write a coherent artifact, not a patch or changelog. Include checklist/progress content only when requested; this does not authorize automatic artifact creation.

## User Custom Rules

Instructions inside the `USER CUSTOM RULES` block below override the default rules in this skill when they conflict. Keep custom rules inside the markers so they are preserved across skill updates and reinstalls.

<!-- >>> USER CUSTOM RULES >>> -->
<!-- <<< USER CUSTOM RULES <<< -->
