# Architecture

## Boundaries

```text
Codex chat
   │ creates artifact, then calls wait_for_plan_review
   ▼
Global user hook ── stamps origin and finalizes replacement lifecycle
   │
   ▼
.codex-artifacts/plans/<id>/{artifact.json,plan.md,comments.json,review-submission.json}
   │
   ▼
VS Code custom editor
   ├─ extension host: validation and immutable review submission
   └─ React webview: rendering, selection, comment and decision UI
                         │
                         ▼
Codex Artifacts MCP ── returns revise/approve/save to the waiting native Codex turn
```

`src/shared` is the only message and file-contract boundary. Zod validates data entering the extension host; TypeScript types are reused by the React webview.

The hook and MCP sources also import these shared schemas. The build bundles each integration entry point into a standalone `.mjs`, so the globally installed scripts keep their independent runtime roles without duplicating the artifact contract.

Artifacts use schema version 2. Each manifest declares an absolute `location.workspaceRoot`; `origin.codexCwd` records the Codex runtime directory separately. The hook discovers newly added `artifact.json` and `plan.md` paths from the single required `apply_patch` call, validates their declared root, and never defaults artifact placement to the first VS Code workspace folder.

## Global Codex integration

The extension installs one user-scoped integration instead of modifying every repository:

```text
~/.agents/skills/create-plan-artifact/
~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs
~/.codex/codex-artifacts/codex-artifacts-review-mcp.mjs
~/.codex/hooks.json
~/.codex/config.toml
```

The hook remains a non-managed Codex hook. The installer checks it through App Server `hooks/list` and reports ready only when `trustStatus` is `trusted`. Trust is an explicit user action in Codex `/hooks`; a changed hook hash requires trust again.

When upgrading from Agent Plus, setup removes the legacy hook entry and generated skill from every open workspace root. It preserves unrelated workspace and user hooks.

## Safety decisions

- Markdown is converted to controlled text blocks; artifact HTML is never injected into the webview.
- Webview scripts use a nonce-based content security policy.
- Selection coordinates are checked again in the extension host against parsed block text.
- Comment writes use a temporary file followed by rename.
- Review submission is create-once and binds the artifact, origin thread, plan hash, and comments hash.
- A replacement must exist and validate before the prior artifact leaves the active plan directory.
- A replacement must stay in the same declared workspace root as the artifact it replaces.
- The prior artifact is moved to `.trash` in the MVP, making cleanup recoverable.
- The extension never resumes the thread through a second App Server process and never redirects feedback to another chat.

## Review decision sequence

1. The skill creates and validates an artifact, then calls MCP `wait_for_plan_review` without ending the Codex turn.
2. React posts `submitReview` with `revise`, `approve`, or `save` to the extension host.
3. The store reloads and validates all artifact files.
4. The extension atomically creates `review-submission.json`.
5. The MCP file watcher validates the artifact ID, origin thread ID, and content hashes.
6. The pending MCP tool call returns the decision to the same Codex turn.
7. On `revise`, Codex creates a replacement artifact and waits again. On `approve`, Codex applies any remaining comments and starts implementation. On `save`, Codex asks for a workspace destination, saves the plan, and finishes without implementing it.
