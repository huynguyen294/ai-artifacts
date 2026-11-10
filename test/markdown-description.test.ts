import { describe, expect, it } from "vitest";
import {
  MAX_ARTIFACT_DESCRIPTION_LENGTH,
  extractMarkdownDescription,
} from "../src/shared/markdown-description";

describe("extractMarkdownDescription", () => {
  it("returns an empty string for empty or whitespace-only markdown", () => {
    expect(extractMarkdownDescription("")).toBe("");
    expect(extractMarkdownDescription("   \n\n\t  ")).toBe("");
  });

  it("extracts text from headings, paragraphs, and formatted inline elements", () => {
    const md = `
# Project Overview

This is an **important** paragraph with a [link to docs](https://example.com) and *italic* text.

Another line of content.
`;
    const desc = extractMarkdownDescription(md);
    expect(desc).toBe(
      "Project Overview This is an important paragraph with a link to docs and italic text. Another line of content.",
    );
  });

  it("handles lists and blockquotes cleanly without markdown markers", () => {
    const md = `
> This is a quote.

- Item 1
- Item 2
- Item 3 with [link](url)
`;
    const desc = extractMarkdownDescription(md);
    expect(desc).toBe("This is a quote. Item 1 Item 2 Item 3 with link");
  });

  it("extracts text from code blocks and strips HTML tags", () => {
    const md = `
<div class="alert">Warning message</div>

<!-- >>> USER CUSTOM RULES >>> -->
<!-- a > b and c < d -->

\`\`\`typescript
const greeting = "hello world";
\`\`\`
`;
    const desc = extractMarkdownDescription(md);
    expect(desc).toContain("Warning message");
    expect(desc).toContain("const greeting = \"hello world\";");
    expect(desc).not.toContain("<div");
    expect(desc).not.toContain("USER CUSTOM RULES");
    expect(desc).not.toContain("-->");
  });

  it("does not truncate or add ellipsis when content is within max length", () => {
    const md = "Short content that fits well within 200 characters limit.";
    const desc = extractMarkdownDescription(md);
    expect(desc).toBe("Short content that fits well within 200 characters limit.");
    expect(desc.endsWith("…")).toBe(false);
  });

  it("truncates at maxLength and appends '…' when content exceeds limit", () => {
    const longText = "a".repeat(150) + " " + "b".repeat(150);
    const desc = extractMarkdownDescription(longText, MAX_ARTIFACT_DESCRIPTION_LENGTH);

    expect(desc.length).toBeLessThanOrEqual(MAX_ARTIFACT_DESCRIPTION_LENGTH + 1);
    expect(desc.endsWith("…")).toBe(true);
    expect(desc.startsWith("a".repeat(150))).toBe(true);
  });

  it("respects a custom maxLength parameter", () => {
    const md = "Hello world from custom description length testing.";
    const desc = extractMarkdownDescription(md, 11);
    expect(desc).toBe("Hello world…");
  });
});

