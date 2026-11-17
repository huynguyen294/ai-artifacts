import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { whatsNewGuides } from "../src/shared/whats-new-guides";
import { whatsNewReleases } from "../src/shared/whats-new-releases";
import { resolveContentImage } from "../src/webview/content-media";
import { whatsNewContent } from "../src/webview/whats-new-content";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function extractImageReferences(markdown: string): string[] {
  const matches = markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g);
  return [...matches].map((match) => match[1]!);
}

describe("whats-new-content", () => {
  it("exposes shared guides metadata in editorial order", () => {
    expect(whatsNewContent.guides).toEqual(whatsNewGuides);
  });

  it("maps every shared release metadata entry to non-empty Markdown in source order with valid assets", async () => {
    expect(whatsNewContent.articles).toHaveLength(whatsNewReleases.length);
    const versions = whatsNewContent.articles.map((item) => item.version);
    expect(new Set(versions).size).toBe(versions.length);
    const { version } = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    expect(versions).toContain(version);

    for (const [index, release] of whatsNewReleases.entries()) {
      const article = whatsNewContent.articles[index]!;
      expect(article).toMatchObject(release);
      expect(article.markdown.trim().length).toBeGreaterThan(0);
    }

    const imageRefs = whatsNewContent.articles.flatMap((article) => extractImageReferences(article.markdown));

    for (const ref of imageRefs) {
      expect(resolveContentImage(ref, "https://example.test/media/whats-new")).toBeDefined();
      const relativeFromMedia = ref.slice("media/".length);
      const assetPath = path.join(repositoryRoot, "media", "whats-new", ...relativeFromMedia.split("/"));
      const bytes = await readFile(assetPath);
      if (ref.endsWith(".png")) {
        expect(bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
      } else if (ref.endsWith(".gif")) {
        expect(bytes.subarray(0, 4).toString("ascii")).toBe("GIF8");
      }
    }

  });
});
