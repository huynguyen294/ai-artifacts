> This project was built through vibe coding with AI.

# Codex Artifacts

Codex Artifacts is a VS Code extension for reviewing Markdown created by Codex. It opens the document in a dedicated review editor, lets you attach comments to selected text, and sends your decision back to Codex so the same conversation can revise the document, proceed with approved work, or save it without execution.

## Requirements

- VS Code 1.95.0 or newer.
- The Codex extension for VS Code.
- Node.js available as `node` in `PATH`; the installed MCP integration is launched with this command.
- When building from source: Node.js `^20.19.0 || >=22.12.0` and npm.

## Getting started

### 1. Install the extension

Download [the current Codex Artifacts VSIX](releases/codex-artifacts.vsix). In VS Code, open **Extensions**, select `...`, choose **Install from VSIX...**, and select the downloaded file.

From a repository checkout, you can also run:

```powershell
code --install-extension releases/codex-artifacts.vsix
```

To build the VSIX yourself, follow [Development](#development) below.

### 2. Install the Codex integration

Run **Codex Artifacts: Install Global Codex Integration** from the Command Palette. By default, it installs:

```text
~/.agents/skills/create-review-artifact/
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/config.toml
```

The skill always uses `~/.agents/skills/create-review-artifact/`. If `CODEX_HOME` is set, the MCP script and `config.toml` use that directory instead of `~/.codex`; the skill location does not change.

The installer preserves unrelated MCP configuration, skills, hooks, and project files. During an upgrade, it removes only legacy integration assets recognized as managed by Codex Artifacts.

After an installation or upgrade:

1. Restart the Codex extension.
2. Start a new chat so it can load the installed MCP tools and skill.
3. Run **Codex Artifacts: Verify Codex Integration** from the Command Palette.

### 3. Create an artifact

Explicitly ask Codex to create or update a review artifact:

```text
Create a review artifact for this API design.
Use $create-review-artifact to draft a plan for this change.
```

Asking for a plan or Markdown document without explicitly requesting an artifact does not activate the review lifecycle. Explicit requests to inspect saved feedback or reconnect a known artifact can resume an existing lifecycle.

The MCP server creates:

```text
.codex-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json  # present after a decision is submitted
```

By default, the extension opens a new `artifact.md` in **Artifact Review** after its `comments.json` is created. This behavior is controlled by `agentPlus.autoOpenArtifactReview`, which defaults to `true`. If auto-open is disabled, run **Codex Artifacts: Open Artifact Review** or open `artifact.md` with the Artifact Review editor.

#### Workspace resolution

Codex must establish exactly one owning workspace from an explicit user path, an IDE-provided active file, an explicitly named workspace folder, or verified single-folder context. Cwd, `environment_context`, workspace ordering, project contents, and name similarity are hints only. Files such as `package.json` may verify a root already identified by user or IDE evidence; they cannot select one.

The extension publishes focused-window and active-file signals with each registry heartbeat. The MCP validates typed `workspaceEvidence` against the focused window and rejects ambiguous, unregistered, stale, nested, escaped, or unsafe linked workspace requests before creating files.

### 4. Review the artifact

1. Select text inside one paragraph, heading, list item, quote, code block, or table cell.
2. Save feedback in the nearby comment popover.
3. Use **View comments** to inspect saved comments or jump to a highlighted passage. The drawer heading shows **Comments (N)**.
4. Choose an action:
   - **Review** returns saved comments to Codex. Questions are answered directly in chat, and Markdown is replaced only when feedback requests a change. Question-only feedback starts the next round without changing the Markdown bytes or SHA.
   - **Proceed** approves the artifact and ends the current review round. For `plan` and `implementation-plan`, this authorizes Codex to execute the complete approved plan immediately in the same turn. It does not automatically open another review round.
   - **Just save** ends the current round without performing the proposed work. Codex asks for a destination in the workspace and copies the current Markdown there.
   - **Copy Markdown** copies the content locally without sending a lifecycle decision.

You may also save comments without pressing **Review** and tell Codex “read the review” or “hãy xem review”. Codex inspects the exact artifact attached to the conversation, answers questions in chat, applies requested changes when needed, and opens the next round. It never guesses the newest artifact in a workspace.

When the current round has no saved comments or submission, you may request a concrete artifact edit directly in chat, such as “add a rollout phase to this artifact”. Codex inspects the exact artifact with the explicit chat-update intent, replaces the Markdown, opens the next round, and waits again without requiring a dummy comment or an empty Review submission. A request to reconnect or keep waiting does not use this intent: it reattaches to the same round without changing Markdown or advancing the lifecycle.

## Behavior and security

- New artifacts use schema version 4 and an MCP-generated `reviewSessionId`; no chat thread ID or creation hook is needed.
- Artifact data outlives the transient MCP waiter and individual chat turns. Cancellation, takeover, or an MCP restart detaches process state without deleting the artifact.
- The MCP server and extension own lifecycle files. The skill never creates, repairs, or bypasses them directly.
- The lifecycle API consists of `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`.
- Comments and submissions bind the artifact ID, review session, round, and content hashes.
- Round tokens are in-memory, one-time, exact-state-bound, and expire after one hour. A validated inspection can issue a fresh token after an MCP restart.
- A chat-update token is issued only for an explicitly requested edit on an empty round. It requires replacement Markdown with a different SHA and cannot consume saved comments or a submitted decision.
- Each artifact permits one live waiter. Cancellation and takeover release only that waiter; they do not modify persistent lifecycle files.
- Round updates are transactional and roll back if a commit fails, including the narrow Windows editor-lock fallback.
- Markdown uses CommonMark/GFM. Raw HTML, artifact scripts, remote images, and unsafe external protocols are disabled.
- `.codex-artifacts/` is operational review state and normally should not be committed.

## Compatibility and upgrades

- Schema v4 is the only writable artifact lifecycle. Existing schema-v4 artifacts do not need migration.
- Schema-v3 artifacts remain readable in Artifact Review but are read-only. Create a new schema-v4 artifact to continue reviewing their content.
- Older `.codex-artifacts/plans/` data is left untouched for manual archival or removal; the installer does not delete user artifact data.
- Version 0.8.0 adds explicit chat updates on empty rounds without changing artifact schema v4. After upgrading, run **Codex Artifacts: Install Global Codex Integration** again, restart Codex, and begin a new chat so the updated MCP tool schema and skill are loaded.
- Version 0.7.0 replaced the former two-tool MCP API with the four lifecycle tools listed above.

## Troubleshooting

### MCP tools are unavailable

Run **Codex Artifacts: Install Global Codex Integration**, restart the Codex extension, and start a new chat. A chat that was already open cannot load tools installed afterward. Also verify that `node` is available in `PATH`.

### `WORKSPACE_NOT_REGISTERED`

Open or add the exact target folder in the VS Code window running Codex Artifacts, wait briefly for the registry heartbeat, and retry. Do not substitute the first workspace folder or create the artifact directly.

### `AMBIGUOUS_WORKSPACE` or `WORKSPACE_EVIDENCE_MISMATCH`

Name the target workspace folder or path explicitly, or focus a concrete file inside it and retry. Project markers and search results do not count as workspace-selection evidence.

### A round token expired or the MCP restarted

The existing content remains intact. Ask Codex to inspect the exact artifact path again to obtain a fresh token and reconnect. If the conversation no longer contains one unambiguous handle, provide the artifact path; Codex must not guess the newest artifact.

### A configuration conflict is reported

Remove or rename the unmanaged `[mcp_servers.codex_artifacts]` entry in `config.toml`, then run the installer again. The extension does not overwrite MCP configuration it does not own.

## Development

Requirements: Node.js `^20.19.0 || >=22.12.0` and VS Code 1.95.0 or newer.

```powershell
npm ci
npm run check
npm test
npm run build
```

Press `F5` to launch an Extension Development Host. Package and install with:

```powershell
npm run package
code --install-extension releases/codex-artifacts.vsix
```

`npm run package` creates both `releases/codex-artifacts-<version>.vsix` and the stable `releases/codex-artifacts.vsix` alias.

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
