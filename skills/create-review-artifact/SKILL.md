---
name: create-review-artifact
description: Create or update a reviewable Markdown artifact and wait for the user's decision in the same Codex turn. Use only when the user explicitly asks to create or update an artifact.
---

# Create Review Artifact

Create one reviewable Markdown artifact for one user request. Read [references/artifact-contract.md](references/artifact-contract.md) before calling the MCP tools.

## Trigger policy

- Trigger only when the user explicitly asks to create or update an artifact.

## Artifact kind

- For a plan artifact, use `kind: "implementation-plan"` when it directly guides code changes; otherwise use `kind: "plan"`.
- For any other artifact, choose a short lowercase slug for `kind`.

## Workflow

1. Require the `codex_artifacts` MCP server to expose `create_and_wait_for_artifact` and `update_and_wait_for_artifact`. If unavailable, ask the user to run **Codex Artifacts: Install Global Codex Integration**, restart Codex, and start a new chat. Hook trust is not required.
2. Pass the workspace evidence gate before any artifact filesystem operation. Resolve candidates in this order and stop at the first verified, unambiguous root:
   1. A path, file link, `@mention`, or attachment explicitly supplied in the user's messages.
   2. An active/open file supplied by IDE context with a concrete path.
   3. A repository or folder explicitly named in the conversation, after resolving it and inspecting at least one relevant project marker, document, or source path.
   4. If none of the above yields exactly one verified root, ask the user which workspace owns the artifact.
   - Treat Codex/session cwd, `environment_context`, workspace-folder order, the first visible repository, and the first search result as orientation hints only. Never describe any of them as the active or selected workspace.
   - Require an existing absolute directory and evidence that the requested work belongs there. A matching directory name alone is insufficient.
   - Do not inspect unrelated roots, create files, or call artifact tools until the root is verified and unambiguous.
3. Map the verified source to `workspaceEvidence`: `explicit-user-path` with the existing absolute path and exact user text; `active-file` with the concrete IDE path; `explicit-user-folder` with exact user text naming one folder; or `single-workspace` only when available workspace context proves exactly one registered folder. Never invent or paraphrase user evidence.
4. Write one complete Markdown document. Call `create_and_wait_for_artifact` with the verified absolute `workspaceRoot`, `workspaceEvidence`, `title`, `kind`, and `markdown`. If it returns `AMBIGUOUS_WORKSPACE` or `WORKSPACE_EVIDENCE_MISMATCH`, ask the user; do not retry another inferred root. Do not create or edit lifecycle files with filesystem tools.
5. Handle the returned decision:
   - `revise`: read every comment from the returned `commentsPath` and classify it as a requested change, a question, or both. Apply requested changes to the document. Replace any existing `## Review responses` section with answers only to question comments from the immediately preceding review round; include a concise identifying quote and a direct answer. Do not retain responses from older rounds, and omit the section when the latest round asked no questions. Then immediately call `update_and_wait_for_artifact` with the returned artifact directory, review round, one-time update token, and complete replacement Markdown.
   - `approve`: read any remaining comments before acting. For `kind: "implementation-plan"`, **Proceed** is explicit authorization to implement the approved plan immediately in the current turn, including applicable remaining comments. Do not stop after acknowledging approval and do not ask for another implementation confirmation. Pause only when implementation needs new authority outside the approved scope or encounters a genuine blocker. For other artifact kinds, continue only with the action implied by the original request; if no action was requested, acknowledge approval and finish.
   - `save`: ask for a destination in the workspace, copy the current Markdown there, and finish without performing the proposed work.
6. Repeat step 5 after every update. Keep the same artifact directory for the entire request.
7. If a tool is unavailable, cancelled, loses its token, rejects the workspace, or reports another live waiter, preserve the current artifact and explain the recovery action. Never invent a session or bypass the MCP with direct writes.

## Lifecycle rules

- One independent user request owns one artifact directory and artifact ID.
- Review replaces the same `artifact.md` and starts the next review round; it does not create revision history.
- Review comments are reset between rounds. The replacement Markdown carries responses for the immediately preceding round only, not a cumulative response history.
- Only the MCP server creates artifacts, advances rounds, resets comments, consumes update tokens, and writes lifecycle metadata.
- Never edit `artifact.json`, `comments.json`, or `review-submission.json`.
- Write a coherent artifact, not a patch, changelog, task tracker, or progress report.
