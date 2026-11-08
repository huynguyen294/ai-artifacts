import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  artifactDirectory,
  conversationDirectory,
} from "../src/shared/artifact-files";
import {
  createSession,
  registerArtifactInSession,
} from "../src/shared/conversation-artifact-registry";
import { patchSessionUiState } from "../src/extension/artifact-ui-state";
import {
  DAY_IN_MS,
  executeWorkSessionArchiveCleanup,
  isSessionCandidateExpired,
} from "../src/extension/work-session-retention";

describe("work session archive retention", () => {
  let tempDir: string;
  let rootOptions: { userHome: string };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "session-retention-test-"));
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

  it("calculates candidate expiration based on archivedAt + 30 days", () => {
    const archivedAt = "2026-10-01T00:00:00.000Z";
    const archivedAtMs = Date.parse(archivedAt);

    expect(isSessionCandidateExpired(archivedAt, 30, archivedAtMs + 29 * DAY_IN_MS)).toBe(false);
    expect(isSessionCandidateExpired(archivedAt, 30, archivedAtMs + 30 * DAY_IN_MS)).toBe(true);
    expect(isSessionCandidateExpired(archivedAt, 30, archivedAtMs + 31 * DAY_IN_MS)).toBe(true);
  });

  it("cleans up sessions archived for 30+ days while preserving active and unarchived sessions", async () => {
    const artId = "art-sample";
    const artDir = await createSampleArtifact(artId);

    const now = Date.parse("2026-11-08T00:00:00.000Z");

    // Session 1: Active, unarchived -> KEEP
    const sActive = await createSession({ title: "Active Session", ...rootOptions });
    await registerArtifactInSession(sActive.sessionId, artId, rootOptions);

    // Session 2: Archived 10 days ago -> KEEP
    const sRecentArchive = await createSession({ title: "Recent Archive", ...rootOptions });
    await registerArtifactInSession(sRecentArchive.sessionId, artId, rootOptions);
    await patchSessionUiState(
      sRecentArchive.sessionId,
      { archivedAt: new Date(now - 10 * DAY_IN_MS).toISOString() },
      rootOptions,
    );

    // Session 3: Archived 31 days ago -> DELETE
    const sExpiredArchive = await createSession({ title: "Expired Archive", ...rootOptions });
    await registerArtifactInSession(sExpiredArchive.sessionId, artId, rootOptions);
    await patchSessionUiState(
      sExpiredArchive.sessionId,
      { archivedAt: new Date(now - 31 * DAY_IN_MS).toISOString() },
      rootOptions,
    );

    const result = await executeWorkSessionArchiveCleanup({
      rootOptions,
      now,
    });

    expect(result.scannedCount).toBe(3);
    expect(result.archivedCount).toBe(2);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedSessionIds).toEqual([sExpiredArchive.sessionId]);

    // Active & Recent archive sessions exist
    await expect(fs.access(conversationDirectory(sActive.sessionId, rootOptions))).resolves.toBeUndefined();
    await expect(fs.access(conversationDirectory(sRecentArchive.sessionId, rootOptions))).resolves.toBeUndefined();

    // Expired session is deleted
    await expect(fs.access(conversationDirectory(sExpiredArchive.sessionId, rootOptions))).rejects.toThrow();

    // The shared artifact was NOT deleted!
    await expect(fs.access(artDir)).resolves.toBeUndefined();
  });

  it("skips sessions with malformed or unverified metadata without deleting them", async () => {
    const artId = "art-sample-2";
    await createSampleArtifact(artId);
    const now = Date.parse("2026-11-08T00:00:00.000Z");

    const session = await createSession({ title: "Corrupt Metadata Session", ...rootOptions });
    await patchSessionUiState(
      session.sessionId,
      { archivedAt: new Date(now - 40 * DAY_IN_MS).toISOString() },
      rootOptions,
    );

    // Corrupt the conversation.json file
    const sDir = conversationDirectory(session.sessionId, rootOptions);
    await fs.writeFile(path.join(sDir, "conversation.json"), "{ malformed json", "utf8");

    const result = await executeWorkSessionArchiveCleanup({
      rootOptions,
      now,
    });

    expect(result.scannedCount).toBe(1);
    expect(result.archivedCount).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect(result.skippedCount).toBe(1);

    // Directory is preserved, not deleted!
    await expect(fs.access(sDir)).resolves.toBeUndefined();
  });
});

