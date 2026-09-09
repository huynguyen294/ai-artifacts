# Architecture

```text
Codex skill
   | resolve (when no tagged file) / create / wait / inspect / advance-and-wait
   v
Codex Artifacts MCP -- validates workspace registry and coordinates review rounds
   |
   +-- .ai-artifacts/artifacts/<id>/
   |     artifact.json + artifact.md + comments.json + optional submission
   |
   v
VS Code extension -- publishes workspace heartbeat and opens the custom editor
   |
   v
React webview -- renders Markdown, anchors comments, and submits a decision
```

## Ownership boundaries

- The skill chooses when an artifact is appropriate, routes one of the two workspace-evidence flows, retains an exact request/workspace-to-handle mapping, writes complete Markdown, answers review questions in chat, and reacts to decisions.
- The MCP server resolves current workspace candidates, exclusively creates schema-v4 artifacts, and advances their review rounds. It generates IDs and review sessions, validates paths and selection grants, owns transient waiter registration, issues one-time round tokens, and commits round transitions transactionally.
- The extension host publishes fresh canonical workspace roots plus focused-window/active-file context, performs trusted local file access, validates bindings, and writes user comments/submissions.
- The webview renders sanitized CommonMark/GFM and sends typed messages to the extension host. It has no direct filesystem or process access.
- `src/shared` is the single contract boundary used by the MCP, extension host, and webview.

## Lifetime model

```text
artifact lifetime > waiter lifetime > chat-turn lifetime
```

An artifact is persistent workspace data. A waiter is an in-memory connection from one MCP request to one exact artifact round. A chat turn may end or interrupt that request without changing the artifact.

Cancellation and takeover close watchers/timers and release waiter ownership only. They do not edit `artifact.json`, `artifact.md`, `comments.json`, or `review-submission.json`. MCP restart loses active waiters and tokens, but a validated inspection can issue a fresh token from the persistent schema-v4 state.

## Lifecycle tools

1. `resolve_artifact_workspace` runs before any target-workspace action for creation without a tagged file and is the only MCP tool allowed before the agent reads the artifact contract. It normalizes common separators and searches the workspace folders inside one uniquely identified fresh VS Code workspace context by the user's exact keyword/path. A text match returns matching candidates. If the context has exactly one folder, MCP returns it as `matched`/`single-folder` even when the text differs. In a multi-root workspace, no match returns every folder in the same context with `matchMode: "all-available"`; an empty fresh scope returns `not-found`. Different VS Code windows are never merged; `WORKSPACE_CONTEXT_AMBIGUOUS` requires the user to focus the intended window and retry. Every returned candidate has an opaque selection token. The resolver never creates anything; the skill chooses an unambiguous candidate or asks the user when ambiguity remains. Once one folder is chosen, the agent reads the contract before inspecting that folder or calling any lifecycle tool.
2. `create_artifact` validates either tagged-file evidence or a `resolved-workspace` grant, creates review round 1, and immediately returns the exact handle. The official skill always sends `kind: "implementation-plan"`.
3. `wait_for_artifact_review` attaches the single waiter for an expected round or immediately returns an existing submission.
4. `inspect_artifact_review` reads the current manifest, Markdown, comments, optional submission, and hashes. With `takeover: true`, it first aborts and drains the prior waiter. It can grant a token from saved comments even before submission, or a chat-update token on an empty round when `intent: "explicit-chat-update"` is supplied.
5. `advance_and_wait_for_artifact` consumes an exact-state round token, optionally replaces Markdown, advances the round, resets comments/submission, and attaches a waiter for the new round. Omitting Markdown preserves its exact bytes and SHA.

The default flow is create -> wait -> submitted decision. Review (`revise`) grants a round token and uses the same feedback policy as chat inspection: answer questions visibly in chat, replace Markdown only for requested changes, then advance and wait. Question-only Review preserves the current Markdown bytes/SHA. Proceed (`approve`) and Just save (`save`) end only the current round and do not automatically advance. For `plan` and `implementation-plan`, the Proceed result additionally carries `nextAction.type: "execute-approved-plan"`; this is runtime authorization to execute all approved in-scope actions immediately in the same turn.

The chat-escape flow differs only in transport: it cancels the live waiter and inspects the exact retained handle instead of receiving a Review submission. Classification, chat answers, optional Markdown replacement, clarification, advancement, and waiting behavior are shared with Review. If no feedback exists, the skill reattaches to the same round unless the user explicitly requested edits in chat (via `intent: "explicit-chat-update"`). Reconnecting an already approved or saved artifact is explicit and must not repeat the prior command.

Only one waiter may own an artifact. Round tokens are in-memory, single-use, expire after one hour, and bind the artifact, session, round, artifact hash, comments hash, and submission presence/hash. Tokens have sources `submitted-review`, `chat-inspection`, or `chat-update` (which requires replacement Markdown with a different SHA). A token is consumed only after a successful transaction commit. Lifecycle errors retain readable text and add typed recovery metadata (`code`, retryability, next-tool hint, token reuse, same-handle requirement, and optional current round), preventing blind replay when commit state is uncertain.

## Persistent protocol

No new lifecycle files or schema migration are required for this flow:

- `artifact.json` identifies the schema-v4 artifact, workspace, session, and current round.
- `artifact.md` contains the complete current document.
- `comments.json` contains saved comments bound to the current round and artifact hash.
- `review-submission.json` appears after Review, Proceed, or Just save.

Advancing always increments the round and resets handled comments. A question-only advance uses the existing Markdown unchanged. Schema-v3 remains read-only.

## Workspace registry

Each running extension window writes an atomic snapshot under `~/.vscode/ai-artifacts/workspaces/` (or `CODEX_ARTIFACTS_REGISTRY_DIRECTORY`) and refreshes it every 15 seconds. Schema-v2 snapshots expire after 45 seconds and contain canonical workspace folders, focus state, and the active file/root when available.

Creation accepts exactly two typed evidence variants. `tagged-file` proves ownership through an existing user-tagged file contained by the registered root. Without a tagged file, `resolve_artifact_workspace` runs before project-file reads or artifact drafting. It matches separator-normalized user words against the folders in one uniquely scoped workspace context. A one-folder context is intrinsically unambiguous and returns `single-folder`; only a multi-root context can fall back to all folders as `available`. Multiple distinct unfocused or concurrently focused window contexts fail closed instead of being combined. `resolved-workspace` proves the chosen candidate came from that resolver call through a ten-minute, context-bound, single-use token. The skill may choose a uniquely strongest candidate from the returned name, path, and match classification; it asks the user only when no unique high-confidence choice exists. Only then may the skill read the chosen folder. Later lifecycle calls use only the exact artifact handle; they never call the resolver or infer “latest artifact” from cwd or a workspace scan.

## Filesystem safety

- Artifact IDs are generated by the server and directories are created exclusively beneath `.ai-artifacts/artifacts/` (legacy `.codex-artifacts/artifacts/` is fully supported for reading and advancement).
- Canonical containment is checked before mutation; linked artifact storage paths are rejected.
- Create rollback may remove only the exact newly allocated directory.
- Advance stages the next round and restores prior files if commit fails. A narrow in-place fallback handles Windows editor locks.
- Installer cleanup recognizes only extension-managed MCP blocks, hook entries, scripts, and legacy skill directories. Unrelated user configuration is preserved.

## Compatibility

Extension version 0.9.2 standardizes artifact storage under `.ai-artifacts/` with 100% backwards compatibility for `.codex-artifacts/`. Extension version 0.9.0 ships MCP server 6.0.0, which adds the workspace resolver and two-evidence create contract, makes `implementation-plan` the official skill default, formalizes multi-handle/ambiguous-intent routing, and returns structured lifecycle recovery metadata. Artifact schema remains v4, so existing schema-v4 artifacts need no migration and can reconnect through inspection. Schema-v3 hook-owned artifacts remain read-only.
