import path from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { whatsNewGuides } from "../src/shared/whats-new-guides";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("whats-new-guides", () => {
  it("provides unique guide ids and URLs, non-empty metadata, and valid https dev.to URLs", () => {
    expect(whatsNewGuides).toHaveLength(5);

    const ids = whatsNewGuides.map((guide) => guide.id);
    expect(new Set(ids).size).toBe(ids.length);

    const urls = whatsNewGuides.map((guide) => guide.url);
    expect(new Set(urls).size).toBe(urls.length);

    for (const guide of whatsNewGuides) {
      expect(guide.id.trim().length).toBeGreaterThan(0);
      expect(guide.title.trim().length).toBeGreaterThan(0);
      expect(guide.description.trim().length).toBeGreaterThan(0);
      const parsedUrl = new URL(guide.url);
      expect(parsedUrl.protocol).toBe("https:");
      expect(parsedUrl.hostname).toBe("dev.to");
    }
  });

  it("bundles standalone for Node without ?raw, VS Code, or React dependencies", async () => {
    const result = await esbuild.build({
      absWorkingDir: repositoryRoot,
      entryPoints: [path.join(repositoryRoot, "src", "shared", "whats-new-guides.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
    expect(Object.keys(result.metafile!.inputs).map((input) => path.resolve(repositoryRoot, input))).toEqual([
      path.join(repositoryRoot, "src", "shared", "whats-new-guides.ts"),
    ]);
  });
});
