---
name: create-review-artifact
description: Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds.
---

# Create Review Artifact

Coordinate one reviewable Markdown artifact for one user request. Read [references/artifact-contract.md](references/artifact-contract.md) before calling the MCP tools.

## Trigger policy

- Trigger only when the user explicitly asks to create or update an artifact, inspect its saved review comments, or reconnect its review lifecycle.

## Artifact kind

- For a plan artifact, use `kind: "implementation-plan"` when it directly guides code, file, workspace, or command changes; use `kind: "plan"` for other executable plans.
- For any other artifact, choose a short lowercase slug for `kind`.

## Create and default review flow

1. Require the `codex_artifacts` MCP server to expose `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`. If unavailable, ask the user to run **Codex Artifacts: Install Global Codex Integration**, restart Codex, and start a new chat.
2. Pass the workspace evidence gate before any artifact filesystem operation. Resolve candidates in this order and stop at the first verified, unambiguous root:
   1. A path, file link, `@mention`, or attachment explicitly supplied in the user's messages.
   2. An active/open file supplied by IDE context with a concrete path.
   3. A repository or folder explicitly named in the conversation, after resolving it and inspecting at least one relevant project marker, document, or source path.
   4. If none of the above yields exactly one verified root, ask the user which workspace owns the artifact.
   - Treat Codex/session cwd, `environment_context`, workspace-folder order, the first visible repository, and the first search result as orientation hints only. Never describe any of them as the active or selected workspace.
   - Require an existing absolute directory and evidence that the requested work belongs there. A matching directory name alone is insufficient.
   - Do not inspect unrelated roots, create files, or call artifact tools until the root is verified and unambiguous.
3. Map the verified source to `workspaceEvidence`: `explicit-user-path` with the existing absolute path and exact user text; `active-file` with the concrete IDE path; `explicit-user-folder` with exact user text naming one folder; or `single-workspace` only when available workspace context proves exactly one registered folder. Never invent or paraphrase user evidence.
4. Write one complete Markdown document. Call `create_artifact` with the verified absolute `workspaceRoot`, `workspaceEvidence`, `title`, `kind`, and `markdown`. If it returns `AMBIGUOUS_WORKSPACE` or `WORKSPACE_EVIDENCE_MISMATCH`, ask the user; do not retry another inferred root. Do not create or edit lifecycle files with filesystem tools.
5. Retain the exact returned `artifactDirectory` and `reviewRound`, then call `wait_for_artifact_review`. This preserves the familiar behavior in which the artifact opens and the current Codex turn waits for Review, Proceed, or Just save.
6. Handle a submitted decision:
   - `revise`: process every returned comment with **Unified feedback handling** below, using the returned round token. Treat Review-button feedback exactly like chat-inspected feedback.
   - `approve`: read any remaining comments before acting. For `kind: "plan"` or `kind: "implementation-plan"`, obey `nextAction.type: "execute-approved-plan"`: execute the complete approved plan immediately in the current turn, including all in-scope code, file, workspace, and command actions. Do not stop after acknowledging approval, do not merely summarize what would be done, and do not ask for another implementation confirmation. Pause only for a genuine blocker or authority outside the approved scope. Do not create a new review round or wait again. For non-plan artifact kinds, continue only with the action implied by the original request.
   - `save`: ask for a destination in the workspace, copy the current Markdown there, and finish. Do not create a new round or wait again.
7. Repeat decision handling after every advanced round. Keep the same artifact directory for the entire request.

## Unified feedback handling

Apply this policy to all saved comments, whether they arrive from a Review (`revise`) submission or `inspect_artifact_review`:

1. Classify all comments together as question-only, change-only, mixed, or needing clarification.
2. Act by class:
   - Question-only: answer every question directly in user-visible chat, then call `advance_and_wait_for_artifact` without `markdown` so the artifact bytes and SHA stay unchanged.
   - Change-only: produce complete replacement Markdown, then call `advance_and_wait_for_artifact` with it.
   - Mixed: answer every question directly in user-visible chat, produce complete replacement Markdown containing the requested changes, then advance with it.
   - Needs clarification: ask the user in chat and do not consume the round token or advance until the answer is available.
3. Send every required chat answer before starting `advance_and_wait_for_artifact`, because that tool waits for the next round.
4. Do not create or update a `## Review responses` section. Keep conversational answers in chat. If a replacement Markdown update touches an artifact containing a section previously generated for review answers, remove that generated section.

## Chat escape, reconnect, and chat updates

1. **Pure reconnect:** When the user only asks to reconnect, resume waiting, or continue without requesting edits (e.g. “kết nối lại”, “chờ tiếp”):
   - Call `wait_for_artifact_review` for the exact `artifactDirectory` and current `expectedReviewRound`.
   - Do not inspect with intent, do not modify Markdown, and do not advance the round.

2. **Chat escape for saved review comments:** When the user interrupts a live waiter with “hãy xem review”, “đọc comment”, or an equivalent request:
   - Use the exact `artifactDirectory` returned by `create_artifact` or passed to the waiter that was just cancelled in the same conversation. Never search for the latest artifact and never infer the handle from cwd.
   - If no unique exact handle remains in context, ask the user for the artifact path.
   - Call `inspect_artifact_review` with `takeover: true`. Takeover cancels and drains the old waiter; it does not end the artifact or its round.
   - If inspection has neither saved comments nor a submission, tell the user that no feedback is saved and call `wait_for_artifact_review` for the same round. Do not advance.
   - If saved comments exist, process them with **Unified feedback handling**.

3. **Explicit chat update on an empty round:** When the user explicitly requests changes in chat without saving comments on the UI (e.g. “thêm phase X vào artifact”, “sửa mục Y trong tài liệu này”):
   - Call `inspect_artifact_review` with `takeover: true`, `expectedReviewRound: currentRound`, and `intent: "explicit-chat-update"`.
   - This grants a one-time round token with source `chat-update`.
   - Answer any chat questions, produce the complete replacement Markdown containing the requested changes (its SHA must differ from the current document), and call `advance_and_wait_for_artifact` with `roundToken` and `markdown`.
   - Never instruct the user to click Review or create dummy comments when they gave explicit instructions in chat.

4. **Reconnect after Proceed or Just save:** To reconnect a round already ended by Proceed or Just save, explicitly inspect the exact artifact, use its fresh token to advance without Markdown, and wait for the new round. Reconnection must not repeat the previously approved or saved action.

## Lifecycle rules

- Artifact lifetime is longer than waiter lifetime, which is longer than an individual chat-turn lifetime.
- Cancellation, chat-turn completion, or MCP restart detaches a waiter but never deletes or finishes an artifact.
- One independent user request owns one artifact directory and artifact ID. Only one live waiter may own it at a time.
- Advancing replaces the same `artifact.md` only when Markdown is supplied, increments the round, resets handled comments, and removes the old submission. It does not create revision history.
- Round tokens are exact-state, one-time capabilities. After MCP restart, inspect the artifact again to obtain a fresh token.
- Only the MCP server creates artifacts, advances rounds, resets comments, consumes tokens, and writes lifecycle metadata.
- Never edit `artifact.json`, `comments.json`, or `review-submission.json` directly.
- Write a coherent artifact, not a patch, changelog, task tracker, or progress report.
