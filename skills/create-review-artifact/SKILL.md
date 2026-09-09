---
name: create-review-artifact
description: Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds.
---

# Create Review Artifact

Coordinate one reviewable Markdown artifact for one explicit user request.

## Resolve the workspace first

1. Require the current tool catalog to expose `resolve_artifact_workspace`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`. Do not probe MCP resources or run filesystem commands to check availability. If a tool is unavailable, ask the user to run **AI Artifacts: Install All Detected Integrations** (or the install command for their specific AI client), restart their AI client, and start a new chat. Check only once per chat lifecycle unless a tool becomes unavailable, the MCP restarts, or a new chat begins.
2. Before reading target-workspace instructions, documentation, source, or drafting artifact content, resolve exactly one target workspace folder through one of these flows:
   - **Tagged file:** use the concrete path explicitly tagged, linked, mentioned, or attached by the user. Resolve its one containing workspace folder and retain `{ kind: "tagged-file", filePath }`. If tagged files span roots or ownership is ambiguous, ask the user.
   - **No tagged file:** call `resolve_artifact_workspace({ query })` immediately, using the user's exact repository/workspace words. This resolver is the only MCP tool that may run before reading the contract. Do not scan folders or rewrite the query first.
     - For `status: "selection-required"`, compare every returned candidate's name, path, and `match` against the user's exact workspace words. Select a candidate without asking when exactly one is clearly the strongest match. Prefer `exact-path` over `exact-name`, `exact-name` over `similar-name`, and any matched candidate over `available`. Treat the sole `single-folder` candidate as unambiguous and select it immediately; this classification is supplied by MCP, not inferred by the agent.
     - `matchMode: "matched"` means either the resolver found one or more string matches, or the uniquely scoped VS Code workspace contains exactly one folder and returns it with `match: "single-folder"`. Use the ranking above and ask the user only when the strongest result is tied or otherwise ambiguous.
     - `matchMode: "all-available"` means the query did not match within a multi-root workspace, so the candidates are every fresh folder in that one workspace context. Select one only when its name or path is a uniquely high-confidence semantic match to the user's words; otherwise show the candidates and ask the user.
     - `status: "not-found"` with `matchMode: "none"` means no fresh workspace is available; ask the user to open the workspace or tag one of its files.
     - `WORKSPACE_CONTEXT_AMBIGUOUS` means the registry cannot identify one VS Code workspace context. Ask the user to focus the intended VS Code window, then retry the same query. Do not combine or inspect folders from different windows.
     - After either a confident agent choice or an explicit user choice, call create with the exact candidate path and `{ kind: "resolved-workspace", selectionToken }`. If the selection expires or registry context changes, resolve and choose again, asking the user only if it is ambiguous.
   - Cwd, `environment_context`, untagged active files, workspace order, project markers, inferred folder names, and search results are never creation evidence.
3. Once exactly one target workspace folder is chosen, read [references/artifact-contract.md](references/artifact-contract.md) before inspecting that folder or calling `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, or `advance_and_wait_for_artifact`. Then read the chosen folder's required instruction files and the minimum relevant documentation/source needed to produce the requested artifact. Do not inspect other roots.

## Create and review

1. Write one complete Markdown document. Call `create_artifact` with the verified absolute `workspaceRoot`, one evidence object, title, `kind: "implementation-plan"`, and `markdown`. Keep `kind` only for protocol compatibility; do not classify the document. Do not create or edit lifecycle files with filesystem tools.
2. Retain the exact returned `artifactDirectory`, `workspaceRoot`, and `reviewRound`. When multiple artifacts exist in one chat, maintain a request/workspace-to-handle-and-round mapping. If a handle is ambiguous, ask the user and never select by recency.
3. Call `wait_for_artifact_review` immediately on that exact handle and round. After creation, never call `resolve_artifact_workspace` again for this artifact; later tools use the retained handle while the MCP verifies its manifest workspace internally.
4. Handle a submitted decision:
   - `revise`: process every returned comment with **Unified feedback handling** below, using the returned round token. Treat Review-button feedback exactly like chat-inspected feedback.
   - `approve`: read any remaining comments, then obey `nextAction.type: "execute-approved-plan"`: execute the complete approved plan immediately in the current turn, including all in-scope code, file, workspace, and command actions. Do not stop after acknowledging approval, merely summarize future work, or ask for another implementation confirmation. Pause only for a genuine blocker or authority outside the approved scope. Do not create a new review round or wait again.
   - `save`: ask for a destination in the workspace, copy the current Markdown there, and finish. Do not create a new round or wait again.
5. Repeat decision handling after every advanced round. Keep the same artifact directory for the entire request.

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

Before calling a lifecycle tool, require both a uniquely matching exact handle and a clear intent. If a request such as “look at the artifact” does not distinguish reconnecting, reading saved feedback, or editing directly, ask the user. Never takeover speculatively.

| Intent | Required flow |
|---|---|
| Pure reconnect, resume waiting, or continue without edits | Call `wait_for_artifact_review` with the exact handle and current round. Do not inspect, modify Markdown, or advance. |
| Read saved review comments or submission | Call `inspect_artifact_review` with the exact handle and `takeover: true`. |
| Explicitly update an empty round from chat | Call inspect with the exact handle, `takeover: true`, `expectedReviewRound`, and `intent: "explicit-chat-update"`. |

- Takeover cancels and drains the old waiter; it does not end the artifact, advance the round, or edit lifecycle files.
- If inspection has neither saved comments nor a submission, tell the user no feedback is saved and call `wait_for_artifact_review` for the same round. Do not advance.
- If feedback exists, process it with **Unified feedback handling**.
- A chat-update token requires complete replacement Markdown with a different SHA. Never ask the user to create dummy comments or click Review after an explicit chat update request.
- To reconnect after Proceed or Just save, inspect the exact artifact, advance without Markdown, and wait. Never repeat the previously approved or saved action.

## Structured recovery

Follow machine-readable recovery metadata returned by lifecycle errors. Keep the same exact artifact handle and never call `resolve_artifact_workspace` during recovery.

| Error code | Required recovery |
|---|---|
| `ROUND_TOKEN_INVALID_OR_EXPIRED`, `ROUND_TOKEN_ALREADY_CONSUMED`, `ROUND_MISMATCH`, `ROUND_STATE_CHANGED` | Inspect the same exact handle for current state and a fresh token. Do not replay old Markdown or actions. |
| `ROUND_TOKEN_IN_USE` | Do not issue another advance. Wait for the in-flight request, then inspect only if its result is unclear. |
| `ARTIFACT_ALREADY_WAITING` | Use the intent table: reconnect by waiting, or inspect with takeover only for saved feedback/direct update. |
| `ADVANCE_CANCELLED_BEFORE_COMMIT`, `ADVANCE_ROLLED_BACK` with `reuseRoundToken: true` | Retry the same advance only when the server explicitly confirms the token remains valid. |
| `ADVANCE_COMMITTED` | Do not replay. Continue with the reported round using the hinted wait flow. |
| `WORKSPACE_NOT_REGISTERED` | Ask the user to reopen or restore the artifact's workspace; do not resolve another workspace. |

For any error that does not prove both “not committed” and `reuseRoundToken: true`, inspect the exact handle before retrying.

## Lifecycle rules

- Artifact lifetime is longer than waiter lifetime, which is longer than an individual chat-turn lifetime.
- Cancellation, chat-turn completion, or MCP restart detaches a waiter but never deletes or finishes an artifact.
- One independent user request owns one artifact directory and artifact ID. Only one live waiter may own it at a time.
- Advancing replaces the same `artifact.md` only when Markdown is supplied, increments the round, resets handled comments, and removes the old submission. It does not create revision history.
- Round tokens are exact-state, one-time capabilities. After MCP restart, inspect the exact artifact again to obtain a fresh token.
- Only the MCP server creates artifacts, advances rounds, resets comments, consumes tokens, and writes lifecycle metadata.
- Never edit `artifact.json`, `comments.json`, or `review-submission.json` directly.
- Write a coherent artifact, not a patch, changelog, task tracker, or progress report.
