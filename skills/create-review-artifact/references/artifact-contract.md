# Codex Artifacts MCP contract

## Tools

`create_and_wait_for_artifact` accepts:

- `workspaceRoot`: an absolute, verified VS Code workspace folder.
- `workspaceEvidence`: one of `single-workspace`, `active-file`, `explicit-user-path`, or `explicit-user-folder` with the fields required by the tool schema.
- `title`: a concise human-readable title.
- `kind`: a lowercase slug.
- `markdown`: the complete review document.

The server validates both the root and its typed evidence against the live VS Code registry, generates the artifact ID, creates schema-v4 lifecycle files, opens review through the extension, and waits for a decision.

`update_and_wait_for_artifact` accepts:

- `artifactDirectory`: the absolute directory returned by the create tool.
- `expectedReviewRound`: the returned current round.
- `updateToken`: the one-time token returned only for `revise`.
- `markdown`: the complete replacement document.

The server transactionally replaces `artifact.md`, advances the round, resets review state, and waits again in the same tool call.

## Directory

```text
.codex-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json  # present only after submission
```

All lifecycle files are server- or extension-owned. Codex may read the Markdown and returned comments, but must not create, update, or repair lifecycle files directly.

## Workspace ownership

Resolve artifact ownership in this order and use the first verified, unambiguous root:

1. A path, file link, `@mention`, or attachment explicitly supplied in the user's messages.
2. An active/open file supplied by IDE context with a concrete path.
3. A repository or folder explicitly named in the conversation, after resolving it and inspecting a relevant project marker, document, or source path.
4. Ask the user when the preceding evidence does not yield exactly one verified root.

Codex/session cwd, `environment_context`, workspace ordering, the first visible repository, and a matching directory name are orientation hints only. They do not prove UI selection or artifact ownership. Explorer selection counts only when an actual UI/integration signal reports it.

The MCP server independently requires the canonical root to appear in a fresh registry snapshot published by the installed VS Code extension. `single-workspace` requires exactly one unique registered root; `active-file` must match the focused window snapshot; explicit user evidence must resolve to exactly one registered root. Ambiguous or mismatched evidence fails before artifact storage is created.

## Decisions

- `revise`: read all comments from `commentsPath`. Apply change requests and replace `## Review responses` with answers only to questions from that submitted round, then use the returned one-time token with `update_and_wait_for_artifact`. Do not carry responses from older rounds forward.
- `approve`: for an `implementation-plan`, **Proceed** authorizes immediate implementation of the approved plan in the current turn; do not merely report approval or request another confirmation. For other kinds, continue only with the action already implied by the original request.
- `save`: ask where to copy the current Markdown and stop without continuing the proposed work.

An update token is bound to one artifact, one review session, one round, and one content hash. It cannot be reused. Updating preserves the artifact path and does not retain old revisions.

Schema-v3 artifacts created by the former hook lifecycle remain viewable but are read-only and cannot be resumed through these tools.
