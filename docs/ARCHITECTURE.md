# Architecture

```text
Codex skill
   | create / wait / inspect / advance-and-wait
   v
Codex Artifacts MCP -- validates workspace registry and coordinates review rounds
   |
   +-- .codex-artifacts/artifacts/<id>/
   |     artifact.json + artifact.md + comments.json + optional submission
   |
   v
VS Code extension -- publishes workspace heartbeat and opens the custom editor
   |
   v
React webview -- renders Markdown, anchors comments, and submits a decision
```

## Ownership boundaries

- The skill chooses when an artifact is appropriate, resolves workspace evidence, retains the exact artifact handle, writes complete Markdown, answers review questions in chat, and reacts to decisions.
- The MCP server exclusively creates schema-v4 artifacts and advances their review rounds. It generates IDs and review sessions, validates paths, owns transient waiter registration, issues one-time round tokens, and commits round transitions transactionally.
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

1. `create_artifact` validates typed workspace evidence, creates review round 1, and immediately returns the exact handle.
2. `wait_for_artifact_review` attaches the single waiter for an expected round or immediately returns an existing submission.
3. `inspect_artifact_review` reads the current manifest, Markdown, comments, optional submission, and hashes. With `takeover: true`, it first aborts and drains the prior waiter. It can grant a token from saved comments even before submission.
4. `advance_and_wait_for_artifact` consumes an exact-state round token, optionally replaces Markdown, advances the round, resets comments/submission, and attaches a waiter for the new round. Omitting Markdown preserves its exact bytes and SHA.

The default flow is create -> wait -> submitted decision. Review (`revise`) grants a round token and uses the same feedback policy as chat inspection: answer questions visibly in chat, replace Markdown only for requested changes, then advance and wait. Question-only Review preserves the current Markdown bytes/SHA. Proceed (`approve`) and Just save (`save`) end only the current round and do not automatically advance. For `plan` and `implementation-plan`, the Proceed result additionally carries `nextAction.type: "execute-approved-plan"`; this is runtime authorization to execute all approved in-scope actions immediately in the same turn.

The chat-escape flow differs only in transport: it cancels the live waiter and inspects the exact retained handle instead of receiving a Review submission. Classification, chat answers, optional Markdown replacement, clarification, advancement, and waiting behavior are shared with Review. If no feedback exists, the skill reattaches to the same round. Reconnecting an already approved or saved artifact is explicit and must not repeat the prior command.

Only one waiter may own an artifact. Round tokens are in-memory, single-use, expire after one hour, and bind the artifact, session, round, artifact hash, comments hash, and submission presence/hash. A token is consumed only after a successful transaction commit.

## Persistent protocol

No new lifecycle files or schema migration are required for this flow:

- `artifact.json` identifies the schema-v4 artifact, workspace, session, and current round.
- `artifact.md` contains the complete current document.
- `comments.json` contains saved comments bound to the current round and artifact hash.
- `review-submission.json` appears after Review, Proceed, or Just save.

Advancing always increments the round and resets handled comments. A question-only advance uses the existing Markdown unchanged. Schema-v3 remains read-only.

## Workspace registry

Each running extension window writes an atomic snapshot under `~/.codex/codex-artifacts/workspaces/` (or `CODEX_HOME`) and refreshes it every 15 seconds. Schema-v2 snapshots expire after 45 seconds and contain canonical workspace folders, focus state, and the active file/root when available.

Creation requires typed evidence: `single-workspace`, `active-file`, `explicit-user-path`, or `explicit-user-folder`. The MCP scopes candidates to the focused window and fails before filesystem mutation when ownership is ambiguous. Later lifecycle calls use only the exact artifact handle; they never infer “latest artifact” from cwd or a workspace scan.

## Filesystem safety

- Artifact IDs are generated by the server and directories are created exclusively beneath `.codex-artifacts/artifacts/`.
- Canonical containment is checked before mutation; linked artifact storage paths are rejected.
- Create rollback may remove only the exact newly allocated directory.
- Advance stages the next round and restores prior files if commit fails. A narrow in-place fallback handles Windows editor locks.
- Installer cleanup recognizes only extension-managed MCP blocks, hook entries, scripts, and legacy skill directories. Unrelated user configuration is preserved.

## Compatibility

Extension version 0.7.0 ships MCP server 5.0.0 and replaces the previous two-tool API with the four lifecycle tools. Users must rerun **Codex Artifacts: Install Global Codex Integration**, restart Codex, and start a new chat. Artifact schema remains v4, so existing schema-v4 artifacts need no migration and can reconnect through inspection. Schema-v3 hook-owned artifacts remain read-only.
