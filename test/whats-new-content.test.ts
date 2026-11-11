import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import previewMarkdown from "../src/content/whats-new/preview.md?raw";
import tipsMarkdown from "../src/content/tips.md?raw";
import { resolveContentImage } from "../src/webview/content-media";
import { whatsNewContent } from "../src/webview/whats-new-content";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function extractImageReferences(markdown: string): string[] {
  const matches = markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g);
  return [...matches].map((match) => match[1]!);
}

describe("whats-new-content", () => {
  it("loads preview release notes and tips markdown via ?raw imports", () => {
    expect(previewMarkdown.trim().length).toBeGreaterThan(0);
    expect(previewMarkdown).toContain("Preview content");
    expect(previewMarkdown).toContain("https://");

    expect(tipsMarkdown.trim().length).toBeGreaterThan(0);
    expect(tipsMarkdown).toContain("Preview content");
    expect(tipsMarkdown).toContain("https://");
  });

  it("exposes preview metadata and references existing valid PNG/GIF sample assets without raw HTML or disallowed topics", async () => {
    expect(whatsNewContent.articles).toHaveLength(1);
    const article = whatsNewContent.articles[0]!;
    expect(article.version).toBe("1.2.0");
    expect(article.title).toContain("Work Sessions");
    expect(article.description.trim().length).toBeGreaterThan(0);
    expect(article.highlights.length).toBeGreaterThanOrEqual(2);
    expect(article.markdown).toBe(previewMarkdown);
    expect(whatsNewContent.tipsMarkdown).toBe(tipsMarkdown);

    const sampleRefs = [
      ...extractImageReferences(article.markdown),
      ...extractImageReferences(whatsNewContent.tipsMarkdown),
    ];
    expect(sampleRefs).toContain("media/samples/ai-artifacts.png");
    expect(sampleRefs).toContain("media/samples/inline-feedback.gif");

    for (const ref of sampleRefs) {
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

    // Disallow raw HTML, Export Session, and Installer/auto-upgrade topics
    for (const body of [article.markdown, whatsNewContent.tipsMarkdown]) {
      expect(body).not.toMatch(/<(?:video|img|script|iframe|div|span)\b/i);
      expect(body).not.toMatch(/export\s+session/i);
      expect(body).not.toMatch(/installer|auto-upgrade/i);
    }
  });
});
