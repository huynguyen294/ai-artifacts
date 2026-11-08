import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  artifactCollectionRoot,
  managedCleanupDirectory,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  ensureManagedDirectory,
  ensureSafeGlobalArtifactsRoot,
  parseArtifactManifest,
} from "../shared/artifact-validation";
import { artifactIdSchema } from "../shared/contracts";
import {
  cleanupStaleConversations,
  type CleanupStaleConversationsResult,
} from "../shared/conversation-artifact-registry";

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export type DeleteArtifactResult = {
  deleted: boolean;
  conversationCleanup?: CleanupStaleConversationsResult;
  cleanupError?: string;
  error?: string;
};

/**
 * Deletes a single artifact globally from ~/.ai-artifacts/artifacts/<artifactId>.
 *
 * Uses exclusive claim + atomic rename to managed cleanup staging to prevent
 * multi-window race conditions and ensure zero half-deleted artifact files.
 *
 * Returns true if the artifact was found, validated, and deleted.
 * Returns false if the artifact did not exist or failed target validation.
 */
export async function deleteSingleArtifact(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
  logDiagnostic?: (message: string, error?: unknown) => void,
): Promise<boolean> {
  const idParse = artifactIdSchema.safeParse(artifactId);
  if (!idParse.success) {
    return false;
  }

  let collectionRoot: string;
  try {
    collectionRoot = await ensureSafeGlobalArtifactsRoot(options);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }

  const targetDir = path.join(collectionRoot, artifactId);

  // 1. Validate real directory
  try {
    const dirStat = await fs.lstat(targetDir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      return false;
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }

  const manifestPath = path.join(targetDir, ARTIFACT_MANIFEST_FILE);
  const markdownPath = path.join(targetDir, ARTIFACT_MARKDOWN_FILE);

  // 2. Validate manifest and markdown files
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
      return false;
    }

    const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const manifest = parseArtifactManifest(manifestRaw);
    if (manifest.artifactId !== artifactId) {
      return false;
    }
  } catch {
    return false;
  }

  // 3. Prepare staging root and acquire exclusive claim
  const stagingRoot = managedCleanupDirectory(options);
  await ensureManagedDirectory(stagingRoot);

  const claimPath = path.join(stagingRoot, `.claim-${artifactId}`);
  try {
    await fs.mkdir(claimPath);
  } catch (claimError) {
    if (errorCode(claimError) === "EEXIST") {
      // Another process or window is currently deleting/staging this artifact
      return false;
    }
    throw claimError;
  }

  try {
    // 4. Revalidate manifest before renaming
    const recheckRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const recheckManifest = parseArtifactManifest(recheckRaw);
    if (recheckManifest.artifactId !== artifactId) {
      return false;
    }

    // 5. Atomic rename to staging
    const stagedDir = path.join(stagingRoot, `deleted-${artifactId}-${randomUUID()}`);
    await fs.rename(targetDir, stagedDir);

    // Commit point reached: artifact is removed from collection.
    // 6. Delete staged files recursively (staging cleanup handles failures)
    try {
      await fs.rm(stagedDir, { recursive: true, force: true });
    } catch (stagingRmError) {
      logDiagnostic?.(
        `Artifact ${artifactId} moved to staging, but deleting staged files encountered an error`,
        stagingRmError,
      );
    }
    return true;
  } catch (error) {
    logDiagnostic?.(`Failed to complete deletion for artifact ${artifactId}`, error);
    throw error;
  } finally {
    await fs.rm(claimPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Deletes a single artifact globally and immediately prunes any stale
 * references in work sessions via cleanupStaleConversations.
 *
 * Empty v2 work sessions are preserved.
 */
export async function deleteArtifactAndCleanup(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
  logDiagnostic?: (message: string, error?: unknown) => void,
): Promise<DeleteArtifactResult> {
  let deleted = false;
  try {
    deleted = await deleteSingleArtifact(artifactId, options, logDiagnostic);
  } catch (delError) {
    const errorMsg = delError instanceof Error ? delError.message : String(delError);
    return { deleted: false, error: errorMsg };
  }

  if (!deleted) {
    return { deleted: false, error: "Artifact manifest verification failed or artifact missing." };
  }

  let conversationCleanup: CleanupStaleConversationsResult | undefined;
  let cleanupError: string | undefined;
  try {
    conversationCleanup = await cleanupStaleConversations({
      ...options,
      ...(logDiagnostic ? { logDiagnostic } : {}),
    });
  } catch (err) {
    cleanupError = err instanceof Error ? err.message : String(err);
    logDiagnostic?.(
      `Artifact ${artifactId} was deleted, but conversation cleanup encountered an error`,
      err,
    );
  }

  return {
    deleted: true,
    ...(conversationCleanup ? { conversationCleanup } : {}),
    ...(cleanupError ? { cleanupError } : {}),
  };
}

