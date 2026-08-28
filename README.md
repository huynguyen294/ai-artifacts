# Codex Artifacts

Codex Artifacts is a VS Code extension for reviewing Codex-generated plans as first-class artifacts. You can read a rendered plan, select text inside a Markdown block, add comments, and send the review back to the Codex conversation that created the plan.

## Getting started

The VS Code extension and its Codex integration are each installed once per user. Repositories only contain generated `.codex-artifacts/` data.

### 1. Install the extension

In VS Code:

1. Open the **Extensions** view.
2. Select the `...` menu.
3. Select **Install from VSIX...**.
4. Choose `codex-artifacts.vsix`.
5. Reload VS Code when prompted.

From a terminal:

```powershell
code --install-extension releases/codex-artifacts.vsix
```

The extension identifier is `agent-plus-local.codex-artifacts`.

### 2. Install the global Codex integration

1. Open the Command Palette with `Ctrl+Shift+P`.
2. Run **Codex Artifacts: Install Global Codex Integration**.

The command installs:

```text
~/.agents/skills/create-plan-artifact/
~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/hooks.json
~/.codex/config.toml
```

If `CODEX_HOME` is configured, the hook script and `hooks.json` are installed there instead of `~/.codex`. Existing unrelated user hooks are preserved.

When run from a workspace that used Agent Plus 0.1.x, setup removes the legacy Agent Plus hook entry and generated local skill from that workspace. It does not touch `.codex-artifacts/` or unrelated hooks.

### 3. Trust the hook once

Codex requires explicit trust for non-managed hooks, including user-level hooks:

1. Open Codex in a terminal.
2. Run `/hooks`.
3. Select and trust the Codex Artifacts hook.
4. Return to VS Code and run **Codex Artifacts: Verify Codex Integration**.

Setup reports ready only after App Server `hooks/list` returns `trustStatus: trusted`. A future extension update that changes the hook hash can require trust again. Restart the Codex extension after setup so new chats load the `codex_artifacts` MCP server.

### 4. Start a new Codex chat

Start a new chat after setup or after trusting an updated hook. Ask Codex:

```text
Create a plan artifact for this authentication feature.
```

You can also invoke the skill explicitly:

```text
Use $create-plan-artifact to create a plan for this task.
```

Codex creates:

```text
.codex-artifacts/plans/<artifact-id>/
  artifact.json
  plan.md
  comments.json
```

In a multi-root workspace, Codex resolves the workspace root relevant to the request and creates the artifact there. If more than one root is plausible, Codex asks which root should own the artifact instead of defaulting to the first folder.

### 5. Review the plan

1. The extension automatically opens the generated `plan.md` after the artifact hook finishes.
2. If auto-open is disabled or the file opens as text, use **Reopen Editor With... → Plan Review**.
3. Select text inside one paragraph, heading, list item, quote, or code block.
4. Add a comment in the review panel.
5. Select **Review** to return saved comments and request a new plan revision, **Proceed** to continue implementation with or without comments, or **Just save** to choose a workspace destination without implementing the plan.

The originating Codex turn stays open in `wait_for_plan_review`. Review comments, approval, and save requests all return to that same turn. Codex Artifacts never starts a hidden background turn.

## Troubleshooting

### Integration remains untrusted

Installing files does not grant trust. Run `/hooks` in Codex, trust the exact Codex Artifacts hook definition, then run **Codex Artifacts: Verify Codex Integration**. Reinstalling the same files does not bypass this security check.

### `origin.threadId` or `comments.json` is missing

The hook did not run. Verify the integration, start a new Codex chat, and create a new artifact. Do not manually backfill a thread ID because it cannot be linked reliably to the originating conversation.

### `wait_for_plan_review` is unavailable

Run **Codex Artifacts: Install Global Codex Integration**, restart the Codex extension, and start a new chat. Existing chats do not automatically load newly installed MCP servers.

### Commands are missing

1. Confirm **Codex Artifacts** is enabled in Extensions.
2. Run **Developer: Reload Window**.
3. Search the Command Palette for `Codex Artifacts`.

## Behavior

- Plans live at `.codex-artifacts/plans/<artifact-id>/`.
- Every artifact declares an absolute `location.workspaceRoot` and remains in that root for its full lifecycle.
- Multi-root workspaces are supported. Ambiguous requests require the user to choose the target root.
- `plan.md` opens automatically in the Plan Review custom editor when `agentPlus.autoOpenPlanReview` is enabled.
- A selection must stay inside one rendered Markdown block.
- Comments are persisted beside the plan in `comments.json`.
- **Review** requires at least one saved comment and creates an immutable revision request for the same active Codex turn.
- **Proceed** releases the same wait and continues implementation; any saved comments remain available to Codex.
- **Just save** releases the same wait so Codex can ask where to copy the plan, then finishes without implementation.
- The MCP wait defaults to a one-hour tool timeout and is cancelled when the originating turn ends.
- Revisions are immutable. A valid replacement moves the previous revision to `.codex-artifacts/.trash/`.

## Development

Requirements: Node.js 20+ and a working Codex CLI login.

```powershell
npm install
npm run check
npm test
npm run build
```

Press `F5` in VS Code to launch an Extension Development Host.

Package and install the extension:

```powershell
npm run package
code --install-extension releases/codex-artifacts.vsix
```

The bundled `create-plan-artifact` skill creates a new directory containing `artifact.json` and `plan.md`. The trusted global hook records Codex `session_id` as `origin.threadId`, creates `comments.json`, and finalizes replacement cleanup. The bundled STDIO MCP server waits for the extension-owned review submission so the original Codex turn remains active.

## Artifact contract

Example manifest before the hook stamps the origin:

```json
{
  "schemaVersion": 2,
  "kind": "plan",
  "artifactId": "plan-auth-20260827-01",
  "title": "Authentication rollout plan",
  "createdAt": "2026-08-27T08:00:00.000Z",
  "operation": "create",
  "location": {
    "workspaceRoot": "D:/workspace/example"
  },
  "origin": {}
}
```

For a revision, Codex adds:

```json
{
  "operation": "replace",
  "replacesArtifactId": "plan-auth-20260827-01"
}
```

The implementation follows the official [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) and [Codex hooks](https://learn.chatgpt.com/docs/hooks) contracts.

Development references live in `plans/PLAN.md` and `docs/ARCHITECTURE.md`.
