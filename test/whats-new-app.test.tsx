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
  const mediaBaseUri = "https://file+.vscode-resource.vscode-cdn.net/ext/media/whats-new";

  afterEach(() => {
    vi.doUnmock("../src/webview/whats-new-content");
    vi.resetModules();
  });

  it("renders both tab buttons and the preview article with resolved sample media by default", () => {
    const html = renderToStaticMarkup(<WhatsNewApp mediaBaseUri={mediaBaseUri} />);
    const previewArticle = whatsNewContent.articles[0]!;

    expect(html).toContain(">What&#x27;s New</button>");
    expect(html).toContain(">Tips</button>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('role="tab"');

    // Preview metadata + markdown content + media
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
    expect(html).toContain(`src="${mediaBaseUri}/samples/ai-artifacts.png"`);
    expect(html).toContain(`src="${mediaBaseUri}/samples/inline-feedback.gif"`);

    // Ensure no review controls or Phase 3 blog CTA leak into Phase 2 app
    expect(html).not.toContain("Proceed");
    expect(html).not.toContain("Just save");
    expect(html).not.toContain("View more details");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-highlight");
    expect(html).not.toContain("code-block-shell");
  });

  it("renders tips markdown and sample media when initialTab is tips", () => {
    const html = renderToStaticMarkup(<WhatsNewApp initialTab="tips" mediaBaseUri={mediaBaseUri} />);
    const previewArticle = whatsNewContent.articles[0]!;

    expect(html).toContain("AI Artifacts Tips");
    expect(html).toContain("Keep shared guidance in Session Instructions");
    expect(html).toContain("artifact-document whats-new-document");
    expect(html).toContain(`src="${mediaBaseUri}/samples/inline-feedback.gif"`);
    expect(html).not.toContain(previewArticle.description);
    expect(html).not.toContain("View more details");
    expect(html).not.toContain("data-block-id");
  });

  it("falls back to placeholders without breaking text when mediaBaseUri is omitted", () => {
    const html = renderToStaticMarkup(<WhatsNewApp />);

    expect(html).toContain("Highlights in this preview");
    expect(html).toContain('href="https://github.com/huynguyen294/ai-artifacts"');
    expect(html).not.toContain("<img");
    expect(html).toContain("whats-new-image-placeholder");
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
    const html = renderToStaticMarkup(<EmptyWhatsNewApp mediaBaseUri={mediaBaseUri} />);

    expect(html).toContain("No updates to show yet.");
    expect(html).toContain(">What&#x27;s New</button>");
    expect(html).toContain(">Tips</button>");
  });

  it("renders content markdown through WhatsNewDocument with resolved media and no raw HTML or review chrome", () => {
    const html = renderToStaticMarkup(
      <WhatsNewDocument
        markdown={
          "# Heading\n\n![Demo](media/samples/ai-artifacts.png)\n\nText with [link](https://example.com) and <script>alert(1)</script>."
        }
        mediaBaseUri={mediaBaseUri}
      />,
    );

    expect(html).toContain("artifact-document whats-new-document");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain(`src="${mediaBaseUri}/samples/ai-artifacts.png"`);
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-block");
    expect(html).not.toContain("<mark");
  });
});
