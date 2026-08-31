# Project instructions

## Project

Codex Artifacts is a VS Code extension for reviewing Codex-generated Markdown through a local, MCP-owned review lifecycle.

- Package version source of truth: `package.json`
- Current writable artifact schema: `v4`
- Legacy schema `v3`: read-only
- Primary environment: VS Code extension host, local MCP server, and React webview

## Read first

Before changing behavior, read the smallest relevant set in this order:

1. `docs/PHILOSOPHY.md` for product intent, lifecycle meaning, and non-goals.
2. `docs/ARCHITECTURE.md` for current boundaries and safety invariants.
3. `skills/create-review-artifact/SKILL.md` and its referenced contract for agent behavior.
4. The implementation and tests for the area being changed.
5. `CHANGE_LOGS.md` and `TODO.md` for recent migration context and known follow-up work.

`plans/`, `ASSESSMENT.md`, and `HIGHLIGHTS.md` may describe historical designs or older snapshots. Do not treat them as the current architecture without verifying them against the files above.

If product intent, documentation, tests, and implementation disagree, call out the conflict and resolve it deliberately. Do not silently preserve or introduce contradictory behavior.

## Critical invariants

- Create or update an artifact only when the user explicitly requests an artifact. A plan or document type alone does not trigger the artifact lifecycle.
- One independent user request owns one artifact ID and directory.
- Review replaces the same `artifact.md`, advances `reviewRound`, resets review state, and does not retain revision history.
- The MCP server creates schema-v4 artifacts, owns live waiters and update tokens, and commits review-round transitions.
- The extension host validates bindings and writes user comments and create-once submissions.
- The skill must not create, edit, repair, or bypass lifecycle files directly.
- Update tokens are in-memory, one-time, round-bound, and expiring. Do not invent recovery state after cancellation or MCP restart.
- Schema v4 is the only writable lifecycle. Schema-v3 artifacts remain readable but read-only; older plan/replacement formats are not live-migrated.
- Workspace ownership requires typed user or IDE evidence. Cwd, `environment_context`, workspace order, project markers, and search results cannot establish ownership by themselves.
- Fail before filesystem mutation when workspace ownership is missing, ambiguous, stale, unregistered, or unsafe.
- Preserve unrelated user skills, hooks, MCP configuration, and project files during install, upgrade, cleanup, or migration.

## Change guidelines

- Preserve existing uncommitted work and avoid unrelated rewrites.
- Change shared contracts before or together with every affected producer, consumer, fixture, and test.
- Keep path and workspace checks fail-closed. Do not weaken them for convenience.
- Keep lifecycle transitions transactional and preserve the Windows editor-lock fallback.
- Do not edit generated `dist/`, packaged VSIX files, or installed global integration assets directly. Change their sources and rebuild.
- When behavior or ownership changes, update `README.md`, `docs/ARCHITECTURE.md`, `docs/PHILOSOPHY.md`, the skill contract, and changelog only where relevant.
- Prefer focused tests during iteration, then run the complete validation before handoff.

## Ownership map

- `src/integration/artifact-review-mcp-v4.ts`: MCP tools, artifact creation, waiting, update grants, and transactional round commits.
- `src/extension/artifact-store.ts`: trusted artifact loading, comment writes, and submission writes.
- `src/extension/workspace-registry-publisher.ts`: live VS Code workspace heartbeat.
- `src/extension/workspace-integration-v4.ts`: global integration installation and legacy cleanup.
- `src/webview/`: review UI and typed messages to the extension host; no direct filesystem or process access.
- `src/shared/`: shared schemas, file contracts, validation, and workspace registry rules.
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

For lifecycle changes, cover at least create, Review, update-and-wait, Proceed, Just save, token replay/expiry, concurrent waiter rejection, rollback, and legacy read-only behavior as applicable.

For workspace changes, cover focused-window scoping, active-file evidence, explicit user path/folder evidence, multi-root ambiguity, stale registry entries, exact-root matching, containment, and linked-path rejection as applicable.
