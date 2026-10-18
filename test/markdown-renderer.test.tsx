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
});
