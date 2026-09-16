import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function readTypeScriptSources(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readTypeScriptSources(entryPath);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return "";
    return readFile(entryPath, "utf8");
  }));
  return contents.join("\n");
}

describe("regular artifact file-link contract", () => {
  it("keeps reviewUrl, URI handlers, and onUri activation out of source and package contracts", async () => {
    const [packageSource, extensionSource] = await Promise.all([
      readFile(path.join(repositoryRoot, "package.json"), "utf8"),
      readTypeScriptSources(path.join(repositoryRoot, "src")),
    ]);
    const packageJson = JSON.parse(packageSource) as {
      activationEvents?: string[];
    };

    expect(packageJson.activationEvents ?? []).not.toContain("onUri");
    expect((packageJson.activationEvents ?? []).some((event) => event.startsWith("onUri:"))).toBe(false);
    expect(packageSource).not.toMatch(/\breviewUrl\b/);
    expect(extensionSource).not.toMatch(/\breviewUrl\b/);
    expect(extensionSource).not.toContain("registerUriHandler");
  });

  it("keeps the MCP result on RFC 8089 file URLs and regular Markdown links", async () => {
    const integrationSource = await readFile(
      path.join(repositoryRoot, "src", "integration", "artifact-review-mcp-v4.ts"),
      "utf8",
    );
    const [skill, contract] = await Promise.all([
      readFile(path.join(repositoryRoot, "skills", "create-review-artifact", "SKILL.md"), "utf8"),
      readFile(
        path.join(repositoryRoot, "skills", "create-review-artifact", "references", "artifact-contract.md"),
        "utf8",
      ),
    ]);

    expect(integrationSource).toContain("pathToFileURL(filePath).href");
    expect(integrationSource).toContain("return `[${safeTitle}](${artifactUrl})`");
    expect(skill).toContain("regular file link");
    expect(skill).toContain("It is not a deep link and does not guarantee that a custom editor opens");
    expect(contract).toContain("`artifactLink` is a regular file link, not a deep link");
    expect(contract).toContain("does not guarantee that a custom editor opens");
  });
});
