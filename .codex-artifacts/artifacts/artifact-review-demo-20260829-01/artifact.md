# Example implementation plan: Artifact review demo

## Objective

Add a repeatable demo for creating and reviewing a sample artifact without manual setup.

## Scope

- Add a development-only command or script that creates a schema-v3 sample artifact under `.codex-artifacts/artifacts/`.
- Use realistic Markdown blocks so selection, commenting, and rendering behavior can be tested.
- Document how to launch the demo and reset it safely.
- Keep generated review state out of published extension assets and source control.

## Implementation steps

1. Inspect the existing extension commands, artifact schema validation, and integration test helpers to identify reusable creation and opening logic.
2. Define a deterministic sample document containing headings, paragraphs, lists, a quote, and a code block so each supported comment target is represented.
3. Add a development command that generates a unique artifact ID, writes a valid schema-v3 manifest and Markdown document, and then opens the custom Artifact Review editor.
4. Route artifact creation through the same validation and path-safety rules used by the production flow instead of duplicating schema assumptions.
5. Add tests for manifest fields, unique directory creation, editor opening, and failure behavior when the workspace is unavailable or the target already exists.
6. Update the development section of the README with commands for running the demo and removing generated state.

## Validation

- Run `npm run check`.
- Run `npm test`.
- Run `npm run build` and confirm the extension and webview bundles complete successfully.
- Launch the Extension Development Host and verify that the generated artifact opens in Artifact Review.
- Add comments to different Markdown block types and verify Review updates the same artifact while Proceed and Just save return the expected decisions.

## Risks and mitigations

- Demo logic could diverge from the production schema. Reuse shared validators and artifact-writing helpers.
- Generated state could pollute commits. Keep it under `.codex-artifacts/` and document that the directory is operational state.
- A fixed artifact ID could overwrite prior reviews. Generate a unique filesystem-safe ID and fail safely on collisions.

## Completion criteria

- A contributor can start the demo from a documented command without manually creating artifact files.
- The sample exercises all supported Markdown comment targets and lifecycle decisions.
- Type checks, tests, and builds pass.
- No existing production review behavior changes.
