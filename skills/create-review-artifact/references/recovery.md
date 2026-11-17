# Artifact recovery

Read this reference only when a lifecycle tool reports an error.

## Recovery payload

Lifecycle errors keep human-readable text and may include:

```ts
type ArtifactRecoveryError = {
  code: string;
  retryable: boolean;
  expectedNextTool?: "create_artifact" | "inspect_artifact" | "wait_for_artifact_review" | "update_artifact" | "resolve_artifact_window" | "join_session";
  reuseRoundToken: boolean;
  useSameArtifactHandle: boolean;
  currentReviewRound?: number;
};
```

## Recovery actions

Follow machine-readable recovery metadata returned by lifecycle errors. Keep the same exact artifact handle.

| Error code | Required recovery |
|---|---|
| `WINDOW_SELECTION_REQUIRED` | Ambiguous window context. If `expectedNextTool: "create_artifact"`, present candidates using window labels, ask user if ambiguous, and retry `create_artifact` with `connection: { targetMode: "explicit-window", selectionToken }`. If `expectedNextTool: "inspect_artifact"`, retry `inspect_artifact` on the same handle with `intent: "reconnect"` and `connection: { targetMode: "explicit-window", selectionToken }`. |
| `ROUND_TOKEN_INVALID_OR_EXPIRED`, `ROUND_TOKEN_ALREADY_CONSUMED`, `ROUND_MISMATCH`, `ROUND_STATE_CHANGED` | Inspect the same exact handle for current state and a fresh token. Do not replay old Markdown or actions. |
| `ROUND_TOKEN_IN_USE` | Do not issue another advance. Wait for the in-flight request, then inspect only if its result is unclear. |
| `ARTIFACT_ALREADY_WAITING` | Another live waiter already owns the exact artifact. Do not start a second wait. For resume-wait intent, keep awaiting the in-flight call; for pure reconnect, call `inspect_artifact` with `intent: "reconnect"` without takeover; use takeover only for saved feedback or an explicit direct update that replaces the waiter. |
| `ADVANCE_CANCELLED_BEFORE_COMMIT`, `ADVANCE_ROLLED_BACK` with `reuseRoundToken: true` | Retry the same advance only when the server explicitly confirms the token remains valid. |
| `ADVANCE_COMMITTED` | Do not replay. Follow the hinted operation on the reported round: wait for a waiting advance, or inspect to confirm state for a non-waiting update without automatically starting a waiter. |
| `WINDOW_NOT_FOUND` | No active VS Code window was found. Ask the user to open VS Code, then retry. |
| `WINDOW_SELECTION_EXPIRED` | Window selection token expired or window was closed. Retry `create_artifact` or `inspect_artifact` without connection to refresh candidate windows. |
| `WINDOW_CONNECTION_MISMATCH`, `WINDOW_CONNECTION_STALE` | Selected window is stale or closed. Retry without connection token to refresh candidates. |
| `ARTIFACT_CONNECTION_INVALID` | Stored routing data is invalid or malformed and cannot be repaired by the skill. Stop automated recovery, retain the exact handle, report the corrupt `artifact-connection.json`, and ask the user to repair or remove that optional routing file before reconnecting. Do not retry inspect/reconnect or edit lifecycle files yourself. |
| `ARTIFACT_CONNECTION_WRITE_FAILED` | Failed to update the connection state atomically. Retry `inspect_artifact` on the exact handle with `intent: "reconnect"`. |
| `ARTIFACT_NOT_FOUND` | The exact artifact handle no longer exists. Non-retryable. Drop the stale handle mapping and inform the user that the artifact is permanently unavailable. Do not retry, scan for a replacement, or recreate the same artifact ID. |

Except for explicit non-retryable errors such as `ARTIFACT_CONNECTION_INVALID`, inspect the exact handle before retrying any error that does not prove both “not committed” and `reuseRoundToken: true`.
