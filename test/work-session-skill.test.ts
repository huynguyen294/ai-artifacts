import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillDirectory = path.resolve(import.meta.dirname, "../skills/work-session");

describe("work-session skill contract", () => {
  it("defines standard work-session metadata and no custom rules block", async () => {
    const [skill, metadata] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("name: work-session");
    expect(skill).toContain(
      "description: Connect to or continue an AI Artifacts Work Session, applying its instructions and current artifact context across requests.",
    );
    expect(skill).not.toContain("USER CUSTOM RULES");
    expect(metadata).toContain('display_name: "Work Session"');
    expect(metadata).toContain('short_description: "Connect and continue work with shared session context"');
    expect(metadata).toContain(
      'default_prompt: "Use $work-session to refresh the active session context and continue the requested work."',
    );
  });

  it("requires join_session and includes the Session contract inline", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");

    expect(skill).toContain("`join_session`");
    expect(skill).toContain("`instructionsPath`, and `catalog`");
    expect(skill).toContain("`join_session` accepts an exact UUID `sessionId` and optional `artifactId`");
    expect(skill).toContain("resolves current Session v2 context without membership writes");
  });

  it("defines session selection matrix and success-only updates", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");

    // Scenario 1: No active session -> standalone
    expect(skill).toContain(
      "| Create/inspect without an active Session | Omit artifactConversationId and conversationName | Remain without an active Session; result.session is null |",
    );
    expect(skill).toContain("Omission alone never requests New Session creation");

    // Scenario 2: Active session S -> default create/inspect passes artifactConversationId: S
    expect(skill).toContain(
      "| Default create/inspect while S is active | artifactConversationId: S | Keep S; adopt the fresh returned context |",
    );

    // Scenario 3: Explicit standalone while S is active -> omits both arguments, preserves S
    expect(skill).toContain(
      "| Explicit standalone while S is active | Omit both Session arguments for this request | Keep S; do not replace it with null |",
    );

    // Scenario 4: Explicit New Session
    expect(skill).toContain(
      "| Explicit artifact creation with a new Session | conversationName, no old ID | Adopt the newly returned Session |",
    );
    expect(skill).toContain("omit the old `artifactConversationId`, and supply `conversationName`");

    // Scenario 5: Explicit Join or switch
    expect(skill).toContain(
      "| Explicit Join or switch to T | join_session with exact sessionId: T | Adopt T |",
    );
    expect(skill).toContain("After a successful tool call returns a non-null Session context, adopt its `sessionId`, Instructions, and paths");
    expect(skill).toContain("replace the active Session catalog with the returned catalog; do not merge it with older snapshots");
    expect(skill).toContain("Preserve retained artifact review handles separately");
  });

  it("delegates wait-mode selection and preserves Session context after commits", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
    const selection = skill.split("\n").find((line) => line.includes("[Tool contract](../create-review-artifact/SKILL.md#tool-contract)"));
    expect(selection).toBeDefined();
    expect(selection).toContain("applying any explicit user/Instructions wait-mode request");
    expect(skill).not.toContain("noWait");
    expect(skill).toContain("Use [create-review-artifact](../create-review-artifact/SKILL.md)");
    expect(skill).toContain("retain the active Session context and record the new artifact round separately");
    expect(skill).toContain("Join has no wait option and always returns an inspection snapshot");
    expect(skill).toContain("Public inspect may return saved feedback immediately even with `wait: true`");
  });

  it("documents instructions and ordered catalog zones", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");

    expect(skill).toContain("Instructions contain rules, workflows, and other guidance for AI in this Session");
    expect(skill).toContain("AI may read Working, References, or Archived catalog artifacts through their exact returned paths");
    expect(skill).toContain("AI may edit the exact `instructions.md` when the user explicitly requests it");
    expect(skill).toContain("Never directly edit `conversation.json`, `registered-artifacts/`");
    expect(skill).toContain("AI may move or reorder existing Session artifacts by directly editing the sibling `layout.json`");

    expect(skill).toContain("Each catalog has ordered `working`, `references`, and `archived` arrays");
    expect(skill).toContain("unavailable: true");
    expect(skill).toContain("Session `updatedAt` is derived from createdAt and membership registeredAt");
    expect(skill).toContain("never use it alone to decide that those contents are unchanged");
  });

  it("handles known targets via direct markdown and unknown via join-only snapshot", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");

    expect(skill).toContain(
      "Otherwise, if the target artifact is already known unambiguously by exact ID and catalog path in the current Session context, read its current Markdown directly",
    );
    expect(skill).toContain(
      "If the target is unknown, call `join_session({ sessionId: activeSessionId })` once",
    );
    expect(skill).toContain("before selecting an artifact, even if a previously known artifact has a valid path");
    expect(skill).toContain("Reuse a fresh catalog already returned for the same request");
  });

  it("defines machine-readable session recovery and historical snapshot policy", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");

    for (const code of [
      "CONVERSATION_NOT_FOUND",
      "CONVERSATION_REGISTRY_INVALID",
      "CONVERSATION_MIGRATION_REQUIRED",
      "WINDOW_SELECTION_REQUIRED",
      "WINDOW_SELECTION_EXPIRED",
      "WINDOW_CONNECTION_MISMATCH",
      "WINDOW_CONNECTION_STALE",
      "ARTIFACT_NOT_FOUND",
    ]) {
      expect(skill).toContain(code);
    }

    expect(skill).toContain("Saved `inspection.submission` or ordinary inspect `submission` is historical state, not a fresh execution directive");
    expect(skill).toContain("Do not re-execute past approvals or repeat a prior save");
    expect(skill).toContain("Do not clear an ID, auto-create a Session, retry as standalone, or replay a saved approval merely because a request failed");
  });
});
