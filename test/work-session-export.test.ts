import fs from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yauzl from "yauzl";

vi.mock("vscode", () => ({
  Uri: {
    file: (fsPath: string) => ({ fsPath, scheme: "file" }),
  },
  window: {
    showSaveDialog: vi.fn(),
  },
}));

import {
  exportWorkSession,
  sanitizeFilenamePart,
} from "../src/extension/work-session-export";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import { ARTIFACT_SCHEMA_VERSION } from "../src/shared/contracts";
import {
  createSession,
  registerArtifactInSession,
  writeSessionInstructions,
} from "../src/shared/conversation-artifact-registry";

function readZipEntries(zipPath: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);
      const entries = new Map<string, string>();
      zipfile.readEntry();
      zipfile.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          entries.set(entry.fileName, "");
          zipfile.readEntry();
        } else {
          zipfile.openReadStream(entry, (streamErr, readStream) => {
            if (streamErr || !readStream) return reject(streamErr);
            const chunks: Buffer[] = [];
            readStream.on("data", (chunk) => chunks.push(chunk));
            readStream.on("end", () => {
              entries.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
              zipfile.readEntry();
            });
          });
        }
      });
      zipfile.on("end", () => resolve(entries));
      zipfile.on("error", reject);
    });
  });
}

describe("work-session-export", () => {
  let userHome: string;

  beforeEach(async () => {
    userHome = await mkdtemp(path.join(tmpdir(), "session-export-test-"));
  });

  afterEach(async () => {
    await rm(userHome, { recursive: true, force: true });
  });

  describe("sanitizeFilenamePart", () => {
    it("sanitizes illegal characters and trims dots/spaces", () => {
      expect(sanitizeFilenamePart("My / Valid : File * Name ?", "Fallback")).toBe("My - Valid - File - Name");
      expect(sanitizeFilenamePart("...Leading and Trailing...", "Fallback")).toBe("Leading and Trailing");
      expect(sanitizeFilenamePart("   ", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("???", "Fallback")).toBe("Fallback");
    });

    it("guards against Windows reserved device names", () => {
      expect(sanitizeFilenamePart("CON", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("prn.txt", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("aux", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("NUL", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("COM1", "Fallback")).toBe("Fallback");
      expect(sanitizeFilenamePart("LPT2", "Fallback")).toBe("Fallback");
    });
  });

  describe("exportWorkSession", () => {
    it("exports complete session structure and contents to ZIP archive", async () => {
      const session = await createSession({
        title: "Project Alpha / Beta",
        userHome,
      });
      await writeSessionInstructions(
        session.sessionId,
        "# Instructions\nFollow strict TDD.",
        { userHome },
      );

      // Create an artifact in global root
      const root = globalArtifactsRoot({ userHome });
      const artifactId = "artifact-001";
      const artifactDir = path.join(root, artifactId);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        path.join(artifactDir, ARTIFACT_MANIFEST_FILE),
        JSON.stringify({
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          artifactId,
          title: "Architecture Design: Core",
          kind: "design",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reviewRound: 1,
          reviewSessionId: "11111111-1111-4111-8111-111111111111",
        }),
        "utf8",
      );
      await writeFile(
        path.join(artifactDir, ARTIFACT_MARKDOWN_FILE),
        "# Design Document\nArchitecture details.",
        "utf8",
      );

      // Register into session (default zone is 'working')
      await registerArtifactInSession(session.sessionId, artifactId, { userHome });

      const targetZip = path.join(userHome, "output.zip");
      const result = await exportWorkSession(session.sessionId, {
        userHome,
        targetPath: targetZip,
      });

      expect(result).toEqual({ success: true, targetPath: targetZip });

      // Unzip with independent reader and verify structure
      const entries = await readZipEntries(targetZip);
      const rootFolder = "Project Alpha - Beta";

      // Verify instructions
      expect(entries.has(`${rootFolder}/Instructions.md`)).toBe(true);
      expect(entries.get(`${rootFolder}/Instructions.md`)).toBe("# Instructions\nFollow strict TDD.");

      // Verify zone folders
      expect(entries.has(`${rootFolder}/Working/`)).toBe(true);
      expect(entries.has(`${rootFolder}/References/`)).toBe(true);
      expect(entries.has(`${rootFolder}/Archived/`)).toBe(true);

      // Verify Working artifact entry
      const expectedWorkingEntry = `${rootFolder}/Working/01 - Architecture Design- Core.md`;
      expect(entries.has(expectedWorkingEntry)).toBe(true);
      expect(entries.get(expectedWorkingEntry)).toBe("# Design Document\nArchitecture details.");
    });

    it("throws informative error when member artifact is missing", async () => {
      const session = await createSession({
        title: "Test Session",
        userHome,
      });

      const root = globalArtifactsRoot({ userHome });
      const artifactId = "missing-artifact";
      const artifactDir = path.join(root, artifactId);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        path.join(artifactDir, ARTIFACT_MANIFEST_FILE),
        JSON.stringify({
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          artifactId,
          title: "To Be Deleted",
          kind: "spec",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reviewRound: 1,
          reviewSessionId: "11111111-1111-4111-8111-111111111111",
        }),
        "utf8",
      );
      await writeFile(path.join(artifactDir, ARTIFACT_MARKDOWN_FILE), "# Content", "utf8");
      await registerArtifactInSession(session.sessionId, artifactId, { userHome });

      // Delete the artifact directory so it becomes missing/unreadable
      await rm(artifactDir, { recursive: true, force: true });

      const targetZip = path.join(userHome, "output-err.zip");
      await expect(
        exportWorkSession(session.sessionId, {
          userHome,
          targetPath: targetZip,
        }),
      ).rejects.toThrow('Failed to export session: member artifact "missing-artifact" is missing or unreadable.');
    });

    it("preserves previous target archive bytes and cleans up temp files when overwrite replacement fails", async () => {
      const session = await createSession({
        title: "Overwrite Preservation Test",
        userHome,
      });

      const targetZip = path.join(userHome, "output-preserve.zip");
      const originalBytes = "PREVIOUS_VALID_ZIP_BYTES_CANONICAL";
      await writeFile(targetZip, originalBytes, "utf8");

      let attempt = 0;
      const realRename = fs.promises.rename.bind(fs.promises);
      const renameSpy = vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
        if (String(oldPath).includes(".tmp-") && String(newPath) === targetZip) {
          attempt++;
          if (attempt === 1) {
            const err: any = new Error("Windows destination exists lock");
            err.code = "EPERM";
            throw err;
          }
          if (attempt === 2) {
            const err: any = new Error("Simulated I/O failure during replacement");
            err.code = "EIO";
            throw err;
          }
        }
        return realRename(oldPath, newPath);
      });

      try {
        await expect(
          exportWorkSession(session.sessionId, {
            userHome,
            targetPath: targetZip,
          }),
        ).rejects.toThrow("Simulated I/O failure during replacement");

        const preserved = await readFile(targetZip, "utf8");
        expect(preserved).toBe(originalBytes);

        const files = await readdir(userHome);
        const leaked = files.filter((f) => f.includes(".tmp-") || f.includes(".bak-"));
        expect(leaked).toEqual([]);
      } finally {
        renameSpy.mockRestore();
      }
    });

    it("rejects export when member artifact directory is a junction/symlink", async () => {
      const session = await createSession({
        title: "Junction Test Session",
        userHome,
      });

      const outsideDir = path.join(userHome, "outside-artifact");
      await mkdir(outsideDir, { recursive: true });
      await writeFile(
        path.join(outsideDir, ARTIFACT_MANIFEST_FILE),
        JSON.stringify({
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          artifactId: "linked-artifact",
          title: "Outside Artifact",
          kind: "spec",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reviewRound: 1,
          reviewSessionId: "11111111-1111-4111-8111-111111111111",
        }),
        "utf8",
      );
      await writeFile(path.join(outsideDir, ARTIFACT_MARKDOWN_FILE), "# Outside", "utf8");

      const root = globalArtifactsRoot({ userHome });
      await mkdir(root, { recursive: true });
      const linkPath = path.join(root, "linked-artifact");
      await symlink(outsideDir, linkPath, process.platform === "win32" ? "junction" : "dir");

      await registerArtifactInSession(session.sessionId, "linked-artifact", { userHome });

      const targetZip = path.join(userHome, "output-junction.zip");
      await expect(
        exportWorkSession(session.sessionId, {
          userHome,
          targetPath: targetZip,
        }),
      ).rejects.toThrow('Failed to export session: member artifact "linked-artifact" is missing or unreadable.');
    });

    it("rejects export when manifest artifactId does not match member directory id", async () => {
      const session = await createSession({
        title: "Mismatch Test Session",
        userHome,
      });

      const root = globalArtifactsRoot({ userHome });
      const artifactId = "expected-id";
      const artifactDir = path.join(root, artifactId);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(
        path.join(artifactDir, ARTIFACT_MANIFEST_FILE),
        JSON.stringify({
          schemaVersion: ARTIFACT_SCHEMA_VERSION,
          artifactId: "different-id",
          title: "Mismatched ID",
          kind: "spec",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          reviewRound: 1,
          reviewSessionId: "11111111-1111-4111-8111-111111111111",
        }),
        "utf8",
      );
      await writeFile(path.join(artifactDir, ARTIFACT_MARKDOWN_FILE), "# Mismatch", "utf8");

      await registerArtifactInSession(session.sessionId, artifactId, { userHome });

      const targetZip = path.join(userHome, "output-mismatch.zip");
      await expect(
        exportWorkSession(session.sessionId, {
          userHome,
          targetPath: targetZip,
        }),
      ).rejects.toThrow('Failed to export session: member artifact "expected-id" is missing or unreadable.');
    });
  });
});
