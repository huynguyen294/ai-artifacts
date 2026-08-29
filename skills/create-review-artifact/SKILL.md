---
name: create-review-artifact
description: Create or update a reviewable Markdown artifact and wait for the user's decision in the same Codex turn. Use automatically when preparing a substantive implementation plan, whenever the user explicitly asks to create, draft, show, revise, or update a plan even without saying "artifact", or when the user explicitly requests another artifact. Do not auto-trigger non-plan artifacts, casual outlines not requested as plans, status updates, or straightforward implementation that needs no review checkpoint.
---

# Create Review Artifact

Create one reviewable Markdown artifact for one user request. Read [references/artifact-contract.md](references/artifact-contract.md) before writing files.

## Trigger policy

- Auto-trigger for a substantive implementation plan that should be reviewed before code changes begin. Use `kind: "implementation-plan"`.
- Auto-trigger whenever the user explicitly asks to create, draft, show, revise, or update a plan, even if they do not mention artifacts. Use `kind: "implementation-plan"` when the plan directly guides code changes; otherwise use `kind: "plan"`.
- Trigger for any artifact kind when the user explicitly requests an artifact. Choose a short lowercase slug for `kind`.
- Do not auto-trigger architecture, specification, API, migration, report, security, test, documentation, outline, checklist, or status artifacts unless the user explicitly requests an artifact or calls the requested document a plan.

## Workflow

1. Verify the trusted Codex Artifacts hook is installed and the `codex_artifacts` MCP server exposes both `wait_for_artifact_review` and `update_artifact`. If unavailable, stop and ask the user to run **Codex Artifacts: Install Global Codex Integration**, trust the hook through `/hooks`, restart Codex, and start a new chat.
2. Pass the workspace evidence gate before any artifact filesystem operation:
   Resolve candidates in this order and stop at the first verified, unambiguous root:
   1. A path, file link, `@mention`, or attachment explicitly supplied in the user's messages.
   2. An active/open file supplied by IDE context with a concrete path.
   3. A repository or folder explicitly named in the conversation, after resolving it and inspecting at least one relevant project marker, document, or source path.
   4. If none of the above yields exactly one verified root, ask the user which workspace owns the artifact.
   - Treat Codex/session cwd, `environment_context`, workspace-folder order, the first visible repository, and the first search result as orientation hints only. Never describe any of them as the active or selected workspace.
   - Require an existing absolute directory and evidence that the requested work belongs there. A matching directory name alone is insufficient.
   - Do not inspect unrelated roots, create files, or call artifact tools until the root is verified and unambiguous.
3. Generate a unique filesystem-safe artifact ID. Create these absolute paths in one `apply_patch` call:
   - `<workspace-root>/.codex-artifacts/artifacts/<artifact-id>/artifact.json`
   - `<workspace-root>/.codex-artifacts/artifacts/<artifact-id>/artifact.md`
4. Use schema version 3, `reviewRound: 1`, identical initial `createdAt`/`updatedAt` values, the exact absolute workspace root, and an empty `origin`. Do not create comments or submission files.
5. Reload the manifest and verify the hook supplied `origin.threadId` and `origin.codexCwd`; verify `comments.json` exists for round 1. Never invent origin values.
6. Immediately call `wait_for_artifact_review` with the absolute artifact directory. Do not end the turn first.
7. Handle the result:
   - `decision: "revise"`: read every comment, produce one complete updated Markdown document, and call `update_artifact` with the returned artifact directory, review round, one-time update token, and Markdown. Verify the same artifact ID/path now has the next round, then call `wait_for_artifact_review` again.
   - `decision: "approve"`: read remaining comments and perform the action intended by the original request. If the original request only asked to create/review an artifact, acknowledge approval and finish without inventing work.
   - `decision: "save"`: ask for a destination in the workspace, copy the current artifact Markdown there, and finish without performing the proposed work.
8. If wait/update is cancelled, expires, or loses its token, keep the current artifact intact and explain that a fresh live review lifecycle is required. Do not reconnect by guessing a thread.

## Lifecycle rules

- One independent user request owns one artifact directory and one artifact ID.
- Review updates the same `artifact.md`; never create a replacement directory or revision history.
- Never edit `comments.json` or `review-submission.json` and never manually increment `reviewRound`.
- Only `update_artifact` may commit a new review round and reset its state.
- Write a coherent artifact, not a patch, changelog, task tracker, or progress report.
