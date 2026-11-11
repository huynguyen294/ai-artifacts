import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";
import {
  ARTIFACT_ROOT_BLOCK_ID,
  ARTIFACT_ROOT_BLOCK_TYPE,
  ARTIFACT_ROOT_TEXT,
  type ReviewComment,
} from "../src/shared/contracts";
import { MarkdownRenderer } from "../src/webview/MarkdownRenderer";

vi.mock("../src/webview/vscode-api", () => ({ vscode: { postMessage: vi.fn() } }));

describe("MarkdownRenderer", () => {
  it("preserves inline Markdown while applying a block-bound comment highlight", () => {
    const markdown = "# Plan\n\nUse **strong** text and [docs](https://example.com).";
    const blocks = parseMarkdownBlocks(markdown);
    const paragraph = blocks.find((block) => block.type === "paragraph")!;
    const comment: ReviewComment = {
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: "2026-08-29T00:00:00.000Z",
      block: { id: paragraph.id, type: paragraph.type, heading: paragraph.heading },
      selection: { quote: "strong", start: 4, end: 10, prefix: "Use ", suffix: " text" },
      body: "Explain this.",
    };
    const commentsByBlock = new Map([[paragraph.id, [comment]]]);
    const html = renderToStaticMarkup(
      <MarkdownRenderer markdown={markdown} blocks={blocks} commentsByBlock={commentsByBlock} onCommentClick={() => {}} />,
    );

    expect(html).toContain(`data-block-id="${paragraph.id}"`);
    expect(html).toContain("<strong><mark");
    expect(html).toContain(">strong</mark></strong>");
    expect(html).toContain("href=\"https://example.com\"");
  });

  it("does not render raw HTML from an artifact", () => {
    const markdown = "Before <script>alert(1)</script> after.";
    const html = renderToStaticMarkup(
      <MarkdownRenderer markdown={markdown} blocks={parseMarkdownBlocks(markdown)} commentsByBlock={new Map()} onCommentClick={() => {}} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("Before alert(1) after.");
  });

  it("never renders an inline highlight for artifact-wide feedback", () => {
    const markdown = "# Plan\n\nReview the entire artifact.";
    const blocks = parseMarkdownBlocks(markdown);
    const paragraph = blocks.find((block) => block.type === "paragraph")!;
    const comment: ReviewComment = {
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-10-16T00:00:00.000Z",
      block: {
        id: ARTIFACT_ROOT_BLOCK_ID,
        type: ARTIFACT_ROOT_BLOCK_TYPE,
        heading: null,
      },
      selection: {
        quote: ARTIFACT_ROOT_TEXT,
        start: 0,
        end: ARTIFACT_ROOT_TEXT.length,
        prefix: "",
        suffix: "",
      },
      body: "Keep the direction consistent.",
    };
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        markdown={markdown}
        blocks={blocks}
        commentsByBlock={new Map([[paragraph.id, [comment]]])}
        onCommentClick={() => {}}
      />,
    );

    expect(html).toContain("Review the entire artifact.");
    expect(html).not.toContain("<mark");
    expect(html).not.toContain("data-comment-ids");
  });

  it("keeps review-mode images as placeholders and skipHtml enabled by default", () => {
    const markdown = "![Local](media/samples/ai-artifacts.png)\n\n![Remote](https://example.com/a.png)";
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        markdown={markdown}
        blocks={parseMarkdownBlocks(markdown)}
        commentsByBlock={new Map()}
        onCommentClick={() => {}}
      />,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("remote-image-placeholder");
    expect(html).toContain("[Local]");
    expect(html).toContain("[Remote]");
  });

  it("renders standard markdown, code fences, packaged images, placeholders, and safe links in content mode", () => {
    const baseUri = "https://file+.vscode-resource.vscode-cdn.net/ext/media/whats-new";
    const markdown = [
      "# Update Title",
      "",
      "Paragraph with **bold**, [docs](https://example.com/docs), and [bad local](media/samples/ai-artifacts.png).",
      "",
      "- Item one",
      "",
      "1. Step one",
      "",
      "| Col A | Col B |",
      "| --- | --- |",
      "| Val 1 | Val 2 |",
      "",
      "```ts",
      "const ready = true;",
      "```",
      "",
      '![Sample PNG](media/samples/ai-artifacts.png "PNG Caption")',
      "",
      "![Sample GIF](media/samples/inline-feedback.gif)",
      "",
      "[![Linked PNG](media/samples/ai-artifacts.png)](https://example.com/linked)",
      "",
      "![Blocked remote](https://example.com/remote.png)",
      "",
      "![Blocked traversal](media/../secret.png)",
      "",
      "<script>alert(1)</script><video src=\"clip.mp4\"></video>",
    ].join("\n");

    const html = renderToStaticMarkup(
      <MarkdownRenderer mode="content" markdown={markdown} mediaBaseUri={baseUri} />,
    );

    // Headings, lists, table, native pre/code without review annotations or ReviewCode chrome
    expect(html).toContain("<h1>Update Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre><code class=\"language-ts\">const ready = true;");
    expect(html).not.toContain("data-block-id");
    expect(html).not.toContain("review-block");
    expect(html).not.toContain("code-block-shell");
    expect(html).not.toContain("<mark");

    // Packaged images & linked image resolve beneath mediaBaseUri
    expect(html).toContain(
      `src="${baseUri}/samples/ai-artifacts.png" alt="Sample PNG" title="PNG Caption"`,
    );
    expect(html).toContain(`src="${baseUri}/samples/inline-feedback.gif" alt="Sample GIF"`);
    expect(html).toContain(
      `<a href="https://example.com/linked" rel="noreferrer"><img src="${baseUri}/samples/ai-artifacts.png" alt="Linked PNG"/></a>`,
    );

    // External HTTPS href allowed, relative href in <a> still stripped by safeArtifactUrl
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).not.toContain('href="media/samples/ai-artifacts.png"');

    // Disallowed image sources become placeholders instead of <img>, and raw HTML is skipped
    expect(html).not.toContain("https://example.com/remote.png");
    expect(html).not.toContain("secret.png");
    expect(html).toContain('class="whats-new-image-placeholder"');
    expect(html).toContain("[Blocked remote]");
    expect(html).toContain("[Blocked traversal]");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<video");
  });

  it("renders placeholders when mediaBaseUri is empty in content mode", () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer
        mode="content"
        markdown={"# Title\n\n![Preview](media/samples/ai-artifacts.png)\n\nSee [repo](https://example.com)."}
        mediaBaseUri=""
      />,
    );

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("<img");
    expect(html).toContain('class="whats-new-image-placeholder"');
    expect(html).toContain("[Preview]");
  });
});
