import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";

describe("parseMarkdownBlocks", () => {
  it("creates selectable blocks for supported Markdown", () => {
    const blocks = parseMarkdownBlocks(`# Plan

First line
continues here.

- One item

> A note

\`\`\`ts
const value = 1;
\`\`\``);
    expect(blocks.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "heading", text: "Plan" },
      { type: "paragraph", text: "First line continues here." },
      { type: "list-item", text: "One item" },
      { type: "quote", text: "A note" },
      { type: "code", text: "const value = 1;" },
    ]);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
    expect(blocks.every((block) => block.sourceEnd > block.sourceStart)).toBe(true);
    const legacySources = ["# Plan", "First line\ncontinues here.", "- One item", "> A note", "```ts\nconst value = 1;\n```"];
    expect(blocks.map((block, index) => block.id)).toEqual(blocks.map((block, index) => {
      const digest = createHash("sha256").update(`${block.type}\0${index}\0${legacySources[index]}`).digest("hex").slice(0, 12);
      return `block-${index}-${digest}`;
    }));
  });

  it("uses visible text while preserving source positions for GFM structures", () => {
    const markdown = `## Details\n\nUse **strong** text and [a link](https://example.com).\n\n| Name | Done |\n| --- | --- |\n| Parser | yes |\n\n- Parent\n  - Nested`;
    const blocks = parseMarkdownBlocks(markdown);

    expect(blocks.map(({ type, text }) => ({ type, text }))).toEqual([
      { type: "heading", text: "Details" },
      { type: "paragraph", text: "Use strong text and a link." },
      { type: "table-cell", text: "Name" },
      { type: "table-cell", text: "Done" },
      { type: "table-cell", text: "Parser" },
      { type: "table-cell", text: "yes" },
      { type: "list-item", text: "Parent" },
      { type: "list-item", text: "Nested" },
    ]);
    expect(markdown.slice(blocks[1]!.sourceStart, blocks[1]!.sourceEnd)).toContain("**strong**");
    const nested = blocks.at(-1)!;
    const legacyNestedDigest = createHash("sha256").update(`list-item\0${4}\0  - Nested`).digest("hex").slice(0, 12);
    expect(nested.id).toBe(`block-4-${legacyNestedDigest}`);
  });
});
