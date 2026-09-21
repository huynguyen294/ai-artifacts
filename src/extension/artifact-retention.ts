import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  globalArtifactsRoot,
  managedCleanupDirectory,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  ensureManagedDirectory,
  ensureSafeGlobalArtifactsRoot,
  parseArtifactManifest,
} from "../shared/artifact-validation";
import { artifactIdSchema } from "../shared/contracts";

export const DEFAULT_RETENTION_DAYS = 30;
export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type RetentionCleanupOptions = {
  retentionDays?: number | unknown;
  now?: number;
  rootOptions?: GlobalArtifactsRootOptions;
  logDiagnostic?: (message: string, error?: unknown) => void;
};

export type RetentionCleanupResult = {
  scannedCount: number;
  expiredCount: number;
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

/**
 * Validates and normalizes retention days to a positive safe integer.
 * Falls back to DEFAULT_RETENTION_DAYS (30) for invalid values (<= 0, NaN, floats, overflow).
 */
export function normalizeRetentionDays(
  rawDays: unknown,
  logDiagnostic?: (message: string) => void,
): number {
  if (
    typeof rawDays === "number"
    && Number.isSafeInteger(rawDays)
    && rawDays >= 1
    && rawDays * DAY_IN_MS <= Number.MAX_SAFE_INTEGER
  ) {
    return rawDays;
  }

  logDiagnostic?.(
    `Invalid artifact retention days ${String(rawDays)}; falling back to default ${DEFAULT_RETENTION_DAYS} days.`,
  );
  return DEFAULT_RETENTION_DAYS;
}

/**
 * Checks whether an artifact manifest timestamp has expired according to retentionDays.
 * Formula: expiresAt = Date.parse(updatedAtIso) + retentionDays * DAY_IN_MS
 * Returns true if nowMs >= expiresAt.
 */
export function isArtifactCandidateExpired(
  updatedAtIso: string,
  retentionDays: number,
  nowMs: number,
): boolean {
  const updatedAtMs = Date.parse(updatedAtIso);
  if (Number.isNaN(updatedAtMs)) {
    return false;
  }
  const expiresAt = updatedAtMs + retentionDays * DAY_IN_MS;
  return nowMs >= expiresAt;
}

/**
 * Drains any leftover staged deletion directories in managed/cleanup/ from previous
 * interrupted runs or crashes.
 */
export async function drainManagedCleanupStaging(
  options: GlobalArtifactsRootOptions = {},
  logDiagnostic?: (message: string, error?: unknown) => void,
): Promise<number> {
  const stagingRoot = managedCleanupDirectory(options);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return 0;
    }
    logDiagnostic?.("Could not read managed cleanup staging directory", error);
    return 0;
  }

  let drainedCount = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      continue;
    }
    const stagedDir = path.join(stagingRoot, entry.name);
    try {
      await fs.rm(stagedDir, { recursive: true, force: true });
      drainedCount++;
    } catch (error) {
      logDiagnostic?.(`Could not drain staged directory ${stagedDir}`, error);
    }
  }

  return drainedCount;
}

/**
 * Runs artifact retention cleanup across the canonical global artifact collection:
 * 1. Drains lingering cleanup staging entries from previous runs.
 * 2. Enumerates validated schema-v6 artifacts under canonical ~/.ai-artifacts/artifacts/.
 * 3. Identifies candidates expired based on artifact.json.updatedAt.
 * 4. Revalidates candidates and performs atomic rename to managed cleanup staging.
 * 5. Recursively deletes staged directories.
 */
export async function executeArtifactRetentionCleanup(
  options: RetentionCleanupOptions = {},
): Promise<RetentionCleanupResult> {
  const logDiagnostic = options.logDiagnostic ?? ((msg, err) => {
    if (err) console.warn(`[AI Artifacts Retention] ${msg}`, err);
    else console.warn(`[AI Artifacts Retention] ${msg}`);
  });

  const retentionDays = normalizeRetentionDays(options.retentionDays, (msg) => logDiagnostic(msg));
  const nowMs = options.now ?? Date.now();
  const rootOptions = options.rootOptions ?? {};

  const result: RetentionCleanupResult = {
    scannedCount: 0,
    expiredCount: 0,
    deletedCount: 0,
    skippedCount: 0,
    failedCount: 0,
  };

  // 1. Drain lingering staging
  await drainManagedCleanupStaging(rootOptions, logDiagnostic);

  // 2. Ensure collection root
  let collectionRoot: string;
  try {
    collectionRoot = await ensureSafeGlobalArtifactsRoot(rootOptions);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return result;
    }
    logDiagnostic("Could not access global artifact collection root", error);
    return result;
  }

  // 3. Enumerate candidates
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(collectionRoot, { withFileTypes: true });
  } catch (error) {
    logDiagnostic("Could not read global artifact collection directory", error);
    return result;
  }

  // Staging directory preparation on demand
  const stagingRoot = managedCleanupDirectory(rootOptions);

  for (const entry of entries) {
    result.scannedCount++;

    // Must be direct-child real directory, not symlink or junction
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      result.skippedCount++;
      continue;
    }

    // Must have valid artifactId basename
    const idParse = artifactIdSchema.safeParse(entry.name);
    if (!idParse.success) {
      result.skippedCount++;
      continue;
    }

    const artifactId = idParse.data;
    const candidateDir = path.join(collectionRoot, artifactId);
    const manifestPath = path.join(candidateDir, ARTIFACT_MANIFEST_FILE);
    const markdownPath = path.join(candidateDir, ARTIFACT_MARKDOWN_FILE);

    try {
      const [manifestStat, markdownStat] = await Promise.all([
        fs.lstat(manifestPath),
        fs.lstat(markdownPath),
      ]);

      if (
        manifestStat.isSymbolicLink()
        || !manifestStat.isFile()
        || markdownStat.isSymbolicLink()
        || !markdownStat.isFile()
      ) {
        result.skippedCount++;
        continue;
      }

      const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const manifest = parseArtifactManifest(manifestRaw);

      if (manifest.artifactId !== artifactId) {
        result.skippedCount++;
        continue;
      }

      if (!isArtifactCandidateExpired(manifest.updatedAt, retentionDays, nowMs)) {
        // Active / unexpired artifact: preserve untouched
        continue;
      }

      result.expiredCount++;

      // Candidate is expired. Ensure staging root exists.
      await ensureManagedDirectory(stagingRoot);

      // Acquire an exclusive per-artifact claim in staging to resolve multi-window race cleanly
      const claimPath = path.join(stagingRoot, `.claim-${artifactId}`);
      try {
        await fs.mkdir(claimPath);
      } catch (claimError) {
        if (errorCode(claimError) === "EEXIST") {
          // Another window or process is already staging/deleting this candidate
          continue;
        }
        throw claimError;
      }

      // Revalidate immediately before staging rename.
      try {
        const recheckRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        const recheckManifest = parseArtifactManifest(recheckRaw);
        if (
          recheckManifest.artifactId !== artifactId
          || !isArtifactCandidateExpired(recheckManifest.updatedAt, retentionDays, nowMs)
        ) {
          await fs.rm(claimPath, { recursive: true, force: true });
          result.skippedCount++;
          continue;
        }
      } catch {
        await fs.rm(claimPath, { recursive: true, force: true });
        result.skippedCount++;
        continue;
      }

      const stagedDir = path.join(stagingRoot, `${artifactId}-${randomUUID()}`);

      // Atomic rename to cleanup staging
      try {
        await fs.rename(candidateDir, stagedDir);
      } catch (renameError) {
        await fs.rm(claimPath, { recursive: true, force: true });
        const code = errorCode(renameError);
        if (code === "ENOENT") {
          // Another window or process won the rename race
          continue;
        }
        if (code === "EPERM" || code === "EBUSY" || code === "EACCES") {
          logDiagnostic(`Filesystem locked candidate artifact ${artifactId} (${code})`, renameError);
          result.failedCount++;
          continue;
        }
        throw renameError;
      }

      // Deletion commit point reached: artifact handle no longer exists in collection
      try {
        await fs.rm(stagedDir, { recursive: true, force: true });
      } catch (rmError) {
        logDiagnostic(`Failed immediate deletion of staged artifact ${stagedDir}`, rmError);
      } finally {
        await fs.rm(claimPath, { recursive: true, force: true });
      }
      result.deletedCount++;
    } catch {
      // Malformed manifest, missing files, or parse errors: skip safely without mutation
      result.skippedCount++;
    }
  }

  return result;
}
