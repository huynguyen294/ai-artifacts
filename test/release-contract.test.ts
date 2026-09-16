import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("v1.0.0 release contract", () => {
  it("keeps package and lock metadata synchronized", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const packageLock = JSON.parse(await read("package-lock.json"));

    expect(packageJson.name).toBe("ai-artifacts");
    expect(packageJson.version).toBe("1.0.0");
    expect(packageLock.name).toBe(packageJson.name);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""].name).toBe(packageJson.name);
    expect(packageLock.packages[""].version).toBe(packageJson.version);
  });

  it("contributes only the global schema-v5 artifact selector", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const selectors = packageJson.contributes.customEditors
      .find((editor: any) => editor.viewType === "agentPlus.artifactReview")
      ?.selector;

    expect(selectors).toEqual([
      { filenamePattern: "**/.ai-artifacts/artifacts/**/artifact.md" },
    ]);
  });

  it("keeps release-facing docs on the global v5 and reinstall contract", async () => {
    const [readme, philosophy, architecture, components, instructions, contract] =
      await Promise.all([
        read("README.md"),
        read("docs/PHILOSOPHY.md"),
        read("docs/ARCHITECTURE.md"),
        read("docs/COMPONENTS.md"),
        read("docs/INSTRUCTION.md"),
        read("skills/create-review-artifact/references/artifact-contract.md"),
      ]);

    for (const document of [readme, philosophy, architecture, components, instructions, contract]) {
      expect(document).toMatch(/schema[- ]v5/i);
      expect(document).toContain("~/.ai-artifacts/artifacts/");
    }
    expect(readme).toContain("reinstall every integration");
    expect(readme).toContain("same user filesystem");
    expect(readme).toContain("not a deep link");
    expect(architecture).toContain("MCP server 7.0.0");
    expect(instructions).toContain("location.workspaceRoot");
    expect(contract).toContain("AI Artifacts: Install All Detected Integrations");
  });

  it("keeps sensitive artifact directories out of source and VSIX payloads", async () => {
    const [gitignore, vscodeignore] = await Promise.all([
      read(".gitignore"),
      read(".vscodeignore"),
    ]);

    expect(gitignore).toContain(".ai-artifacts/");
    expect(gitignore).toContain(".codex-artifacts/");
    expect(vscodeignore).toContain(".ai-artifacts/**");
    expect(vscodeignore).toContain(".codex-artifacts/**");
  });
});
