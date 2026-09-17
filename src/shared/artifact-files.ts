import os from "node:os";
import path from "node:path";

export const ARTIFACTS_DIRECTORY = ".ai-artifacts";
export const ARTIFACT_COLLECTION_DIRECTORY = "artifacts";
export const MANAGED_ASSETS_DIRECTORY = "managed";
export const MANAGED_RUNTIME_DIRECTORY = "runtime";
export const MANAGED_WORKSPACES_DIRECTORY = "workspaces";
export const MANAGED_MCP_SCRIPT_FILE = "ai-artifacts-review-mcp.mjs";

export const ARTIFACT_MANIFEST_FILE = "artifact.json";
export const ARTIFACT_MARKDOWN_FILE = "artifact.md";
export const COMMENTS_FILE = "comments.json";
export const REVIEW_SUBMISSION_FILE = "review-submission.json";
export const ARTIFACT_UPDATE_LOCK_FILE = ".artifact-update.lock";
export const ARTIFACT_CONNECTION_FILE = "artifact-connection.json";
export const ARTIFACT_CONNECTION_LOCK_FILE = ".artifact-connection.lock";

export const OWNER_ONLY_DIRECTORY_MODE = 0o700;
export const OWNER_ONLY_FILE_MODE = 0o600;

export type GlobalArtifactsRootOptions = {
  userHome?: string;
};

/**
 * Returns the process-global product root (~/.ai-artifacts).
 */
export function aiArtifactsRoot(options: GlobalArtifactsRootOptions = {}): string {
  const userHome = options.userHome ?? os.homedir();
  if (!path.isAbsolute(userHome)) {
    throw new Error("The artifact user home must be an absolute path.");
  }
  return path.join(path.resolve(userHome), ARTIFACTS_DIRECTORY);
}

/**
 * Returns the process-global artifact collection root (~/.ai-artifacts/artifacts).
 */
export function artifactCollectionRoot(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(aiArtifactsRoot(options), ARTIFACT_COLLECTION_DIRECTORY);
}

/**
 * Compatibility alias for artifactCollectionRoot.
 *
 * Production callers omit `userHome`. Tests supply an isolated absolute home so
 * they never depend on, or write beneath, the real user home.
 */
export function globalArtifactsRoot(options: GlobalArtifactsRootOptions = {}): string {
  return artifactCollectionRoot(options);
}

/**
 * Returns the extension-managed assets root (~/.ai-artifacts/managed).
 */
export function managedAssetsRoot(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(aiArtifactsRoot(options), MANAGED_ASSETS_DIRECTORY);
}

/**
 * Returns the managed runtime directory (~/.ai-artifacts/managed/runtime).
 */
export function managedRuntimeDirectory(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedAssetsRoot(options), MANAGED_RUNTIME_DIRECTORY);
}

/**
 * Returns the canonical managed MCP script path (~/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs).
 */
export function managedMcpScriptPath(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedRuntimeDirectory(options), MANAGED_MCP_SCRIPT_FILE);
}

/**
 * Returns the managed workspace registry directory (~/.ai-artifacts/managed/workspaces).
 */
export function managedWorkspaceRegistryDirectory(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedAssetsRoot(options), MANAGED_WORKSPACES_DIRECTORY);
}
