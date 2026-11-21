import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { splitRawLines } from "./artifact-markdown-read";
import { MAX_MARKDOWN_BYTES } from "./contracts";

export type ArtifactWriteErrorCode =
  | "INVALID_ARTIFACT_INPUT"
  | "SOURCE_FILE_UNREADABLE"
  | "EDIT_TARGET_NOT_FOUND"
  | "EDIT_TARGET_AMBIGUOUS"
  | "EDIT_TARGET_OVERLAP";

export type ArtifactMarkdownEdit = {
  oldText: string;
  newText: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  replaceAll?: boolean | undefined;
};

export class ArtifactWriteError extends Error {
  readonly code: ArtifactWriteErrorCode;
  readonly editIndex?: number | undefined;
  readonly matchedLines?: number[] | undefined;

  constructor(
    code: ArtifactWriteErrorCode,
    message: string,
    options?: {
      editIndex?: number | undefined;
      matchedLines?: number[] | undefined;
    },
  ) {
    const prefixed = message.startsWith(`${code}:`) ? message : `${code}: ${message}`;
    super(prefixed);
    this.name = "ArtifactWriteError";
    this.code = code;
    this.editIndex = options?.editIndex;
    this.matchedLines = options?.matchedLines;
  }
}

const EDIT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "oldText",
  "newText",
  "startLine",
  "endLine",
  "replaceAll",
]);

/** Return true when text contains at least one non-BOM, non-whitespace character. */
export function hasNonWhitespaceMarkdown(markdown: string): boolean {
  return markdown.replace(/\uFEFF/g, "").trim().length > 0;
}

/** Validate Markdown size and non-whitespace invariant consistently across create and update flows. */
export function validateMarkdownContent(markdown: unknown, label = "markdown"): string {
  if (typeof markdown !== "string" || !hasNonWhitespaceMarkdown(markdown)) {
    throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `${label} must be non-empty.`);
  }
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `${label} exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
  }
  return markdown;
}

/**
 * Validate and read an existing regular UTF-8 text file (`0 < size <= 2 MiB`) for one-time copy
 * into an artifact without reading binary data or empty/whitespace-only files.
 */
export async function readValidatedArtifactSourceFile(sourcePath: unknown): Promise<string> {
  if (typeof sourcePath !== "string" || sourcePath.length === 0 || !path.isAbsolute(sourcePath)) {
    throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", "sourcePath must be a non-empty absolute OS path.");
  }

  let fileStat: Stats;
  try {
    fileStat = await fs.stat(sourcePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", `sourcePath could not be accessed: ${detail}`);
  }

  if (!fileStat.isFile()) {
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", "sourcePath must reference an existing regular file.");
  }
  if (fileStat.size <= 0 || fileStat.size > MAX_MARKDOWN_BYTES) {
    throw new ArtifactWriteError(
      "SOURCE_FILE_UNREADABLE",
      `sourcePath file size must be > 0 and <= ${MAX_MARKDOWN_BYTES} bytes.`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(sourcePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", `sourcePath could not be read: ${detail}`);
  }

  if (buffer.length === 0 || buffer.length > MAX_MARKDOWN_BYTES) {
    throw new ArtifactWriteError(
      "SOURCE_FILE_UNREADABLE",
      `sourcePath byte size must be > 0 and <= ${MAX_MARKDOWN_BYTES} bytes.`,
    );
  }
  if (buffer.includes(0x00)) {
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", "sourcePath contains null bytes and is not UTF-8 text.");
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", "sourcePath is not valid UTF-8 text.");
  }

  if (!hasNonWhitespaceMarkdown(decoded)) {
    throw new ArtifactWriteError("SOURCE_FILE_UNREADABLE", "sourcePath must contain non-whitespace text.");
  }

  return decoded;
}

type ValidatedEdit = {
  oldText: string;
  newText: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  replaceAll: boolean;
};

function validateEditsBatch(rawEdits: unknown, lineCount: number): ValidatedEdit[] {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
    throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", "edits must be a non-empty array.");
  }

  const validated: ValidatedEdit[] = [];
  for (let i = 0; i < rawEdits.length; i++) {
    const entry = rawEdits[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}] must be an object.`, { editIndex: i });
    }
    const obj = entry as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (!EDIT_ALLOWED_KEYS.has(key)) {
        throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}] has unrecognized key '${key}'.`, {
          editIndex: i,
        });
      }
    }

    const { oldText, newText, startLine, endLine, replaceAll } = obj;
    if (typeof oldText !== "string" || oldText.length < 1) {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].oldText must be a non-empty string.`, {
        editIndex: i,
      });
    }
    if (typeof newText !== "string") {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].newText must be a string.`, {
        editIndex: i,
      });
    }
    if (replaceAll !== undefined && typeof replaceAll !== "boolean") {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].replaceAll must be a boolean.`, {
        editIndex: i,
      });
    }
    if (startLine !== undefined && (typeof startLine !== "number" || !Number.isInteger(startLine) || startLine < 1)) {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].startLine must be an integer >= 1.`, {
        editIndex: i,
      });
    }
    if (endLine !== undefined && (typeof endLine !== "number" || !Number.isInteger(endLine) || endLine < 1)) {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].endLine must be an integer >= 1.`, {
        editIndex: i,
      });
    }
    if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
      throw new ArtifactWriteError("INVALID_ARTIFACT_INPUT", `edits[${i}].endLine must be >= startLine.`, {
        editIndex: i,
      });
    }
    if (startLine !== undefined && startLine > lineCount) {
      throw new ArtifactWriteError(
        "INVALID_ARTIFACT_INPUT",
        `edits[${i}].startLine (${startLine}) exceeds artifact lineCount (${lineCount}).`,
        { editIndex: i },
      );
    }
    if (endLine !== undefined && endLine > lineCount) {
      throw new ArtifactWriteError(
        "INVALID_ARTIFACT_INPUT",
        `edits[${i}].endLine (${endLine}) exceeds artifact lineCount (${lineCount}).`,
        { editIndex: i },
      );
    }

    validated.push({
      oldText,
      newText,
      startLine,
      endLine,
      replaceAll: replaceAll ?? false,
    });
  }

  return validated;
}

/**
 * Apply an atomic batch of search-and-replace edits on original-text coordinates.
 * Normalizes CRLF/LF/CR only for matching, maps match spans back to original offsets,
 * rejects missing, ambiguous, or overlapping spans, and preserves untouched bytes verbatim.
 */
export function applyArtifactMarkdownEdits(originalMarkdown: string, rawEdits: unknown): string {
  const rawLines = splitRawLines(originalMarkdown);
  const lineCount = rawLines.length;
  const edits = validateEditsBatch(rawEdits, lineCount);

  const origLen = originalMarkdown.length;
  const normParts: string[] = [];
  const normToOrigStart: number[] = [];
  const normToOrigEnd: number[] = [];
  const normLineOfChar: number[] = [];
  const lineNormStart: number[] = [0];
  const lineNormEnd: number[] = [0];

  let currentLine = 1;
  let lineStartNormIdx = 0;
  for (let i = 0; i < origLen; ) {
    const code = originalMarkdown.charCodeAt(i);
    const normIdx = normToOrigStart.length;
    if (code === 13) {
      const isCrlf = originalMarkdown.charCodeAt(i + 1) === 10;
      const spanEnd = isCrlf ? i + 2 : i + 1;
      normParts.push("\n");
      normToOrigStart.push(i);
      normToOrigEnd.push(spanEnd);
      normLineOfChar.push(currentLine);
      lineNormStart[currentLine] = lineStartNormIdx;
      lineNormEnd[currentLine] = normIdx + 1;
      currentLine += 1;
      lineStartNormIdx = normIdx + 1;
      i = spanEnd;
    } else if (code === 10) {
      normParts.push("\n");
      normToOrigStart.push(i);
      normToOrigEnd.push(i + 1);
      normLineOfChar.push(currentLine);
      lineNormStart[currentLine] = lineStartNormIdx;
      lineNormEnd[currentLine] = normIdx + 1;
      currentLine += 1;
      lineStartNormIdx = normIdx + 1;
      i += 1;
    } else {
      normParts.push(originalMarkdown[i]!);
      normToOrigStart.push(i);
      normToOrigEnd.push(i + 1);
      normLineOfChar.push(currentLine);
      i += 1;
    }
  }
  if (lineStartNormIdx < normToOrigStart.length) {
    lineNormStart[currentLine] = lineStartNormIdx;
    lineNormEnd[currentLine] = normToOrigStart.length;
  }
  const normText = normParts.join("");

  type ReplacementSpan = {
    origStart: number;
    origEnd: number;
    newText: string;
    editIndex: number;
  };
  const spans: ReplacementSpan[] = [];

  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (lineCount === 0) {
      throw new ArtifactWriteError("EDIT_TARGET_NOT_FOUND", `edits[${i}].oldText did not match empty artifact.`, {
        editIndex: i,
      });
    }

    const normNeedle = edit.oldText.replace(/\r\n|\r/g, "\n");
    const effectiveStartLine = edit.startLine ?? 1;
    const effectiveEndLine = edit.endLine ?? lineCount;
    const regionStart = lineNormStart[effectiveStartLine]!;
    const regionEnd = lineNormEnd[effectiveEndLine]!;

    const matches: Array<{ origStart: number; origEnd: number; matchLine: number }> = [];
    let searchFrom = regionStart;
    while (searchFrom + normNeedle.length <= regionEnd) {
      const idx = normText.indexOf(normNeedle, searchFrom);
      if (idx === -1 || idx + normNeedle.length > regionEnd) break;
      matches.push({
        origStart: normToOrigStart[idx]!,
        origEnd: normToOrigEnd[idx + normNeedle.length - 1]!,
        matchLine: normLineOfChar[idx]!,
      });
      searchFrom = idx + normNeedle.length;
    }

    if (matches.length === 0) {
      throw new ArtifactWriteError(
        "EDIT_TARGET_NOT_FOUND",
        `edits[${i}].oldText did not match lines ${effectiveStartLine}..${effectiveEndLine}.`,
        { editIndex: i },
      );
    }

    if (!edit.replaceAll && matches.length > 1) {
      const matchedLines = [...new Set(matches.map((match) => match.matchLine))].sort((a, b) => a - b);
      throw new ArtifactWriteError(
        "EDIT_TARGET_AMBIGUOUS",
        `edits[${i}].oldText matched ${matches.length} locations (lines ${matchedLines.join(", ")}) while replaceAll is false.`,
        { editIndex: i, matchedLines },
      );
    }

    for (const match of matches) {
      spans.push({
        origStart: match.origStart,
        origEnd: match.origEnd,
        newText: edit.newText,
        editIndex: i,
      });
    }
  }

  spans.sort((a, b) => a.origStart - b.origStart || a.origEnd - b.origEnd || a.editIndex - b.editIndex);
  for (let k = 1; k < spans.length; k++) {
    const prev = spans[k - 1]!;
    const curr = spans[k]!;
    if (curr.origStart < prev.origEnd) {
      throw new ArtifactWriteError(
        "EDIT_TARGET_OVERLAP",
        `edits[${prev.editIndex}] and edits[${curr.editIndex}] overlap on original artifact text.`,
        { editIndex: Math.max(prev.editIndex, curr.editIndex) },
      );
    }
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    parts.push(originalMarkdown.slice(cursor, span.origStart), span.newText);
    cursor = span.origEnd;
  }
  parts.push(originalMarkdown.slice(cursor));
  return parts.join("");
}
