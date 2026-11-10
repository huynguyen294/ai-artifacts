import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  artifactCollectionRoot,
  artifactDirectory,
  artifactUiStatePath,
  conversationDirectory,
  conversationRegistryRoot,
  sessionUiStatePath,
} from "../src/shared/artifact-files";
import {
  DEFAULT_UI_STATE,
  getArtifactUiState,
  getSessionUiState,
  patchArtifactUiState,
  patchSessionUiState,
} from "../src/extension/artifact-ui-state";

describe("artifact-ui-state", () => {
  let tempDir: string;
  let rootOptions: { userHome: string };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ui-state-test-"));
    rootOptions = { userHome: tempDir };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("artifact UI state", () => {
    it("returns default state in-memory when file does not exist, without writing to disk", async () => {
      const artifactId = "art-test-1";
      const state = await getArtifactUiState(artifactId, rootOptions);

      expect(state).toEqual(DEFAULT_UI_STATE);
      const filePath = artifactUiStatePath(artifactId, rootOptions);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it("patches pinned to true and preserves it across reads", async () => {
      const artifactId = "art-test-1";
      const artDir = artifactDirectory(artifactId, rootOptions);
      await fs.mkdir(artDir, { recursive: true });

      const updated = await patchArtifactUiState(artifactId, { pinned: true }, rootOptions);
      expect(updated).toEqual({
        schemaVersion: 1,
        pinned: true,
      });

      const loaded = await getArtifactUiState(artifactId, rootOptions);
      expect(loaded).toEqual({
        schemaVersion: 1,
        pinned: true,
      });
    });

    it("archives and restores an artifact, preserving pinned status", async () => {
      const artifactId = "art-test-1";
      const artDir = artifactDirectory(artifactId, rootOptions);
      await fs.mkdir(artDir, { recursive: true });

      await patchArtifactUiState(artifactId, { pinned: true }, rootOptions);

      const archivedAt = "2026-11-08T10:00:00.000Z";
      const archived = await patchArtifactUiState(artifactId, { archivedAt }, rootOptions);
      expect(archived).toEqual({
        schemaVersion: 1,
        pinned: true,
        archivedAt,
      });

      const restored = await patchArtifactUiState(artifactId, { archivedAt: null }, rootOptions);
      expect(restored).toEqual({
        schemaVersion: 1,
        pinned: true,
      });
      expect(restored.archivedAt).toBeUndefined();
    });

    it("throws if target directory does not exist or is not canonical child", async () => {
      await expect(patchArtifactUiState("non-existent-art", { pinned: true }, rootOptions)).rejects.toThrow();
    });

    it("throws if UI state file contains malformed JSON instead of silently overwriting", async () => {
      const artifactId = "art-corrupt";
      const artDir = artifactDirectory(artifactId, rootOptions);
      await fs.mkdir(artDir, { recursive: true });

      const filePath = artifactUiStatePath(artifactId, rootOptions);
      await fs.writeFile(filePath, "{ malformed json", "utf8");

      await expect(getArtifactUiState(artifactId, rootOptions)).rejects.toThrow();
    });
  });

  describe("session UI state", () => {
    it("returns default state in-memory when file does not exist", async () => {
      const validSessionId = randomUUID();
      const state = await getSessionUiState(validSessionId, rootOptions);
      expect(state).toEqual(DEFAULT_UI_STATE);
      const filePath = sessionUiStatePath(validSessionId, rootOptions);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it("patches session pinned and archivedAt correctly", async () => {
      const validSessionId = randomUUID();
      const sessionDir = conversationDirectory(validSessionId, rootOptions);
      await fs.mkdir(sessionDir, { recursive: true });

      const archivedAt = "2026-11-08T12:00:00.000Z";
      const updated = await patchSessionUiState(
        validSessionId,
        { pinned: true, archivedAt },
        rootOptions,
      );

      expect(updated).toEqual({
        schemaVersion: 1,
        pinned: true,
        archivedAt,
      });

      const restored = await patchSessionUiState(
        validSessionId,
        { archivedAt: null },
        rootOptions,
      );
      expect(restored).toEqual({
        schemaVersion: 1,
        pinned: true,
      });
    });

    it("rejects when ui-state file is a symbolic link", async () => {
      const validSessionId = randomUUID();
      const sessionDir = conversationDirectory(validSessionId, rootOptions);
      await fs.mkdir(sessionDir, { recursive: true });

      const linkPath = sessionUiStatePath(validSessionId, rootOptions);
      await fs.writeFile(linkPath, JSON.stringify(DEFAULT_UI_STATE), "utf8");

      // Spy on lstat for this file to simulate a symbolic link on any platform
      const originalLstat = fs.lstat;
      const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (targetPath) => {
        if (typeof targetPath === "string" && targetPath === linkPath) {
          return {
            isSymbolicLink: () => true,
            isFile: () => false,
            isDirectory: () => false,
          } as any;
        }
        return originalLstat(targetPath);
      });

      try {
        await expect(getSessionUiState(validSessionId, rootOptions)).rejects.toThrow(/symbolic links are not allowed/);
      } finally {
        lstatSpy.mockRestore();
      }
    });

    it("rejects when target directory is a symbolic link or junction", async () => {
      const outsideDir = path.join(tempDir, "outside-session");
      await fs.mkdir(outsideDir, { recursive: true });

      const validSessionId = randomUUID();
      const linkSessionDir = conversationDirectory(validSessionId, rootOptions);
      await fs.mkdir(path.dirname(linkSessionDir), { recursive: true });
      await fs.symlink(outsideDir, linkSessionDir, process.platform === "win32" ? "junction" : "dir");

      await expect(
        patchSessionUiState(validSessionId, { pinned: true }, rootOptions),
      ).rejects.toThrow(/must be a real directory/);
    });
  });
});
