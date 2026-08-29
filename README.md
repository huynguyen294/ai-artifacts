> This project was built through vibe coding with AI.

# Codex Artifacts

Codex Artifacts is a VS Code extension for reviewing Codex-generated Markdown as a first-class artifact. Read a rendered document, select text inside a Markdown block, add comments, and return an explicit decision to the Codex turn that created it.

One user request owns one artifact. Selecting **Review** updates the same `artifact.md` and starts a new review round; it does not create a revision directory or retain old content.

## Getting started

### 1. Install the extension

In VS Code, open **Extensions**, select `...`, choose **Install from VSIX...**, and select `codex-artifacts.vsix`.

From a terminal:

```powershell
code --install-extension releases/codex-artifacts.vsix
```

The extension identifier is `agent-plus-local.codex-artifacts`.

### 2. Install the global Codex integration

Run **Codex Artifacts: Install Global Codex Integration** from the Command Palette. It installs:

```text
~/.agents/skills/create-review-artifact/
~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/hooks.json
~/.codex/config.toml
```

If `CODEX_HOME` is configured, Codex files are installed there. Existing unrelated skills, hooks, and MCP configuration are preserved. The installer removes the extension-managed legacy `create-plan-artifact` skill.

### 3. Trust the hook once

1. Open Codex in a terminal.
2. Run `/hooks`.
3. Trust the Codex Artifacts hook.
4. In VS Code, run **Codex Artifacts: Verify Codex Integration**.

Restart Codex and start a new chat after installation or an integration upgrade. Existing chats do not load newly installed skills, hooks, or MCP tools.

### 4. Create an artifact

The bundled skill is allowed to trigger automatically when Codex prepares a substantive implementation plan that should be reviewed before implementation. You can also request an artifact explicitly:

```text
Create a review artifact for this API design.
```

Or invoke the skill directly:

```text
Use $create-review-artifact to create an implementation plan for this task.
```

Codex creates:

```text
.codex-artifacts/artifacts/<artifact-id>/
  artifact.json
  artifact.md
  comments.json
```

The extension opens `artifact.md` in **Artifact Review**.

#### Workspace resolution

Before creating an artifact, Codex resolves its owning workspace in this order:

1. A path, file link, `@mention`, or attachment explicitly supplied in the conversation.
2. An active/open file supplied by IDE context with a concrete path.
3. A repository or folder explicitly named in the conversation, verified against a relevant project file.
4. A direct question to the user when the preceding evidence does not identify exactly one root.

Codex cwd, `environment_context`, workspace order, and the first visible repository are hints only. They never establish that a folder is active or selected. Explorer selection is usable only when an integration explicitly supplies it.

### 5. Review the artifact

1. Select text inside one paragraph, heading, list item, quote, or code block.
2. Save a comment in the review panel.
3. Choose an action:
   - **Review** returns comments and asks Codex to update the same artifact.
   - **Proceed** approves the artifact and lets Codex continue the original work.
   - **Just save** asks for a workspace destination and saves Markdown without continuing the work.
   - **Copy Markdown** copies content locally and does not change the review lifecycle.

An unsaved comment draft disables lifecycle actions until it is saved or cancelled.

The originating Codex turn stays open in `wait_for_artifact_review`. On Review, Codex uses a one-time token with `update_artifact`; the MCP server transactionally updates the same `artifact.md`, increments `reviewRound`, resets comments/submission, and returns the document to review.

## Behavior

- Artifacts live at `.codex-artifacts/artifacts/<artifact-id>/` and use schema version 3.
- One independent request keeps one directory and one artifact ID through all review rounds.
- Review history and old Markdown are not retained.
- Artifact HTML is never executed; controlled Markdown blocks are rendered with a nonce-based CSP.
- Comments and submissions are bound to artifact ID, review round, origin thread, and content hashes.
- Review updates are staged and rolled back if the transaction cannot commit.
- The extension never redirects feedback to another chat or starts a hidden Codex turn.
- Generated `.codex-artifacts/` data is operational review state and normally should not be committed.
- Automatic skill triggering is currently limited to implementation plans; other artifact kinds require an explicit user request.

## Legacy schema v2

Version 0.4.0 does not migrate active schema-v2 reviews from `.codex-artifacts/plans/`. Their replacement/thread semantics cannot be safely converted to live schema-v3 review rounds.

Legacy `plans/` and `.trash/` data is left untouched. Archive or delete it manually after confirming it is no longer needed. The new runtime only creates data under `.codex-artifacts/artifacts/`.

## Troubleshooting

### Integration is untrusted or outdated

Run the install command, use Codex `/hooks` to trust the exact current hook, then run **Verify Codex Integration**. A changed hook hash requires trust again.

### `origin.threadId` or `comments.json` is missing

The creation hook did not run. Verify the integration, restart Codex, start a new chat, and create the artifact again. Never backfill origin manually.

### MCP tools are unavailable

The current chat did not load `wait_for_artifact_review` and `update_artifact`. Reinstall the global integration, restart Codex, and start a new chat.

### A review update token expired

The live review connection was lost or the MCP server restarted. Existing artifact content remains intact, but a fresh live artifact lifecycle is required.

## Development

Requirements: Node.js 20+ and a working Codex CLI login.

```powershell
npm install
npm run check
npm test
npm run build
```

Press `F5` to launch an Extension Development Host.

Package and install:

```powershell
npm run package
code --install-extension releases/codex-artifacts.vsix
```

## Schema-v3 manifest example

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

Development references for system boundaries and product intent live in `docs/ARCHITECTURE.md` and `docs/PHILOSOPHY.md`.
