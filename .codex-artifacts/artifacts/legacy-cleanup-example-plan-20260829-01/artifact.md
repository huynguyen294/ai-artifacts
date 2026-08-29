# Example Plan: Confirmed Legacy Review Cleanup

## Summary

Add an explicit VS Code command that finds legacy schema-v2 review data in the selected workspace, shows exactly what will be removed, and deletes it only after the user confirms. This plan is a review example based on the cleanup item already listed in `TODO.md`.

## Goals

- Give users a supported way to clean up legacy `.codex-artifacts/plans/` and `.codex-artifacts/.trash/` data.
- Keep cleanup limited to one explicitly selected workspace in multi-root windows.
- Require a confirmation dialog that names every target and reports the number of discovered entries.
- Make cancellation and empty-state behavior safe and understandable.

## Non-goals

- Do not migrate schema-v2 reviews into schema v3.
- Do not delete active schema-v3 artifacts under `.codex-artifacts/artifacts/`.
- Do not clean global Codex configuration, skills, hooks, or MCP files.
- Do not run cleanup automatically during extension activation or upgrade.

## Proposed User Flow

1. The user runs **Codex Artifacts: Clean Up Legacy Review Data** from the Command Palette.
2. If multiple workspace folders are open, the extension asks the user to choose one folder.
3. The extension inspects only the two known legacy locations in that folder.
4. When no legacy data exists, it displays an informational message and performs no write.
5. When legacy data exists, it displays the exact paths and entry counts in a modal confirmation.
6. Only an explicit **Move to Trash** action proceeds; dismissing the dialog leaves all data unchanged.
7. The extension reports which targets were removed or explains any failure without touching unrelated data.

## Implementation Changes

### Command registration

Update `package.json` to contribute and activate a new command such as `agentPlus.cleanupLegacyReviewData`, titled **Codex Artifacts: Clean Up Legacy Review Data**.

Register the command in `src/extension/extension.ts` alongside the existing open-review and integration commands. Keep the handler thin and delegate discovery, confirmation, and cleanup to a dedicated module.

### Cleanup service

Add `src/extension/legacy-cleanup.ts` with small testable functions for:

- Resolving the target workspace folder without assuming the first workspace root.
- Constructing only the approved legacy paths beneath that root.
- Inspecting whether each target exists and counting its direct entries.
- Returning a structured preview for the confirmation UI.
- Moving approved targets to the operating-system trash through the VS Code filesystem API.

Before deletion, resolve and compare paths to guarantee that every target remains beneath the selected workspace's `.codex-artifacts` directory and is exactly one of the approved legacy locations.

### User feedback

Use VS Code-native messages and selection dialogs so the flow matches the existing extension UI. The destructive action label should be unambiguous, and partial failures should identify the path that could not be removed.

### Documentation

Update the legacy schema-v2 section in `README.md` to replace the manual cleanup note with the new command while preserving the warning that active schema-v2 reviews are not migrated.

Remove the completed cleanup item from `TODO.md` after the implementation and tests land.

## Test Plan

### Automated tests

- No workspace folders: command exits with a clear message and no filesystem calls.
- One workspace: it is selected without prompting.
- Multiple workspaces: cleanup proceeds only for the folder explicitly chosen by the user.
- No legacy targets: result is a no-op.
- Legacy `plans/` only, `.trash/` only, and both targets: preview and counts are correct.
- User cancels confirmation: no delete operation occurs.
- User confirms: only approved legacy paths are passed to the deletion layer.
- Path traversal or unexpected target input is rejected before any deletion.
- One target fails while another succeeds: the result reports the partial failure accurately.

### Manual verification

1. Launch the Extension Development Host with a temporary workspace containing sample legacy directories.
2. Run the cleanup command and verify the preview names the correct workspace and targets.
3. Cancel once and confirm that all files remain.
4. Run again, confirm cleanup, and verify the legacy directories move to the OS trash.
5. Verify `.codex-artifacts/artifacts/` and unrelated workspace files remain untouched.

## Acceptance Criteria

- Cleanup never starts automatically.
- The user explicitly selects the workspace when selection is ambiguous.
- The confirmation dialog identifies all destructive targets before proceeding.
- Only legacy `plans/` and `.trash/` locations can be removed.
- Active schema-v3 artifact data is preserved.
- Automated tests cover workspace selection, cancellation, path safety, success, and partial failure.
- README guidance reflects the shipped command.

## Open Decision

Decide whether the first version should always use the operating-system trash or offer a second, more destructive permanent-delete action. The recommended initial behavior is trash-only because it remains recoverable and satisfies the cleanup goal.
