import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ArtifactWriteError,
  applyArtifactMarkdownEdits,
  readValidatedArtifactSourceFile,
} from "../src/shared/artifact-markdown-write";
import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";
import { MAX_MARKDOWN_BYTES } from "../src/shared/contracts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ai-artifacts-write-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe("artifact-markdown-write core engine", () => {
  it("reads valid UTF-8 sourcePath files and rejects unsafe, missing, binary, empty, or oversized inputs", async () => {
    const dir = await makeTempDir();
    const mdFile = path.join(dir, "draft.md");
    const txtFile = path.join(dir, "notes.txt");
    const bomFile = path.join(dir, "bom.md");
    const content = "# Tiếng Việt 🚀\r\nDòng hai\r\n";
    await writeFile(mdFile, content, "utf8");
    await writeFile(txtFile, "Plain text UTF-8 content\n", "utf8");
    await writeFile(bomFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# BOM heading\n", "utf8")]));

    expect(await readValidatedArtifactSourceFile(mdFile)).toBe(content);
    expect(await readValidatedArtifactSourceFile(txtFile)).toBe("Plain text UTF-8 content\n");
    const decodedBom = await readValidatedArtifactSourceFile(bomFile);
    expect(decodedBom).toBe("# BOM heading\n");
    expect(parseMarkdownBlocks(decodedBom)[0]?.type).toBe("heading");

    await expect(readValidatedArtifactSourceFile("relative/draft.md")).rejects.toMatchObject({
      code: "INVALID_ARTIFACT_INPUT",
    });
    await expect(readValidatedArtifactSourceFile("")).rejects.toMatchObject({
      code: "INVALID_ARTIFACT_INPUT",
    });

    await expect(readValidatedArtifactSourceFile(path.join(dir, "missing.md"))).rejects.toMatchObject({
      code: "SOURCE_FILE_UNREADABLE",
    });
    await expect(readValidatedArtifactSourceFile(dir)).rejects.toMatchObject({
      code: "SOURCE_FILE_UNREADABLE",
    });

    const zeroFile = path.join(dir, "zero.md");
    const whitespaceFile = path.join(dir, "spaces.md");
    const bomOnlyFile = path.join(dir, "bom-only.md");
    const nullByteFile = path.join(dir, "binary.bin");
    const badUtf8File = path.join(dir, "invalid-utf8.txt");
    const oversizedFile = path.join(dir, "oversized.md");

    await writeFile(zeroFile, Buffer.alloc(0));
    await writeFile(whitespaceFile, "   \r\n\t  ", "utf8");
    await writeFile(bomOnlyFile, "\uFEFF  \n", "utf8");
    await writeFile(nullByteFile, Buffer.from("# Title\0hidden", "utf8"));
    await writeFile(badUtf8File, Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a]));
    await writeFile(oversizedFile, Buffer.alloc(MAX_MARKDOWN_BYTES + 1, "a"));

    for (const badPath of [zeroFile, whitespaceFile, bomOnlyFile, nullByteFile, badUtf8File, oversizedFile]) {
      await expect(readValidatedArtifactSourceFile(badPath)).rejects.toMatchObject({
        code: "SOURCE_FILE_UNREADABLE",
      });
    }
  });

  it("applies single, batch, delete, CRLF/LF-normalized, line-bounded, touching, and replaceAll edits while preserving untouched bytes", () => {
    const crlfDoc = [
      "# Plan Header",
      "Line 2: alpha item",
      "Line 3: repeated tag",
      "Line 4: giữ nguyên CRLF",
      "Line 5: repeated tag",
      "Line 6: targetA|targetB",
    ].join("\r\n");

    // Batch on original-text coordinates:
    // - multi-line LF oldText matches CRLF document
    // - line-bounded single edit picks line 3 rather than ambiguous whole doc
    // - empty newText deletes substring
    // - touching boundary edits (targetA| and targetB) do not overlap
    const next = applyArtifactMarkdownEdits(crlfDoc, [
      {
        oldText: "repeated tag",
        newText: "scoped line-3 tag",
        startLine: 3,
        endLine: 3,
      },
      {
        oldText: "# Plan Header\nLine 2: alpha item",
        newText: "# Plan Header v2\r\nLine 2: updated item",
      },
      {
        oldText: "targetA|",
        newText: "",
        startLine: 6,
        endLine: 6,
      },
      {
        oldText: "targetB",
        newText: "ONLY_B",
        startLine: 6,
        endLine: 6,
      },
    ]);

    expect(next).toBe(
      [
        "# Plan Header v2",
        "Line 2: updated item",
        "Line 3: scoped line-3 tag",
        "Line 4: giữ nguyên CRLF",
        "Line 5: repeated tag",
        "Line 6: ONLY_B",
      ].join("\r\n"),
    );

    const replaceAllDoc = "a = old\r\nb = old\nc = keep\r\n";
    const replacedAll = applyArtifactMarkdownEdits(replaceAllDoc, [
      { oldText: "old", newText: "new", replaceAll: true },
    ]);
    expect(replacedAll).toBe("a = new\r\nb = new\nc = keep\r\n");

    // Matching a lone CR/CRLF line ending directly with CRLF preserves surrounding lines verbatim
    const mixedEndings = "L1\r\nL2\nL3\r\n";
    const editedMixed = applyArtifactMarkdownEdits(mixedEndings, [{ oldText: "L2\n", newText: "L2-mod\n" }]);
    expect(editedMixed).toBe("L1\r\nL2-mod\nL3\r\n");
  });

  it("rejects missing, ambiguous (with deduplicated matchedLines), overlapping, and out-of-range edits without mutation", () => {
    const doc = [
      "foo bar foo",
      "second line",
      "alpha foo omega",
      "tail line",
    ].join("\n");

    let capturedError: unknown;
    try {
      applyArtifactMarkdownEdits(doc, [
        { oldText: "second line", newText: "ok" },
        { oldText: "does-not-exist", newText: "x" },
      ]);
    } catch (error) {
      capturedError = error;
    }
    expect(capturedError).toBeInstanceOf(ArtifactWriteError);
    expect(capturedError).toMatchObject({
      code: "EDIT_TARGET_NOT_FOUND",
      editIndex: 1,
    });

    // Ambiguous across multiple lines and twice on line 1 -> deduplicated ascending [1, 3]
    capturedError = undefined;
    try {
      applyArtifactMarkdownEdits(doc, [{ oldText: "foo", newText: "baz" }]);
    } catch (error) {
      capturedError = error;
    }
    expect(capturedError).toMatchObject({
      code: "EDIT_TARGET_AMBIGUOUS",
      editIndex: 0,
      matchedLines: [1, 3],
    });

    // replaceAll: true still fails with EDIT_TARGET_NOT_FOUND when matches === 0
    expect(() =>
      applyArtifactMarkdownEdits(doc, [{ oldText: "missing", newText: "x", replaceAll: true }]),
    ).toThrow(/EDIT_TARGET_NOT_FOUND/);

    // Overlapping spans rejected
    expect(() =>
      applyArtifactMarkdownEdits(doc, [
        { oldText: "alpha foo", newText: "A" },
        { oldText: "foo omega", newText: "B" },
      ]),
    ).toThrow(/EDIT_TARGET_OVERLAP/);

    // Line bounds and malformed payloads rejected with INVALID_ARTIFACT_INPUT
    for (const badEdits of [
      [],
      [{ oldText: "", newText: "x" }],
      [{ oldText: "second", newText: "x", extraKey: true }],
      [{ oldText: "second", newText: "x", startLine: 3, endLine: 2 }],
      [{ oldText: "second", newText: "x", startLine: 5 }],
      [{ oldText: "second", newText: "x", endLine: 10 }],
    ]) {
      expect(() => applyArtifactMarkdownEdits(doc, badEdits)).toThrow(/INVALID_ARTIFACT_INPUT/);
    }
  });
});
