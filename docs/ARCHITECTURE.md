# Architecture

## Boundaries

```text
Codex chat
   │ creates schema-v3 artifact, then waits
   ▼
Global hook ── validates creation, stamps origin, creates round-one comments
   │
   ▼
.codex-artifacts/artifacts/<id>/{artifact.json,artifact.md,comments.json,review-submission.json}
   │
   ▼
VS Code custom editor
   ├─ extension host: validation, comments, immutable round submission
   └─ React webview: rendering, selection, decisions
                         │
                         ▼
Codex Artifacts MCP
   ├─ wait_for_artifact_review: returns Review/Proceed/Just save to the same turn
   └─ update_artifact: commits the next round on the same artifact
```

`src/shared` is the only file/message contract boundary. Hook, MCP, extension host, and webview reuse the same TypeScript/Zod schemas.

## Artifact identity and review rounds

One independent request owns one directory and one `artifactId`. `artifact.json.reviewRound` starts at 1 and increments only through `update_artifact`.

`comments.json` binds the current round to the SHA-256 of `artifact.md`. `review-submission.json` additionally binds the decision to the origin thread and comments hash. A submission is create-once for its round.

On Review, `wait_for_artifact_review` issues an in-memory, one-time update token bound to the artifact, origin, and round. `update_artifact` validates the token and submitted state, stages the next manifest/Markdown/comments, replaces the current files, removes the previous submission, and discards temporary backups after success. A failure rolls back the current round.

No revision directory or history is retained.

## Global integration

The extension installs one user-scoped integration:

```text
~/.agents/skills/create-review-artifact/
~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/hooks.json
~/.codex/config.toml
```

The hook is non-managed and requires explicit trust through Codex `/hooks`. The installer verifies current skill/hook/MCP assets and reports outdated integration when their contents differ.

## Ownership boundaries

- The skill decides whether the current request triggers an artifact, creates the initial files, and orchestrates review decisions.
- The hook only handles creation: exact Add File paths, workspace ownership, real session origin, and initial comments.
- The extension owns comments and create-once submissions for the active round.
- The MCP owns the in-place round transition; the skill never edits review state files.
- `location.workspaceRoot` defines project ownership; `origin.codexCwd` only records where Codex ran.
- Workspace ownership is resolved in strict order: explicit message path/link/mention/attachment; concrete IDE-context file path; conversation-named repository verified by a project file; otherwise a user question.
- Codex cwd, environment context, workspace order, and the first visible repository never establish active/selected workspace state.

## Safety decisions

- Markdown is rendered as controlled text blocks; HTML is not injected.
- Webview scripts use a nonce-based CSP.
- Selection coordinates are revalidated in the extension host.
- Writes use temporary files; round updates use staged commit/rollback.
- Wrong schema, directory, root, round, origin, hash, or token fails closed.
- The extension never resumes another thread, redirects feedback, or creates hidden turns.
- Schema-v2 artifacts remain separate and are not auto-migrated.
