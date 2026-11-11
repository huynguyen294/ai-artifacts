import { describe, expect, it } from "vitest";
import previewMarkdown from "../src/content/whats-new/preview.md?raw";
import tipsMarkdown from "../src/content/tips.md?raw";
import { whatsNewContent } from "../src/webview/whats-new-content";

describe("whats-new-content", () => {
  it("loads preview release notes and tips markdown via ?raw imports", () => {
    expect(previewMarkdown.trim().length).toBeGreaterThan(0);
    expect(previewMarkdown).toContain("Preview content");
    expect(previewMarkdown).toContain("https://");

    expect(tipsMarkdown.trim().length).toBeGreaterThan(0);
    expect(tipsMarkdown).toContain("Preview content");
    expect(tipsMarkdown).toContain("https://");
  });

  it("exposes preview article metadata referencing imported markdown without Phase 2+ media or disallowed topics", () => {
    expect(whatsNewContent.articles).toHaveLength(1);
    const article = whatsNewContent.articles[0]!;
    expect(article.version).toBe("1.2.0");
    expect(article.title).toContain("Work Sessions");
    expect(article.description.trim().length).toBeGreaterThan(0);
    expect(article.highlights.length).toBeGreaterThanOrEqual(2);
    expect(article.markdown).toBe(previewMarkdown);
    expect(whatsNewContent.tipsMarkdown).toBe(tipsMarkdown);

    // Phase 1 sample constraints: no media, raw HTML, fenced code/Mermaid, Export, or Installer copy
    for (const body of [article.markdown, whatsNewContent.tipsMarkdown]) {
      expect(body).not.toMatch(/!\[[^\]]*\]\(/);
      expect(body).not.toContain("```");
      expect(body).not.toMatch(/<(?:video|img|script|iframe|div|span)\b/i);
      expect(body).not.toMatch(/export\s+session/i);
      expect(body).not.toMatch(/installer|auto-upgrade/i);
    }
  });
});

