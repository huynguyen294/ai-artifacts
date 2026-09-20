# Project instructions

## Project

Codex Artifacts is a VS Code extension for reviewing Codex-generated Markdown through a local, MCP-owned review lifecycle.

- Package version source of truth: `package.json`
- Current and only supported artifact schema: `v6`
- Artifact storage: global per-user `~/.ai-artifacts/artifacts/`
- Compatibility: schemas `v3`/`v4`/`v5` and workspace-local lifecycles are unsupported and are not live-migrated
- Primary environment: VS Code extension host, local MCP server, and React webview
- Filesystem support: extension host and MCP process must see the same user home and filesystem

## Read first

Before changing behavior, read the smallest relevant set in this order:

1. `docs/PHILOSOPHY.md` for product intent, lifecycle meaning, and non-goals.
2. `docs/ARCHITECTURE.md` for current boundaries and safety invariants.
3. `skills/create-review-artifact/SKILL.md` and its referenced contract for agent behavior.
4. The implementation and tests for the area being changed.
5. `CHANGELOG.md` and any current tracked roadmap for recent migration context and known follow-up work.

`plans/`, `ASSESSMENT.md`, and `HIGHLIGHTS.md` may describe historical designs or older snapshots. Do not treat them as the current architecture without verifying them against the files above.

If product intent, documentation, tests, and implementation disagree, call out the conflict and resolve it deliberately. Do not silently preserve or introduce contradictory behavior.

## Critical invariants

- Create or update an artifact only when the user explicitly requests an artifact. Explicit review inspection/reconnect may resume an exact known artifact; a plan or document type alone does not trigger the lifecycle.
- One independent user request owns one artifact ID and directory.
- Review replaces the same `artifact.md`, advances `reviewRound`, resets review state, and does not retain revision history.
- Review submissions and chat-inspected comments use one feedback policy: answer questions visibly in chat, update Markdown only for requested changes, and preserve Markdown/SHA for question-only rounds.
- Proceed on `plan` or `implementation-plan` returns `execute-approved-plan` and authorizes immediate execution in the same turn; acknowledgement without execution is incorrect.
- The MCP server creates schema-v6 artifacts only beneath the canonical global collection, owns the transient waiter registry and round tokens, and commits review-round transitions.
- The extension host validates bindings and writes user comments and create-once submissions.
- The skill must not create, edit, repair, or bypass lifecycle files directly.
- Round tokens are in-memory, one-time, exact-state-bound, and expiring. Cancellation or restart preserves artifact state; recover only by inspecting an exact retained artifact handle.
- Artifact lifetime exceeds waiter lifetime, which exceeds chat-turn lifetime. Cancellation and takeover must not mutate lifecycle files.
- Schema v6 is the only readable and writable lifecycle. Schema-v3/v4/v5 and workspace-local artifacts are rejected and are not live-migrated.
- Artifacts are owned by review sessions, not repository paths; `artifact.json` contains no `location.workspaceRoot` field.
- After creation, wait/inspect/advance/reconnect use the exact global artifact handle.
- Window routing defaults to the currently focused live window (or sole live window). Generic reconnect prioritizes sole live window, validated advisory artifact-window affinity, and unique focused window. When multiple live windows exist and focus/affinity is ambiguous, `create_artifact` or `inspect_artifact_review` returns `WINDOW_SELECTION_REQUIRED` with candidate tokens. Focus is only a ranking hint; it is not routing identity.
- `artifact.json` is the source of truth for artifact identity. Optional schema-v1 `artifact-connection.json` contains only UI-routing state (`windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, `updatedAt`).
- Create and explicit reconnect may commit connection state. Wait and advance preserve that state and must not rebind or emit another open request. Reconnect recovery always keeps the exact artifact handle and never calls a workspace resolver after creation.
- Fail before filesystem mutation when window selection is required, ambiguous, stale, or unsafe.
- Preserve unrelated user skills, hooks, MCP configuration, and project files during install, upgrade, cleanup, or migration.
- Preserve user review data in `~/.ai-artifacts/artifacts/` during integration or extension uninstall. Only exact extension-owned runtime assets under `~/.ai-artifacts/managed/` are removable managed state; artifact deletion is a separate explicit user action.
- Treat artifact Markdown, comments, and decisions as potentially sensitive local data. Preserve owner-only POSIX modes and never claim POSIX-mode guarantees on Windows.
- Extension upgrades require reinstalling integrations and restarting the AI client; do not add mixed-version compatibility without an explicit architecture decision.

## Change guidelines

- Preserve existing uncommitted work and avoid unrelated rewrites.
- Change shared contracts before or together with every affected producer, consumer, fixture, and test.
- Keep path and workspace checks fail-closed. Do not weaken them for convenience.
- Keep lifecycle transitions transactional and preserve the Windows editor-lock fallback.
- Do not edit generated `dist/`, packaged VSIX files, or installed global integration assets directly. Change their sources and rebuild.
- When behavior or ownership changes, update `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, the skill contract, and changelog only where relevant.
- Prefer focused tests during iteration, then run the complete validation before handoff.

## Ownership map

- `src/integration/artifact-review-mcp-v4.ts`: historical filename for the current MCP 9.0.0/schema-v6 tools, window resolution, connection commits, artifact creation, waiter ownership/takeover, round grants, inspection, and transactional round commits.
- `src/extension/artifact-store.ts`: trusted artifact loading, comment writes, and submission writes.
- `src/extension/workspace-registry-publisher.ts`: live VS Code workspace heartbeat.
- `src/extension/workspace-integration.ts`: centralized MCP installation, base runtime provisioning, and legacy cleanup.
- `src/extension/mcp-clients/`: dedicated configuration drivers for Codex, Cursor, Claude Code, Windsurf, and GitHub Copilot (VS Code).
- `src/webview/`: review UI and typed messages to the extension host; no direct filesystem or process access.
- `src/shared/`: shared schemas, file contracts, artifact-connection safety/persistence, validation, and grouped workspace registry rules.
- `skills/create-review-artifact/`: Codex trigger and lifecycle orchestration contract.
- `test/`: executable regression coverage for contracts and failure behavior.

## Validation

From the repository root, run:

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run build
```

On shells where `npm` is directly executable, the equivalent `npm run ...` commands are fine.

For lifecycle changes, cover at least create, wait, takeover inspection, Review, question-only and Markdown advancement, Proceed, Just save, reconnect, token state binding/replay, cancellation, concurrency, rollback, and explicit rejection of unsupported schemas as applicable.

For workspace changes, cover grouped-window results, focus-as-ranking-hint behavior, single-folder matching, unique cross-window matches, duplicate workspace paths across windows, tagged-file evidence, separator-normalized exact/similar matches, unique high-confidence agent choice, tied user selection, all-available fallback, empty-scope not-found, stale/replayed window/workspace selection tokens, registry changes, exact-root matching, containment, and linked-path rejection as applicable.
