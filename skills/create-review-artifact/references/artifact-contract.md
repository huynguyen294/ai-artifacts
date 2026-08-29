# Codex Artifacts contract

## Directory

```text
.codex-artifacts/artifacts/<artifact-id>/
  artifact.json
  artifact.md
  comments.json           # hook/MCP owned
  review-submission.json  # extension owned; present only after submission
```

## Create manifest

```json
{
  "schemaVersion": 3,
  "kind": "implementation-plan",
  "artifactId": "auth-rollout-20260828-01",
  "title": "Authentication rollout",
  "createdAt": "2026-08-28T08:00:00.000Z",
  "updatedAt": "2026-08-28T08:00:00.000Z",
  "reviewRound": 1,
  "location": {
    "workspaceRoot": "D:/workspace/example"
  },
  "origin": {}
}
```

## Workspace resolution

Resolve artifact ownership in this order and use the first verified, unambiguous root:

1. A path, file link, `@mention`, or attachment explicitly supplied in the user's messages.
2. An active/open file supplied by IDE context with a concrete path.
3. A repository or folder explicitly named in the conversation, after resolving it and inspecting a relevant project marker, document, or source path.
4. Ask the user when the preceding evidence does not yield exactly one verified root.

Codex/session cwd, `environment_context`, workspace ordering, the first visible repository, and a matching directory name are orientation hints only. They do not prove UI selection or artifact ownership. Explorer selection counts only when an actual UI/integration signal reports it.

Requirements:

- `artifactId` must equal its directory name and contain only letters, digits, `.`, `_`, or `-`.
- `kind` is a lowercase slug containing letters, digits, and hyphens.
- The workspace root must be an existing absolute path established through the workspace resolution order above.
- Create `artifact.json` and `artifact.md` together with one `apply_patch` Add File operation.
- Leave `origin` empty; the trusted hook supplies thread, turn, and Codex cwd.
- Never write comments, submission, hashes, or later review rounds yourself.

## Markdown

- Produce a complete document with a clear title and conventional headings.
- Use paragraphs and list items that can be selected independently.
- Do not embed HTML, progress state, comment state, or revision history.

## Review round

The extension creates one submission for the current round. `wait_for_artifact_review` returns:

- `revise`: read all comments and use the returned one-time token with `update_artifact`.
- `approve`: continue the original request using the approved content.
- `save`: ask for a destination and save the current Markdown without continuing the work.

`update_artifact` transactionally updates the same `artifact.md`, increments `reviewRound`, creates empty comments bound to the new content, and removes the old submission. It keeps backup/rollback guarantees and may write in place when Windows blocks rename because the artifact is open in an editor. Do not modify those files with filesystem tools.
