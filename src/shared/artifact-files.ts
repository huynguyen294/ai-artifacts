import os from "node:os";
import path from "node:path";
import { artifactConversationIdSchema, artifactIdSchema } from "./contracts";

export const ARTIFACTS_DIRECTORY = ".ai-artifacts";
export const ARTIFACT_COLLECTION_DIRECTORY = "artifacts";
export const CONVERSATION_REGISTRY_DIRECTORY = "conversation-registry";
export const CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY = "registered-artifacts";
export const CONVERSATION_METADATA_FILE = "conversation.json";
export const WORK_SESSION_LAYOUT_FILE = "layout.json";
export const WORK_SESSION_INSTRUCTIONS_FILE = "instructions.md";
export const CONVERSATION_V1_BACKUP_FILE = "conversation.v1.backup.json";
export const SESSION_TYPES_FILE = "session-types.json";
export const MANAGED_ASSETS_DIRECTORY = "managed";
export const MANAGED_RUNTIME_DIRECTORY = "runtime";
export const MANAGED_WORKSPACES_DIRECTORY = "workspaces";
export const MANAGED_CLEANUP_DIRECTORY = "cleanup";
export const MANAGED_MCP_SCRIPT_FILE = "ai-artifacts-review-mcp.mjs";
export const MANAGED_INTEGRATION_VERSION_FILE = "integration-version.json";
export const MANAGED_INSTALLED_CLIENTS_FILE = "installed-clients.json";

export const ARTIFACT_MANIFEST_FILE = "artifact.json";
export const ARTIFACT_MARKDOWN_FILE = "artifact.md";
export const COMMENTS_FILE = "comments.json";
export const REVIEW_SUBMISSION_FILE = "review-submission.json";
export const ARTIFACT_UPDATE_LOCK_FILE = ".artifact-update.lock";
export const ARTIFACT_CONNECTION_FILE = "artifact-connection.json";
export const ARTIFACT_CONNECTION_LOCK_FILE = ".artifact-connection.lock";
export const ARTIFACT_UI_STATE_FILE = "artifact-ui-state.json";
export const SESSION_UI_STATE_FILE = "session-ui-state.json";

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
 * Returns the directory for an artifact (~/.ai-artifacts/artifacts/<artifactId>).
 */
export function artifactDirectory(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  return path.join(artifactCollectionRoot(options), validatedArtifactId);
}

/**
 * Returns the process-global conversation registry root (~/.ai-artifacts/conversation-registry).
 */
export function conversationRegistryRoot(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(aiArtifactsRoot(options), CONVERSATION_REGISTRY_DIRECTORY);
}

/**
 * Returns the directory for a specific conversation (~/.ai-artifacts/conversation-registry/<artifactConversationId>).
 */
export function conversationDirectory(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  const validatedConversationId = artifactConversationIdSchema.parse(artifactConversationId);
  return path.join(conversationRegistryRoot(options), validatedConversationId);
}

/**
 * Returns the conversation.json path for a specific conversation.
 */
export function conversationMetadataPath(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(conversationDirectory(artifactConversationId, options), CONVERSATION_METADATA_FILE);
}

/**
 * Returns the registered-artifacts directory for a specific conversation.
 */
export function conversationRegisteredArtifactsDirectory(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(
    conversationDirectory(artifactConversationId, options),
    CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  );
}

/**
 * Returns the membership JSON path for an artifact registered in a conversation.
 */
export function conversationRegisteredArtifactPath(
  artifactConversationId: string,
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  return path.join(
    conversationRegisteredArtifactsDirectory(artifactConversationId, options),
    `${validatedArtifactId}.json`,
  );
}

/**
 * Returns the layout.json path for a specific work session.
 */
export function workSessionLayoutPath(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(conversationDirectory(sessionId, options), WORK_SESSION_LAYOUT_FILE);
}

/**
 * Returns the instructions.md path for a specific work session.
 */
export function workSessionInstructionsPath(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(conversationDirectory(sessionId, options), WORK_SESSION_INSTRUCTIONS_FILE);
}

/**
 * Returns the conversation.v1.backup.json path for a migrated conversation.
 */
export function conversationV1BackupPath(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(conversationDirectory(sessionId, options), CONVERSATION_V1_BACKUP_FILE);
}

/**
 * Returns the artifact-ui-state.json path for a specific artifact.
 */
export function artifactUiStatePath(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(artifactDirectory(artifactId, options), ARTIFACT_UI_STATE_FILE);
}

/**
 * Returns the session-ui-state.json path for a specific work session.
 */
export function sessionUiStatePath(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  return path.join(conversationDirectory(sessionId, options), SESSION_UI_STATE_FILE);
}

/**
 * Returns the global session-types.json path.
 */
export function sessionTypesFilePath(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(aiArtifactsRoot(options), SESSION_TYPES_FILE);
}

/**
 * Returns the extension-managed assets root (~/.ai-artifacts/managed).
 */
export function managedAssetsRoot(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(aiArtifactsRoot(options), MANAGED_ASSETS_DIRECTORY);
}

/**
 * Returns the installed integration version receipt path
 * (~/.ai-artifacts/managed/integration-version.json).
 */
export function managedIntegrationVersionPath(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedAssetsRoot(options), MANAGED_INTEGRATION_VERSION_FILE);
}

/**
 * Returns the installed client selection path
 * (~/.ai-artifacts/managed/installed-clients.json).
 */
export function managedInstalledClientsPath(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedAssetsRoot(options), MANAGED_INSTALLED_CLIENTS_FILE);
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

/**
 * Returns the managed cleanup staging directory (~/.ai-artifacts/managed/cleanup).
 */
export function managedCleanupDirectory(options: GlobalArtifactsRootOptions = {}): string {
  return path.join(managedAssetsRoot(options), MANAGED_CLEANUP_DIRECTORY);
}

