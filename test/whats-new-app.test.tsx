import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/webview/vscode-api", () => ({
  vscode: {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

import { WhatsNewApp } from "../src/webview/WhatsNewApp";
import { WhatsNewDocument } from "../src/webview/WhatsNewDocument";
import { whatsNewContent } from "../src/webview/whats-new-content";

describe("WhatsNewApp and WhatsNewDocument", () => {
  afterEach(() => {
    vi.doUnmock("../src/webview/whats-new-content");
    vi.resetModules();
  });

  it("renders both tab buttons and the preview article by default", () => {
    const html = renderToStaticMarkup(<WhatsNewApp />);
    const previewArticle = whatsNewContent.articles[0]!;

    expect(html).toContain(">What&#x27;s New</button>");
    expect(html).toContain(">Tips</button>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('role="tab"');

    // Preview metadata + markdown content
    expect(html).toContain("Preview content");
    expect(html).toContain(`Version ${previewArticle.version}`);
    expect(html).toContain(previewArticle.title);
    expect(html).toContain(previewArticle.description);
    for (const highlight of previewArticle.highlights) {
      expect(html).toContain(highlight);
    }
    expect(html).toContain("artifact-document whats-new-document");
    expect(html).toContain("Highlights in this preview");
    expect(html).toContain('href="https://github.com/huynguyen294/ai-artifacts"');

    // Ensure no review controls or Phase 3 blog CTA leak into Phase 1 app
    expect(html).not.toContain("Proceed");
    expect(html).not.toContain("Just save");
    expect(html).not.toContain("View more details");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-highlight");
  });

  it("renders tips markdown directly when initialTab is tips", () => {
    const html = renderToStaticMarkup(<WhatsNewApp initialTab="tips" />);
    const previewArticle = whatsNewContent.articles[0]!;

    expect(html).toContain("AI Artifacts Tips");
    expect(html).toContain("Keep shared guidance in Session Instructions");
    expect(html).toContain("artifact-document whats-new-document");
    expect(html).not.toContain(previewArticle.description);
    expect(html).not.toContain("View more details");
  });

  it("renders safe empty state without crashing when articles is empty", async () => {
    vi.resetModules();
    vi.doMock("../src/webview/whats-new-content", () => ({
      whatsNewContent: {
        articles: [],
        tipsMarkdown: "# Sample Tips",
      },
    }));

    const { WhatsNewApp: EmptyWhatsNewApp } = await import("../src/webview/WhatsNewApp");
    const html = renderToStaticMarkup(<EmptyWhatsNewApp />);

    expect(html).toContain("No updates to show yet.");
    expect(html).toContain(">What&#x27;s New</button>");
    expect(html).toContain(">Tips</button>");
  });

  it("renders read-only markdown through WhatsNewDocument without review annotations or raw HTML", () => {
    const html = renderToStaticMarkup(
      <WhatsNewDocument markdown={"# Heading\n\nText with [link](https://example.com) and <script>alert(1)</script>."} />,
    );

    expect(html).toContain("artifact-document whats-new-document");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-block");
    expect(html).not.toContain("<mark");
  });
});

