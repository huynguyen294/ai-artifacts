# Artifact storage and protocol reference

Read this reference only when investigating persisted schemas or raw window-resolution data. Use [SKILL.md](../SKILL.md) for normal tool calls and [recovery.md](recovery.md) only when a tool reports an error.

## Directory

```text
~/.ai-artifacts/artifacts/<server-generated-id>/
  artifact.json
  artifact.md
  comments.json
  review-submission.json    # present only after submission
  artifact-connection.json  # optional window-routing state
  artifact-ui-state.json    # optional Pin/Archive state
```

Schema v6 is the only supported lifecycle contract. Older schemas are unsupported and are not live-migrated. Comment/submission formats for AI authoring are in [AI-authored feedback](ai-feedback.md).

`artifact.json` is schema-v6 and does not store workspace location: `{ schemaVersion: 6, kind, artifactId, title, createdAt, updatedAt, reviewRound, reviewSessionId }`. Optional `artifact-connection.json` is schema-v1 UI-routing state only: `{ schemaVersion, windowInstanceId, connectionRevision, openRequestId, source, updatedAt }`. `connectionRevision` orders successful commits and `openRequestId` deduplicates filesystem events.

## Window resolution data

`resolve_artifact_window` accepts an optional `query` string matched against candidate label, active file, and folder paths. It reads every fresh VS Code window snapshot and returns candidates grouped by window; each candidate includes `candidateId`, `windowInstanceId`, `focused`, `label`, `folderCount`, `folders`, `activeFile`, and an opaque `selectionToken`. It returns `status: "matched"`, `status: "selection-required"`, or `status: "not-found"`. It is read-only and never creates lifecycle files.
