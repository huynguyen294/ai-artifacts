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
    expect(skill).toContain("inspect its saved review comments, or reconnect its review lifecycle");
    expect(skill).not.toContain("asks for content to be presented as a review artifact");
    expect(skill).not.toContain("explicitly invokes this skill");
    expect(skill).not.toContain("Use automatically for substantive implementation plans");
    expect(skill).not.toContain("Create a plan artifact whenever");
    expect(metadata).toContain("Create and reconnect review artifacts");
  });

  it("uses the ordered workspace evidence gate before artifact operations", async () => {
    const skill = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
    expect(skill).toContain("Pass the workspace evidence gate before any artifact filesystem operation");
    expect(skill).toContain("A path, file link, `@mention`, or attachment explicitly supplied");
    expect(skill).toContain("An active/open file supplied by IDE context with a concrete path");
    expect(skill).toContain("A repository or folder explicitly named in the conversation");
    expect(skill).toContain("ask the user which workspace owns the artifact");
    expect(skill).toContain("workspace-folder order");
    expect(skill).toContain("Do not inspect unrelated roots");
    expect(skill).not.toContain("package.json");
    expect(skill).toContain("`workspaceEvidence`");
    expect(skill).toContain("do not retry another inferred root");
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
      "`create_artifact`",
      "`wait_for_artifact_review`",
      "`inspect_artifact_review`",
      "`advance_and_wait_for_artifact`",
    ]) expect(skill).toContain(tool);
    expect(skill).toContain("Never search for the latest artifact");
    expect(skill).toContain("answer every question directly in user-visible chat");
    expect(skill).toContain("without `markdown`");
    expect(skill).toContain("before starting `advance_and_wait_for_artifact`");
    expect(skill).toContain("must not repeat the previously approved or saved action");
    expect(contract).toContain("artifact lifetime > waiter lifetime > chat-turn lifetime");
    expect(contract).toContain("Proceed and Just save end only the submitted round");
  });

  it("treats Proceed on every plan kind as immediate execution authorization", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain('For `kind: "plan"` or `kind: "implementation-plan"`');
    expect(skill).toContain('`nextAction.type: "execute-approved-plan"`');
    expect(skill).toContain("execute the complete approved plan immediately in the current turn");
    expect(skill).toContain("do not ask for another implementation confirmation");
    expect(contract).toContain("Treat this as execution authorization, not an acknowledgement request");
  });
});
