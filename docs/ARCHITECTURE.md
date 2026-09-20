# Architecture

```text
Codex skill
   | resolve (optional window discovery) / create / wait / inspect / advance-and-wait
   v
AI Artifacts MCP -- discovers live windows and coordinates review rounds
   |
   +-- ~/.ai-artifacts/artifacts/<id>/
   |     artifact.json + artifact.md + comments.json
   |     + optional submission + optional artifact-connection.json
   |
   v
VS Code extension windows -- publish heartbeats, match connection target, open editor
   |
   v
React webview -- renders Markdown, anchors comments, and submits a decision
```

## Ownership boundaries

- The skill chooses when an artifact is appropriate, calls create directly or resolves windows when ambiguous, retains an exact handle mapping, writes complete Markdown, answers review questions in chat, and reacts to decisions.
- The MCP server discovers live VS Code windows, exclusively creates schema-v6 artifacts in global storage, commits schema-v1 window-routing requests, and advances review rounds. It generates IDs and review sessions, validates paths and candidate selection tokens, owns transient waiter registration, issues one-time round tokens, and commits round transitions transactionally.
- Each extension host window publishes fresh canonical workspace roots plus its stable instance ID, focus hint, and active-file context. It validates connection targets and artifact bindings, opens only requests addressed to its own instance ID, and writes user comments/submissions.
- The webview renders sanitized CommonMark/GFM and sends typed messages to the extension host. It has no direct filesystem or process access.
- `src/shared` is the single contract boundary used by the MCP, extension host, and webview.

## Lifetime model

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

An artifact is persistent per-user data representing a review session. A waiter is an in-memory connection from one MCP request to one exact artifact round. A chat turn may end or interrupt that request without changing the artifact.

Cancellation and takeover alone close watchers/timers and release waiter ownership only. They do not edit `artifact.json`, `artifact.md`, `comments.json`, `review-submission.json`, or `artifact-connection.json`; only an explicit reconnect intent may commit new routing state during inspection. MCP restart loses active waiters and tokens, but a validated inspection can issue a fresh token from the persistent schema-v6 state.

## Lifecycle tools

1. `resolve_artifact_window` accepts an optional `query` string matched against candidate label, active file, and folder paths. It reads fresh VS Code window snapshots and returns candidates grouped by window; each candidate includes `candidateId`, `windowInstanceId`, `focused`, `label`, `folderCount`, `folders`, `activeFile`, and an opaque `selectionToken`. It returns `status: "matched"`, `status: "selection-required"`, or `status: "not-found"`. It is read-only and never creates lifecycle files.
2. `create_artifact` creates review round 1, commits connection revision 1, and immediately returns the exact handle plus connection metadata. By default, it routes to the currently focused window (or sole live window); when focus is ambiguous across multiple windows, it returns `WINDOW_SELECTION_REQUIRED` requiring retry with `connection: { targetMode: "explicit-window", selectionToken }`. The official skill always sends `kind: "implementation-plan"`.
3. `wait_for_artifact_review` attaches the single waiter for an expected round or immediately returns an existing submission.
4. `inspect_artifact_review` reads the current manifest, Markdown, comments, optional submission, connection state, and hashes. With `intent: "reconnect"`, it re-evaluates the currently focused window (or explicit window candidate) and atomically increments the connection revision with a new open-request ID; ambiguous candidates require `connection.selectionToken`. With `takeover: true`, inspection first aborts and drains the prior waiter. It can grant a token from saved comments even before submission, or a chat-update token on an empty round when `intent: "explicit-chat-update"` is supplied.
5. `advance_and_wait_for_artifact` consumes an exact-state round token, optionally replaces Markdown, advances the round, resets comments/submission, and attaches a waiter for the new round. Omitting Markdown preserves its exact bytes and SHA. Both wait and advance preserve existing connection state and cannot rebind the artifact.

The default flow is create -> wait -> submitted decision. Review (`revise`) grants a round token and uses the same feedback policy as chat inspection: answer questions visibly in chat, replace Markdown only for requested changes, then advance and wait. Question-only Review preserves the current Markdown bytes/SHA. Proceed (`approve`) and Just save (`save`) end only the current round and do not automatically advance. For `plan` and `implementation-plan`, the Proceed result additionally carries `nextAction.type: "execute-approved-plan"`; this is runtime authorization to execute all approved in-scope actions immediately in the same turn. Every lifecycle result includes an RFC 8089 `artifactUrl` and regular Markdown `artifactLink`; neither is a custom-editor deep link.

The chat-escape flow differs only in transport: it cancels the live waiter and inspects the exact retained handle instead of receiving a Review submission. Classification, chat answers, optional Markdown replacement, clarification, advancement, and waiting behavior are shared with Review. If no feedback exists, the skill reattaches to the same round unless the user explicitly requested edits in chat (via `intent: "explicit-chat-update"`). Reconnecting an already approved or saved artifact is explicit and must not repeat the prior command.

Only one waiter may own an artifact. Round tokens are in-memory, single-use, expire after one hour, and bind the artifact, session, round, artifact hash, comments hash, and submission presence/hash. Tokens have sources `submitted-review`, `chat-inspection`, or `chat-update` (which requires replacement Markdown with a different SHA). A token is consumed only after a successful transaction commit. Lifecycle errors retain readable text and add typed recovery metadata (`code`, retryability, next-tool hint, token reuse, same-handle requirement, and optional current round), preventing blind replay when commit state is uncertain.

## Persistent protocol

Schema v6 is the sole live lifecycle protocol:

- `artifact.json` identifies the schema-v6 artifact, title, session, and current round without repository ownership fields.
- `artifact.md` contains the complete current document.
- `comments.json` contains saved comments bound to the current round and artifact hash.
- `review-submission.json` appears after Review, Proceed, or Just save.
- `artifact-connection.json` is optional schema-v1 UI-routing state containing only `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`.

Advancing always increments the round and resets handled comments. A question-only advance uses the existing Markdown unchanged. Schemas v3/v4/v5 are rejected and are not live-migrated.

`artifact.json` remains the source of truth for artifact ID; connection state never duplicates or overrides it. Connection revisions start at 1 and increment once per successful create/reconnect commit under an artifact-scoped lock. Revisions provide ordering and diagnostics, while unique open-request IDs deduplicate filesystem events. Connection writes are atomic and do not change Markdown bytes/SHA, comments, submission, review round, or round tokens.

## Workspace registry

Each running extension window writes an atomic snapshot under `~/.ai-artifacts/managed/workspaces/` (or `CODEX_ARTIFACTS_REGISTRY_DIRECTORY`) and refreshes it every 15 seconds. Schema-v2 snapshots expire after 45 seconds and contain canonical workspace folders (or empty array for folderless windows), focus state, and the active file/root when available. The registry publisher prunes snapshots, retaining at most 10 snapshots and removing files older than 7 days.

Window routing defaults to the focused live window. When multiple live windows exist and none or multiple are focused, `create_artifact` or `inspect_artifact_review` returns `WINDOW_SELECTION_REQUIRED` with candidates and opaque selection tokens. Agents present candidates using concise labels instead of raw UUIDs and retry using `connection: { targetMode: "explicit-window", selectionToken }`.

## Filesystem safety

- Artifact IDs are generated by the server and directories are created exclusively as direct children of `~/.ai-artifacts/artifacts/`.
- The exact global handle is canonicalized and bound to the manifest artifact ID. Nested, escaped, linked, workspace-local, and wrong-home paths are rejected before read or mutation.
- On POSIX, managed directories are tightened to owner-only `0700` and lifecycle files to `0600`. Windows relies on the user account and filesystem ACLs and makes no POSIX-mode guarantee.
- Canonical containment is checked before mutation; linked artifact storage paths are rejected.
- Create rollback may remove only the exact newly allocated directory.
- Advance stages the next round and restores prior files if commit fails. A narrow in-place fallback handles Windows editor locks.
- Installer cleanup recognizes only extension-managed MCP blocks, hook entries, scripts, runtime files under `~/.ai-artifacts/managed/`, legacy `~/.vscode/ai-artifacts/` assets, registry snapshots, and managed skill directories. Unrelated user configuration is preserved, and user review data in `~/.ai-artifacts/artifacts/` is retained on uninstall.

## Extension watcher and editor opening

The extension validates and creates the global collection root before registering a `RelativePattern` watcher for direct-child `artifact-connection.json` creation and change. Every extension window receives the filesystem event, performs bounded retry for transient create/replace races, and revalidates the root, artifact directory, connection file, manifest binding, and linked-path safety on every read attempt. A window ignores the request unless `connection.windowInstanceId` matches its own stable instance ID. The matching window may call `vscode.openWith` even when unfocused, provided `agentPlus.autoOpenArtifactReview` is enabled. Disabling auto-open does not prevent MCP from committing routing state.

Each window deduplicates successfully handled `openRequestId` values and coalesces concurrent work by canonical artifact path. Failed opens are not permanently deduplicated, so a later event can retry. Different artifacts remain independent, and VS Code's single-editor-per-document contract performs the final reuse/reveal behavior. Non-target validation failures remain silent in that window; the target window reports actionable failures without opening an unsafe artifact.

The manual **AI Artifacts: Open Artifact Review** command uses the active Artifact Review URI when available or a file picker rooted at the global collection. It shares the same validation and open coordinator as the watcher. A chat `artifactLink` is only a regular file link and may open a normal Markdown editor depending on the client.

## Deployment and filesystem support

The supported v1.0.0 topology requires a local desktop VS Code-compatible extension host and MCP process running as the same OS user, resolving the same home, and seeing the same `~/.ai-artifacts/` filesystem. Windows, macOS, and Linux are the declared local targets. Remote SSH, WSL, dev containers, Codespaces, browser/virtual workspaces, and split-host topologies are unsupported in v1.0.0 because their producer/consumer filesystem boundary has not passed the release matrix.

## Compatibility

Extension version 1.0.0 ships MCP server 9.0.0, artifact schema v6, and optional connection schema v1 as a hard compatibility cutoff. The MCP tool catalog remains exactly five tools with `resolve_artifact_window` replacing `resolve_artifact_workspace`. Schema-v3/v4/v5 and workspace-local lifecycles remain untouched on disk but are not parsed, opened, advanced, or migrated. Updating the extension does not mutate an already installed runtime or skill; users must reinstall integrations, restart the AI client, and start a fresh chat. Rolling back the extension likewise requires reinstalling the matching older runtime/skill. Optional connection files are retained as user artifact data and may be ignored by older code; they are never deleted during rollback or uninstall.
