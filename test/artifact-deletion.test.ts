import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  artifactCollectionRoot,
  artifactDirectory,
  conversationDirectory,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import {
  createSession,
  deleteSession,
  readSession,
  registerArtifactInSession,
} from "../src/shared/conversation-artifact-registry";
import {
  deleteArtifactAndCleanup,
  deleteSingleArtifact,
} from "../src/extension/artifact-deletion";

describe("artifact deletion", () => {
  let tempDir: string;
  let rootOptions: { userHome: string };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-deletion-test-"));
    rootOptions = { userHome: tempDir };
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createSampleArtifact(artifactId: string): Promise<string> {
    const artDir = artifactDirectory(artifactId, rootOptions);
    await fs.mkdir(artDir, { recursive: true });

    const manifest = {
      schemaVersion: 6,
      artifactId,
      title: `Artifact ${artifactId}`,
      kind: "plan",
      createdAt: "2026-11-08T00:00:00.000Z",
      updatedAt: "2026-11-08T00:00:00.000Z",
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
      reviewRound: 1,
    };
    await fs.writeFile(path.join(artDir, "artifact.json"), JSON.stringify(manifest, null, 2), "utf8");
    await fs.writeFile(path.join(artDir, "artifact.md"), "# Content\n", "utf8");
    return artDir;
  }

  describe("deleteSingleArtifact", () => {
    it("deletes a valid artifact and removes it completely", async () => {
      const artifactId = "art-del-1";
      const artDir = await createSampleArtifact(artifactId);

      await expect(fs.access(artDir)).resolves.toBeUndefined();

      const deleted = await deleteSingleArtifact(artifactId, rootOptions);
      expect(deleted).toBe(true);

      await expect(fs.access(artDir)).rejects.toThrow();
    });

    it("returns false for non-existent artifact", async () => {
      const deleted = await deleteSingleArtifact("non-existent-art", rootOptions);
      expect(deleted).toBe(false);
    });

    it("returns false for invalid artifact ID", async () => {
      const deleted = await deleteSingleArtifact("../invalid/id", rootOptions);
      expect(deleted).toBe(false);
    });
  });

  describe("deleteArtifactAndCleanup", () => {
    it("deletes artifact and prunes its memberships across sessions while preserving empty v2 sessions", async () => {
      const artIdA = "art-shared-a";
      const artIdB = "art-shared-b";
      const artDirA = await createSampleArtifact(artIdA);
      const artDirB = await createSampleArtifact(artIdB);

      const session1 = await createSession({ title: "Session 1", ...rootOptions });
      const session2 = await createSession({ title: "Session 2", ...rootOptions });

      await registerArtifactInSession(session1.sessionId, artIdA, rootOptions);
      await registerArtifactInSession(session1.sessionId, artIdB, rootOptions);
      await registerArtifactInSession(session2.sessionId, artIdA, rootOptions);

      // Verify initial memberships
      const initialS1 = await readSession(session1.sessionId, rootOptions);
      expect(initialS1.working).toEqual([artIdA, artIdB]);
      const initialS2 = await readSession(session2.sessionId, rootOptions);
      expect(initialS2.working).toEqual([artIdA]);

      // Delete artifact A
      const result = await deleteArtifactAndCleanup(artIdA, rootOptions);
      expect(result.deleted).toBe(true);
      expect(result.conversationCleanup?.removedMemberships).toBe(2);

      // Artifact A is gone, Artifact B remains
      await expect(fs.access(artDirA)).rejects.toThrow();
      await expect(fs.access(artDirB)).resolves.toBeUndefined();

      // Session 1 now only has artifact B
      const updatedS1 = await readSession(session1.sessionId, rootOptions);
      expect(updatedS1.working).toEqual([artIdB]);

      // Session 2 is now empty but v2 session is NOT deleted!
      const updatedS2 = await readSession(session2.sessionId, rootOptions);
      expect(updatedS2.working).toEqual([]);
      expect(updatedS2.sessionId).toBe(session2.sessionId);
    });

    it("returns deleted: false when artifact does not exist", async () => {
      const result = await deleteArtifactAndCleanup("missing-art", rootOptions);
      expect(result.deleted).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("treats rename to staging as the commit point even if draining staging fails", async () => {
      const artId = "art-staging-fail";
      const artDir = await createSampleArtifact(artId);

      const session = await createSession({ title: "Session Staging Fail", ...rootOptions });
      await registerArtifactInSession(session.sessionId, artId, rootOptions);

      // Spy on fs.rm and make it fail only when deleting the staged directory
      const originalRm = fs.rm;
      const rmSpy = vi.spyOn(fs, "rm").mockImplementation(async (targetPath, options) => {
        if (typeof targetPath === "string" && targetPath.includes("deleted-")) {
          const err = new Error("EBUSY: resource busy or locked");
          (err as any).code = "EBUSY";
          throw err;
        }
        return originalRm(targetPath, options);
      });

      try {
        const diagnostics: string[] = [];
        const result = await deleteArtifactAndCleanup(artId, rootOptions, (msg) => diagnostics.push(msg));

        // Artifact is successfully deleted from collection!
        expect(result.deleted).toBe(true);
        await expect(fs.access(artDir)).rejects.toThrow();

        // Staging rm failure was caught and logged as diagnostic
        expect(diagnostics.some((d) => d.includes("deleting staged files encountered an error"))).toBe(true);

        // Conversation cleanup STILL ran!
        const updated = await readSession(session.sessionId, rootOptions);
        expect(updated.working).toEqual([]);
      } finally {
        rmSpy.mockRestore();
      }
    });
  });

  describe("deleteSession", () => {
    it("deletes the session directory without deleting user artifact files", async () => {
      const artId = "art-keep-me";
      const artDir = await createSampleArtifact(artId);

      const session = await createSession({ title: "Session To Delete", ...rootOptions });
      await registerArtifactInSession(session.sessionId, artId, rootOptions);

      const sDir = conversationDirectory(session.sessionId, rootOptions);
      await expect(fs.access(sDir)).resolves.toBeUndefined();

      const deleted = await deleteSession(session.sessionId, rootOptions);
      expect(deleted).toBe(true);

      // Session directory is deleted
      await expect(fs.access(sDir)).rejects.toThrow();

      // Artifact files are completely intact!
      await expect(fs.access(artDir)).resolves.toBeUndefined();
      await expect(fs.access(path.join(artDir, "artifact.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(artDir, "artifact.md"))).resolves.toBeUndefined();
    });

    it("rejects and does not delete when conversation.json is malformed", async () => {
      const session = await createSession({ title: "Malformed Session", ...rootOptions });
      const sDir = conversationDirectory(session.sessionId, rootOptions);
      await fs.writeFile(path.join(sDir, "conversation.json"), "{ invalid json", "utf8");

      await expect(deleteSession(session.sessionId, rootOptions)).rejects.toThrow();
      // Directory is NOT deleted
      await expect(fs.access(sDir)).resolves.toBeUndefined();
    });
  });
});
