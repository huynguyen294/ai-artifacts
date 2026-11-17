import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPostMessage } = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
}));

vi.mock("../src/webview/vscode-api", () => ({
  vscode: {
    postMessage: mockPostMessage,
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

// UI behavior uses fixed fixtures so authored release notes and Guides can change freely.
vi.mock("../src/webview/whats-new-content", () => ({
  whatsNewContent: {
    articles: [{
      version: "1.2.0",
      title: "Fixture release title",
      description: "Fixture release description.",
      features: ["Fixture feature one", "Fixture feature two"],
      bugFixes: [],
      preview: true,
      markdown: '# Fixture article heading\n\nFixture article body.\n\n[Docs](https://example.test/docs)\n\n![Screenshot](media/fixtures/article.png)\n\n![Animation](media/fixtures/article.gif)',
    }],
    guides: [
      {
        id: "fixture-guide-one",
        title: "Fixture Guide One",
        description: "First fixture guide description.",
        url: "https://dev.to/huynguyen294/fixture-guide-one",
      },
      {
        id: "fixture-guide-two",
        title: "Fixture Guide Two",
        description: "Second fixture guide description.",
        url: "https://dev.to/huynguyen294/fixture-guide-two",
      },
    ],
  },
}));

import { WhatsNewApp } from "../src/webview/WhatsNewApp";
import { WhatsNewDocument } from "../src/webview/WhatsNewDocument";
import { whatsNewContent, type WhatsNewContent } from "../src/webview/whats-new-content";

describe("WhatsNewApp and WhatsNewDocument", () => {
  const mediaBaseUri = "https://file+.vscode-resource.vscode-cdn.net/ext/media/whats-new";

  afterEach(() => {
    mockPostMessage.mockClear();
    vi.doUnmock("../src/webview/whats-new-content");
    vi.resetModules();
  });

  // SSR (renderToStaticMarkup) verifies markup and version fallback for initialView;
  // it does not execute useEffect, so window listener setup and post-commit ACK are not tested here.
  it("renders the release list by default without article body or media and without posting effect messages during SSR", () => {
    const html = renderToStaticMarkup(<WhatsNewApp mediaBaseUri={mediaBaseUri} />);
    expect(mockPostMessage).not.toHaveBeenCalled();
    const previewArticle = whatsNewContent.articles[0]!;

    expect(html).toContain(">What&#x27;s New &amp; Guides</h1>");
    expect(html).toContain(">What&#x27;s New</button>");
    expect(html).toContain(">Guides</button>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('role="tab"');

    // Blog card metadata, collapsed Features accordion, and View more details CTA
    expect(html).toContain("v1.2.0");
    expect(html).toContain("Preview content");
    expect(html).toContain(previewArticle.title);
    expect(html).toContain(previewArticle.description);
    expect(html).toContain("Features");
    expect(html).toContain("(2)");
    for (const feature of previewArticle.features) {
      expect(html).toContain(feature);
    }
    expect(html).not.toContain("Bug fixes");
    expect(html).not.toMatch(/<details[^>]*\bopen\b/i);
    expect(html).toContain("View more details →");

    // List screen must not mount full Markdown body, article images, or back button
    expect(html).not.toContain("whats-new-document");
    expect(html).not.toContain("Fixture article body.");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("← All updates");
  });

  it("renders the selected article view with back button, release metadata, and media", () => {
    const html = renderToStaticMarkup(
      <WhatsNewApp initialView={{ kind: "article", version: "1.2.0" }} mediaBaseUri={mediaBaseUri} />,
    );

    expect(html).toContain('class="whats-new-tab-btn is-active" aria-pressed="true">What&#x27;s New</button>');
    expect(html).toContain('class="whats-new-tab-btn" aria-pressed="false">Guides</button>');
    expect(html).toContain(">← All updates</button>");
    expect(html).toContain("v1.2.0");
    expect(html).toContain("Preview content");
    expect(html).toContain("artifact-document whats-new-document");
    expect(html).toContain("<h1>Fixture article heading</h1>");
    expect(html).toContain("Fixture article body.");
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain(`src="${mediaBaseUri}/fixtures/article.png"`);
    expect(html).toContain(`src="${mediaBaseUri}/fixtures/article.gif"`);

    expect(html).not.toContain("View more details");
    expect(html).not.toContain("Proceed");
    expect(html).not.toContain("Just save");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-highlight");
    expect(html).not.toContain("code-block-shell");
  });

  it("falls back to media placeholders in article view when mediaBaseUri is omitted", () => {
    const html = renderToStaticMarkup(<WhatsNewApp initialView={{ kind: "article", version: "1.2.0" }} />);

    expect(html).toContain("Fixture article body.");
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).not.toContain("<img");
    expect(html).toContain("whats-new-image-placeholder");
  });

  it("renders guide cards without release cards or internal markdown when initialView is guides", () => {
    const html = renderToStaticMarkup(
      <WhatsNewApp initialView={{ kind: "guides" }} mediaBaseUri={mediaBaseUri} />,
    );
    const previewArticle = whatsNewContent.articles[0]!;
    const firstGuide = whatsNewContent.guides[0]!;
    const secondGuide = whatsNewContent.guides[1]!;

    expect(html).toContain('class="whats-new-tab-btn" aria-pressed="false">What&#x27;s New</button>');
    expect(html).toContain('class="whats-new-tab-btn is-active" aria-pressed="true">Guides</button>');
    expect(html).toContain(firstGuide.title);
    expect(html).toContain(firstGuide.description);
    expect(html.indexOf(secondGuide.title)).toBeGreaterThan(html.indexOf(firstGuide.title));
    expect(html).toContain("Read on dev.to ↗");

    expect(html).not.toContain(previewArticle.description);
    expect(html).not.toContain("View more details");
    expect(html).not.toContain("← All updates");
    expect(html).not.toContain("whats-new-document");
    expect(html).not.toContain("data-block-id");
  });

  it("preserves source order, filters empty-markdown entries, selects articles by version, and handles unknown versions", async () => {
    const fixtureContent: WhatsNewContent = {
      articles: [
        {
          version: "2.1.0",
          title: "Newer release headline",
          description: "Latest stable release notes.",
          features: ["Added workflow summary"],
          bugFixes: ["Fixed sync delay"],
          publishedAt: "2026-05-01",
          markdown: "# Release 2.1.0\n\nBody for release 2.1.0.",
        },
        {
          version: "2.0.5",
          title: "Metadata only release",
          description: "Should be filtered out because markdown is blank.",
          features: ["Hidden item"],
          bugFixes: [],
          markdown: "   \n\t ",
        },
        {
          version: "2.0.0",
          title: "Earlier milestone release",
          description: "Earlier preview release.",
          features: ["Initial milestone feature"],
          bugFixes: [],
          preview: true,
          markdown: "# Release 2.0.0\n\n![Milestone demo](media/samples/ai-artifacts.png)\n\nTarget body 2.0.0.",
        },
      ],
      guides: [
        {
          id: "sample-guide",
          title: "Sample Guide",
          description: "Sample guide description.",
          url: "https://dev.to/huynguyen294/sample-guide",
        },
      ],
    };

    vi.resetModules();
    vi.doMock("../src/webview/whats-new-content", () => ({
      whatsNewContent: fixtureContent,
    }));

    const { WhatsNewApp: MultiWhatsNewApp } = await import("../src/webview/WhatsNewApp");

    const listHtml = renderToStaticMarkup(<MultiWhatsNewApp mediaBaseUri={mediaBaseUri} />);
    expect(listHtml.indexOf("v2.1.0")).toBeGreaterThan(-1);
    expect(listHtml.indexOf("v2.0.0")).toBeGreaterThan(listHtml.indexOf("v2.1.0"));
    expect(listHtml).toContain("May 1, 2026");
    expect(listHtml).toContain("Bug fixes");
    expect(listHtml).toContain("Preview content");
    expect(listHtml).not.toContain("v2.0.5");
    expect(listHtml).not.toContain("Metadata only release");

    const secondArticleHtml = renderToStaticMarkup(
      <MultiWhatsNewApp initialView={{ kind: "article", version: "2.0.0" }} mediaBaseUri={mediaBaseUri} />,
    );
    expect(secondArticleHtml).toContain("Target body 2.0.0.");
    expect(secondArticleHtml).toContain(`src="${mediaBaseUri}/samples/ai-artifacts.png"`);
    expect(secondArticleHtml).toContain("v2.0.0");
    expect(secondArticleHtml).toContain("Preview content");
    expect(secondArticleHtml).not.toContain("Body for release 2.1.0.");

    const missingHtml = renderToStaticMarkup(
      <MultiWhatsNewApp initialView={{ kind: "article", version: "9.9.9" }} mediaBaseUri={mediaBaseUri} />,
    );
    expect(missingHtml).toContain("← All updates");
    expect(missingHtml).toContain("Release notes for version 9.9.9 were not found.");
    expect(missingHtml).not.toContain("Body for release 2.1.0.");

    const emptyBodyArticleHtml = renderToStaticMarkup(
      <MultiWhatsNewApp initialView={{ kind: "article", version: "2.0.5" }} mediaBaseUri={mediaBaseUri} />,
    );
    expect(emptyBodyArticleHtml).toContain("Release notes for version 2.0.5 were not found.");
  });

  it("renders safe empty list state with both tabs intact and still renders Guides when articles is empty", async () => {
    vi.resetModules();
    vi.doMock("../src/webview/whats-new-content", () => ({
      whatsNewContent: {
        articles: [],
        guides: [
          {
            id: "empty-articles-guide",
            title: "Sample Guide",
            description: "Helpful guide.",
            url: "https://dev.to/huynguyen294/sample-guide",
          },
        ],
      },
    }));

    const { WhatsNewApp: EmptyWhatsNewApp } = await import("../src/webview/WhatsNewApp");
    const listHtml = renderToStaticMarkup(<EmptyWhatsNewApp mediaBaseUri={mediaBaseUri} />);

    expect(listHtml).toContain("No updates to show yet.");
    expect(listHtml).toContain(">What&#x27;s New</button>");
    expect(listHtml).toContain(">Guides</button>");

    const guidesHtml = renderToStaticMarkup(
      <EmptyWhatsNewApp initialView={{ kind: "guides" }} mediaBaseUri={mediaBaseUri} />,
    );
    expect(guidesHtml).toContain("Sample Guide");
    expect(guidesHtml).toContain("Helpful guide.");
    expect(guidesHtml).toContain("Read on dev.to ↗");
  });

  it("renders safe empty state when guides is empty", async () => {
    vi.resetModules();
    vi.doMock("../src/webview/whats-new-content", () => ({
      whatsNewContent: {
        articles: [],
        guides: [],
      },
    }));

    const { WhatsNewApp: EmptyGuidesApp } = await import("../src/webview/WhatsNewApp");
    const guidesHtml = renderToStaticMarkup(
      <EmptyGuidesApp initialView={{ kind: "guides" }} mediaBaseUri={mediaBaseUri} />,
    );

    expect(guidesHtml).toContain("No guides to show yet.");
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
