import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";
import type { ReviewComment } from "../src/shared/contracts";
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
});
