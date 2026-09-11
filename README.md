> This project was built through vibe coding with AI.

# AI Artifacts - Interactive Planning & Review

**AI Artifacts** is a VS Code extension for reviewing AI-generated Markdown artifacts, implementation plans, and architecture proposals. It provides a dedicated interactive review editor directly inside your IDE—allowing you to highlight text, attach inline feedback, and send review decisions back to your AI coding agents (such as **Codex**, **Cursor**, **Windsurf**, and other MCP-enabled assistants) through the open **Model Context Protocol (MCP)**.

With AI Artifacts, you can review proposals before code is written, guide agent planning iteratively, and authorize execution with a single click.

## How It Works

1. **Ask your AI to create an artifact** — In your AI chat, request a review artifact (e.g., _"Create a review artifact for this API design"_). The agent generates an interactive Markdown document in your workspace.
2. **Review & annotate inline** — The Artifact Review editor opens automatically. Highlight any text and attach inline comments with your feedback.
3. **Submit your decision** — Click **Review** to send feedback back for revision, or **Proceed** to approve the plan and let the AI execute immediately.

## Requirements

- VS Code 1.95.0 or newer (or compatible editors like Cursor, Windsurf, VSCodium).
- An AI Agent or extension supporting MCP / Skills (e.g. Codex extension, Cursor Agent, Windsurf Cascade).
- Node.js available as `node` in `PATH`; the installed MCP integration is launched with this command.
- When building from source: Node.js `^20.19.0 || >=22.12.0` and npm.

## Getting started

### 1. Install the extension

- **From Marketplace / Open VSX:** Search for `AI Artifacts` in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click **Install**.
- **From VSIX release:** Download the latest [AI Artifacts VSIX](releases/ai-artifacts-0.9.3.vsix) and run:
  ```powershell
  code --install-extension releases/ai-artifacts-0.9.3.vsix
  # Or in Cursor:
  cursor --install-extension releases/ai-artifacts-0.9.3.vsix
  ```

To build the VSIX yourself from source, follow [Development](#development) below.

### 2. Install the AI / MCP integration

Open the Command Palette (`Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS) and choose your preferred setup command:

- **`AI Artifacts: Install All Detected Integrations`**: Deploys the centralized MCP runtime to `~/.vscode/ai-artifacts/` and automatically configures all detected AI environments on your machine.
- Or choose the dedicated installer for your specific AI client:
  - **`AI Artifacts: Install Integration for GitHub Copilot`**: Automatically configures VS Code User global configuration (`Code/User/mcp.json`) for GitHub Copilot.
  - **`AI Artifacts: Install Integration for Cursor`**: Automatically configures `~/.cursor/mcp.json`.
  - **`AI Artifacts: Install Integration for Codex`**: Automatically configures `~/.codex/config.toml`.
  - **`AI Artifacts: Install Integration for Claude`**: Automatically configures `~/.claude.json`.
  - **`AI Artifacts: Install Integration for Windsurf`**: Automatically configures `~/.codeium/windsurf/mcp_config.json`.
- Or run **`AI Artifacts: Copy MCP Configuration JSON`** to copy the ready-to-use JSON configuration snippet directly to your clipboard to paste into any MCP-compatible editor.
- Or run **`AI Artifacts: Copy create-review-artifact Skill Markdown`** to copy the full agent review skill instructions directly to your clipboard to paste into custom agent prompts, system instructions, or skill files.

```text
# Centralized runtime & skill assets:
~/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs      # Centralized MCP runtime server
~/.vscode/ai-artifacts/workspaces/                      # Live workspace heartbeat registry
~/.agents/skills/create-review-artifact/                 # Shared agent skill & instructions
```

The installer preserves all unrelated MCP configurations, custom skills, and workspace files.

### 3. Reload and verify the integration

After installing or upgrading:

1. Reload the window (**Developer: Reload Window** from the Command Palette).
2. Restart your AI chat extension or agent (Cursor, Codex, Windsurf, Claude, Copilot).
3. Start a fresh chat conversation to load the newly registered MCP tools and skill.
4. Verify readiness by running **AI Artifacts: Verify All Integrations** from the Command Palette.

### 4. Verification & troubleshooting

To ensure AI Artifacts is ready, verify the two core components (**MCP** and **Skills**):

#### 1. Automated check via command

Run **`AI Artifacts: Verify All Integrations`** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **Skill (.agents):** Must report **Ready** (confirms `create-review-artifact` is deployed to `~/.agents/skills/`).
- **Base (.vscode):** Must report **Ready** (confirms central MCP runtime server is deployed to `~/.vscode/ai-artifacts/`).
- **Clients:** Shows detected configuration state for each AI editor.

#### 2. Agent customization check (or manual setup)

If the verify command reports `missing` (or you prefer manual setup), check directly in your Agent's **Customization / Settings** view:

- **MCP Server:** Confirm `ai_artifacts` is enabled with tools like `create_artifact` and `inspect_artifact`. If missing, run **`AI Artifacts: Copy MCP Configuration JSON`** from the Command Palette and paste the snippet into your agent's MCP settings.
- **Skills:** Confirm `create-review-artifact` is available (type `$create-review-artifact` in chat or check active skills). If missing, run **`AI Artifacts: Copy create-review-artifact Skill Markdown`** to copy the skill instructions directly to your clipboard, configure your agent to load skills from `~/.agents/skills/`, or copy `~/.agents/skills/create-review-artifact/` into your agent/workspace skills directory.

> [!NOTE]
> **Prerequisites:** Requires **Node.js** in `PATH` to run the MCP server. Always reload the window and start a fresh chat turn after changing configurations.

### 5. Uninstalling and cleanup

AI Artifacts provides two comprehensive ways to remove MCP configurations and runtime assets:

- **Automatic Cleanup upon Extension Uninstall:** When you uninstall the AI Artifacts extension from VS Code or Cursor (`Extensions -> Uninstall`), an automated lifecycle hook (`vscode:uninstall`) runs a standalone script that automatically removes the `ai_artifacts` MCP configuration from all detected AI clients and completely deletes base runtime assets (`~/.vscode/ai-artifacts/` and `~/.agents/skills/create-review-artifact/`).
- **Manual Cleanup via Command Palette:** If you want to disconnect MCP integrations while keeping the VS Code extension active, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):
  - **`AI Artifacts: Uninstall All Detected Integrations`**: Removes MCP configs from all detected editors and clears base runtime assets.
  - Or choose a specific client: **`AI Artifacts: Uninstall Integration for GitHub Copilot`**, **`... for Cursor`**, **`... for Codex`**, **`... for Claude`**, or **`... for Windsurf`**.

> [!IMPORTANT]
> **Zero Project Data Loss:** Neither uninstall method will ever touch or delete your project repositories' `.ai-artifacts/` or `.codex-artifacts/` review history and documents.

### Compatibility & Supported Agents

AI Artifacts connects to your favorite AI coding agents using the Model Context Protocol (MCP) and shared agent skills:

| AI / Environment                     | Integration Type                   | Supported Features                                       |
| :----------------------------------- | :--------------------------------- | :------------------------------------------------------- |
| **Codex** (VS Code)                  | Native MCP (`config.toml`) + Skill | Full lifecycle, auto-open editor, Proceed execution      |
| **Cursor**                           | MCP Server (`mcp.json`) + Skill    | Multi-round review, inline annotations, waiter reconnect |
| **Windsurf** (Cascade)               | MCP Server (`mcp_config.json`)     | Plan review, inline feedback via MCP                     |
| **Claude (VS Code Extension / MCP)** | MCP Server / Tool Integration      | Artifact creation, inspection, round advancement         |

### 6. Ask your AI to create a review artifact

In your AI chat (Codex, Cursor, etc.), request a review artifact for your task:

```text
Create a review artifact for this API design.
Use $create-review-artifact to draft an implementation plan before writing code.
```

Asking for a plan or Markdown document without explicitly requesting an artifact does not activate the review lifecycle. Explicit requests to inspect saved feedback or reconnect a known artifact can resume an existing lifecycle.

The AI agent calls the MCP `create_artifact` tool, which generates an isolated review bundle in your workspace:

```text
.ai-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json  # Present after a decision is submitted
```

By default, the custom **Artifact Review** editor opens automatically as soon as the artifact is created. This behavior is controlled by the `agentPlus.autoOpenArtifactReview` setting (defaults to `true`).

### 7. Review, annotate, and drive execution

1. **Highlight text:** Select any paragraph, heading, list item, quote, code block, or table cell.
2. **Add inline comments:** Type your feedback in the floating comment popover and click **Save**.
3. **Inspect feedback:** Open the **Comments (N)** drawer to jump between annotated passages.
4. **Submit your decision:**
   - **Review (Revise):** Sends your batch comments back to the AI. The agent answers questions in chat, updates the Markdown where changes were requested, and opens the next review round. Question-only feedback starts the next round without changing the Markdown bytes or SHA.
   - **Proceed:** Approves the plan and concludes the review. For `plan` and `implementation-plan`, this authorizes the agent to execute the approved work immediately in the same turn.
   - **Just save:** Saves the Markdown to a designated workspace path without executing code.
   - **Copy Markdown:** Copies the raw document to the clipboard without changing lifecycle state.

> [!TIP]
> **Chat Escape Flow:** You can also save comments without clicking _Review_, then simply tell your AI in chat: _"Read the review"_ or _"Check the review comments"_. The AI will inspect the exact artifact, answer your notes, and advance the review round.

When the current round has no saved comments or submission, you may request a concrete artifact edit directly in chat, such as _"add a rollout phase to this artifact"_. The AI inspects the exact artifact with the explicit chat-update intent, replaces the Markdown, opens the next round, and waits again without requiring a dummy comment or an empty Review submission.

## Behavior and security

- **Safe Lifecycle:** Artifact data outlives transient MCP connections. Process restarts, waiter cancellations, or new chat turns never destroy unreviewed artifacts.
- **Fail-Closed Workspace Ownership:** The agent must prove workspace ownership via explicit tagged files or an MCP-issued resolver token before creating an artifact. Cwd or fuzzy workspace guessing is rejected.
- **Transactional Updates:** Multi-round revisions are transactional; failed commits automatically roll back, including the Windows editor-lock fallback.
- **Local & Private:** Everything runs locally on your machine via stdio MCP. No code, markdown, or telemetry is sent to any external server.
- **Content Sanitization:** Rendered with CommonMark/GFM with syntax highlighting (Shiki) and diagram rendering (Mermaid). Unsafe raw HTML, scripts, and remote protocols are disabled.
- **State Storage:** `.ai-artifacts/` contains operational review state and normally should not be committed to Git. Legacy `.codex-artifacts/` remains fully readable and supported.

## Compatibility and upgrades

- Schema v4 is the only writable artifact lifecycle. Existing schema-v4 artifacts do not need migration.
- Schema-v3 artifacts remain readable in Artifact Review but are read-only. Create a new schema-v4 artifact to continue reviewing their content.
- Older `.codex-artifacts/` data is left untouched for backwards compatibility; the installer and extension do not delete user artifact data.
- Version 0.9.2 standardizes artifact storage under `.ai-artifacts/` while maintaining 100% backwards compatibility for legacy `.codex-artifacts/`.
- Version 0.9.0 adds workspace candidate resolution, the two-evidence creation contract, default `implementation-plan` creation, multi-handle/intent safety rules, and structured lifecycle recovery.

## Troubleshooting

### MCP tools are unavailable

Run **Codex Artifacts: Install Global Codex Integration**, restart your AI extension/editor, and start a new chat. A chat that was already open cannot load tools installed afterward. Also verify that `node` is available in `PATH`.

### `WORKSPACE_NOT_REGISTERED`

Open or add the exact target folder in the VS Code / Cursor window running AI Artifacts, wait briefly for the registry heartbeat, and retry. Do not substitute the first workspace folder or create the artifact directly.

### Workspace selection expired or evidence does not match

If no file was tagged, resolve again and choose a current name/path candidate, asking the user only if the result is ambiguous. If a file was tagged, verify that it still exists inside the intended registered workspace.

### A round token expired or the MCP restarted

The existing content remains intact. Ask the AI agent to inspect the exact artifact path again to obtain a fresh token and reconnect.

### A configuration conflict is reported

Remove or rename the unmanaged `[mcp_servers.ai_artifacts]` entry in your configuration file, then run the installer again.

## Development

Requirements: Node.js `^20.19.0 || >=22.12.0` and VS Code 1.95.0 or newer.

```powershell
npm ci
npm run check
npm test
npm run build
```

Press `F5` to launch an Extension Development Host. Package and install locally:

```powershell
npm run package
code --install-extension releases/ai-artifacts-0.9.3.vsix
```

## Documentation

- [Product philosophy](docs/PHILOSOPHY.md) — product intent, lifecycle semantics, and non-goals.
- [Architecture](docs/ARCHITECTURE.md) — system boundaries, ownership, workspace registry, and filesystem safety.
- [Components and responsibilities](docs/COMPONENTS.md) — detailed component and ownership map.
- [Project instructions](docs/INSTRUCTION.md) — contributor invariants, workflow, and validation requirements.
- [Artifact contract](skills/create-review-artifact/references/artifact-contract.md) — exact skill and MCP lifecycle contract.
- [Change logs](CHANGE_LOGS.md) — release history.
- [Documentation change logs](docs/CHANGE_LOGS.md) — meaningful documentation and architecture decisions.
- [Known follow-up work](TODO.md) — current improvement backlog.
- [MIT License](LICENSE) — project license.
