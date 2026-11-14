# Improve Codex Installer, Unexpected-Key Guard, README Recovery Link, and Copy Codex MCP Config Command

## Context

- Codex (CLI / VS Code extension) strips `# >>> AI Artifacts review MCP >>>` / `# <<< AI Artifacts review MCP <<<` comment markers, drops fields such as `tool_timeout_sec`, `default_tools_approval_mode`, and `[mcp_servers.ai_artifacts.tools.*]`, or scatters `[mcp_servers.ai_artifacts*]` tables when rewriting `~/.codex/config.toml` (for example via `codex mcp add`).
- Relying on comment markers breaks `Verify` (`hasManagedCodexArtifactsMcp`), `Install` (`upsertCodexArtifactsMcp`), `Upgrade` (`patchCodexArtifactsMcpForUpgrade` returning early without fixing stripped blocks), and `Uninstall` (`removeCodexArtifactsMcp`).
- Deleting blindly from `[mcp_servers.ai_artifacts]` to the next `[header]` risks erasing unrelated settings if a downstream section header (for example `[desktop]`) was accidentally deleted, while parsing/merging arbitrary user custom keys in TOML adds unnecessary complexity and risks conflict with managed defaults.
- Users also need a dedicated command to copy the Codex TOML configuration snippet (`agentPlus.copyCodexMcpConfig`), and unexpected-key guard failures should direct users straight to a recovery section in `README.md`.

## Requirements

- **Marker-less Codex TOML handling & strict unexpected-key guard (`src/extension/mcp-config.ts`, `src/extension/mcp-clients/codex-client.ts`, `src/extension/workspace-integration.ts`):**
  - Scan `~/.codex/config.toml` for all `[mcp_servers.ai_artifacts*]` and legacy `[mcp_servers.codex_artifacts*]` tables by table header (without requiring `# >>> ... >>>` / `# <<< ... <<<` markers), plus any lingering AI Artifacts / Codex Artifacts marker lines.
  - Apply a strict **unexpected-key guard** across all matched sections before removing or replacing anything:
    - Allowed keys in `[mcp_servers.ai_artifacts]` / `[mcp_servers.codex_artifacts]`: `command`, `args`, `tool_timeout_sec`, `default_tools_approval_mode` (handling single-line and multi-line TOML `args = [...]` arrays, blank lines, and `#` comments).
    - Allowed key in `[mcp_servers.ai_artifacts.tools.*]` / `[mcp_servers.codex_artifacts.tools.*]`: `approval_mode`.
    - Do not expand this whitelist with optional user-custom MCP keys (such as `env` or `custom_flag`) so custom user entries are never silently wiped.
    - Any key outside this strict whitelist (whether a user custom key or an unrelated key exposed by a missing downstream `[header]`) must fail closed with error code `CODEX_UNEXPECTED_KEY_CONFLICT`, naming the unexpected key(s) and telling the user to restore any missing section header or temporarily copy out and remove custom keys before retrying Installer/Upgrade, then re-add them afterward.
  - **Verify (`hasManagedCodexArtifactsMcp`, `CodexClientDriver.check()`):**
    - Treat marker-less configs as valid without requiring comment markers as long as the unexpected-key guard passes and the file defines `[mcp_servers.ai_artifacts]` with `command = "node"`, normalized `args` matching `serverScriptPath`, `tool_timeout_sec = 3600`, `default_tools_approval_mode = "approve"`, and all 6 required tool sub-tables (`resolve_artifact_window`, `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, `advance_and_wait_for_artifact`, `join_session`) with `approval_mode = "approve"`.
    - Return `{ status: "configuration-conflict", detail }` when the unexpected-key guard fails.
  - **Install / Replace (`upsertCodexArtifactsMcp`, `CodexClientDriver.install()`):**
    - When the unexpected-key guard passes, strip all existing `[mcp_servers.ai_artifacts*]` / `[mcp_servers.codex_artifacts*]` sections and any orphaned/displaced markers (resetting whitelisted fields to canonical defaults without retaining custom overrides inside `ai_artifacts`), preserve unrelated sections, and append one canonical managed block wrapped in `# >>> AI Artifacts review MCP >>>` / `# <<< AI Artifacts review MCP <<<`.
  - **Upgrade (`CodexClientDriver.upgrade()`, `src/extension/mcp-config.ts`):**
    - Keep the `needsCodexArtifactsMcpUpgrade(previousMcpVersion, targetMcpVersion)` version gate (`previousMcpVersion < 12 && targetMcpVersion >= 12`), avoid reading `config.toml` when current, and keep disk untouched when `hasManagedCodexArtifactsMcp` already passes.
    - Remove the early exit on missing comment markers: when migration applies and the unexpected-key guard passes, replace the existing Codex Artifacts tables cleanly using `upsertCodexArtifactsMcp`.
    - When the unexpected-key guard fails during upgrade, throw the `CODEX_UNEXPECTED_KEY_CONFLICT` error so `codexDefinitionMigrationFailed` defers updating `mcpVersion` in `integration-version.json` until resolved (re-prompting on future activations until fixed), while shared MCP runtime files, skills, and other AI clients continue upgrading normally.
  - **Uninstall (`removeCodexArtifactsMcp`, `CodexClientDriver.uninstall()`):**
    - Reuse the shared section scanner and unexpected-key guard; remove all `[mcp_servers.ai_artifacts*]` / `[mcp_servers.codex_artifacts*]` sections and markers when clean while preserving all unrelated config sections.
  - Align `codexConfigUsesManagedRuntime` in `src/extension/workspace-integration.ts` with marker-less Codex blocks.

- **Error propagation & README guide routing (`src/extension/workspace-integration.ts`, `src/extension/upgrade-notification.ts`, `src/extension/install-notification.ts`, `src/extension/integration-install-command.ts`, `src/extension/extension.ts`):**
  - Propagate optional `errorCode` in `installSelectedIntegrations` (`failedClients`) and `upgradeDetectedIntegrations` (`clients`).
  - When `failedClients` contains `CODEX_UNEXPECTED_KEY_CONFLICT`:
    - **Automatic Upgrade (`upgrade-notification.ts`):** Route the existing `View Installation Guide` action directly to `https://github.com/huynguyen294/ai-artifacts#codex-toml-unexpected-keys-or-missing-section-header` (keeping `#getting-started` for other failures).
    - **Manual Installer (`install-notification.ts`, `integration-install-command.ts`, `extension.ts`):** Show a non-modal `View Installation Guide` button on install error / partial-success warning notifications containing `CODEX_UNEXPECTED_KEY_CONFLICT` (alongside `Reload Window` on partial failures), opening the same `README.md` anchor.

- **New command: Copy Codex MCP TOML configuration (`package.json`, `src/extension/workspace-integration.ts`, `src/extension/extension.ts`):**
  - Register `agentPlus.copyCodexMcpConfig` (`onCommand:agentPlus.copyCodexMcpConfig`, title `AI Artifacts: Copy Codex MCP Configuration TOML`).
  - Export `getCodexMcpConfigSnippet(context)` producing the canonical managed TOML block (`upsertCodexArtifactsMcp("", targetMcpScript)` including comment markers, `tool_timeout_sec = 3600`, `default_tools_approval_mode = "approve"`, and all 6 `[mcp_servers.ai_artifacts.tools.*]` sections).
  - Copy the TOML snippet to clipboard and show an info confirmation without running installation or recording client state.

- **Documentation (`README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, `docs/CHANGE_LOGS.md`):**
  - Update `README.md` custom setup and verification sections to cover both `AI Artifacts: Copy MCP Configuration JSON` and `AI Artifacts: Copy Codex MCP Configuration TOML`, explicitly noting that copied snippets reference `~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs` (deployed by running `AI Artifacts: Installer` at least once).
  - Add subsection `#### Codex TOML unexpected keys or missing section header` under `Verification & troubleshooting` in `README.md` (`#codex-toml-unexpected-keys-or-missing-section-header`) explaining:
    1. How to restore a missing downstream `[section]` header if unrelated settings accidentally fell under `[mcp_servers.ai_artifacts]`.
    2. How to handle intentional custom keys in `[mcp_servers.ai_artifacts]`: back them up outside `config.toml`, remove the custom keys (or paste a fresh block via `AI Artifacts: Copy Codex MCP Configuration TOML`), run `AI Artifacts: Installer` (or let upgrade finish), and optionally re-add them afterward.
  - Update `README.md`, `docs/INSTRUCTION.md`, `docs/ARCHITECTURE.md`, and `docs/CHANGE_LOGS.md` to reflect the marker-less Codex lifecycle, unexpected-key guard, and `agentPlus.copyCodexMcpConfig`. Keep `package.json` version at `1.2.0`.

- **Out of scope:**
  - Retaining or merging custom keys / custom overrides inside `[mcp_servers.ai_artifacts]` during automated install/upgrade.
  - Changes to JSON client drivers (`Cursor`, `Claude`, `Copilot`, `Cline`, `Antigravity`, `Windsurf`).
  - Broad notification UI redesign (such as renaming `View Installation Guide` to `How to Fix` across unrelated failures).

- **Validation & Tests:**
  - Update and add unit/integration tests in `test/mcp-config.test.ts`, `test/mcp-client-drivers.test.ts`, `test/integration-upgrade.test.ts`, `test/install-notification.test.ts`, `test/upgrade-notification.test.ts`, `test/integration-install-command.test.ts`, `test/extension-command-recording.test.ts`, and verify `test/release-contract.test.ts`.
  - Run `npm.cmd run check`, `npm.cmd test`, and `npm.cmd run build`.
