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
    const [readme, philosophy, architecture, components, instructions, contract, changelog, documentationChanges] =
      await Promise.all([
        read("README.md"),
        read("docs/PHILOSOPHY.md"),
        read("docs/ARCHITECTURE.md"),
        read("docs/COMPONENTS.md"),
        read("docs/INSTRUCTION.md"),
        read("skills/create-review-artifact/references/artifact-contract.md"),
        read("CHANGELOG.md"),
        read("docs/CHANGE_LOGS.md"),
      ]);

    for (const document of [readme, philosophy, architecture, components, instructions, contract]) {
      expect(document).toMatch(/schema[- ]v5/i);
      expect(document).toContain("~/.ai-artifacts/artifacts/");
    }
    expect(readme).toContain("reinstall every integration");
    expect(readme).toContain("same user filesystem");
    expect(readme).toContain("not a deep link");
    expect(readme).toContain("MCP server 8.0.0");
    expect(readme).toContain("artifact-connection.json");
    expect(readme).toContain("The target may be unfocused; other windows ignore the event");
    expect(philosophy).toContain("Focus is a ranking hint, not identity, authorization, or a requirement");
    expect(architecture).toContain("MCP server 8.0.0");
    expect(architecture).toContain("artifact-connection.json` creation and change");
    expect(architecture).toContain("Both wait and advance preserve existing connection state");
    expect(components).toContain("Multiple windows are not an error by themselves");
    expect(instructions).toContain("Focus is only a ranking hint");
    expect(instructions).toContain("location.workspaceRoot");
    expect(contract).toContain("schema-v1 UI-routing state only");
    expect(contract).toContain("AI Artifacts: Install All Detected Integrations");
    expect(changelog).toContain("## [1.0.0] - Unreleased");
    expect(changelog).toContain("MCP server 8.0.0");
    expect(changelog).not.toContain("## [1.1.0]");
    expect(documentationChanges).toContain("Window-routed artifact connections and MCP 8.0.0 cutover");
  });

  it("keeps the public setting and version matrix on the 1.0.0 targeted-window contract", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const autoOpen = packageJson.contributes.configuration.properties["agentPlus.autoOpenArtifactReview"];

    expect(packageJson.version).toBe("1.0.0");
    expect(autoOpen.type).toBe("boolean");
    expect(autoOpen.default).toBe(true);
    expect(autoOpen.description).toContain("selected target window");
    expect(autoOpen.description).not.toContain("focused window");
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
