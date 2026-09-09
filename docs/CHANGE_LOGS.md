# Documentation change logs

This document records meaningful changes to how the project behaves and how it is documented. Its purpose is to help maintainers and AI assistants quickly track architectural and behavioral decisions that alter the system's state, keeping code, behavior, and documentation aligned.

Changes documented here include:

- Product, extension host, MCP server, webview, or agent skill behavior.
- Architecture, ownership boundaries, lifecycle, data flow, schema, or contracts.
- Product intent, philosophy, non-goals, or the semantics of review decisions.
- Workspace rules, filesystem safety, compatibility, or migration paths.
- Content in instructions or documentation that modifies how humans or AI understand and work on the project.

Minor typos, formatting fixes, or cosmetic wording adjustments that do not change technical semantics do not need to be recorded here. Versioned release notes are kept in `CHANGE_LOGS.md` at the repository root; this file focuses on behavior, architecture, and documentation decisions, even when not tied to an immediate release.

Each entry includes the date, category, summary of changes, rationale, and affected components or files.

---

## 2026-09-09 — Product branding and release automation — AI Artifacts and CI/CD workflow

### Changes

- Rebranded product from "Codex Artifacts" to **AI Artifacts - Interactive Planning & Review** (`ai-artifacts`), expanding positioning and documentation to support the open Model Context Protocol (MCP) across multiple AI coding agents (Codex, Cursor, Windsurf, Claude, etc.).
- Created and integrated the official extension icon at `media/icon.png` (256x256 px).
- Unlocked public distribution in `package.json`: removed `private: true`, configured publisher `huynguyen294`, icon, categories, SEO keywords, and bumped version to `0.9.1`.
- Refined the `package` script with `clean:releases` so `releases/` is always wiped before packaging, retaining only the single latest version VSIX (`releases/ai-artifacts-0.9.1.vsix`).
- Added CI/CD workflow at `.github/workflows/release.yml` triggered on `v*` tag pushes to automatically run typechecks, unit tests, build, and publish a GitHub Release with the VSIX artifact attached.
- Added `.env*` and `old-releases/**` to `.vscodeignore` and `.gitignore` to prevent environment leaks and exclude legacy builds from VSIX packaging.

### Rationale

- Broadens product reach to developer communities using Cursor, Windsurf, and Claude rather than remaining restricted to Codex alone.
- Automates releases according to modern CI/CD standards and guarantees clean, deterministic VSIX bundles.

### Affected components

- Metadata: `package.json`
- Assets: `media/icon.png`
- Documentation: `README.md`, `CHANGE_LOGS.md`, `docs/CHANGE_LOGS.md`
- Packaging & Git: `.vscodeignore`, `.gitignore`
- CI/CD: `.github/workflows/release.yml`

---

## 2026-09-08 — MCP API and skill orchestration — Workspace resolver and structured recovery

### Changes

- Added read-only `resolve_artifact_workspace` tool; the resolver reads the fresh focused registry and returns name/path candidates with a selection token. The skill automatically selects a uniquely high-confidence candidate and prompts the user only when ambiguous.
- Resolver normalizes separators in search queries and workspace names; in multi-root workspaces with no match, it returns all fresh folders for the same context with `matchMode: "all-available"`, while `not-found` strictly indicates an empty fresh scope.
- Resolver immediately returns a single workspace folder as `matched`/`single-folder` even when the query differs, relieving the agent from inferring cardinality outside MCP.
- Resolver reads strictly one unique VS Code workspace context: it never merges folders across windows during ambiguous focus, returning `WORKSPACE_CONTEXT_AMBIGUOUS` to request window focus, while deduplicating identical heartbeats from the same context.
- Reduced create evidence to two types: `tagged-file` and `resolved-workspace`; removed `single-workspace`, `active-file`, `explicit-user-path`, and `explicit-user-folder` from the writable create contract.
- Official skill always sends `kind: "implementation-plan"`, checks tool availability once per chat lifecycle, and maintains exact request/workspace-to-handle mappings across multiple artifacts.
- `resolve_artifact_workspace` is the only MCP tool called before reading `artifact-contract.md`; after selecting a workspace, the skill reads the contract before performing workspace research, artifact drafting, or calling remaining lifecycle tools.
- Added intent decision table with fail-safe rule: ask if intent or handle is unclear; never take over speculatively.
- Added structured recovery metadata for lifecycle errors with a same-handle/no-blind-replay policy. Only confirmed pre-commit cancellations or rollbacks allow token reuse.
- Retained schema v4, full replacement Markdown, pure reconnect, and Proceed behavior; no changes to Artifact Store, provider, webview, or renderer.
- Bumped extension to `0.9.0` and MCP server to `6.0.0`; synchronized README, architecture, components, philosophy, skill contract, installer approvals, and tests.
- Verified with typecheck, 76/76 tests across 12 test files, and full production build.

### Rationale

- Streamlines agent workspace inference down to two clear flows while preserving fast, fail-closed MCP verification.
- Prevents misattributing workspaces/artifacts in multi-root or multi-handle sessions and enables agents to recover from machine-readable state rather than parsing error strings or blindly replaying.

### Affected components and documentation

- `src/shared/workspace-registry.ts`
- `src/integration/artifact-review-mcp-v4.ts`
- `src/extension/mcp-config.ts`
- `skills/create-review-artifact/`
- `test/workspace-registry.test.ts`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`
- `test/mcp-config.test.ts`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/COMPONENTS.md`
- `docs/PHILOSOPHY.md`
- `CHANGE_LOGS.md`

---

## 2026-09-06 — Lifecycle and MCP API — Explicit chat update on empty review rounds

### Changes

- Extended MCP tool `inspect_artifact_review` with parameters `intent: "explicit-chat-update"` and `expectedReviewRound`.
- Added `source: "chat-update"` to `RoundGrant`. Grants a `chat-update` token when the user requests artifact edits directly from chat on an empty round (no comments or submissions saved on disk).
- MCP rejects chat-update intent if saved feedback or submissions already exist; validates round before takeover and revalidates after takeover so stale requests do not terminate valid waiters.
- In `advance_and_wait_for_artifact`, requires `chat-update` tokens to provide new `markdown` with a different SHA from the current document, preventing empty advances.
- Maintained fail-closed behavior: standard `inspect_artifact_review` calls on an empty round do not issue a token, ensuring pure reconnects reattach to the same round without changing data or advancing rounds.
- Updated `create-review-artifact` skill and contract to distinguish 3 flows: Pure reconnect, Saved comment inspection, and Explicit chat update.
- Bumped extension to `0.8.0` and MCP server to `5.1.0`. Updated `docs/ARCHITECTURE.md` and `docs/PHILOSOPHY.md`.
- Synchronized `package-lock.json`, `README.md`, `docs/COMPONENTS.md`, and regression tests for empty-round eligibility, stale-round waiter safety, token state binding, and Enter/Shift+Enter/IME support.
- Verified with typecheck, 67/67 tests across 12 test files, and full production build.

### Rationale

- Resolves deadlocks when users request artifact edits directly in chat without UI comments: previous inspections issued no token on empty rounds, preventing agents from advancing, while agents could not instruct users to click Review because the UI and backend disabled Review when comment count was 0.

### Affected components and documentation

- `src/integration/artifact-review-mcp-v4.ts`
- `package.json`
- `package-lock.json`
- `skills/create-review-artifact/SKILL.md`
- `skills/create-review-artifact/references/artifact-contract.md`
- `test/review-wait-mcp.test.ts`
- `test/skill-contract.test.ts`
- `test/selection-comment-popover.test.ts`
- `README.md`
- `docs/COMPONENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PHILOSOPHY.md`
- `CHANGE_LOGS.md`
- `docs/CHANGE_LOGS.md`

---

## 2026-09-06 — Webview UX — Enter to submit comment & Text auto-wrap

### Changes

- Updated textarea in `SelectionCommentPopover` to support pressing `Enter` to quickly submit a comment when text is present (`body.trim()`).
- Supported `Shift + Enter` to insert normal newlines inside the textarea.
- Added `!event.nativeEvent.isComposing` check to prevent unintended submissions during IME composition (e.g., Vietnamese Telex/VNI, Japanese, Chinese).
- Added `wrap="soft"` attribute to `<textarea>`.
- Updated CSS in `styles.css` (`overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;`) for `.comment-popover textarea`, `.comment-detail-popover p`, and `.comment-body` in the sidebar drawer so text wraps cleanly, preventing horizontal layout overflow even with long URLs or unbroken strings.

### Rationale

- Improves review UX by enabling keyboard-driven comment submissions (Enter) without requiring mouse interaction.
- Prevents horizontal overflow rendering bugs when users enter or inspect comments with long continuous words or URLs.

### Affected components and documentation

- `src/webview/SelectionCommentPopover.tsx`
- `src/webview/styles.css`
- Webview bundle (`dist/webview/review.js`, `dist/webview/review.css`)

---

## 2026-08-31 — Documentation and distribution — README onboarding

### Changes

- Rewrote README introduction for end-users, removing internal waiter jargon from initial descriptions.
- Added VS Code requirements, Node runtime/build versions, VSIX installation paths, and source build workflows via `npm ci`.
- Clarified that skills reside in `~/.agents/skills`, while MCP scripts and `config.toml` adhere to `CODEX_HOME`.
- Documented auto-open as default behavior with configurable settings and manual fallbacks; aligned **View comments** drawer labels with Review, Proceed, Just save, and Copy Markdown semantics.
- Restored compatibility guidance for schema v4, read-only schema v3, and preserved unmigrated legacy data.
- Added links to Philosophy, Architecture, Components, Project Instructions, artifact contract, changelog, TODO, and MIT License.
- Documented stable VSIX alias alongside versioned packages; no changes to runtime, MCP API, or artifact schema.
- Added Git repository metadata in `package.json` to allow VSCE to resolve relative markdown links during packaging.

### Rationale

- Previous README assumed pre-existing VSIX packages, lacked runtime prerequisites, introduced internal jargon prematurely, and omitted several installation/review details. The revised onboarding supports direct repository checkouts and builds while keeping deep contract specifications in specialized docs.

### Affected components and documentation

- `README.md`
- `package.json` repository metadata
- Release VSIX generated from current source
- `CHANGE_LOGS.md` and this documentation change log

---

## 2026-08-31 — Proceed semantics — Runtime execution directive

### Changes

- Classified both `plan` and `implementation-plan` as executable plans upon user Proceed.
- `wait_for_artifact_review` returns `nextAction.type: "execute-approved-plan"` with instructions mandating immediate execution of all code, file, workspace, and command actions within the approved plan scope in the same turn.
- Skill must not pause at acknowledgements, describe future work, or prompt for additional execution confirmation; pauses are permitted only for genuine blockers or out-of-scope permissions.
- Expanded `implementation-plan` selection rules for plans directly guiding code, file, workspace, or command changes; `plan` remains executable for other proposal types.
- Reconnect via inspection avoids re-emitting runtime directives, preventing reconnects from re-executing previously approved actions.

### Rationale

- Previous tool results returned only `decision: "approve"`, relying on model inference to combine `kind` with skill instructions. Actionable artifacts classified as `plan` could cause agents to merely acknowledge Proceed without implementing. Runtime directives make execution authority explicit data in MCP results rather than relying on prompt conventions.

### Affected components and documentation

- MCP results and initialization instructions
- Bundled skill and artifact contract
- README, Architecture, Philosophy, Components, project instructions, and 0.7.0 release notes
- MCP lifecycle tests and skill contract tests

---

## 2026-08-31 — Review semantics — Unified feedback handling

### Changes

- Aligned Review submissions (`revise`) and chat inspection under a single unified feedback classifier and action policy.
- Question-only feedback always answers questions visibly in chat, then advances without transmitting Markdown; change-only updates complete Markdown; mixed answers in chat and updates Markdown; needs-clarification defers token consumption.
- Removed creation and updating of `## Review responses` in artifacts. Conversational answers are no longer embedded in review documents.
- Preserved internal transport distinctions: Review receives submitted-review tokens from waiters, while chat escape receives chat-inspection tokens via takeover/inspection.

### Rationale

- Users expect the Review button and "read the review" chat commands to yield identical observable behavior. A single unified policy prevents diverging comment-handling behaviors and keeps artifacts focused on clean document content rather than conversation transcripts.

### Affected components and documentation

- Agent behavior: bundled skill and artifact contract
- MCP guidance: initialization instructions; no changes to tool APIs, token validation, or persistent schema
- Documentation: README, Architecture, Philosophy, Components, project instructions, and 0.7.0 release notes
- Regression contract: skill contract and MCP initialization tests

---

## 2026-08-31 — Lifecycle architecture and behavior — Chat escape/reconnect

### Changes

- Standardized lifetime hierarchy: `artifact lifetime > waiter lifetime > chat-turn lifetime`: artifacts are persistent workspace state; waiters and round tokens are transient process state.
- Split MCP lifecycle into `create_artifact`, `wait_for_artifact_review`, `inspect_artifact_review`, and `advance_and_wait_for_artifact`.
- Added chat escape so AI agents can take over waiters, read unsubmitted comments, answer questions in chat, revise artifacts as needed, and start new rounds.
- Allowed question-only advancement to preserve Markdown bytes and SHA; no-comment inspection reattaches to the same round.
- Established that Proceed and Just save conclude rounds without deleting artifacts; reconnect is an explicit action that never repeats past commands.
- Enforced exact artifact handles; eliminated latest-artifact heuristics and working directory inferences.
- Converted update grants to exact-state round grants; unified waiter cancellation and takeover detach semantics.

### Rationale

- Former lifecycles coupled artifact persistence too tightly to a single pending MCP tool call, requiring UI comments to return exclusively via the Review button. Decoupling artifacts from waiters preserves default UX while enabling natural conversation, post-cancellation reconnection, and direct in-chat Q&A without altering schemas or UI.

### Affected components and documentation

- MCP lifecycle: `src/integration/artifact-review-mcp-v4.ts`
- Managed integration: `src/extension/mcp-config.ts`, extension `0.7.0`, MCP server `5.0.0`
- Agent contract: `skills/create-review-artifact/SKILL.md`, `references/artifact-contract.md`, `agents/openai.yaml`
- Current state docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, `docs/COMPONENTS.md`, `docs/INSTRUCTION.md`
- Regression coverage: `test/review-wait-mcp.test.ts`, `test/mcp-config.test.ts`, `test/skill-contract.test.ts`
- No changes to artifact schema v4, webview, provider, Artifact Store, Markdown renderer, or workspace registry.
