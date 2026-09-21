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

  it("documents focused-window routing and resolve_artifact_window discovery", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("## Tools and Window Routing");
    expect(skill).toContain("`resolve_artifact_window`");
    expect(skill).toContain("By default, call `create_artifact` directly without any prior window resolution");
    expect(skill).toContain("The server routes directly to the currently focused VS Code window");
    expect(skill).toContain("`WINDOW_SELECTION_REQUIRED`");
    expect(skill).toContain('`connection: { targetMode: "explicit-window", selectionToken }`');
    expect(skill).toContain("Select a candidate without asking when exactly one clearly matches");
    expect(skill).toContain("Ask the user only when candidates remain tied or ambiguous");
    expect(skill).toContain("call `resolve_artifact_window({ query })`");
    expect(skill).toContain("Read [references/artifact-contract.md](references/artifact-contract.md) before calling `create_artifact`");
    expect(skill).not.toContain("resolve_artifact_workspace");
    expect(skill).not.toContain("tagged-file");
    expect(skill).not.toContain("workspaceRoot");
    expect(contract).toContain("`resolve_artifact_window` accepts an optional `query` string");
    expect(contract).toContain("returns candidates grouped by window");
    expect(contract).toContain('status: "matched"');
    expect(contract).toContain('status: "selection-required"');
    expect(contract).toContain('status: "not-found"');
    expect(contract).toContain("do not probe MCP resources or the filesystem");
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
      "`resolve_artifact_window`",
      "`create_artifact`",
      "`wait_for_artifact_review`",
      "`inspect_artifact_review`",
      "`advance_and_wait_for_artifact`",
    ]) expect(skill).toContain(tool);
    expect(skill).not.toContain("`resolve_artifact_workspace`");
    expect(contract).toContain("Never select “the latest artifact”");
    expect(skill).toContain("maintain an `artifactDirectory -> { reviewRound, windowInstanceId }` mapping");
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

  it("defines schema-v6 global storage without workspace ownership metadata", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("schema-v6 lifecycle");
    expect(skill).toContain("global `~/.ai-artifacts/artifacts/<artifact-id>/` collection");
    expect(skill).toContain("exact returned global `artifactDirectory`");
    expect(skill).not.toContain("workspaceRoot");
    expect(skill).not.toContain("ownership evidence");
    expect(contract).toContain("schema-v6 lifecycle in global AI Artifacts storage");
    expect(contract).toContain("~/.ai-artifacts/artifacts/<server-generated-id>/");
    expect(contract).toContain("Schema v6 is the only supported lifecycle contract");
    expect(contract).toContain("Older schemas are unsupported and are not live-migrated");
    expect(contract).toContain("exact global handle after creation");
    expect(contract).toContain("Never scan global storage");
    expect(contract).toContain("Optional `artifact-connection.json` is schema-v1 UI-routing state only");
    expect(contract).toContain("`artifact.json` is schema-v6 and does not store workspace location");
    expect(contract).toContain("Create and reconnect may commit this file; wait and advance preserve it unchanged");
    expect(skill).not.toContain("schema-v5");
    expect(skill).not.toContain("schema v5");
    expect(contract).not.toContain("schema-v5");
    expect(contract).not.toContain("schema v5");
    expect(contract).not.toContain("persistent workspace data");
  });

  it("documents window selection and exact-handle reconnect routing", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain('retry the same inspect call with `connection: { targetMode: "explicit-window", selectionToken }`');
    expect(skill).toContain('`connection: { targetMode: "artifact-window", windowInstanceId }`');
    expect(skill).toContain("`schemaVersion`, `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`");
    expect(skill).toContain("Reconnect evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity");
    expect(skill).toContain("Do not send or compare `connectionRevision`");
    expect(contract).toContain('`connection: { targetMode: "explicit-window", selectionToken }`');
    expect(contract).toContain('`{ targetMode: "artifact-window", windowInstanceId }`');
    expect(contract).toContain("returns the committed connection metadata");
    expect(contract).toContain("Focus is not required when targeting via `selectionToken` or matching advisory affinity");
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
      "WINDOW_NOT_FOUND",
      "WINDOW_SELECTION_REQUIRED",
      "WINDOW_SELECTION_EXPIRED",
      "WINDOW_CONNECTION_STALE",
      "WINDOW_CONNECTION_MISMATCH",
      "ARTIFACT_CONNECTION_INVALID",
      "ARTIFACT_CONNECTION_WRITE_FAILED",
      "ARTIFACT_NOT_FOUND",
    ]) expect(skill).toContain(code);
    expect(skill).not.toContain("WORKSPACE_NOT_REGISTERED");
    expect(skill).not.toContain("resolve_artifact_workspace");
    expect(skill).toContain("inspect the exact handle before retrying");
    expect(skill).toContain("Stop automated recovery");
    expect(skill).toContain("Do not retry inspect/reconnect or edit lifecycle files yourself");
    expect(skill).toContain("For resume-wait intent, keep awaiting the in-flight call");
    expect(skill).toContain('for pure reconnect, call `inspect_artifact_review` with `intent: "reconnect"` without takeover');
    expect(skill).not.toContain("reconnect by waiting");
    expect(skill).toContain("Drop the stale handle mapping and inform the user that the artifact is permanently unavailable");
    expect(contract).toContain("useSameArtifactHandle: boolean;");
    expect(contract).toContain("ARTIFACT_NOT_FOUND`: the exact artifact handle no longer exists");
    expect(contract).toContain("Non-retryable with `useSameArtifactHandle: false`");
    expect(contract).not.toContain("resolve_artifact_workspace");
    expect(contract).toContain("Unless the error is explicitly non-retryable");
    expect(contract).toContain("Do not retry inspect/reconnect or edit lifecycle files directly");
    expect(contract).toContain("Keep awaiting the in-flight call for resume-wait intent");
    expect(contract).toContain('use inspect with `intent: "reconnect"` and no takeover for pure reconnect');
  });

  it("documents bounded artifact retention and long-term preservation", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain("Artifact lifetime is bounded by configured retention");
    expect(contract).toContain("agentPlus.artifactRetentionDays");
    expect(contract).toContain("bounded by configured retention");
    expect(contract).toContain("validated expired artifacts are permanently deleted");
    expect(contract).toContain("To preserve content beyond the retention window, the user must complete Just save, Copy Markdown, or export content manually");
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
