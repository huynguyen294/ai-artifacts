# Change Logs

All notable changes to the **AI Artifacts** (`agent-plus`) project will be documented in this file.

Release history has been standardized and tracked starting from version **0.2.6**. Package builds prior to this version are not considered part of the official changelog.

---

## [0.9.2] - 2026-09-09

### Standardized .ai-artifacts Storage with 100% Backwards Compatibility

- **Default Storage Migration**:
  - Migrated primary artifact storage directory from `.codex-artifacts/` to `.ai-artifacts/` across the core system.
  - New artifacts created via the MCP server `create_artifact` tool are stored in `.ai-artifacts/artifacts/<id>/`.
  - Zero data mutation: existing artifacts in `.codex-artifacts/` are left untouched without disruptive filesystem scanning or file moves.
- **Dual-Directory Validation (`assertArtifactDirectory`)**:
  - Updated core validation in `src/shared/artifact-validation.ts` to accept both primary `.ai-artifacts` and legacy `.codex-artifacts` directories.
  - Exported `ARTIFACTS_DIRECTORIES` containing both paths to unify validation across the extension and MCP server.
- **VS Code Extension Host & Custom Editor Integration**:
  - Updated `customEditors` contribution in `package.json` with multi-pattern selectors matching both `**/.ai-artifacts/artifacts/**/artifact.md` and `**/.codex-artifacts/artifacts/**/artifact.md`.
  - Updated `artifactReadyWatcher` in `src/extension/extension.ts` to watch comments across both directories via `**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json`.
- **MCP Server & Skill Contract**:
  - Updated temporary file naming in `stamp-origin.ts` to `.ai-artifacts-...tmp`.
  - Updated artifact lifecycle contract in `skills/create-review-artifact/references/artifact-contract.md` to reference `.ai-artifacts`.
  - Added comprehensive unit and integration tests verifying dual-directory validation, artifact storage, and legacy `.codex-artifacts` inspection/advancement (90 tests passing).

---

## [0.9.1] - 2026-09-09

### Product Branding and Release Automation

- Rebranded the product to **AI Artifacts - Interactive Planning & Review** (`ai-artifacts`), positioned as an interactive review layer for AI coding agents (Codex, Cursor, Windsurf, Claude, etc.).
- Added official extension brand icon at `media/icon.png` (256x256 px) with clean anti-aliased transparency for light and dark themes.
- Updated `package.json` metadata:
  - Set publisher to `huynguyen294`.
  - Added categories `AI` and `Programming Languages`.
  - Configured 10 high-value SEO keywords for the VS Code Marketplace and Open VSX Registry.
  - Removed `private: true` to unlock public distribution.
  - Added utility scripts: `clean:releases`, `publish:vscode`, and `publish:ovsx`.
- Improved packaging workflow:
  - Automated cleaning of the `releases/` directory prior to each build (`clean:releases`), guaranteeing that the folder contains exclusively the single newest version VSIX (`releases/ai-artifacts-0.9.1.vsix`).
  - Relocated historical builds to `old-releases/` and configured ignore rules in `.gitignore` and `.vscodeignore`.
- Configured automated CI/CD releases via GitHub Actions (`.github/workflows/release.yml`):
  - Triggered automatically on `v*` tag pushes.
  - Runs typechecks (`npm run check`) and all 86 unit/integration tests (`npm test`).
  - Builds and publishes a GitHub Release with the production VSIX asset attached.
- Security and VSIX optimization: added `.env*` and `old-releases/**` to `.vscodeignore` to prevent leaking environment files or bundling legacy builds.
- Comprehensive `README.md` upgrade: added an agent compatibility matrix and detailed end-to-end getting-started walkthrough.

### Multi-Client MCP Architecture and Installation

- Standardized centralized MCP runtime storage at `~/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs` and moved live workspace heartbeat snapshots to `~/.vscode/ai-artifacts/workspaces/`.
- Introduced modular MCP client drivers under `src/extension/mcp-clients/`:
  - **GitHub Copilot (VS Code)**: Automated configuration in VS Code User configuration (`Code/User/mcp.json` under the official `"servers"` key) across Windows (`%APPDATA%\Code\User\mcp.json`), macOS (`~/Library/Application Support/Code/User/mcp.json`), and Linux (`~/.config/Code/User/mcp.json`), preserving custom servers and settings.
  - **Cursor**: Automated non-destructive configuration in `~/.cursor/mcp.json`.
  - **Codex**: Automated TOML block management in `~/.codex/config.toml` using unified server name `[mcp_servers.ai_artifacts]` and `# >>> AI Artifacts review MCP >>>` markers, with automatic backwards-compatible migration of legacy `[mcp_servers.codex_artifacts]` blocks and encapsulated legacy hook cleanup.
  - **Claude Code**: Automated configuration in `~/.claude.json`.
  - **Windsurf**: Automated configuration in `~/.codeium/windsurf/mcp_config.json`.
- Unified MCP server naming: standardized server name to `ai_artifacts` across all client platforms (Codex, Cursor, Claude Code, Windsurf, GitHub Copilot).
- Stdio transport conformity for VS Code: ensured `CopilotClientDriver` and `upsertJsonMcpServer` automatically inject `"type": "stdio"` when targeting VS Code's `"servers"` container in `Code/User/mcp.json`.
- Implemented dedicated installation commands in the Command Palette:
  - `AI Artifacts: Install All Detected Integrations`: Deploys base server and configures all detected environments including VS Code / Copilot User configuration.
  - `AI Artifacts: Install Integration for GitHub Copilot`: Automatically configures VS Code User configuration (`Code/User/mcp.json`) and provisions base runtime and agent skills.
  - `AI Artifacts: Install Integration for Codex`
  - `AI Artifacts: Install Integration for Cursor`
  - `AI Artifacts: Install Integration for Claude`
  - `AI Artifacts: Install Integration for Windsurf`
  - `AI Artifacts: Copy MCP Configuration JSON`: Copies ready-to-use JSON config snippet directly to clipboard.
  - `AI Artifacts: Verify All Integrations`: Verifies and reports detailed readiness for base assets and each client.
- Implemented robust non-destructive JSON & text helper with atomic file writing (`.tmp` staging with retry and copy fallback) and cross-platform path normalization (`normalizePathForComparison`).
- Preserved repository artifact isolation: repository-level `.codex-artifacts` directory naming and schema v4 contracts remain 100% unchanged.

---

## [0.9.0] - 2026-09-08

### Workspace Resolution and Create Contract

- Added read-only `resolve_artifact_workspace` tool; searches exact-path, exact-name, or similar-name in the fresh focused registry and returns candidate name/paths with an opaque selection token. The skill automatically picks uniquely high-confidence candidates and prompts the user only when ambiguous.
- Normalized separators in search queries so `agent plus`, `agent-plus`, and `agent_plus` match identically. In multi-root workspaces without a match, returns all fresh folders for the same context with `matchMode: "all-available"`; `not-found` strictly indicates an empty fresh scope.
- If a VS Code context contains exactly one folder, the resolver immediately returns `matchMode: "matched"` with `match: "single-folder"` even if the query differs, relieving agents from inferring folder cardinality outside MCP.
- Prevented merging folders across different VS Code windows. When multiple active contexts exist without a unique focused window, MCP fails with `WORKSPACE_CONTEXT_AMBIGUOUS`; duplicate snapshots of the same context are consolidated.
- Reduced create evidence to two explicit types: `tagged-file` and `resolved-workspace`. The resolver token proves the candidate belongs to the fresh focused scope.
- Selection tokens expire after 10 minutes, are consumed only upon successful creation, and bind to candidate and registry contexts; `create_artifact` revalidates registration, focused scope, canonical root, and tagged-file containment before mutation.
- The official skill always sends `kind: "implementation-plan"`; artifact schema remains v4 and MCP retains the required `kind` field for protocol compatibility.

### Skill Orchestration and Reconnect Safety

- Added the resolver to the tool-availability contract; verified once when starting a chat lifecycle unless tools become unavailable, MCP restarts, or a new chat begins.
- Positioned workspace resolution prior to all project actions: when no file is tagged, `resolve_artifact_workspace` is the only MCP tool allowed before reading the contract; the skill may not scan folders, read instructions/docs/source, or draft artifacts before establishing a trusted workspace.
- Once a workspace is selected, the skill reads `artifact-contract.md` before inspecting files or calling remaining lifecycle tools.
- Enforced request/workspace-to-handle mappings for multi-artifact conversations; recency heuristics and post-create resolver calls are disallowed.
- Added an intent decision table distinguishing pure reconnects, saved feedback inspections, and explicit chat updates. Unclear intents or handles require user confirmation before speculative takeover.
- Preserved Case F/H invariants: pure reconnects reattach to the exact handle and round; Proceed executes `execute-approved-plan` immediately within the same turn.

### Structured Lifecycle Recovery

- Enhanced lifecycle errors with human-readable descriptions alongside structured metadata: `code`, `retryable`, `expectedNextTool`, `reuseRoundToken`, `useSameArtifactHandle`, and optional `currentReviewRound`.
- Differentiated invalid/expired tokens, in-use tokens, consumed tokens, round mismatches, state changes, active waiters, confirmed rollbacks, cancellations, and workspace unavailability.
- Tokens may only be reused when MCP confirms pre-commit state and `reuseRoundToken: true`; uncertain states re-inspect the exact handle without replaying previous mutations.
- Bumped extension to `0.9.0` and MCP server to `6.0.0`; synchronized installer approvals, skills, contracts, documentation, and regression tests.
- Final validation: typecheck pass, 76/76 tests pass across 12 test files, and full production build pass.

---

## [0.8.0] - 2026-09-06

### Explicit Chat Updates on Empty Rounds

- Extended MCP tool `inspect_artifact_review` with parameters `intent: "explicit-chat-update"` and `expectedReviewRound`.
- Granted `chat-update` round tokens when users request artifact edits directly in chat while the round has no saved comments or submissions.
- Rejected `explicit-chat-update` if comments or submissions already exist on disk, preventing accidental feedback loss or corrupting Proceed/Just save lifecycles.
- Validated `expectedReviewRound` before takeover and revalidated after takeover, preventing stale requests from canceling active waiters.
- Mandated that `advance_and_wait_for_artifact` with `chat-update` tokens supply replacement `markdown` with a different SHA, preventing empty advances.
- Preserved fail-closed mechanics: standard `inspect_artifact_review` calls on empty rounds issue no token, ensuring pure reconnects reattach to the same round without data mutations or round increments.
- Updated `create-review-artifact` skill and contract to separate Pure reconnects, Saved comment inspection, and Explicit chat updates.
- Bumped extension to `0.8.0` and MCP server to `5.1.0`.
- Synchronized `package-lock.json`, README, component docs, and regression coverage for lifecycle and keyboard behavior.
- Final validation: typecheck pass, 67/67 tests pass across 12 test files, and full production build pass.

### Webview UX

- Supported pressing **Enter** in the review popover (`SelectionCommentPopover`) to quickly submit comments (`Shift + Enter` for newlines).
- Added IME composition checks (`!event.nativeEvent.isComposing`) to prevent accidental submissions during multilingual typing.
- Added automatic text wrapping (`overflow-wrap: anywhere; word-break: break-word;`) across comment inputs and detail drawers.

---

## [0.7.0] - 2026-08-31

### Breaking MCP API

- Removed `create_and_wait_for_artifact` and `update_and_wait_for_artifact`; replaced with four distinct tools: `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`.
- Bumped extension to `0.7.0` and MCP server to `5.0.0`.
- Preserved artifact schema v4; existing artifacts require no migration; schema v3 remains read-only.

### Chat Escape and Reconnect

- Decoupled durable artifact data from ephemeral waiters following `artifact lifetime > waiter lifetime > chat-turn lifetime`.
- Enabled chat escape: users can save comments and ask the AI to "read the review" without clicking the Review button. The AI takes over the waiter, inspects comments, answers questions in chat, updates the artifact if requested, and starts a new round.
- Unified feedback policies between Review button submissions and in-chat review requests.
- Stopped generating `Review responses` inside the artifact; conversational answers belong exclusively in chat.
- Question-only feedback increments review rounds and resets processed comments while preserving the exact bytes and SHA of `artifact.md`.
- Proceed and Just save conclude rounds without deleting artifacts. Proceed on `plan` or `implementation-plan` returns runtime directive `execute-approved-plan` authorizing immediate execution in the same turn.
- Enforced exact `artifactDirectory` handles; prohibited latest-artifact heuristics and working directory inferences.

### Waiter Ownership and Round Tokens

- Replaced active-waiter sets with an explicit registry tracking request keys, review rounds, `AbortController`, and settled states.
- Unified JSON-RPC cancellation and takeover detach semantics without mutating persistent files.
- Generalized update tokens into in-memory, single-use, 1-hour expiring round tokens bound to artifact, session, round, and document/comment hashes.
- Allowed inspections to issue tokens from saved comments prior to `review-submission.json`.
- Tokens are consumed strictly after successful transaction commits.

### Verification

- Added regression coverage for detached creation, default Review flows, cancellation/reattach, non-racing takeovers, inspection prior to submission, question-only SHA preservation, exact-state token rejection, MCP restarts, concurrent consumption, rollback, and Windows editor locks.
- `npm.cmd run check`, all 57 tests, and `npm.cmd run build` passed.

---

## [0.6.1] - 2026-08-29

- Restored strict workspace evidence gates; disallow `package.json`, project markers, cwd, or folder order from establishing workspace roots independently.
- Upgraded workspace registry to schema v2 with focused-window and active-file contexts.
- Enforced typed `workspaceEvidence`; MCP fails closed before mutation on multi-root ambiguity.
- Streamlined `Review responses` to contain only the immediate preceding round's answers.
- Added regression tests for multi-root ambiguity, active-file evidence, explicit user paths, focused-window scoping, and skill contracts.

---

## [0.6.0] - 2026-08-29

### MCP-Owned Lifecycle

- Replaced creation hooks and App Server trust flows with two MCP tools: `create_and_wait_for_artifact` and `update_and_wait_for_artifact`.
- MCP server generates artifact IDs/sessions, commits schema v4, awaits decisions, and updates `artifact.md` within the originating tool call.
- Used single-use in-memory update tokens bound to artifact/session/round with transactional rollback and Windows editor-lock fallbacks.

### Workspace Boundary

- Extension host publishes registry heartbeats for currently active `workspaceFolders`; MCP requires exact valid canonical roots.
- Blocked stale/unregistered workspaces, unnested root registrations, path escapes, and symlink/junction storage.

### Review Semantics

- **Proceed** on `implementation-plan` grants immediate execution authority in the same turn.
- In-artifact Q&A answers append to `Review responses` at the document bottom for review in subsequent rounds.

---

## [0.5.0] - 2026-08-29

### Markdown Viewer

- Replaced custom renderer with `react-markdown`, `remark-gfm`, and unified remark AST source positions.
- Supported nested lists, task lists, tables, links, inline formatting, code blocks, and Mermaid diagrams.
- Used fine-grained Shiki bundles for syntax highlighting; lazy-loaded Shiki and Mermaid.
- Automatically matched VS Code light, dark, and high-contrast themes.

### Contextual Review

- Displayed comment composer using Floating UI popovers anchored to selected text.
- Replaced static sidebar with collapsible comments drawer navigating directly to highlighted passages.
- Styled `Review (N)` button showing comment counts; `Proceed` remains primary throughout the review.
- Prevented false cross-block selections and compacted padding for improved reading space.

### Security and Verification

- Disabled raw HTML/MDX execution, blocked unsafe URLs and remote images, routed external links through the VS Code host.
- Maintained nonce-based CSP; Shiki tokens rendered via React, Mermaid strict SVG rendered inside data-image contexts.

---

## [0.4.3] - 2026-08-29

- Disallowed using agent cwd, `environment_context`, or the first workspace folder as the active folder.
- Enforced explicit UI/path signals verified against workspace contents; prompted users when missing.

---

## [0.4.2] - 2026-08-29

- Automatically activated Artifact Review for requests creating, viewing, or updating plans, even without the word "artifact".
- Differentiated `implementation-plan` from standard `plan`.

---

## [0.4.1] - 2026-08-29

- Added fallback for updating `artifact.md` when Windows file locks prevent renaming open files.
- Enforced evidence-based workspace determination in skills.

---

## [0.4.0] - 2026-08-28

### Breaking Changes

- Upgraded to `schemaVersion: 3` and `.codex-artifacts/artifacts/<id>/artifact.md` layout.
- Retained identical artifact IDs across review rounds; updated files in place rather than generating replacement artifacts.
- Removed runtime operations `replace`, `replacesArtifactId`, and `.trash` directories.
- Renamed skill to `create-review-artifact` and MCP tools to `wait_for_artifact_review` and `update_artifact`.

### Artifact Lifecycle

- Added `reviewRound`, `updatedAt`, and round-aware comment/submission bindings.
- MCP server issued single-use update tokens and committed transactions with rollback support.

---

## [0.3.0] - 2026-08-28

### Breaking Changes

- Upgraded artifact protocol to `schemaVersion: 2`; deprecated version 1.
- Separated `location.workspaceRoot` from `origin.codexCwd`, enabling multi-root workspace review.
- Standardized `artifact.json` and `plan.md` creation using single `apply_patch` operations.

---

## [0.2.7] - 2026-08-28

### Bug Fixes

- Removed premature `Plan saved` notification upon selecting **Just save**.
- Tightened MCP submission validation: re-checked `schemaVersion`, `artifactId`, plan hashes, and comment structures before returning decisions.
- Corrected copy icon colors: green checkmark upon success; red reserved for delete operations.

---

## [0.2.6] - 2026-08-28

### Topbar UI

- **"Proceed" Button** _(Primary green, rightmost)_: Approves plans and requests immediate execution.
- **"Review" Button** _(Replaced "Request revision")_: Enabled when comments exist; sends feedback back to AI agents.
- **"Just save" Button** _(Ghost style)_: Saves plans to workspace without code execution.
- **Copy Markdown Button**: Copies raw Markdown to clipboard with 2-second success confirmation.

### Core & MCP Upgrades

- Resolved submission hash verification discrepancies in `review-wait-mcp.mjs`.
- Expanded `contracts.ts` with `"save"` decision and `markdown: string` in `ReviewState`.
- Relaxed comment deletion requirements when approving or saving.
