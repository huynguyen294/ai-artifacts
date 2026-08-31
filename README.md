> This project was built through vibe coding with AI.

# Codex Artifacts

Codex Artifacts is a VS Code extension for reviewing Codex-generated Markdown as a first-class artifact. It renders the document, lets you comment on selected text, and returns **Review**, **Proceed**, or **Just save** to the exact Codex tool call that created it.

One request owns one artifact. **Review** replaces the same `artifact.md` and starts another review round; old Markdown and revision directories are not retained.

## Getting started

### 1. Install the extension

In VS Code, open **Extensions**, select `...`, choose **Install from VSIX...**, and select `codex-artifacts.vsix`.

Or run:

```powershell
code --install-extension releases/codex-artifacts.vsix
```

### 2. Install the Codex integration

Run **Codex Artifacts: Install Global Codex Integration** from the Command Palette. It installs:

```text
~/.agents/skills/create-review-artifact/
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/config.toml
```

If `CODEX_HOME` is set, Codex-owned files use that directory. Existing unrelated MCP configuration, skills, and hooks are preserved. The installer removes only legacy Codex Artifacts hook entries/assets that it recognizes.

No `/hooks` trust step is required. Restart the Codex extension and start a new chat after installation or an upgrade because existing chats do not load newly installed MCP tools or skills.

Run **Codex Artifacts: Verify Codex Integration** to check the installed MCP, skill, and configuration.

### 3. Create an artifact

The bundled skill triggers only when you explicitly ask Codex to create or update an artifact. Asking for a plan alone does not activate the artifact lifecycle:

```text
Create a review artifact for this API design.
Use $create-review-artifact to draft a plan for this change.
```

The MCP server creates:

```text
.codex-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
```

The extension automatically opens `artifact.md` in **Artifact Review**, while the originating MCP tool call remains waiting.

#### Workspace resolution

Codex must establish exactly one owning workspace from an explicit user path, IDE-provided active file, an explicitly named workspace folder, or verified single-folder context. Cwd, `environment_context`, workspace ordering, project contents, and name similarity are hints only. Files such as `package.json` may verify a root already identified by user/IDE evidence; they cannot select a root.

The extension publishes focused-window and active-file signals with each registry heartbeat. The MCP requires typed `workspaceEvidence`, validates it against the focused window, and rejects ambiguous multi-root requests before creating storage. Unregistered, stale, nested, escaped, and unsafe linked paths are also rejected.

### 4. Review the artifact

1. Select text inside one paragraph, heading, list item, quote, code block, or table cell.
2. Save feedback in the nearby comment popover.
3. Use **Comments (N)** to inspect comments or jump to a highlighted passage.
4. Choose:
   - **Review**: return comments and ask Codex to replace the current artifact content. **Review responses** contains answers for only the immediately preceding comment round and is replaced on the next revision.
   - **Proceed**: approve the artifact. For an implementation plan, this explicitly tells Codex to implement the approved plan immediately in the same turn.
   - **Just save**: ask Codex to save the Markdown without performing the proposed work.
   - **Copy Markdown**: copy locally without changing the review lifecycle.

On **Review**, Codex receives a one-time update token and calls `update_and_wait_for_artifact`. The MCP transaction advances `reviewRound`, replaces the same `artifact.md`, clears the previous review state, and waits again. On **Proceed** or **Just save**, no update token is granted.

## Behavior and security

- New artifacts use schema version 4 and an MCP-generated `reviewSessionId`; no chat thread ID or creation hook is needed.
- Lifecycle files are owned by the MCP server and extension. The skill never creates or repairs them directly.
- Comments and submissions bind the artifact ID, review session, round, and content hashes.
- Update tokens are in-memory, one-time, round-bound, and expire after one hour.
- Each artifact permits one live waiter. Concurrent or replayed lifecycle calls fail closed.
- Updates are transactional and roll back if a round cannot commit, including Windows editor-lock fallback behavior.
- Markdown uses CommonMark/GFM. Raw HTML, artifact scripts, remote images, and unsafe external protocols are disabled.
- `.codex-artifacts/` is operational review state and normally should not be committed.
- Artifact creation always requires an explicit request to create or update an artifact; document kind alone does not trigger it.

### Legacy artifacts

Schema-v3 artifacts from the former hook lifecycle remain readable in Artifact Review, but are read-only. Start a new MCP-owned artifact to continue reviewing. Older `.codex-artifacts/plans/` data is left untouched for manual archival or removal.

## Troubleshooting

### MCP tools are unavailable

Run **Install Global Codex Integration**, restart the Codex extension, and start a new chat. The current chat cannot load tools installed after it began.

### `WORKSPACE_NOT_REGISTERED`

Open or add the exact target folder in the VS Code window running Codex Artifacts. Wait briefly for the registry heartbeat and retry. Do not substitute the first workspace folder or create the artifact directly.

### `AMBIGUOUS_WORKSPACE` or `WORKSPACE_EVIDENCE_MISMATCH`

Name the target workspace folder/path explicitly, or focus a concrete file inside it and retry. Project markers and search results do not count as selection evidence.

### An update token expired or the MCP restarted

The existing content remains intact, but the disconnected lifecycle cannot be resumed by guessing state. Create a fresh MCP-owned artifact.

### A configuration conflict is reported

Remove or rename the unmanaged `[mcp_servers.codex_artifacts]` entry in `config.toml`, then run the installer again. The extension does not overwrite MCP configuration it does not own.

## Development

Requirements: Node.js 20+.

```powershell
npm install
npm run check
npm test
npm run build
```

Press `F5` to launch an Extension Development Host. Package and install with:

```powershell
npm run package
code --install-extension releases/codex-artifacts.vsix
```

Development boundaries and product intent are documented in `docs/ARCHITECTURE.md` and `docs/PHILOSOPHY.md`.
