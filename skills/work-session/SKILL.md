---
name: work-session
description: Connect to or continue an AI Artifacts Work Session, applying its instructions and current artifact context across requests.
---

# Work Session

Manage one active Work Session in the current chat. A Session can be shared across agents and chats; its context contains metadata, Instructions, and artifact catalogs, not another chat's transcript.

## Entry and active context

1. Require `join_session` in the current tool catalog before joining or refreshing a Session. Check once for this workflow unless the tool becomes unavailable or the MCP restarts. Do not probe MCP resources or installed files to test tool availability. If unavailable, ask the user to run **AI Artifacts: Install All Detected Integrations** (or their client's install command), restart that client, and start a new chat.
2. Read [references/session-contract.md](references/session-contract.md) before Session entry or refresh. Keep at most one `activeSessionId` per chat, together with the current Instructions, `instructionsPath`, and catalog paths.
3. To join or switch to an exact Session, call `join_session({ sessionId })`. Adopt the returned `session.sessionId`, Instructions, path, and catalog only after success. A failed entry preserves the previous context; do not guess an ID, fall back to another Session, or create a replacement.
4. If the user asks to work in a Session but no exact ID is known and no Session is active, ask for its Connect prompt or exact ID. Never select by title, recency, artifact membership, PID, or AI client identity.
5. If the user explicitly asks to create an artifact and start a new Session, follow [create-review-artifact](../create-review-artifact/SKILL.md), omit the old `artifactConversationId`, and supply `conversationName`. Use the user's name when provided; otherwise derive a concise name from the requested work. On successful creation, adopt the returned non-null `session` context. Do not create an artifact just to start an empty Session; empty Sessions can be created from the extension UI.
6. Keep the active Session for later related requests. Loading the artifact skill does not itself require another Join. An explicit request to leave the Session clears only the chat's active Session context; it does not delete the Session, memberships, or retained artifact handles.

After a successful tool call returns a non-null Session context, replace the active Session catalog with the returned catalog; do not merge it with older snapshots. Preserve retained artifact review handles separately.

## Related requests and refresh

- Apply these rules when the request concerns the active Session's work. Mentions such as plan or blueprint are semantic references, not unconditional keyword triggers. Do not apply Session instructions to an unrelated request merely because a Session is active.
- Before acting on a related request, read the current Instructions from the exact `instructionsPath`, or use the fresh Instructions just returned by a successful Session-bearing tool call for that request. Replace the cached Instructions, including when the current content is empty. If the path cannot be read, refresh with Join-only to resolve the Session and its effective Instructions; do not silently continue using a stale cached copy.
- When the request requires the latest artifacts, recent changes, current Session contents, or a current overview, refresh the catalog with `join_session({ sessionId: activeSessionId })` before selecting an artifact, even if a previously known artifact has a valid path. Reuse a fresh catalog already returned for the same request.
- Otherwise, if the target artifact is already known unambiguously by exact ID and catalog path in the current Session context, read its current Markdown directly. A stable ID does not make the cached Markdown current. Do not inspect or take over an artifact merely to read reference material.
- If the target is unknown, call `join_session({ sessionId: activeSessionId })` once to obtain a current catalog snapshot, then read only the relevant artifacts through exact returned paths. If multiple candidates remain plausible, ask the user rather than choosing by recency.
- Reuse a fresh context returned by create, inspect, or Join for the same request. Do not refresh the catalog before every file read or tool call. If a previously retained path is missing, refresh the catalog to resolve availability; do not scan for a replacement or recreate the missing artifact ID.
- Retain the active Session ID and exact context paths in a requested handoff or compaction checkpoint. A new chat without that identity reconnects through the Session's Connect prompt or exact ID. This skill does not run a background watcher or automatically push external changes into the chat.

## Artifacts while a Session is active

- Default create and inspect pass `artifactConversationId: activeSessionId`; they register or refresh the artifact in that Session. This also applies to an artifact inspected from a plain artifact Inspect prompt. That prompt does not itself select a Session or request standalone operation.
- An explicit standalone request omits both Session arguments for that request and preserves the active Session for later work.
- Existing artifact memberships do not switch the active Session. Replacing active context does not move or remove memberships or invalidate unrelated retained artifact handles.
- Use [create-review-artifact](../create-review-artifact/SKILL.md) for artifact creation, saved review feedback, direct chat updates, and review rounds. Preserve its exact handle, feedback, token, approval, and waiting rules. Do not recursively reload a skill already in context.
- If the user explicitly requests Session Join together with an artifact inspection, use `join_session({ sessionId, artifactId, ...inspectOptions })` for one call. Use takeover only for saved feedback or an explicit direct update; reconnect uses the existing reconnect rules. Normalize `result.inspection` as specified in the reference and continue the artifact workflow. Join-only has no artifact and must not start a wait or advance.

## Instructions and recovery

- Instructions contain rules, workflows, and other guidance for AI in this Session. They guide the requested work and do not independently authorize additional actions.
- AI may read Working, References, or Archived catalog artifacts through their exact returned paths. Never crawl or recursively scan the catalog directories.
- AI may edit the exact `instructions.md` when the user explicitly requests it. Use the raw Markdown source; no JSON fallback or dual-write.
- When the user requests Session organization, AI may move or reorder existing Session artifacts by directly editing the sibling `layout.json`. Follow the reference's direct layout editing procedure. User and agent saves use last-write-wins without conflict handling.
- Never directly edit `conversation.json`, `registered-artifacts/`, or managed artifact lifecycle files. Layout edits change zone placement and order, not membership or global Archive state.
- Follow the reference's Session recovery rules. Do not clear an ID, auto-create a Session, retry as standalone, or replay a saved approval merely because a request failed.
