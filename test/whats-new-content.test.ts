import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import previewMarkdown from "../src/content/whats-new/preview.md?raw";
import tipsMarkdown from "../src/content/tips.md?raw";
import { whatsNewReleases } from "../src/shared/whats-new-releases";
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

  it("maps every shared release metadata entry to non-empty Markdown in source order with valid assets", async () => {
    expect(whatsNewContent.articles).toHaveLength(whatsNewReleases.length);
    const versions = whatsNewContent.articles.map((item) => item.version);
    expect(new Set(versions).size).toBe(versions.length);

    for (const [index, release] of whatsNewReleases.entries()) {
      const article = whatsNewContent.articles[index]!;
      expect(article).toMatchObject(release);
      expect(article.markdown.trim().length).toBeGreaterThan(0);
    }

    const article = whatsNewContent.articles[0]!;
    expect(article.version).toBe("1.2.0");
    expect(article.title).toContain("Work Sessions");
    expect(article.description.trim().length).toBeGreaterThan(0);
    expect(article.features).toEqual([
      "A Session Manager for your Working, References, and Archived artifacts.",
      "Shared instructions and artifacts across multiple AI agents and chats.",
      "Agent-to-agent review: one agent waits while another submits feedback.",
      "A dedicated sidebar with pinning, archiving, search, and session types.",
    ]);
    expect(article.bugFixes).toEqual([]);
    expect(article.preview).toBe(true);
    expect(article.icon).toBe("layers");
    expect(article.notify).toBe(false);
    expect(article.publishedAt).toBeUndefined();
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
