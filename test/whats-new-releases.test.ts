import path from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { whatsNewReleases } from "../src/shared/whats-new-releases";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("whats-new-releases", () => {
  it("provides unique release versions and non-empty card metadata", () => {
    const versions = whatsNewReleases.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);

    for (const release of whatsNewReleases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(release.title.trim().length).toBeGreaterThan(0);
      expect(release.description.trim().length).toBeGreaterThan(0);
      for (const highlight of [...release.features, ...release.bugFixes]) {
        expect(highlight.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("bundles standalone for Node without ?raw, VS Code, or React dependencies", async () => {
    const result = await esbuild.build({
      absWorkingDir: repositoryRoot,
      entryPoints: [path.join(repositoryRoot, "src", "shared", "whats-new-releases.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
    expect(Object.keys(result.metafile!.inputs).map((input) => path.resolve(repositoryRoot, input))).toEqual([
      path.join(repositoryRoot, "src", "shared", "whats-new-releases.ts"),
    ]);
  });
});

