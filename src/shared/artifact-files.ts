import os from "node:os";
import path from "node:path";

export const ARTIFACTS_DIRECTORY = ".ai-artifacts";
export const LEGACY_ARTIFACTS_DIRECTORY = ".codex-artifacts";
export const ARTIFACTS_DIRECTORIES = [ARTIFACTS_DIRECTORY, LEGACY_ARTIFACTS_DIRECTORY] as const;
export const ARTIFACT_COLLECTION_DIRECTORY = "artifacts";
export const ARTIFACT_MANIFEST_FILE = "artifact.json";
export const ARTIFACT_MARKDOWN_FILE = "artifact.md";
export const COMMENTS_FILE = "comments.json";
export const REVIEW_SUBMISSION_FILE = "review-submission.json";
export const ARTIFACT_UPDATE_LOCK_FILE = ".artifact-update.lock";

export const OWNER_ONLY_DIRECTORY_MODE = 0o700;
export const OWNER_ONLY_FILE_MODE = 0o600;

export type GlobalArtifactsRootOptions = {
  userHome?: string;
};

/**
 * Returns the process-global artifact collection root.
 *
 * Production callers omit `userHome`. Tests supply an isolated absolute home so
 * they never depend on, or write beneath, the real user home.
 */
export function globalArtifactsRoot(options: GlobalArtifactsRootOptions = {}): string {
  const userHome = options.userHome ?? os.homedir();
  if (!path.isAbsolute(userHome)) {
    throw new Error("The artifact user home must be an absolute path.");
  }
  return path.join(path.resolve(userHome), ARTIFACTS_DIRECTORY, ARTIFACT_COLLECTION_DIRECTORY);
}
