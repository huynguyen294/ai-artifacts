import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SKILL_DESCRIPTIONS,
  USER_CUSTOM_RULES_BEGIN,
  USER_CUSTOM_RULES_END,
} from "../src/extension/mcp-clients/skill-helper";

const skillDirectory = path.resolve(import.meta.dirname, "../skills/create-review-artifact");

describe("create-review-artifact skill contract", () => {
  it("locks the append-only official descriptions and one empty customization block", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
    const expectedOfficialDescriptions = [
      "Create or update a reviewable Markdown artifact and wait for the user's decision in the same Codex turn. Use only when the user explicitly asks to create or update an artifact.",
      "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds.",
      "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact, join work sessions, and coordinate review rounds.",
      "Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact and coordinate its review rounds. Also use when explicitly asked to comment on an artifact, with or without submitting Review.",
    ];

    expect(OFFICIAL_SKILL_DESCRIPTIONS).toEqual(expectedOfficialDescriptions);
    expect(skill).toContain(`description: ${expectedOfficialDescriptions.at(-1)}`);
    expect(skill.match(new RegExp(USER_CUSTOM_RULES_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(skill.match(new RegExp(USER_CUSTOM_RULES_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(skill.slice(
      skill.indexOf(USER_CUSTOM_RULES_BEGIN) + USER_CUSTOM_RULES_BEGIN.length,
      skill.indexOf(USER_CUSTOM_RULES_END),
    ).trim()).toBe("");
    expect(skill).toContain("override the default rules in this skill when they conflict");
  });

  it("triggers only for explicit artifact creation, inspection, reconnect, or AI feedback", async () => {
    const [skill, metadata] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("Create, update, inspect, or reconnect an explicitly requested reviewable Markdown artifact");
    expect(skill).not.toContain("asks for content to be presented as a review artifact");
    expect(skill).not.toContain("explicitly invokes this skill");
    expect(skill).not.toContain("Use automatically for substantive implementation plans");
    expect(skill).not.toContain("Create a plan artifact whenever");
    expect(metadata).toContain("Create, inspect, and review Markdown artifacts");
  });

  it("routes AI-authored comments to two adjacent actions without entering the lifecycle wait flow", async () => {
    const [skill, feedback, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "ai-feedback.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("follow [references/ai-feedback.md](references/ai-feedback.md)");
    expect(skill).toContain("do not enter the create/advance/wait flow");
    expect(feedback.match(/^## /gm)).toHaveLength(2);
    expect(feedback).toContain("## 1. Comment");
    expect(feedback).toContain("## 2. Comment and submit Review");
    expect(feedback).toContain("inspect_artifact_review` without takeover");
    expect(feedback).toContain("only this request's AI-generated batch");
    expect(feedback).toContain("commentsSha256");
    expect(feedback).toContain('`decision: "revise"`');
    expect(contract).toContain("[AI-authored feedback](ai-feedback.md)");
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
    expect(skill).toContain('`nextAction.type: "process-review-feedback"`');
    expect(skill).toContain("`comments.comments`");
    expect(skill).toContain("Apply this policy to all saved comments");
    expect(skill).toContain("Question-only: answer every question directly in user-visible chat");
    expect(skill).toContain("Do not create or update a `## Review responses` section");
    expect(skill).not.toContain("Replace any existing `## Review responses` section");
    expect(contract).toContain("shared feedback policy");
    expect(contract).toContain("result.comments.comments");
    expect(contract).toContain("process-review-feedback");
    expect(contract).toContain("text JSON and `structuredContent`");
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
    expect(contract).toContain("artifact lifetime > waiter lifetime > chat-turn lifetime");
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
    expect(skill).toContain("Check only once per chat lifecycle");
    expect(skill).toContain("If a request such as “look at the artifact” does not distinguish");
    expect(skill).toContain("Never takeover speculatively");
  });

  it("separates Session update commits from review decisions without broadening creation or feedback", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    const sessionUpdate = skill.slice(skill.indexOf("### Session direct updates"), skill.indexOf("### After inspection"));
    expect(sessionUpdate).toContain("../work-session/SKILL.md#artifacts-while-a-session-is-active");
    expect(sessionUpdate).toContain("explicit chat updates to existing artifacts");
    expect(sessionUpdate).toContain("does not change the wait after creation or the handling of review feedback");
    const decisions = skill.slice(skill.indexOf("### Fresh decisions"), skill.indexOf("## Structured recovery"));
    expect(decisions).toContain("`waited: false`");
    expect(decisions).toContain("not a review decision");
    expect(decisions).toContain("continue the authorized work in the same turn");
    expect(decisions).toContain("do not fetch comments or attach a waiter");
    expect(decisions).toContain("fresh inspection token");
    expect(contract).toContain("optional `noWait?: boolean` (default `false`)");
    expect(contract).toContain("before token claim or mutation");
    expect(contract).toContain("does not verify Join state, registry existence, or membership");
    expect(contract).toContain("no `decision`, `comments`, `nextAction`, or new round token");
    expect(skill).toContain("user-requested checklist/progress content");
    expect(skill).toContain("this does not authorize automatic artifact creation");
    expect(skill).toContain("Call `wait_for_artifact_review` immediately on that exact handle and round");
    expect(contract).toContain("`expectedReviewRound` is checked at attachment only");
    expect(sessionUpdate).toContain("leave any existing waiter attached");
    expect(contract).toContain("An existing waiter is preserved");
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
    expect(contract).not.toContain("workspaceRoot");
    expect(skill).not.toContain("schema-v5");
    expect(skill).not.toContain("schema v5");
    expect(contract).not.toContain("schema-v5");
    expect(contract).not.toContain("schema v5");
  });

  it("documents window selection and exact-handle reconnect routing", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain('retry the same inspect call with `connection: { targetMode: "explicit-window", selectionToken }`');
    expect(skill).toContain('`connection: { targetMode: "artifact-window", windowInstanceId }`');
    expect(skill).toContain("complete committed connection metadata");
    expect(skill).toContain("Reconnect evaluates active windows prioritizing sole live window, validated advisory artifact-window affinity");
    expect(skill).toContain("Do not send or compare `connectionRevision`");
    expect(contract).toContain('`connection: { targetMode: "explicit-window", selectionToken }`');
    expect(contract).toContain('`{ targetMode: "artifact-window", windowInstanceId }`');
    expect(contract).toContain("`schemaVersion`, `windowInstanceId`, `connectionRevision`, `openRequestId`, `source`, and `updatedAt`");
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
    expect(skill).toContain("CONVERSATION_NOT_FOUND");
    expect(skill).toContain("CONVERSATION_REGISTRY_INVALID");
    expect(skill).toContain("CONVERSATION_MIGRATION_REQUIRED");
    expect(skill).not.toContain("WORKSPACE_NOT_REGISTERED");
    expect(skill).not.toContain("resolve_artifact_workspace");
    expect(skill).toContain("inspect the exact handle before retrying");
    expect(skill).toContain("Stop automated recovery");
    expect(skill).toContain("Do not retry inspect/reconnect or edit lifecycle files yourself");
    expect(skill).toContain("For resume-wait intent, keep awaiting the in-flight call");
    expect(skill).toContain('for pure reconnect, call `inspect_artifact_review` with `intent: "reconnect"` without takeover');
    expect(skill).not.toContain("reconnect by waiting");
    expect(skill).toContain("Drop the stale handle mapping and inform the user that the artifact is permanently unavailable");
  });

  it("documents archive-only artifact retention and long-term preservation", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain("Only globally archived artifacts are subject to configured retention");
    expect(contract).toContain("agentPlus.artifactRetentionDays");
    expect(contract).toContain("artifact-ui-state.json.archivedAt");
    expect(contract).toContain("Missing UI state or `archivedAt` means unarchived");
    expect(contract).toContain("restore the artifact or save a copy with Just save, Copy Markdown, or manual export before cleanup");
  });

  it("documents artifactUrl and artifactLink as regular file links", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("artifactLink");
    expect(skill).toContain("regular file link");
    expect(skill).toContain("It is not a deep link; it opens `artifact.md` in a plain Markdown/text editor");
    expect(skill).toContain("Open Artifact Review");
    expect(skill).not.toContain("re-open the artifact review tab");
    expect(contract).toContain("artifactUrl");
    expect(contract).toContain("artifactLink");
    expect(contract).toContain("`artifactLink` is a regular file link, not a deep link; it opens `artifact.md` in a plain Markdown/text editor");
    expect(contract).toContain("Open Artifact Review");
  });

  it("documents conversation artifact tracking and Session bridge across create, inspect, and reconnect", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);

    expect(skill).toContain("## Session bridge");
    expect(skill).toContain("artifactConversationId");
    expect(skill).toContain("conversationName");
    expect(skill).toContain("session: null");
    expect(skill).toContain("CONVERSATION_NOT_FOUND");
    expect(skill).toContain("CONVERSATION_REGISTRY_INVALID");
    expect(skill).toContain("CONVERSATION_MIGRATION_REQUIRED");
    expect(skill).toContain("follow [work-session](../work-session/SKILL.md)");

    expect(contract).toContain("## Optional Work Session arguments");
    expect(contract).toContain("artifactConversationId");
    expect(contract).toContain("conversationName");
    expect(contract).toContain("session: null");
    expect(contract).toContain("follow [work-session](../../work-session/SKILL.md)");
  });
});
