import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  READ_ARTIFACT_OUTLINE_MAX_BYTES,
  READ_ARTIFACT_OUTLINE_MAX_HEADINGS,
  READ_ARTIFACT_RANGE_MAX_BYTES,
  READ_ARTIFACT_RANGE_MAX_LINES,
  READ_ARTIFACT_SEARCH_MAX_BYTES,
  ReadArtifactInputError,
  computeMarkdownMetrics,
  readArtifactMarkdown,
  splitRawLines,
  type ArtifactMetadataFields,
} from "../src/shared/artifact-markdown-read";

function makeMetadata(markdown: string, reviewRound = 1): ArtifactMetadataFields {
  const metrics = computeMarkdownMetrics(markdown);
  return {
    artifactDirectory: "C:/Users/Test/.ai-artifacts/artifacts/sample-artifact-20261121-12345678",
    artifactId: "sample-artifact-20261121-12345678",
    artifactPath: "C:/Users/Test/.ai-artifacts/artifacts/sample-artifact-20261121-12345678/artifact.md",
    artifactSha256: metrics.artifactSha256,
    reviewRound,
    lineCount: metrics.lineCount,
    byteSize: metrics.byteSize,
  };
}

function readAllRangePages(markdown: string, metadata = makeMetadata(markdown)): {
  reassembled: string;
  pageCount: number;
} {
  let startLine = 1;
  let byteOffset = 0;
  let reassembled = "";
  let pageCount = 0;

  while (true) {
    const page = readArtifactMarkdown(markdown, metadata, {
      mode: "range",
      startLine,
      byteOffset,
    });
    expect(page.mode).toBe("range");
    if (page.mode !== "range") throw new Error("unreachable");

    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(READ_ARTIFACT_RANGE_MAX_BYTES);
    expect(page.artifactSha256).toBe(metadata.artifactSha256);
    expect(page.reviewRound).toBe(metadata.reviewRound);
    expect(page.lineCount).toBe(metadata.lineCount);
    expect(page.byteSize).toBe(metadata.byteSize);

    reassembled += page.content;
    pageCount += 1;

    if (!page.truncated) {
      expect(page.nextStartLine).toBeNull();
      expect(page.nextByteOffset).toBeNull();
      break;
    }

    expect(page.nextStartLine).not.toBeNull();
    expect(page.nextByteOffset).not.toBeNull();
    const movedForward =
      page.nextStartLine! > startLine ||
      (page.nextStartLine === startLine && page.nextByteOffset! > byteOffset);
    expect(movedForward).toBe(true);

    startLine = page.nextStartLine!;
    byteOffset = page.nextByteOffset!;
  }

  return { reassembled, pageCount };
}

describe("artifact-markdown-read core reader", () => {
  it("computes lineCount without creating a phantom trailing line and matches UTF-8 byteSize/SHA", () => {
    expect(splitRawLines("")).toEqual([]);
    expect(computeMarkdownMetrics("")).toEqual({
      artifactSha256: createHash("sha256").update("").digest("hex"),
      lineCount: 0,
      byteSize: 0,
    });

    expect(computeMarkdownMetrics("# A\n").lineCount).toBe(1);
    expect(computeMarkdownMetrics("# A\r\n").lineCount).toBe(1);
    expect(computeMarkdownMetrics("# A").lineCount).toBe(1);
    expect(computeMarkdownMetrics("# A\n\n").lineCount).toBe(2);

    const mixed = "# Tiếng Việt 🚀\r\nDòng 2\nDòng 3\r\n";
    const metrics = computeMarkdownMetrics(mixed);
    expect(metrics.lineCount).toBe(3);
    expect(metrics.byteSize).toBe(Buffer.byteLength(mixed, "utf8"));
    expect(metrics.artifactSha256).toBe(createHash("sha256").update(mixed).digest("hex"));
  });

  it("reassembles mixed CRLF/LF, single lines > 16 KiB, multi-byte UTF-8 boundaries, and heavy JSON escapes byte-for-byte", () => {
    const emojiLine = `${"🚀TiếngViệt".repeat(1500)}`; // > 25 KB single line with 3-byte & 4-byte UTF-8 chars
    const escapedLine = `${'\\"\\'.repeat(6000)}`; // heavy backslash + quote JSON escaping
    const normalLines = Array.from({ length: 260 }, (_, idx) => `Line ${idx + 1}: giá trị ${idx}`).join("\r\n");

    for (const doc of [
      `${emojiLine}\r\n${escapedLine}\n${normalLines}\r\n`,
      `${emojiLine}\n${escapedLine}`, // no trailing newline
      `${Array.from({ length: 300 }, (_, i) => `row-${i + 1}`).join("\n")}\n`, // > 250 lines
    ]) {
      const metadata = makeMetadata(doc);
      const { reassembled, pageCount } = readAllRangePages(doc, metadata);
      expect(pageCount).toBeGreaterThan(1);
      expect(reassembled).toBe(doc);
      expect(createHash("sha256").update(reassembled).digest("hex")).toBe(metadata.artifactSha256);
    }
  });

  it("respects 250-line cap, explicit endLine bounds, and rejects invalid range inputs", () => {
    const lines = Array.from({ length: 300 }, (_, idx) => `L${idx + 1}`).join("\n");
    const metadata = makeMetadata(lines);

    const capped = readArtifactMarkdown(lines, metadata, { mode: "range" });
    expect(capped.mode).toBe("range");
    if (capped.mode === "range") {
      expect(capped.startLine).toBe(1);
      expect(capped.endLine).toBe(READ_ARTIFACT_RANGE_MAX_LINES);
      expect(capped.truncated).toBe(true);
      expect(capped.nextStartLine).toBe(READ_ARTIFACT_RANGE_MAX_LINES + 1);
      expect(capped.nextByteOffset).toBe(0);
    }

    const bounded = readArtifactMarkdown(lines, metadata, { mode: "range", startLine: 295, endLine: 500 });
    expect(bounded.mode).toBe("range");
    if (bounded.mode === "range") {
      expect(bounded.endLine).toBe(300);
      expect(bounded.truncated).toBe(false);
      expect(bounded.nextStartLine).toBeNull();
      expect(bounded.nextByteOffset).toBeNull();
      expect(bounded.content).toBe("L295\nL296\nL297\nL298\nL299\nL300");
    }

    expect(() =>
      readArtifactMarkdown("a\nb", makeMetadata("a\nb"), { mode: "range", startLine: 3 }),
    ).toThrow(ReadArtifactInputError);
    expect(() =>
      readArtifactMarkdown("a\nb", makeMetadata("a\nb"), { mode: "range", startLine: 2, endLine: 1 }),
    ).toThrow(ReadArtifactInputError);

    // Mid-UTF-8 continuation byte offset must be rejected
    const utf8Doc = "Tiếng\n";
    expect(() =>
      readArtifactMarkdown(utf8Doc, makeMetadata(utf8Doc), { mode: "range", startLine: 1, byteOffset: 3 }),
    ).toThrow(ReadArtifactInputError);
  });

  it("extracts outline via remark while skipping YAML frontmatter and fenced code blocks and preserving original lines", () => {
    const doc = [
      "---",
      "title: Example",
      "# Not a heading inside YAML",
      "---",
      "",
      "# Section One",
      "Intro",
      "",
      "````markdown",
      "# Fake Heading Inside 4-backtick fence",
      "````",
      "",
      "~~~",
      "## Fake Heading Inside tilde fence",
      "~~~",
      "",
      "## Subsection A",
      "Detail",
      "### Deep Note",
      "Sub-detail",
      "## Subsection B",
      "End A",
      "# Section Two",
      "Final",
    ].join("\n");

    const metadata = makeMetadata(doc);
    const fullOutline = readArtifactMarkdown(doc, metadata, { mode: "outline" });
    expect(fullOutline.mode).toBe("outline");
    if (fullOutline.mode === "outline") {
      expect(fullOutline.truncated).toBe(false);
      expect(fullOutline.headings).toEqual([
        { level: 1, text: "Section One", startLine: 6, endLine: 22, lineCount: 17 },
        { level: 2, text: "Subsection A", startLine: 17, endLine: 20, lineCount: 4 },
        { level: 3, text: "Deep Note", startLine: 19, endLine: 20, lineCount: 2 },
        { level: 2, text: "Subsection B", startLine: 21, endLine: 22, lineCount: 2 },
        { level: 1, text: "Section Two", startLine: 23, endLine: 24, lineCount: 2 },
      ]);
    }

    const depth2 = readArtifactMarkdown(doc, metadata, { mode: "outline", maxDepth: 2 });
    expect(depth2.mode).toBe("outline");
    if (depth2.mode === "outline") {
      expect(depth2.headings.map((h) => h.text)).toEqual([
        "Section One",
        "Subsection A",
        "Subsection B",
        "Section Two",
      ]);
      // Subsection A still ends at line 20 (right before Subsection B at line 21)
      expect(depth2.headings[1]).toEqual({
        level: 2,
        text: "Subsection A",
        startLine: 17,
        endLine: 20,
        lineCount: 4,
      });
    }
  });

  it("enforces outline 200-heading and 12 KiB caps (whichever hits first) with escape-heavy headings", () => {
    const manyHeadings = Array.from({ length: 220 }, (_, idx) => `# Heading ${idx + 1}`).join("\n");
    const countCapped = readArtifactMarkdown(manyHeadings, makeMetadata(manyHeadings), { mode: "outline" });
    expect(countCapped.mode).toBe("outline");
    if (countCapped.mode === "outline") {
      expect(countCapped.headings.length).toBeGreaterThan(0);
      expect(countCapped.headings.length).toBeLessThanOrEqual(READ_ARTIFACT_OUTLINE_MAX_HEADINGS);
      expect(countCapped.headings.length).toBeLessThan(220);
      expect(countCapped.truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(countCapped), "utf8")).toBeLessThanOrEqual(READ_ARTIFACT_OUTLINE_MAX_BYTES);
    }

    const escapeHeadings = Array.from(
      { length: 80 },
      (_, idx) => `# ${'\\"\\'.repeat(80)} H${idx + 1}`,
    ).join("\n");
    const byteCapped = readArtifactMarkdown(escapeHeadings, makeMetadata(escapeHeadings), { mode: "outline" });
    expect(byteCapped.mode).toBe("outline");
    if (byteCapped.mode === "outline") {
      expect(byteCapped.truncated).toBe(true);
      expect(byteCapped.headings.length).toBeGreaterThan(0);
      expect(byteCapped.headings.length).toBeLessThan(80);
      expect(Buffer.byteLength(JSON.stringify(byteCapped), "utf8")).toBeLessThanOrEqual(READ_ARTIFACT_OUTLINE_MAX_BYTES);
    }
  });

  it("performs literal-only search, merges overlapping hunks, tracks totalMatches, and enforces 16 KiB cap", () => {
    const doc = [
      "line 1 alpha",
      "line 2 [foo].*bar? match",
      "line 3 gap",
      "line 4 [FOO].*BAR? match",
      "line 5 tail",
      "line 6 separate",
      "line 7 separate",
      "line 8 [foo].*bar? third",
      "line 9 end",
    ].join("\r\n");

    const metadata = makeMetadata(doc);
    const insensitive = readArtifactMarkdown(doc, metadata, {
      mode: "search",
      query: "[foo].*bar?",
      caseSensitive: false,
      contextLines: 1,
      maxMatches: 2,
    });
    expect(insensitive.mode).toBe("search");
    if (insensitive.mode === "search") {
      expect(insensitive.totalMatches).toBe(3);
      expect(insensitive.truncated).toBe(true);
      expect(insensitive.hunks).toEqual([
        {
          startLine: 1,
          endLine: 5,
          matchedLines: [2, 4],
          content: "line 1 alpha\r\nline 2 [foo].*bar? match\r\nline 3 gap\r\nline 4 [FOO].*BAR? match\r\nline 5 tail\r\n",
        },
      ]);
    }

    const sensitive = readArtifactMarkdown(doc, metadata, {
      mode: "search",
      query: "[FOO].*BAR?",
      caseSensitive: true,
      contextLines: 0,
    });
    expect(sensitive.mode).toBe("search");
    if (sensitive.mode === "search") {
      expect(sensitive.totalMatches).toBe(1);
      expect(sensitive.truncated).toBe(false);
      expect(sensitive.hunks).toEqual([
        {
          startLine: 4,
          endLine: 4,
          matchedLines: [4],
          content: "line 4 [FOO].*BAR? match\r\n",
        },
      ]);
    }

    const heavySearchDoc = Array.from(
      { length: 20 },
      (_, idx) => `MATCH_${idx}_${'\\"\\'.repeat(800)}\nseparator\nseparator\nseparator`,
    ).join("\n");
    const heavyRes = readArtifactMarkdown(heavySearchDoc, makeMetadata(heavySearchDoc), {
      mode: "search",
      query: "MATCH_",
      contextLines: 1,
      maxMatches: 20,
    });
    expect(heavyRes.mode).toBe("search");
    if (heavyRes.mode === "search") {
      expect(heavyRes.totalMatches).toBe(20);
      expect(heavyRes.truncated).toBe(true);
      expect(heavyRes.hunks.length).toBeGreaterThan(0);
      expect(heavyRes.hunks.length).toBeLessThan(20);
      expect(Buffer.byteLength(JSON.stringify(heavyRes), "utf8")).toBeLessThanOrEqual(READ_ARTIFACT_SEARCH_MAX_BYTES);
    }

    // Single >16 KiB matching line still stays within 16 KiB serialized cap
    const hugeSingleLine = `NEEDLE_${"x".repeat(25_000)}`;
    const hugeRes = readArtifactMarkdown(hugeSingleLine, makeMetadata(hugeSingleLine), {
      mode: "search",
      query: "NEEDLE_",
    });
    expect(hugeRes.mode).toBe("search");
    if (hugeRes.mode === "search") {
      expect(hugeRes.totalMatches).toBe(1);
      expect(hugeRes.truncated).toBe(true);
      expect(hugeRes.hunks).toHaveLength(1);
      expect(hugeRes.hunks[0]!.content).toContain("NEEDLE_");
      expect(Buffer.byteLength(JSON.stringify(hugeRes), "utf8")).toBeLessThanOrEqual(READ_ARTIFACT_SEARCH_MAX_BYTES);
    }
  });
});
