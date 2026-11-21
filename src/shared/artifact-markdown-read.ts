import { createHash } from "node:crypto";
import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export const READ_ARTIFACT_RANGE_MAX_LINES = 250;
export const READ_ARTIFACT_RANGE_MAX_BYTES = 16 * 1024;
export const READ_ARTIFACT_OUTLINE_MAX_HEADINGS = 200;
export const READ_ARTIFACT_OUTLINE_MAX_BYTES = 12 * 1024;
export const READ_ARTIFACT_SEARCH_DEFAULT_CONTEXT_LINES = 2;
export const READ_ARTIFACT_SEARCH_MAX_CONTEXT_LINES = 5;
export const READ_ARTIFACT_SEARCH_DEFAULT_MAX_MATCHES = 20;
export const READ_ARTIFACT_SEARCH_MAX_MATCHES = 50;
export const READ_ARTIFACT_SEARCH_MAX_BYTES = 16 * 1024;

export type ReadArtifactMode = "range" | "outline" | "search";

export type ArtifactMetadataFields = {
  artifactDirectory: string;
  artifactId: string;
  artifactPath: string;
  artifactSha256: string;
  reviewRound: number;
  lineCount: number;
  byteSize: number;
};

export type MarkdownMetrics = {
  artifactSha256: string;
  lineCount: number;
  byteSize: number;
};

export type ReadArtifactRangeOptions = {
  mode: "range";
  startLine?: number | undefined;
  endLine?: number | undefined;
  byteOffset?: number | undefined;
};

export type ReadArtifactOutlineOptions = {
  mode: "outline";
  maxDepth?: number | undefined;
};

export type ReadArtifactSearchOptions = {
  mode: "search";
  query: string;
  caseSensitive?: boolean | undefined;
  contextLines?: number | undefined;
  maxMatches?: number | undefined;
};

export type ReadArtifactOptions =
  | ReadArtifactRangeOptions
  | ReadArtifactOutlineOptions
  | ReadArtifactSearchOptions;

export type ReadArtifactRangeResult = ArtifactMetadataFields & {
  mode: "range";
  startLine: number;
  endLine: number;
  byteOffset: number;
  content: string;
  truncated: boolean;
  nextStartLine: number | null;
  nextByteOffset: number | null;
};

export type ReadArtifactOutlineHeading = {
  level: number;
  text: string;
  startLine: number;
  endLine: number;
  lineCount: number;
};

export type ReadArtifactOutlineResult = ArtifactMetadataFields & {
  mode: "outline";
  headings: ReadArtifactOutlineHeading[];
  truncated: boolean;
};

export type ReadArtifactSearchHunk = {
  startLine: number;
  endLine: number;
  matchedLines: number[];
  content: string;
};

export type ReadArtifactSearchResult = ArtifactMetadataFields & {
  mode: "search";
  query: string;
  totalMatches: number;
  truncated: boolean;
  hunks: ReadArtifactSearchHunk[];
};

export type ReadArtifactResult =
  | ReadArtifactRangeResult
  | ReadArtifactOutlineResult
  | ReadArtifactSearchResult;

export class ReadArtifactInputError extends Error {
  constructor(message: string) {
    super(message.startsWith("INVALID_ARTIFACT_INPUT:") ? message : `INVALID_ARTIFACT_INPUT: ${message}`);
    this.name = "ReadArtifactInputError";
  }
}

type RawLine = {
  text: string;
  raw: string;
};

/** Split text into lines while retaining exact line endings on each line without creating a trailing phantom line. */
export function splitRawLines(markdown: string): RawLine[] {
  if (markdown.length === 0) return [];
  const lines: RawLine[] = [];
  let lineStart = 0;
  for (let i = 0; i < markdown.length; i++) {
    const code = markdown.charCodeAt(i);
    if (code === 13) {
      const end = markdown.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      lines.push({
        text: markdown.slice(lineStart, i),
        raw: markdown.slice(lineStart, end),
      });
      if (end === i + 2) i += 1;
      lineStart = end;
    } else if (code === 10) {
      const end = i + 1;
      lines.push({
        text: markdown.slice(lineStart, i),
        raw: markdown.slice(lineStart, end),
      });
      lineStart = end;
    }
  }
  if (lineStart < markdown.length) {
    lines.push({
      text: markdown.slice(lineStart),
      raw: markdown.slice(lineStart),
    });
  }
  return lines;
}

/** Compute SHA-256, line count, and UTF-8 byte size from the exact same Markdown snapshot. */
export function computeMarkdownMetrics(markdown: string): MarkdownMetrics {
  return {
    artifactSha256: createHash("sha256").update(markdown).digest("hex"),
    lineCount: splitRawLines(markdown).length,
    byteSize: Buffer.byteLength(markdown, "utf8"),
  };
}

function serializedByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0b1100_0000) === 0b1000_0000;
}

function findMaxUtf8PrefixByteLength(
  buffer: Buffer,
  maxTakenBytes: number,
  fits: (prefixByteLength: number) => boolean,
): number {
  const maxSplit = Math.min(buffer.length - 1, maxTakenBytes);
  const boundaries: number[] = [];
  for (let i = 1; i <= maxSplit; i++) {
    if (!isUtf8ContinuationByte(buffer[i]!)) {
      boundaries.push(i);
    }
  }
  if (maxTakenBytes >= buffer.length && buffer.length > 0) {
    boundaries.push(buffer.length);
  }

  let lo = 0;
  let hi = boundaries.length - 1;
  let bestK = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidateK = boundaries[mid]!;
    if (fits(candidateK)) {
      bestK = candidateK;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestK;
}

function readRangeFromLines(
  lines: readonly RawLine[],
  metadata: ArtifactMetadataFields,
  options: ReadArtifactRangeOptions,
): ReadArtifactRangeResult {
  const startLine = options.startLine ?? 1;
  const byteOffset = options.byteOffset ?? 0;

  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new ReadArtifactInputError("startLine must be an integer >= 1.");
  }
  if (options.endLine !== undefined && (!Number.isInteger(options.endLine) || options.endLine < 1)) {
    throw new ReadArtifactInputError("endLine must be an integer >= 1.");
  }
  if (options.endLine !== undefined && options.endLine < startLine) {
    throw new ReadArtifactInputError("endLine must be >= startLine.");
  }
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new ReadArtifactInputError("byteOffset must be an integer >= 0.");
  }

  const buildPayload = (
    content: string,
    endLine: number,
    truncated: boolean,
    nextStartLine: number | null,
    nextByteOffset: number | null,
  ): ReadArtifactRangeResult => ({
    ...metadata,
    mode: "range",
    startLine,
    endLine,
    byteOffset,
    content,
    truncated,
    nextStartLine,
    nextByteOffset,
  });

  if (lines.length === 0) {
    if (startLine > 1 || byteOffset > 0) {
      throw new ReadArtifactInputError("startLine exceeds empty artifact.");
    }
    return buildPayload("", 0, false, null, null);
  }

  if (startLine > lines.length) {
    throw new ReadArtifactInputError(`startLine (${startLine}) exceeds artifact lineCount (${lines.length}).`);
  }

  const firstLineBytes = Buffer.from(lines[startLine - 1]!.raw, "utf8");
  if (byteOffset > 0) {
    if (byteOffset >= firstLineBytes.length) {
      throw new ReadArtifactInputError(
        `byteOffset (${byteOffset}) exceeds remaining bytes of line ${startLine} (${firstLineBytes.length}).`,
      );
    }
    if (isUtf8ContinuationByte(firstLineBytes[byteOffset]!)) {
      throw new ReadArtifactInputError(
        `byteOffset (${byteOffset}) does not align to a UTF-8 character boundary.`,
      );
    }
  }

  const effectiveEndLimit = options.endLine !== undefined ? Math.min(options.endLine, lines.length) : lines.length;
  const maxEndByLineCap = Math.min(effectiveEndLimit, startLine + READ_ARTIFACT_RANGE_MAX_LINES - 1);

  const firstSliceText =
    byteOffset === 0 ? lines[startLine - 1]!.raw : firstLineBytes.subarray(byteOffset).toString("utf8");

  const lineTexts: string[] = [];
  for (let lineNum = startLine; lineNum <= maxEndByLineCap; lineNum++) {
    lineTexts.push(lineNum === startLine ? firstSliceText : lines[lineNum - 1]!.raw);
  }

  const payloadForLineCount = (count: number): ReadArtifactRangeResult => {
    const endLine = startLine + count - 1;
    const truncated = endLine < effectiveEndLimit;
    const content = lineTexts.slice(0, count).join("");
    return buildPayload(
      content,
      endLine,
      truncated,
      truncated ? endLine + 1 : null,
      truncated ? 0 : null,
    );
  };

  // Try whole-line accumulation using incremental serialized length estimates, then verify exact serialized byte length.
  const lineJsonPayloadBytes = lineTexts.map((text) => Buffer.byteLength(JSON.stringify(text), "utf8") - 2);
  const emptyPayload = buildPayload("", startLine, true, startLine + 1, 0);
  const baseJsonBytes = serializedByteLength(emptyPayload);

  let candidateCount = 0;
  let runningContentJsonBytes = 0;
  for (let idx = 0; idx < lineTexts.length; idx++) {
    const nextContentBytes = runningContentJsonBytes + lineJsonPayloadBytes[idx]!;
    // Give a small margin (32 bytes) for digit differences between emptyPayload and real cursor fields, then check exact.
    if (baseJsonBytes + nextContentBytes - 32 > READ_ARTIFACT_RANGE_MAX_BYTES) {
      break;
    }
    runningContentJsonBytes = nextContentBytes;
    candidateCount = idx + 1;
  }

  while (candidateCount > 0) {
    const candidate = payloadForLineCount(candidateCount);
    if (serializedByteLength(candidate) <= READ_ARTIFACT_RANGE_MAX_BYTES) {
      return candidate;
    }
    candidateCount -= 1;
  }

  // Even the single first line (from byteOffset) exceeded the byte cap: split at a valid UTF-8 boundary.
  const remainingBytes = byteOffset === 0 ? firstLineBytes : firstLineBytes.subarray(byteOffset);
  const buildSplitPayload = (takenByteLength: number): ReadArtifactRangeResult => {
    const content = remainingBytes.subarray(0, takenByteLength).toString("utf8");
    return buildPayload(content, startLine, true, startLine, byteOffset + takenByteLength);
  };

  const bestK = findMaxUtf8PrefixByteLength(
    remainingBytes,
    Math.min(remainingBytes.length - 1, READ_ARTIFACT_RANGE_MAX_BYTES),
    (candidateK) => serializedByteLength(buildSplitPayload(candidateK)) <= READ_ARTIFACT_RANGE_MAX_BYTES,
  );

  if (bestK <= 0) {
    throw new Error("Artifact range metadata exceeds READ_ARTIFACT_RANGE_MAX_BYTES cap.");
  }

  return buildSplitPayload(bestK);
}

function findLeadingYamlFrontmatterEndLine(lines: readonly RawLine[]): number {
  if (lines.length < 2) return -1;
  const firstLine = lines[0]!.text.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*$/.test(firstLine)) return -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i]!.text)) {
      return i;
    }
  }
  return -1;
}

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readOutlineFromLines(
  lines: readonly RawLine[],
  metadata: ArtifactMetadataFields,
  options: ReadArtifactOutlineOptions,
): ReadArtifactOutlineResult {
  const maxDepth = options.maxDepth ?? 6;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 6) {
    throw new ReadArtifactInputError("maxDepth must be an integer between 1 and 6.");
  }

  const frontmatterEndIdx = findLeadingYamlFrontmatterEndLine(lines);
  const parseInput = lines
    .map((line, index) => {
      if (index <= frontmatterEndIdx) return "";
      return index === 0 ? line.text.replace(/^\uFEFF/, "") : line.text;
    })
    .join("\n");

  const tree = unified().use(remarkParse).use(remarkGfm).parse(parseInput) as Root;

  const rawHeadings: Array<{ level: number; text: string; startLine: number }> = [];
  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    const heading = node as Heading;
    const startLine = heading.position?.start.line;
    if (startLine === undefined) continue;
    rawHeadings.push({
      level: heading.depth,
      text: normalizeHeadingText(toString(heading)),
      startLine,
    });
  }

  const totalLineCount = lines.length;
  const allHeadings: ReadArtifactOutlineHeading[] = rawHeadings.map((item, idx) => {
    let endLine = totalLineCount;
    for (let nextIdx = idx + 1; nextIdx < rawHeadings.length; nextIdx++) {
      if (rawHeadings[nextIdx]!.level <= item.level) {
        endLine = rawHeadings[nextIdx]!.startLine - 1;
        break;
      }
    }
    const clampedEnd = Math.max(item.startLine, endLine);
    return {
      level: item.level,
      text: item.text,
      startLine: item.startLine,
      endLine: clampedEnd,
      lineCount: clampedEnd - item.startLine + 1,
    };
  });

  const filtered = allHeadings.filter((heading) => heading.level <= maxDepth);
  const cappedByCount = filtered.slice(0, READ_ARTIFACT_OUTLINE_MAX_HEADINGS);
  const truncatedByCount = filtered.length > READ_ARTIFACT_OUTLINE_MAX_HEADINGS;

  const buildPayload = (
    headings: ReadArtifactOutlineHeading[],
    truncated: boolean,
  ): ReadArtifactOutlineResult => ({
    ...metadata,
    mode: "outline",
    headings,
    truncated,
  });

  const initialPayload = buildPayload(cappedByCount, truncatedByCount);
  if (serializedByteLength(initialPayload) <= READ_ARTIFACT_OUTLINE_MAX_BYTES) {
    return initialPayload;
  }

  let lo = 0;
  let hi = cappedByCount.length;
  let bestCount = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = buildPayload(cappedByCount.slice(0, mid), true);
    if (serializedByteLength(candidate) <= READ_ARTIFACT_OUTLINE_MAX_BYTES) {
      bestCount = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return buildPayload(cappedByCount.slice(0, bestCount), true);
}

function sliceUtf8ToSerializedBudget(
  rawText: string,
  buildWithContent: (content: string) => unknown,
  maxBytes: number,
): string {
  const buf = Buffer.from(rawText, "utf8");
  const bestK = findMaxUtf8PrefixByteLength(
    buf,
    Math.min(buf.length, maxBytes),
    (candidateK) => serializedByteLength(buildWithContent(buf.subarray(0, candidateK).toString("utf8"))) <= maxBytes,
  );
  return buf.subarray(0, bestK).toString("utf8");
}

function readSearchFromLines(
  lines: readonly RawLine[],
  metadata: ArtifactMetadataFields,
  options: ReadArtifactSearchOptions,
): ReadArtifactSearchResult {
  const query = options.query;
  const caseSensitive = options.caseSensitive ?? false;
  const contextLines = options.contextLines ?? READ_ARTIFACT_SEARCH_DEFAULT_CONTEXT_LINES;
  const maxMatches = options.maxMatches ?? READ_ARTIFACT_SEARCH_DEFAULT_MAX_MATCHES;

  if (typeof query !== "string" || query.length < 1) {
    throw new ReadArtifactInputError("query must be a string with length >= 1.");
  }
  if (typeof caseSensitive !== "boolean") {
    throw new ReadArtifactInputError("caseSensitive must be a boolean.");
  }
  if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > READ_ARTIFACT_SEARCH_MAX_CONTEXT_LINES) {
    throw new ReadArtifactInputError(
      `contextLines must be an integer between 0 and ${READ_ARTIFACT_SEARCH_MAX_CONTEXT_LINES}.`,
    );
  }
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > READ_ARTIFACT_SEARCH_MAX_MATCHES) {
    throw new ReadArtifactInputError(
      `maxMatches must be an integer between 1 and ${READ_ARTIFACT_SEARCH_MAX_MATCHES}.`,
    );
  }

  const needle = caseSensitive ? query : query.toLowerCase();
  const allMatchedLines: number[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const haystack = caseSensitive ? lines[idx]!.text : lines[idx]!.text.toLowerCase();
    if (haystack.includes(needle)) {
      allMatchedLines.push(idx + 1);
    }
  }

  const totalMatches = allMatchedLines.length;
  const selectedMatches = allMatchedLines.slice(0, maxMatches);
  const truncatedByMaxMatches = totalMatches > maxMatches;

  type HunkRange = { startLine: number; endLine: number; matchedLines: number[] };
  const hunkRanges: HunkRange[] = [];
  for (const matchLine of selectedMatches) {
    const winStart = Math.max(1, matchLine - contextLines);
    const winEnd = Math.min(lines.length, matchLine + contextLines);
    const previous = hunkRanges.at(-1);
    if (previous && winStart <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, winEnd);
      previous.matchedLines.push(matchLine);
    } else {
      hunkRanges.push({
        startLine: winStart,
        endLine: winEnd,
        matchedLines: [matchLine],
      });
    }
  }

  const allHunks: ReadArtifactSearchHunk[] = hunkRanges.map((range) => ({
    startLine: range.startLine,
    endLine: range.endLine,
    matchedLines: range.matchedLines,
    content: lines
      .slice(range.startLine - 1, range.endLine)
      .map((line) => line.raw)
      .join(""),
  }));

  const buildPayload = (hunks: ReadArtifactSearchHunk[], truncated: boolean): ReadArtifactSearchResult => ({
    ...metadata,
    mode: "search",
    query,
    totalMatches,
    truncated,
    hunks,
  });

  const initialPayload = buildPayload(allHunks, truncatedByMaxMatches);
  if (serializedByteLength(initialPayload) <= READ_ARTIFACT_SEARCH_MAX_BYTES) {
    return initialPayload;
  }

  let lo = 1;
  let hi = allHunks.length;
  let bestCount = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = buildPayload(allHunks.slice(0, mid), true);
    if (serializedByteLength(candidate) <= READ_ARTIFACT_SEARCH_MAX_BYTES) {
      bestCount = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (bestCount >= 1) {
    return buildPayload(allHunks.slice(0, bestCount), true);
  }

  // Even the first hunk alone exceeded the output byte cap: narrow around the first matched line.
  const firstHunk = allHunks[0]!;
  const anchorLine = firstHunk.matchedLines[0]!;
  const singleLineHunk: ReadArtifactSearchHunk = {
    startLine: anchorLine,
    endLine: anchorLine,
    matchedLines: [anchorLine],
    content: lines[anchorLine - 1]!.raw,
  };
  const singleLinePayload = buildPayload([singleLineHunk], true);
  if (serializedByteLength(singleLinePayload) <= READ_ARTIFACT_SEARCH_MAX_BYTES) {
    return singleLinePayload;
  }

  const trimmedContent = sliceUtf8ToSerializedBudget(
    lines[anchorLine - 1]!.raw,
    (content) =>
      buildPayload(
        [
          {
            startLine: anchorLine,
            endLine: anchorLine,
            matchedLines: [anchorLine],
            content,
          },
        ],
        true,
      ),
    READ_ARTIFACT_SEARCH_MAX_BYTES,
  );
  return buildPayload(
    [
      {
        startLine: anchorLine,
        endLine: anchorLine,
        matchedLines: [anchorLine],
        content: trimmedContent,
      },
    ],
    true,
  );
}

/**
 * Pure read-only Markdown reader supporting range pagination, AST outline, and literal search
 * against a pre-validated artifact snapshot.
 */
export function readArtifactMarkdown(
  markdown: string,
  metadata: ArtifactMetadataFields,
  options: ReadArtifactOptions,
): ReadArtifactResult {
  const lines = splitRawLines(markdown);
  if (options.mode === "range") {
    return readRangeFromLines(lines, metadata, options);
  }
  if (options.mode === "outline") {
    return readOutlineFromLines(lines, metadata, options);
  }
  if (options.mode === "search") {
    return readSearchFromLines(lines, metadata, options);
  }
  throw new ReadArtifactInputError(`unsupported mode '${String((options as { mode?: unknown }).mode)}'.`);
}
