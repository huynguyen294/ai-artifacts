# Codex Artifacts MCP contract

## Tools

The skill may call `resolve_artifact_workspace` before loading this reference. Read this contract after one target workspace folder is chosen and before inspecting that folder or calling any other MCP lifecycle tool.

`resolve_artifact_workspace` accepts the exact workspace keyword or path from the user's message. It normalizes common separators, so names such as `agent plus`, `agent-plus`, and `agent_plus` match. It reads one uniquely identified fresh VS Code workspace context and returns stable workspace-folder name/path candidates with opaque, expiring selection tokens. If that context contains exactly one folder, the resolver returns `matchMode: "matched"` and `match: "single-folder"` even when the query text differs; the agent selects it immediately. If a query has no match in a multi-root workspace, the resolver returns every folder in that same context with `matchMode: "all-available"`. It never combines folders from different VS Code windows; `WORKSPACE_CONTEXT_AMBIGUOUS` requires the user to focus the intended window and retry. `status: "not-found"` is reserved for an empty fresh scope. It is read-only and never creates lifecycle files. The agent may choose one candidate when its name or path is the unique high-confidence match to the user's words; it asks the user only when the candidates remain ambiguous.

`create_artifact` accepts a verified absolute `workspaceRoot`, `title`, lowercase `kind`, complete `markdown`, and exactly one creation evidence variant:

- `{ kind: "tagged-file", filePath }` for a concrete file explicitly tagged by the user.
- `{ kind: "resolved-workspace", selectionToken }` for a candidate chosen from the current resolver result by the agent or user.

The server revalidates current registry scope, canonical root, tagged-file containment or the resolver grant before mutation. Cwd, untagged active files, project markers, folder order, and filesystem search results are not creation evidence. The official skill always sends `kind: "implementation-plan"`; the MCP keeps `kind` required for protocol compatibility.

`wait_for_artifact_review` accepts `artifactDirectory`, `expectedReviewRound`, and optional `takeover`. It returns an existing submission immediately or owns the single transient waiter until Review, Proceed, Just save, cancellation, or takeover. A `revise` result includes a one-time `roundToken`.

For an `approve` result whose artifact kind is `plan` or `implementation-plan`, the result includes `nextAction.type: "execute-approved-plan"` and an explicit instruction to execute the approved plan immediately in the same turn. Treat this as execution authorization, not an acknowledgement request.

`inspect_artifact_review` accepts the exact `artifactDirectory`, optional `expectedReviewRound`, optional `takeover`, and optional `intent`. It immediately returns the validated manifest, Markdown, comments, optional submission, round, and hashes. It returns a `roundToken` when saved comments or a submission make the round consumable, or when `intent` is `"explicit-chat-update"` on an empty round.

`advance_and_wait_for_artifact` accepts the exact `artifactDirectory`, `expectedReviewRound`, and `roundToken`, plus optional complete replacement `markdown`. It transactionally advances the same artifact and waits for the next round. Omitting Markdown preserves the exact `artifact.md` bytes and SHA while resetting handled comments and removing the old submission.

## Availability and lifetime

The skill requires all five tools once when starting an artifact lifecycle in the current chat. Use the current tool catalog; do not probe MCP resources or the filesystem. It does not repeat the check in later rounds unless a tool becomes unavailable, the MCP restarts, or a new chat begins. If the catalog is incomplete, ask the user to run **Codex Artifacts: Install Global Codex Integration**, restart Codex, and start a new chat.

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

The artifact is persistent workspace data. A waiter is an in-memory connection for one exact artifact round. Cancellation, takeover, turn completion, or MCP restart may detach the waiter but never deletes or ends the artifact. Proceed and Just save end only the submitted round.

## Directory

```text
.ai-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json  # present only after submission
```

All lifecycle files are server- or extension-owned. Agents must not create, update, or repair them directly. Schema-v3 artifacts remain viewable but read-only; schema v4 remains the writable format.

## Workspace and handle ownership

Before create, use only a tagged file or a candidate from the current resolver result. With no tagged file, call the resolver with the user's exact words before reading project files or drafting content. Do not scan folders to discover or normalize a workspace name. Select a sole `single-folder` candidate immediately because MCP has proved the workspace-folder choice is unambiguous. Otherwise choose a uniquely strongest candidate from its returned name, path, and match classification; ask the user only when no unique high-confidence choice exists. Only then read required instructions and relevant content in that folder. Resolver tokens are in-memory, one-time on successful creation, bound to the candidate and registry context, and expire after ten minutes. Expired, replayed, mismatched, or stale selections require resolution and another choice, with user input only when ambiguity remains.

After create, never call the resolver for that artifact. For wait, inspection, advance, and reconnect, use only the exact `artifactDirectory` returned by creation or retained from an interrupted waiter. Keep a request/workspace → handle → round mapping when a chat owns multiple artifacts. Never select “the latest artifact” or infer a handle from cwd. If the handle is missing or ambiguous, ask the user.

Each lifecycle tool loads the exact artifact context and revalidates the manifest workspace internally. Success continues in the same tool call; failure occurs before waiter attachment or mutation.

## Intent decision table

| User intent | Tool flow |
|---|---|
| Reconnect or resume waiting without edits | Wait on the exact handle and same round. |
| Read saved comments/submission | Inspect the exact handle with `takeover: true`. |
| Update an empty round directly from chat | Inspect with exact handle, round, takeover, and `intent: "explicit-chat-update"`. |
| Intent or handle is ambiguous | Ask the user before any lifecycle call. Never takeover speculatively. |

If inspection finds no feedback, reattach to the same round without advancing. Takeover only aborts and drains the old waiter; it does not mutate lifecycle files.

## Round tokens and structured recovery

A round token is in-memory, single-use, expires after one hour, and binds the exact artifact, session, round, artifact hash, comments hash, and submission presence/hash. Any intervening change rejects it. Tokens are consumed only after a successful round commit. A chat-update token requires non-empty replacement Markdown with a different SHA.

Lifecycle errors keep human-readable text and may include:

```ts
type ArtifactRecoveryError = {
  code: string;
  retryable: boolean;
  expectedNextTool?: "inspect_artifact_review" | "wait_for_artifact_review" | "advance_and_wait_for_artifact";
  reuseRoundToken: boolean;
  useSameArtifactHandle: true;
  currentReviewRound?: number;
};
```

Recovery rules:

- Invalid/expired/consumed tokens, wrong round, or changed state: inspect the same exact handle; do not replay old Markdown or actions.
- Token in use: wait for the in-flight request; do not advance concurrently.
- Active waiter: choose wait or intentional inspect/takeover from the user's intent.
- Confirmed cancellation before commit or confirmed rollback may set `reuseRoundToken: true`.
- `ADVANCE_COMMITTED` means the round changed successfully but waiting did not finish; never replay, and continue on the reported round.
- Workspace unavailable after create: ask the user to reopen/restore that workspace; never resolve a replacement workspace.
- If commit state is uncertain, inspect the same exact handle before retrying.

## Decisions and chat feedback

- Review (`revise`) and chat-inspected feedback use the same classification and response policy.
- Question-only: answer visibly in chat before advancing without Markdown, preserving bytes and SHA.
- Change-only: advance with complete replacement Markdown.
- Mixed: answer visibly in chat, then advance with complete replacement Markdown.
- Needs clarification: ask in chat and leave the round unconsumed.
- Do not create or update `## Review responses`; conversational answers belong in chat.
- Proceed (`approve`): execute the complete approved plan immediately in the same turn according to `nextAction`; do not stop at acknowledgement, summarize future work, request another confirmation, or auto-advance.
- Just save (`save`): save as requested and do not auto-advance.
- Explicit reconnect after Proceed/Just save: inspect, advance without Markdown, and wait. Never repeat the prior action merely because the artifact was reconnected.
