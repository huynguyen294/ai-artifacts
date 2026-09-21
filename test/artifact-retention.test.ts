import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RETENTION_DAYS,
  drainManagedCleanupStaging,
  executeArtifactRetentionCleanup,
  isArtifactCandidateExpired,
  normalizeRetentionDays,
} from "../src/extension/artifact-retention";
import {
  globalArtifactsRoot,
  managedCleanupDirectory,
} from "../src/shared/artifact-files";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeUserHome(): Promise<string> {
  const userHome = await mkdtemp(path.join(tmpdir(), "agent-plus-retention-"));
  temporaryDirectories.push(userHome);
  return userHome;
}

async function writeArtifact(
  userHome: string,
  artifactId: string,
  options: {
    title?: string;
    kind?: string;
    reviewRound?: number;
    schemaVersion?: number;
    createdAt?: string;
    updatedAt?: string;
    markdown?: string;
    mismatchedArtifactId?: string;
  } = {},
): Promise<string> {
  const collectionRoot = globalArtifactsRoot({ userHome });
  const artifactDir = path.join(collectionRoot, artifactId);
  await mkdir(artifactDir, { recursive: true });

  const manifest = {
    schemaVersion: options.schemaVersion ?? 6,
    kind: options.kind ?? "plan",
    artifactId: options.mismatchedArtifactId ?? artifactId,
    title: options.title ?? `Title for ${artifactId}`,
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: options.updatedAt ?? "2026-01-01T00:00:00.000Z",
    reviewRound: options.reviewRound ?? 1,
    reviewSessionId: randomUUID(),
  };

  await writeFile(
    path.join(artifactDir, "artifact.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    path.join(artifactDir, "artifact.md"),
    options.markdown ?? "# Test artifact",
  );
  return artifactDir;
}

describe("normalizeRetentionDays", () => {
  it("returns the input value for positive safe integers", () => {
    expect(normalizeRetentionDays(1)).toBe(1);
    expect(normalizeRetentionDays(30)).toBe(30);
    expect(normalizeRetentionDays(90)).toBe(90);
    expect(normalizeRetentionDays(365)).toBe(365);
  });

  it("falls back to default 30 for 0, negative, non-integers, floats, and non-numbers", () => {
    const diagnostic = vi.fn();
    expect(normalizeRetentionDays(0, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(-5, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(1.5, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(NaN, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(Infinity, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays("30", diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(undefined, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(normalizeRetentionDays(null, diagnostic)).toBe(DEFAULT_RETENTION_DAYS);
    expect(diagnostic).toHaveBeenCalled();
  });
});

describe("isArtifactCandidateExpired", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const baseTime = Date.parse("2026-01-01T00:00:00.000Z");

  it("returns true when nowMs equals or exceeds expiresAt", () => {
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const retentionDays = 30;
    const exactExpiry = baseTime + 30 * DAY_MS;

    expect(isArtifactCandidateExpired(updatedAt, retentionDays, exactExpiry)).toBe(true);
    expect(isArtifactCandidateExpired(updatedAt, retentionDays, exactExpiry + 1000)).toBe(true);
  });

  it("returns false when nowMs is before expiresAt", () => {
    const updatedAt = "2026-01-01T00:00:00.000Z";
    const retentionDays = 30;
    const exactExpiry = baseTime + 30 * DAY_MS;

    expect(isArtifactCandidateExpired(updatedAt, retentionDays, exactExpiry - 1)).toBe(false);
  });

  it("returns false for invalid updatedAt ISO strings", () => {
    expect(isArtifactCandidateExpired("invalid-date", 30, Date.now())).toBe(false);
  });
});

describe("drainManagedCleanupStaging", () => {
  it("returns 0 if staging directory does not exist", async () => {
    const userHome = await makeUserHome();
    const drained = await drainManagedCleanupStaging({ userHome });
    expect(drained).toBe(0);
  });

  it("removes lingering directories in managed cleanup staging", async () => {
    const userHome = await makeUserHome();
    const stagingDir = managedCleanupDirectory({ userHome });
    const leftoverDir = path.join(stagingDir, "artifact-1-leftover");
    await mkdir(leftoverDir, { recursive: true });
    await writeFile(path.join(leftoverDir, "stale.txt"), "leftover data");

    const drained = await drainManagedCleanupStaging({ userHome });
    expect(drained).toBe(1);

    await expect(readFile(path.join(leftoverDir, "stale.txt"))).rejects.toThrow();
  });
});

describe("executeArtifactRetentionCleanup", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("keeps active unexpired schema-v6 artifacts and deletes expired ones", async () => {
    const userHome = await makeUserHome();
    const now = Date.parse("2026-03-01T00:00:00.000Z");

    // 10 days old relative to now -> active with 30 days retention
    const activeUpdatedAt = new Date(now - 10 * DAY_MS).toISOString();
    await writeArtifact(userHome, "active-artifact", {
      updatedAt: activeUpdatedAt,
    });

    // 40 days old relative to now -> expired with 30 days retention
    const expiredUpdatedAt = new Date(now - 40 * DAY_MS).toISOString();
    await writeArtifact(userHome, "expired-artifact", {
      updatedAt: expiredUpdatedAt,
    });

    const result = await executeArtifactRetentionCleanup({
      retentionDays: 30,
      now,
      rootOptions: { userHome },
    });

    expect(result.scannedCount).toBe(2);
    expect(result.expiredCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.skippedCount).toBe(0);

    const collectionRoot = globalArtifactsRoot({ userHome });
    // Active artifact must still exist
    const activeManifest = JSON.parse(
      await readFile(path.join(collectionRoot, "active-artifact", "artifact.json"), "utf8"),
    );
    expect(activeManifest.artifactId).toBe("active-artifact");

    // Expired artifact must be gone
    await expect(
      readFile(path.join(collectionRoot, "expired-artifact", "artifact.json")),
    ).rejects.toThrow();
  });

  it("uses artifact.json.updatedAt instead of connection timestamp or filesystem mtime", async () => {
    const userHome = await makeUserHome();
    const now = Date.parse("2026-03-01T00:00:00.000Z");

    // Artifact created long ago, but updatedAt was refreshed 5 days ago (e.g. by review advance)
    const refreshedUpdatedAt = new Date(now - 5 * DAY_MS).toISOString();
    const dir = await writeArtifact(userHome, "advanced-artifact", {
      createdAt: new Date(now - 50 * DAY_MS).toISOString(),
      updatedAt: refreshedUpdatedAt,
    });

    // Stale connection file timestamp should not affect retention
    await writeFile(
      path.join(dir, "artifact-connection.json"),
      JSON.stringify({
        schemaVersion: 1,
        windowInstanceId: randomUUID(),
        connectionRevision: 1,
        openRequestId: randomUUID(),
        source: "create",
        updatedAt: new Date(now - 60 * DAY_MS).toISOString(),
      }),
    );

    const result = await executeArtifactRetentionCleanup({
      retentionDays: 30,
      now,
      rootOptions: { userHome },
    });

    expect(result.expiredCount).toBe(0);
    expect(result.deletedCount).toBe(0);

    // Advanced artifact is preserved
    const collectionRoot = globalArtifactsRoot({ userHome });
    await expect(
      readFile(path.join(collectionRoot, "advanced-artifact", "artifact.json")),
    ).resolves.toBeDefined();
  });

  it("safely skips schema v5, malformed manifests, mismatched IDs, and symlinks without modifying them", async () => {
    const userHome = await makeUserHome();
    const now = Date.parse("2026-03-01T00:00:00.000Z");
    const oldTimestamp = new Date(now - 50 * DAY_MS).toISOString();
    const collectionRoot = globalArtifactsRoot({ userHome });

    // Schema v5 (unsupported)
    await writeArtifact(userHome, "v5-artifact", {
      schemaVersion: 5,
      updatedAt: oldTimestamp,
    });

    // Mismatched artifactId
    await writeArtifact(userHome, "mismatched-artifact", {
      mismatchedArtifactId: "other-id",
      updatedAt: oldTimestamp,
    });

    // Malformed JSON manifest
    const malformedDir = path.join(collectionRoot, "malformed-artifact");
    await mkdir(malformedDir, { recursive: true });
    await writeFile(path.join(malformedDir, "artifact.json"), "{ invalid-json");
    await writeFile(path.join(malformedDir, "artifact.md"), "# Broken");

    // Non-artifact directory (missing artifact.json)
    const emptyDir = path.join(collectionRoot, "non-artifact");
    await mkdir(emptyDir, { recursive: true });

    const result = await executeArtifactRetentionCleanup({
      retentionDays: 30,
      now,
      rootOptions: { userHome },
    });

    // None should be deleted
    expect(result.deletedCount).toBe(0);
    expect(result.expiredCount).toBe(0);
    expect(result.skippedCount).toBe(4);

    // All original files remain intact
    await expect(readFile(path.join(collectionRoot, "v5-artifact", "artifact.json"))).resolves.toBeDefined();
    await expect(readFile(path.join(collectionRoot, "mismatched-artifact", "artifact.json"))).resolves.toBeDefined();
    await expect(readFile(path.join(collectionRoot, "malformed-artifact", "artifact.json"))).resolves.toBeDefined();
  });

  it("handles multi-window concurrent cleanup race safely", async () => {
    const userHome = await makeUserHome();
    const now = Date.parse("2026-03-01T00:00:00.000Z");
    const expiredUpdatedAt = new Date(now - 40 * DAY_MS).toISOString();

    await writeArtifact(userHome, "racing-artifact", {
      updatedAt: expiredUpdatedAt,
    });

    // Run two cleanups concurrently
    const [result1, result2] = await Promise.all([
      executeArtifactRetentionCleanup({
        retentionDays: 30,
        now,
        rootOptions: { userHome },
      }),
      executeArtifactRetentionCleanup({
        retentionDays: 30,
        now,
        rootOptions: { userHome },
      }),
    ]);

    // Total deletions across both runs must equal 1
    expect(result1.deletedCount + result2.deletedCount).toBe(1);

    // Expired artifact is permanently removed
    const collectionRoot = globalArtifactsRoot({ userHome });
    await expect(
      readFile(path.join(collectionRoot, "racing-artifact", "artifact.json")),
    ).rejects.toThrow();
  });
});
