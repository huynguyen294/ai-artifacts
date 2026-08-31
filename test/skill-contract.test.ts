import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const skillDirectory = path.resolve(import.meta.dirname, "../skills/create-review-artifact");

describe("create-review-artifact skill contract", () => {
  it("has one trigger condition: an explicit create or update artifact request", async () => {
    const [skill, metadata] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "agents", "openai.yaml"), "utf8"),
    ]);

    expect(skill).toContain("Use only when the user explicitly asks to create or update an artifact");
    expect(skill).toContain("Trigger only when the user explicitly asks to create or update an artifact");
    expect(skill).not.toContain("asks for content to be presented as a review artifact");
    expect(skill).not.toContain("explicitly invokes this skill");
    expect(skill).not.toContain("Use automatically for substantive implementation plans");
    expect(skill).not.toContain("Create a plan artifact whenever");
    expect(metadata).toContain("Create explicitly requested review artifacts");
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

  it("keeps review responses for only the immediately preceding comment round", async () => {
    const [skill, contract] = await Promise.all([
      readFile(path.join(skillDirectory, "SKILL.md"), "utf8"),
      readFile(path.join(skillDirectory, "references", "artifact-contract.md"), "utf8"),
    ]);
    expect(skill).toContain("Replace any existing `## Review responses` section");
    expect(skill).toContain("Do not retain responses from older rounds");
    expect(skill).not.toContain("Preserve still-relevant answers from earlier rounds");
    expect(contract).toContain("Do not carry responses from older rounds forward");
  });
});
