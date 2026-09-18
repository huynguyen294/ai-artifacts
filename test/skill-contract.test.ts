import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillDirectory = path.resolve(import.meta.dirname, "../skills/create-review-artifact");

describe("create-review-artifact skill contract", () => {
  it("triggers only for explicit artifact creation, review inspection, or reconnect", async () => {
    const [skill, metadata] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact");
    expect(skill).not.toContain("asks for content to be presented as a review artifact");
    expect(skill).not.toContain("explicitly invokes this skill");
    expect(skill).not.toContain("Use automatically for substantive implementation plans");
    expect(skill).not.toContain("Create a plan artifact whenever");
    expect(metadata).toContain("Create and reconnect review artifacts");
  });

  it("resolves workspace before project research and selects a unique high-confidence candidate", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("## Resolve the workspace first");
    expect(skill).toContain("Before reading target-workspace instructions, documentation, source, or drafting artifact content");
    expect(skill).toContain("This resolver is the only MCP tool that may run before reading the contract");
    expect(skill).toContain("Do not scan folders or rewrite the query first");
    expect(skill).toContain('`{ kind: "tagged-file", filePath }`');
    expect(skill).toContain("`resolve_artifact_workspace({ query })`");
    expect(skill).toContain('`{ kind: "resolved-workspace", selectionToken }`');
    expect(skill).toContain('`matchMode: "matched"`');
    expect(skill).toContain('`match: "single-folder"`');
    expect(skill).toContain("this classification is supplied by MCP, not inferred by the agent");
    expect(skill).toContain("Select a candidate without asking when exactly one is clearly the strongest match");
    expect(skill).toContain('`matchMode: "all-available"`');
    expect(skill).toContain("ask the user only when the strongest result is tied or otherwise ambiguous");
    expect(skill).toContain("uniquely high-confidence semantic match");
    expect(skill).toContain("When multiple active VS Code windows open the same workspace folder");
    expect(skill).toContain("Resolver results are grouped by VS Code window");
    expect(skill).toContain("Window focus is a ranking hint, not workspace ownership evidence or a routing requirement");
    expect(skill).toContain("Multiple windows do not automatically require a question");
    expect(skill).toContain("Each candidate's opaque selection token binds the exact window and workspace tuple");
    expect(skill).toContain("Once exactly one target workspace folder is chosen, read [references/artifact-contract.md](references/artifact-contract.md)");
    expect(skill).toContain("before inspecting that folder or calling `create_artifact`");
    expect(contract).toContain("may call `resolve_artifact_workspace` before loading this reference");
    expect(skill).not.toContain("Read [references/artifact-contract.md](references/artifact-contract.md) before calling the MCP tools");
    expect(skill).not.toContain("Do not read [references/artifact-contract.md](references/artifact-contract.md) during an ordinary create flow");
    expect(skill).toContain("Do not probe MCP resources or run filesystem commands to check availability");
    expect(contract).toContain("Resolver tokens are in-memory, one-time on successful creation");
    expect(contract).toContain("expire after ten minutes");
    expect(contract).toContain('`agent plus`, `agent-plus`, and `agent_plus` match');
    expect(contract).toContain('`match: "single-folder"`');
    expect(contract).toContain("returns stable candidates grouped into `windows`");
    expect(contract).toContain("Focus is only a ranking hint, not ownership evidence or a routing requirement");
    expect(contract).toContain("multiple windows alone do not require a question");
    expect(contract).toContain("binds an exact `windowInstanceId + workspaceRoot` tuple");
  });

  it("uses one chat-visible feedback policy for Review and chat inspection", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("Treat Review-button feedback exactly like chat-inspected feedback");
    expect(skill).toContain("Apply this policy to all saved comments");
    expect(skill).toContain("Question-only: answer every question directly in user-visible chat");
    expect(skill).toContain("Do not create or update a `## Review responses` section");
    expect(skill).not.toContain("Replace any existing `## Review responses` section");
    expect(contract).toContain("Review (`revise`) and chat-inspected feedback use the same classification and response policy");
    expect(contract).toContain("conversational answers belong in chat");
  });

  it("defines default waiting, chat escape, exact-handle reconnect, and question-only advancement", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    for (const tool of [
      "`resolve_artifact_workspace`",
      "`create_artifact`",
      "`wait_for_artifact_review`",
      "`inspect_artifact_review`",
      "`advance_and_wait_for_artifact`",
    ]) expect(skill).toContain(tool);
    expect(contract).toContain("Never select “the latest artifact”");
    expect(skill).toContain("maintain a request/workspace-to-handle-and-round mapping");
    expect(skill).toContain("answer every question directly in user-visible chat");
    expect(skill).toContain("without `markdown`");
    expect(skill).toContain("before starting `advance_and_wait_for_artifact`");
    expect(skill).toContain("Never repeat the previously approved or saved action");
    expect(skill).toContain('intent: "explicit-chat-update"');
    expect(skill).toContain('intent: "reconnect"');
    expect(contract).toContain('`intent: "reconnect"`');
    expect(skill).toContain("Never ask the user to create dummy comments or click Review");
    expect(contract).toContain("artifact lifetime > waiter lifetime > chat-turn lifetime");
    expect(contract).toContain("Proceed and Just save end only the submitted round");
    expect(contract).toContain('`intent` is `"explicit-chat-update"`');
    expect(contract).toContain("A chat-update token requires non-empty replacement Markdown");
    expect(skill).toContain("Check only once per chat lifecycle");
    expect(skill).toContain("If a request such as “look at the artifact” does not distinguish");
    expect(skill).toContain("Never takeover speculatively");
  });

  it("defines schema-v5 global storage while retaining workspace ownership metadata", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("schema-v5 lifecycle");
    expect(skill).toContain("global `~/.ai-artifacts/artifacts/<artifact-id>/` collection");
    expect(skill).toContain("`workspaceRoot` is target metadata and ownership evidence, not the storage location");
    expect(skill).toContain("exact returned global `artifactDirectory`");
    expect(contract).toContain("schema-v5 lifecycle in global AI Artifacts storage");
    expect(contract).toContain("`workspaceRoot` is retained as target metadata and ownership evidence");
    expect(contract).toContain("~/.ai-artifacts/artifacts/<server-generated-id>/");
    expect(contract).toContain("Schema v5 is the only supported lifecycle contract");
    expect(contract).toContain("Schemas 3 and 4 are unsupported and are not live-migrated");
    expect(contract).toContain("exact global handle after creation");
    expect(contract).toContain("Never scan global storage");
    expect(contract).toContain("Optional `artifact-connection.json` is schema-v1 UI-routing state only");
    expect(contract).toContain("`artifact.json` remains the source of truth for artifact identity");
    expect(contract).toContain("Create and reconnect may commit this file; wait and advance preserve it unchanged");
    expect(skill).not.toContain("schema-v4");
    expect(skill).not.toContain("schema v4");
    expect(contract).not.toContain("schema-v4");
    expect(contract).not.toContain("schema v4");
    expect(contract).not.toContain("persistent workspace data");
  });

  it("documents tagged-create window selection and exact-handle reconnect routing", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain("retry the same create request with the candidate's `connection.selectionToken`");
    expect(skill).toContain("the token chooses a window but does not replace tagged-file ownership evidence");
    expect(skill).toContain("`schemaVersion`, `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`");
    expect(skill).toContain("An optional `connection.windowInstanceId` is only a hint");
    expect(skill).toContain("retry the same inspect call with its `connection.selectionToken`");
    expect(skill).toContain("Reconnect never requires the target window to be focused");
    expect(contract).toContain("the tagged file remains the ownership evidence");
    expect(contract).toContain("`connection.windowInstanceId` is an optimization hint");
    expect(contract).toContain("returns the committed connection metadata");
    expect(contract).toContain("Focus is not required");
  });

  it("always creates implementation plans and treats Proceed as immediate execution authorization", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain('`kind: "implementation-plan"`');
    expect(skill).toContain('`nextAction.type: "execute-approved-plan"`');
    expect(skill).toContain("execute the complete approved plan immediately in the current turn");
    expect(skill).toContain("ask for another implementation confirmation");
    expect(contract).toContain("Treat this as execution authorization, not an acknowledgement request");
  });

  it("defines machine-readable same-handle recovery without blind replay", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    for (const code of [
      "ROUND_TOKEN_INVALID_OR_EXPIRED",
      "ROUND_TOKEN_IN_USE",
      "ROUND_TOKEN_ALREADY_CONSUMED",
      "ROUND_MISMATCH",
      "ROUND_STATE_CHANGED",
      "ARTIFACT_ALREADY_WAITING",
      "ADVANCE_ROLLED_BACK",
      "ADVANCE_COMMITTED",
      "WORKSPACE_NOT_REGISTERED",
      "WINDOW_SELECTION_REQUIRED",
      "WINDOW_SELECTION_EXPIRED",
      "WINDOW_CONNECTION_STALE",
      "WINDOW_CONNECTION_MISMATCH",
      "ARTIFACT_CONNECTION_INVALID",
      "ARTIFACT_CONNECTION_WRITE_FAILED",
    ]) expect(skill).toContain(code);
    expect(skill).toContain("never call `resolve_artifact_workspace` during recovery after an artifact has been created");
    expect(skill).toContain("inspect the exact handle before retrying");
    expect(skill).toContain("Stop automated recovery");
    expect(skill).toContain("Do not retry inspect/reconnect or edit lifecycle files yourself");
    expect(skill).toContain("For resume-wait intent, keep awaiting the in-flight call");
    expect(skill).toContain('for pure reconnect, call `inspect_artifact_review` with `intent: "reconnect"` without takeover');
    expect(skill).not.toContain("reconnect by waiting");
    expect(contract).toContain("useSameArtifactHandle: true");
    expect(contract).toContain("never call `resolve_artifact_workspace` after create");
    expect(contract).toContain("Unless the error is explicitly non-retryable");
    expect(contract).toContain("Do not retry inspect/reconnect or edit lifecycle files directly");
    expect(contract).toContain("Keep awaiting the in-flight call for resume-wait intent");
    expect(contract).toContain('use inspect with `intent: "reconnect"` and no takeover for pure reconnect');
  });

  it("documents artifactUrl and artifactLink as regular file links", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("artifactLink");
    expect(skill).toContain("regular file link");
    expect(skill).toContain("It is not a deep link and does not guarantee that a custom editor opens");
    expect(skill).not.toContain("re-open the artifact review tab");
    expect(contract).toContain("artifactUrl");
    expect(contract).toContain("artifactLink");
    expect(contract).toContain("`artifactLink` is a regular file link, not a deep link");
    expect(contract).toContain("does not guarantee that a custom editor opens");
  });
});
