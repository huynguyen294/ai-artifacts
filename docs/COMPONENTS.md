# Components and Responsibilities

This document describes the technical components that participate in the current Codex Artifacts review workflow. It explains what each component owns, how components communicate, and which responsibilities must remain outside each boundary.

It complements the existing documentation:

- [PHILOSOPHY.md](./PHILOSOPHY.md) defines the product intent and the meaning of **Review**, **Proceed**, and **Just save**.
- [ARCHITECTURE.md](./ARCHITECTURE.md) defines the high-level topology, ownership boundaries, and safety constraints.
- This file is the component-level responsibility reference: **which technical component is responsible for what**.

## Component overview

```mermaid
flowchart LR
    User[User]
    Codex[Codex]
    Skill[Create Review Artifact Skill]
    MCP[Artifact Review MCP]
    Registry[Workspace Registry]
    Files[Artifact Files]
    Extension[VS Code Extension Entry]
    Provider[Artifact Review Provider]
    Store[Artifact Store]
    Webview[Review Webview]
    Markdown[Markdown Review Pipeline]
    Installer[Integration Manager]
    Shared[Shared Contracts and Validation]

    Codex --> Skill
    Skill --> MCP
    Extension --> Registry
    MCP --> Registry
    MCP --> Files
    Extension --> Provider
    Provider --> Store
    Store --> Files
    Provider <--> Webview
    Webview --> Markdown
    User --> Webview
    Installer --> Skill
    Installer --> MCP

    Shared -. schemas .-> MCP
    Shared -. schemas .-> Store
    Shared -. messages .-> Provider
    Shared -. messages .-> Webview
```

The core responsibility split is:

| Component                | Primary responsibility                        | State or resources it owns                                                   |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| Codex skill              | Agent-side lifecycle and chat policy           | Exact artifact handle, complete proposed Markdown, and current tool result    |
| Artifact Review MCP      | Artifact persistence, routing, and waiters     | Artifact creation, connection commits, waiter registry, grants, transactions |
| Workspace Registry       | Evidence of currently open VS Code workspaces | Short-lived, per-window workspace snapshots                                  |
| Artifact file protocol   | Persistent lifecycle and routing communication | Manifest, Markdown, comments, decision, and optional connection state         |
| Extension entry          | VS Code activation and composition            | Commands, watchers, and provider registration                                |
| Artifact Review Provider | Webview/extension orchestration               | One custom-editor session and its subscriptions                              |
| Artifact Store           | Trusted artifact persistence adapter          | Validated review state, comments, and submission writes                      |
| Review Webview           | Human review interaction                      | Ephemeral UI state and typed user intent                                     |
| Markdown review pipeline | Document rendering and comment anchoring      | Parsed blocks and rendered annotations                                       |
| Shared contracts         | Cross-process protocol definition             | Schemas, types, filenames, and binding rules                                 |
| Integration manager      | Installation and verification                 | Extension-managed MCP runtime, skill, and supported-client configuration     |

The governing lifetime relationship is `artifact lifetime > waiter lifetime > chat-turn lifetime`. Artifact lifetime is bounded by configured retention (`agentPlus.artifactRetentionDays`); expired artifacts are permanently deleted when the extension activates. Artifact files persist across cancellation, takeover, chat completion, and MCP restart until the retention window expires. The MCP waiter registry is temporary process state, while the skill retains the exact artifact handle needed to inspect or reconnect that persistent state.

## 1. Codex skill

**Source**

- [`skills/create-review-artifact/SKILL.md`](../skills/create-review-artifact/SKILL.md)
- [`skills/create-review-artifact/references/artifact-contract.md`](../skills/create-review-artifact/references/artifact-contract.md)

**Responsibilities**

- Decide whether an explicit user request should create/update an artifact, inspect saved feedback, or reconnect an exact artifact.
- Produce one complete Markdown document.
- By default, call `create_artifact` directly; the MCP server automatically targets the currently focused live VS Code window (or sole live window).
- When multiple windows exist and focus is ambiguous, handle `WINDOW_SELECTION_REQUIRED` and retry with `connection: { targetMode: "explicit-window", selectionToken }`.
- Call `resolve_artifact_window` when proactive window discovery or candidate inspection is needed before creation.
- Call `create_artifact` with `kind: "implementation-plan"`, retain an exact handle mapping and returned connection metadata, then call `wait_for_artifact_review` for the default flow.
- Interpret the returned decision.
- Apply one feedback policy to submitted `revise` and chat-inspected comments: answer questions visibly, update Markdown only for requested changes, and advance unchanged Markdown for question-only rounds.
- For chat escape, inspect the exact interrupted handle with takeover before applying that shared policy.
- For an explicit chat update on an empty round, inspect the exact handle with `intent: "explicit-chat-update"`, replace the Markdown, and advance without requiring a UI comment or Review submission.
- Reattach the same round when inspection has no feedback; ask for a path instead of guessing when the exact handle is ambiguous.
- Use the intent decision table before reconnect/inspection/chat update and never takeover when the intent or exact handle is ambiguous.
- Reconnect only through `inspect_artifact_review` on the exact handle. Ambiguous window reconnect retries inspect with the selected `connection.selectionToken`.
- Follow structured lifecycle recovery metadata, keep the same handle, and never replay an update whose commit state is uncertain.
- For `approve` on `plan` or `implementation-plan`, obey the MCP `execute-approved-plan` directive and execute the complete approved plan immediately; for other kinds, continue only with the action implied by the original request.
- For `save`, ask for a destination and copy the Markdown without performing the proposed work.

**Does not own**

- Artifact IDs, review session IDs, or round numbers.
- Lifecycle-file creation or repair.
- Comment or submission persistence.
- Token creation or validation.
- Waiter ownership, cancellation, or takeover mechanics.

The skill must never create or edit `artifact.json`, `comments.json`, `review-submission.json`, or `artifact-connection.json` directly.

## 2. Artifact Review MCP

**Source**

- [`src/integration/artifact-review-mcp-v4.ts`](../src/integration/artifact-review-mcp-v4.ts)

**Responsibilities**

- Expose one window resolver plus four lifecycle tools:
  - `resolve_artifact_window`
  - `create_artifact`
  - `wait_for_artifact_review`
  - `inspect_artifact_review`
  - `advance_and_wait_for_artifact`
- Validate tool arguments, artifact kind, title, and Markdown size.
- Group fresh window candidates and issue short-lived, single-use window selection tokens.
- Generate the artifact ID and `reviewSessionId`.
- Create a schema-v6 artifact beneath the global per-user collection at review round 1.
- Select the focused live target window (or explicit selection token), atomically commit connection state, and return the persistent artifact handle plus connection metadata before attaching any waiter.
- Attach one transient tool call to `review-submission.json`, or return an existing submission immediately.
- Detect a submission through filesystem watching with periodic polling as a fallback.
- Validate that the submission belongs to the same schema, artifact, session, round, Markdown hash, and comments hash.
- Reserve at most one live waiter per canonical artifact directory and let cancellation/takeover detach it without touching lifecycle files.
- Inspect validated Markdown, comments, and optional submission even when no Review submission exists.
- For explicit reconnect, re-evaluate target window routing and atomically commit a new revision/open-request ID without changing lifecycle state.
- Grant in-memory, single-use, one-hour round tokens after submitted `revise` or a consumable chat inspection.
- Bind tokens to artifact/session/round plus artifact, comments, and submission hashes/presence.
- Transactionally preserve or replace Markdown, increment `reviewRound`, reset comments, remove the previous submission, and wait for the next decision.
- Consume the token only after a successful commit; leave a newly committed round detached if its waiter is cancelled.
- Roll back a failed round transition.
- Return additive machine-readable recovery metadata for token, round, state, waiter, transaction, and workspace failures while preserving readable error text.

**Owns and may write**

- Initial `artifact.json`, `artifact.md`, `comments.json`, and `artifact-connection.json`.
- Connection revisions and `.artifact-connection.lock` for create/reconnect commits.
- New-round Markdown, manifest, and empty comments state.
- Temporary staged files, backups, and `.artifact-update.lock`.
- In-memory active waiter registry and round-token grants.

**Does not own**

- User-interface state.
- Comment authoring or the user's decision.
- Extension commands or custom-editor behavior.
- Direct implementation of an approved plan.

## 3. Workspace Registry

**Source**

- Publisher: [`src/extension/workspace-registry-publisher.ts`](../src/extension/workspace-registry-publisher.ts)
- Contract and resolver: [`src/shared/workspace-registry.ts`](../src/shared/workspace-registry.ts)

This component has two cooperating halves.

### Registry publisher

The VS Code extension publishes:

- Canonical paths for currently open workspace folders.
- Window focus state.
- Active file and its owning workspace when available.
- A unique extension-window instance ID.
- Snapshot creation and expiration timestamps.

It refreshes on workspace, active-editor, or focus changes and also sends a periodic heartbeat. It removes its snapshot when disposed.

### Registry resolver

The MCP-side resolver:

- Reads only fresh, schema-valid snapshots.
- Canonicalizes the requested workspace and rejects stale or unregistered roots.
- Preserves each fresh snapshot as a window group with stable instance ID, focus hint, snapshot context, and folder candidates.
- Normalizes common name separators and resolves exact-path, exact-name, and similar-name folder candidates across groups; a sole registered folder is returned as `single-folder` and selected without agent inference.
- Returns fresh folders grouped as `available` when no query match exists and `not-found` only when the fresh scope is empty. Multiple windows are not an error by themselves; focus influences ordering but does not erase window identity.
- Validates either `tagged-file` containment or an MCP-owned `resolved-workspace` grant.
- Fails closed when evidence, selection context, registration, or containment is stale or invalid.

**Does not own**

- Artifact content or review state.
- Artifact selection based on cwd, folder order, package markers, untagged active files, or recency.
- Persistent workspace configuration.

The registry proves that a workspace is currently available and that the supplied evidence selects it; it does not decide when an artifact should be created.

## 4. Artifact file protocol

**Source**

- Filenames: [`src/shared/artifact-files.ts`](../src/shared/artifact-files.ts)
- Schemas: [`src/shared/contracts.ts`](../src/shared/contracts.ts)
- Binding validation: [`src/shared/artifact-validation.ts`](../src/shared/artifact-validation.ts)

Each artifact is a direct child of the global per-user collection:

```text
~/.ai-artifacts/artifacts/<artifactId>/
├── artifact.json
├── artifact.md
├── comments.json
├── review-submission.json   # exists after submission
├── artifact-connection.json # optional schema-v1 UI-routing state
├── .artifact-connection.lock # temporary during create/reconnect routing commit
└── .artifact-update.lock   # temporary during a round update
```

| File                     | Responsible writer                                         | Responsibility                                                                                     |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `artifact.json`          | MCP                                                        | Identify the artifact and bind kind, title, session, timestamps, and current round |
| `artifact.md`            | MCP                                                        | Store the complete Markdown for the current round                                                  |
| `comments.json`          | Artifact Store during review; MCP when opening a new round | Store block-bound comments and bind them to the current artifact hash and round                    |
| `review-submission.json` | Artifact Store                                             | Record the immutable `revise`, `approve`, or `save` decision for one round                         |
| `artifact-connection.json` | MCP                                                      | Store only target window, connection revision, open-request ID, source, and timestamp              |
| `.artifact-connection.lock` | MCP                                                      | Serialize connection commits without changing lifecycle state                                      |
| `.artifact-update.lock`  | MCP                                                        | Prevent readers from observing an incomplete multi-file update                                     |

The protocol is the communication medium between the independently running MCP process and VS Code extension. It is not a revision-history store.

`artifact.json` stores the schema-v6 manifest without repository ownership fields. Schemas v3/v4 and workspace-local artifact directories are rejected and are not live-migrated.

`artifact.json` remains the source of truth for artifact identity. Optional `artifact-connection.json` is routing state only: revisions order successful create/reconnect commits, and open-request IDs deduplicate watcher events. Wait and advance preserve it unchanged.

## 5. VS Code extension entry

**Source**

- [`src/extension/extension.ts`](../src/extension/extension.ts)
- VS Code contributions in [`package.json`](../package.json)

**Responsibilities**

- Activate the extension.
- Construct the review provider and workspace-registry publisher.
- Register the `agentPlus.artifactReview` custom editor.
- Ensure and validate the global collection root before registering direct-child `artifact-connection.json` create/change events.
- Revalidate the connection path, manifest binding, and linked-path safety on each bounded read attempt; ignore events whose target instance ID does not match the current window.
- Automatically open the corresponding `artifact.md` when configured and targeted, even if that window is unfocused. Disabling auto-open does not undo the MCP connection commit.
- Deduplicate successful open-request IDs, coordinate concurrent opens by canonical artifact path, and call `vscode.openWith` for VS Code reuse/reveal behavior. Failed opens remain retryable.
- Register commands to:
  - Open an artifact review.
  - Search artifacts by title in the global collection (`agentPlus.searchArtifact`).
  - Install, verify, and uninstall all supported integrations or one specific client.
  - Copy the current MCP configuration or production skill.
- Schedule best-effort asynchronous retention cleanup at activation: read `agentPlus.artifactRetentionDays`, enumerate validated schema-v6 candidates, and permanently delete expired artifacts via atomic rename to managed cleanup staging. Cleanup does not block activation or commands.
- Own and dispose top-level VS Code subscriptions.

**Does not own**

- Artifact validation or comment persistence.
- Webview rendering.
- MCP waiting or round transitions.
- Review decision semantics.

This is the composition root for the extension host, not the business-logic layer.

## 6. Artifact Review Provider

**Source**

- [`src/extension/artifact-review-provider.ts`](../src/extension/artifact-review-provider.ts)

**Responsibilities**

- Resolve an `artifact.md` document as a custom text editor.
- Create one `ArtifactStore` for the artifact directory.
- Configure the webview's local resources and Content Security Policy.
- Send validated `ReviewState` snapshots to the webview.
- Parse every incoming webview message with the shared discriminated-union schema.
- Route:
  - `addComment` to the store.
  - `removeComment` to the store.
  - `submitReview` to the store.
  - Allowed external links to VS Code.
- Serialize submission attempts within the editor using the local `sending` guard.
- Watch artifact lifecycle files and refresh the webview after external changes.
- Dispose message handlers and filesystem watchers when the editor closes.

**Does not own**

- Filesystem validation rules; it delegates them to the store and shared validators.
- UI rendering or selection interpretation.
- Review-round advancement.
- Arbitrary URL opening; only `http`, `https`, and `mailto` are accepted.

The provider is the orchestration bridge between an untrusted webview and trusted extension services.

## 7. Artifact Store

**Source**

- [`src/extension/artifact-store.ts`](../src/extension/artifact-store.ts)

**Responsibilities**

- Wait briefly for an MCP round-update transaction to complete before reading.
- Load Markdown and manifest data.
- Verify that the artifact directory matches the manifest's declared workspace and ID.
- Calculate the current Markdown hash.
- Parse and bind `comments.json` to schema, artifact ID, round, and Markdown hash.
- Parse and bind a submission to the artifact, session/thread, round, Markdown hash, and comments hash.
- Parse Markdown into selectable review blocks.
- Expose one complete `ReviewState` to the provider.
- Validate that a comment still references an existing block and exact text range.
- Add and remove comments only while the round is writable and unsubmitted.
- Require at least one comment for `revise`.
- Allow `approve` and `save` with or without comments.
- Create a submission exclusively so duplicate submissions cannot overwrite one another.
- Use temporary files and rename/copy fallbacks for robust comment writes on Windows.

**Owns and may write**

- `comments.json` while a round is open.
- `review-submission.json` when the user submits the round.

**Does not own**

- `artifact.md` or `artifact.json` updates.
- Review-round increments, waiter ownership, or round tokens.
- Selection capture or rendering.
- Continued Codex behavior after a decision.

Only schema-v6 artifacts at exact validated global handles are loaded. Schemas v3/v4/v5 and workspace-local artifacts are rejected before review state is exposed.

## 8. Review Webview

**Source**

- Entry: [`src/webview/main.tsx`](../src/webview/main.tsx)
- Application: [`src/webview/ReviewApp.tsx`](../src/webview/ReviewApp.tsx)
- Action policy: [`src/webview/review-actions.ts`](../src/webview/review-actions.ts)
- VS Code messaging adapter: [`src/webview/vscode-api.ts`](../src/webview/vscode-api.ts)

**Responsibilities**

- Request initial state from the provider.
- Render the artifact title, kind, round, Markdown, comments, and lifecycle notices.
- Capture a text selection within one reviewable block.
- Normalize the selection to the block's visible-text offsets.
- Create comment drafts and send typed add/remove messages.
- Open comment details and navigate from the comments drawer to highlighted text.
- Submit `revise`, `approve`, or `save` intent.
- Disable actions while submitting, after submission, for read-only artifacts, or while a comment draft is unsaved.
- Reset transient selection/comment UI when the review round changes.
- Copy Markdown to the clipboard without changing lifecycle state.

**Owns**

- Ephemeral React state: current draft, comment body, drawer/popover state, sending status, active comment, and copy feedback.

**Does not own**

- Filesystem state.
- Final validation of comments or decisions.
- Submission uniqueness or round transitions.
- MCP communication.

The webview expresses user intent; the trusted extension host decides whether that intent is valid and persistent.

## 9. Markdown review pipeline

**Source**

- Parser: [`src/shared/markdown-blocks.ts`](../src/shared/markdown-blocks.ts)
- Renderer: [`src/webview/MarkdownRenderer.tsx`](../src/webview/MarkdownRenderer.tsx)
- Annotation mapping: [`src/webview/review-annotations.tsx`](../src/webview/review-annotations.tsx)
- Code rendering: [`src/webview/CodeBlock.tsx`](../src/webview/CodeBlock.tsx)
- Mermaid rendering: [`src/webview/MermaidBlock.tsx`](../src/webview/MermaidBlock.tsx)
- Enhancement loader: [`src/webview/enhancement-loader.ts`](../src/webview/enhancement-loader.ts)
- URL policy: [`src/webview/url-policy.ts`](../src/webview/url-policy.ts)

**Responsibilities**

- Parse CommonMark/GFM into stable selectable blocks:
  - Headings.
  - Paragraphs.
  - List items.
  - Quotes.
  - Fenced code.
  - Table cells.
- Preserve source positions while deriving the visible text used for comment offsets.
- Match rendered nodes back to parsed blocks.
- Rebuild inline React children with comment highlight ranges.
- Render overlapping annotations and associate them with comment IDs.
- Render code with optional lazy-loaded Shiki highlighting.
- Render Mermaid diagrams through a separately built enhancement bundle.
- Reject raw HTML, executable/local/malformed links, and remote image loading.
- Route safe external links through the provider instead of opening them directly.

**Does not own**

- Comment validity after the document changes.
- Comment persistence.
- Artifact lifecycle decisions.

The parser, selection capture, renderer, and store must agree on the same visible-text model. Changes to one part require checking all other parts.

## 10. Shared contracts and validation

**Source**

- [`src/shared/contracts.ts`](../src/shared/contracts.ts)
- [`src/shared/artifact-connection.ts`](../src/shared/artifact-connection.ts)
- [`src/shared/artifact-validation.ts`](../src/shared/artifact-validation.ts)
- [`src/shared/artifact-files.ts`](../src/shared/artifact-files.ts)

**Responsibilities**

- Define the schema-v6 manifest/comments/submission contracts and the independent schema-v1 artifact-connection contract.
- Define comments, review decisions, submissions, Markdown blocks, review state, and webview messages.
- Validate all untrusted JSON and webview input.
- Bind comments and submissions to the correct artifact lifecycle.
- Verify canonical artifact directory placement.
- Validate, read, and atomically commit exact-handle connection routing with linked-path protection and bounded transient-read retry.
- Define canonical lifecycle filenames.

This layer is the protocol source of truth. A contract change must be propagated to every producer and consumer rather than locally patched in one process.

**Does not own**

- I/O scheduling.
- UI behavior.
- MCP waiting.
- VS Code activation.

## 11. Integration manager

**Source**

- Installer: [`src/extension/workspace-integration.ts`](../src/extension/workspace-integration.ts)
- Client drivers: [`src/extension/mcp-clients/`](../src/extension/mcp-clients/)
- MCP configuration: [`src/extension/mcp-config.ts`](../src/extension/mcp-config.ts)
- Status classification: [`src/extension/global-integration-status.ts`](../src/extension/global-integration-status.ts)
- Legacy-hook cleanup: [`src/extension/hook-config.ts`](../src/extension/hook-config.ts)

**Responsibilities**

- Deploy the centralized MCP server runtime into `~/.ai-artifacts/managed/runtime/`.
- Deploy the bundled skill into the global agent-skills directory (`~/.agents/skills/create-review-artifact/`).
- Provide dedicated, non-destructive configuration drivers for Codex (`config.toml`), Cursor (`mcp.json`), Claude Code (`.claude.json`), Windsurf (`mcp_config.json`), and GitHub Copilot (`Code/User/mcp.json`).
- Expose dedicated setup commands plus `AI Artifacts: Install All Detected Integrations` and `AI Artifacts: Copy MCP Configuration JSON`.
- Verify whether installed assets and client configurations match the extension requirements.
- Report ready, missing, outdated, or configuration-conflict states across environments.
- Replace stale installed skill/runtime assets with the packaged source and remove obsolete files during reinstall.
- Remove only recognized legacy Codex Artifacts hooks, scripts, legacy `.vscode/ai-artifacts/` assets, and skill directories.
- Preserve unrelated user configuration and all global user review data (`~/.ai-artifacts/artifacts/`) during uninstall.

**Does not own**

- The live review session.
- Artifact files.
- General Codex configuration outside its marked block.
- Automatic restart or hot-loading into an existing chat.

## 12. Current interaction flow

### Default submission flow

1. The skill writes one complete Markdown document and calls `create_artifact` with `kind: "implementation-plan"`, title, and markdown. By default, it omits connection parameters and the server routes directly to the currently focused VS Code window (or sole live window).
2. If multiple windows exist and none or multiple are focused, `create_artifact` returns `WINDOW_SELECTION_REQUIRED` with candidates and opaque tokens. The skill selects the best candidate or prompts the user, then retries with `connection: { targetMode: "explicit-window", selectionToken }`.
3. The MCP creates the initial schema-v6 files plus schema-v1 connection state under `~/.ai-artifacts/artifacts/<artifactId>/`, and returns the exact global handle plus a regular file link.
4. The skill calls `wait_for_artifact_review` with the exact handle. The MCP reserves waiter ownership.
5. Every extension window observes the connection event, but only the matching `windowInstanceId` validates and opens the custom editor when enabled. The target may be unfocused; non-target windows remain silent. Provider, store, webview, and Markdown pipeline render and persist review comments as before.
6. The user submits Review (`revise`), Proceed (`approve`), or Just save (`save`); the store creates `review-submission.json` exactly once.
7. The waiting MCP validates and returns the submission. Submitted Review includes a round token.
8. For Review, the skill classifies feedback exactly as it does for chat escape: answer questions visibly, supply replacement Markdown only when changes are requested, then call `advance_and_wait_for_artifact`. Question-only Review omits Markdown.
9. Proceed and Just save end the current round without automatically advancing. Proceed returns `execute-approved-plan`, so the skill executes the approved code/file/workspace/command actions immediately in the same turn. The artifact remains persistent and reconnectable.

### Chat escape flow

1. The user saves comments and sends an instruction such as “read the review” while the waiter is active.
2. The prior tool wait is cancelled. The skill calls `inspect_artifact_review` with the exact retained handle and `takeover: true`.
3. The MCP aborts and drains any old waiter, validates persistent state, and returns comments plus a state-bound round token even if no submission exists.
4. The skill applies the same classification and response policy used by Review submissions; only the feedback transport/token source differs.
5. The skill calls `advance_and_wait_for_artifact`; omitting Markdown preserves its bytes/SHA for a question-only round.
6. The MCP advances, resets handled comments/submission, and waits on the new round. If the new wait is cancelled, the committed round remains valid but detached.
7. If inspection finds no feedback, the skill reattaches `wait_for_artifact_review` to the same round instead of advancing.

### Explicit chat update flow

1. The user explicitly requests a concrete edit to an exact artifact in chat while its current round has no saved comments or submission.
2. The skill calls `inspect_artifact_review` with the exact handle, `takeover: true`, the current `expectedReviewRound`, and `intent: "explicit-chat-update"`.
3. The MCP validates the expected round before detaching a waiter, revalidates after takeover, confirms the round is still empty, and returns a state-bound `chat-update` token.
4. The skill supplies complete replacement Markdown to `advance_and_wait_for_artifact`.
5. The MCP rejects missing or unchanged Markdown, otherwise commits the next round transactionally and attaches a new waiter.
6. A pure reconnect never uses this intent and remains on the same round.

### Reconnect rules

- Reconnect uses an exact artifact handle from the conversation or a path supplied by the user. No component selects the newest workspace artifact.
- `inspect_artifact_review` with reconnect intent validates the manifest workspace against live window snapshots. A window ID is a hint; a tie returns candidates and retries inspect with the chosen selection token.
- A successful reconnect increments `connectionRevision`, creates a new `openRequestId`, and may rebind another live window without changing Markdown, comments, submission, review round, or round tokens.
- Wait and advance preserve connection state and never rebind.
- MCP restart loses waiter/token memory, not artifact state. Inspection can issue a fresh token.
- Explicit reconnect after Proceed/Just save inspects and advances without Markdown; it does not repeat the previous approved or saved action.

### Search and connect flow

1. The user runs **AI Artifacts: Search Artifact** (`agentPlus.searchArtifact`) from the Command Palette.
2. The extension-local search service queries the canonical global collection `~/.ai-artifacts/artifacts/` with bounded concurrency (`16`), filtering valid direct-child schema-v6 manifests in-memory by normalized title (accent-insensitive, case-insensitive).
3. The VS Code Quick Pick displays matching artifacts with `alwaysShow: true`, deterministic ordering, and count indicators, capped at 1,000 items.
4. On selection, the artifact is revalidated and opened in the current extension window via `ArtifactReviewOpenCoordinator.open`. Search does not call MCP, invoke window routing, or mutate `artifact-connection.json`.
5. In the opened Artifact Review header, the user clicks the **Connect** button to copy the exact artifact directory and prompt to the clipboard.
6. The user pastes the prompt into their AI chat to inspect or reconnect the artifact into the active agent session.

## 13. Responsibility matrix

| Operation                      |             Skill |                 MCP |            Registry |               Extension entry |  Provider |              Store |      Webview |
| ------------------------------ | ----------------: | ------------------: | ------------------: | ----------------------------: | --------: | -----------------: | -----------: |
| Decide to create an artifact   |             Owner |                     |                     |                               |           |                    |              |
| Prove workspace ownership      | Supplies evidence |           Validates | Supplies live facts |               Publishes facts |           |                    |              |
| Generate artifact/session ID   |                   |               Owner |                     |                               |           |                    |              |
| Create initial lifecycle files |                   |               Owner |                     |                               |           |                    |              |
| Auto-open review editor        |                   |                     |                     |                         Owner |           |                    |              |
| Render Markdown                |                   |                     |                     |                               |   Bridges |                    |        Owner |
| Capture text selection         |                   |                     |                     |                               |           |                    |        Owner |
| Validate comment range         |                   |                     |                     |                               |    Routes |              Owner |  Preliminary |
| Write comments                 |                   | Resets on new round |                     |                               |    Routes |              Owner | Sends intent |
| Record decision                |                   |     Reads/validates |                     |                               |    Routes |              Owner | Sends intent |
| Create round token             |                   |               Owner |                     |                               |           |                    |              |
| Attach/detach waiter           | Requests lifecycle|               Owner |                     |                               |           |                    |              |
| Inspect saved feedback         | Classifies/answers| Validates and grants |                     |                               |           |        Persists it | Captures it  |
| Advance review round           | Optional Markdown |               Owner |                     |                               | Refreshes | Waits while locked |    Resets UI |
| Continue after approval        | Executes directive| Decision + nextAction|                    |                               |           |                    |              |
| Install MCP and skill          |                   |     Installed asset |                     | Owner via integration manager |           |                    |              |

## 14. Active and excluded legacy components

The active implementation is:

- `ArtifactReviewProvider`, not `PlanReviewProvider`.
- `ReviewApp.tsx`, imported by `src/webview/main.tsx`, not the retained `src/webview/App.tsx`.
- `artifact-review-mcp-v4.ts`, built into `codex-artifacts-review-mcp.mjs` (and deployed as `ai-artifacts-review-mcp.mjs` under `~/.ai-artifacts/managed/runtime/`).

Retained legacy sources include:

- `src/extension/plan-review-provider.ts`
- `src/integration/review-wait-mcp.ts`
- `src/integration/stamp-origin.ts`
- `src/webview/App.tsx`

Schemas v3/v4 and workspace-local artifacts are unsupported by the active runtime. Retained legacy source exists only as cleanup, historical, or test-workflow context and must not be treated as a compatibility path.

## 15. Verification ownership

Tests document the expected responsibility boundaries:

| Area                                                                                   | Tests                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Global artifact loading, comments, submissions, schema-v3/v4 rejection, and permissions | `test/artifact-store.test.ts`, `test/global-artifact-path.test.ts`                              |
| MCP creation, waiting, takeover, inspection, reconnect, token use, rollback, and safety | `test/review-wait-mcp.test.ts`                                                                 |
| Workspace evidence, grouped windows, selection grants, and focus-as-hint behavior      | `test/workspace-registry.test.ts`                                                               |
| Connection schema, atomic commits, retries, path safety, and target resolution          | `test/artifact-connection.test.ts`                                                              |
| Review button state and decision constraints                                           | `test/review-actions.test.ts`                                                                   |
| Markdown blocks and rendered annotation behavior                                       | `test/markdown-blocks.test.ts`, `test/markdown-renderer.test.tsx`                               |
| Safe links and protocols                                                               | `test/url-policy.test.ts`                                                                       |
| Managed MCP and legacy-hook configuration                                              | `test/mcp-config.test.ts`, `test/hook-config.test.ts`, `test/global-integration-status.test.ts` |
| Installed skill contract                                                               | `test/skill-contract.test.ts`                                                                   |
| Connection watcher, targeted unfocused auto-open, dedupe, exact-handle command, and open coordination | `test/artifact-review-open.test.ts`, `test/artifact-link-contract.test.ts`          |
| Extension-local artifact search core, discovery, limit cap, and Quick Pick controller | `test/artifact-search.test.ts`, `test/artifact-search-command.test.ts`                         |
| Five-client install/reinstall/verify/uninstall and artifact retention                   | `test/workspace-integration.test.ts`, `test/mcp-client-drivers.test.ts`, `test/artifact-retention.test.ts` |

For responsibility or protocol changes, update the shared contract first, trace every producer and consumer, and run:

```powershell
npm run check
npm test
npm run build
```

## Summary

The review system deliberately separates responsibilities:

- The **skill** controls agent behavior.
- The **MCP** controls lifecycle transitions.
- The **registry** proves workspace availability and ownership evidence.
- The **extension entry** composes VS Code services.
- The **provider** bridges the webview and trusted host.
- The **store** validates and persists human review state.
- The **webview** captures human intent.
- The **Markdown pipeline** renders and anchors that intent.
- The **shared layer** defines the protocol.
- The **integration manager** installs and verifies the system.

No component should absorb another component's authority merely for convenience. This separation keeps persistent artifact state, transient waiter ownership, chat responses, and human decisions correctly bound across process and filesystem boundaries.
