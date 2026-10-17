import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ARTIFACT_CONVERSATION_SCHEMA_VERSION,
  artifactConversationIdSchema,
  artifactConversationMembershipSchema,
  artifactConversationMetadataSchema,
  artifactIdSchema,
  conversationNameSchema,
  type ArtifactConversationMembership,
  type ArtifactConversationMetadata,
} from "./contracts";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_MANIFEST_FILE,
  CONVERSATION_METADATA_FILE,
  CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  conversationDirectory,
  conversationMetadataPath,
  conversationRegisteredArtifactPath,
  conversationRegisteredArtifactsDirectory,
  conversationRegistryRoot,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  enforceOwnerOnlyDirectory,
  enforceOwnerOnlyFile,
  ensureManagedDirectory,
  sameFilesystemPath,
} from "./artifact-validation";

const TEMP_FILE_PREFIX = ".tmp-";

export class ConversationNotFoundError extends Error {
  readonly code = "CONVERSATION_NOT_FOUND" as const;
  constructor(message: string) {
    super(`CONVERSATION_NOT_FOUND: ${message}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationRegistryError extends Error {
  readonly code = "CONVERSATION_REGISTRY_INVALID" as const;
  constructor(message: string) {
    super(`CONVERSATION_REGISTRY_INVALID: ${message}`);
    this.name = "ConversationRegistryError";
  }
}

export type CreateConversationAndRegisterInput = GlobalArtifactsRootOptions & {
  conversationName: string;
  artifactId: string;
  artifactConversationId?: string;
  registeredAt?: string;
};

export type RegisterArtifactInConversationInput = GlobalArtifactsRootOptions & {
  artifactConversationId: string;
  artifactId: string;
  registeredAt?: string;
};

export type ConversationRegistrationResult = {
  conversation: ArtifactConversationMetadata;
  membership: ArtifactConversationMembership;
};

export type RegisteredConversationEntry = {
  conversation: ArtifactConversationMetadata;
  currentArtifactRegisteredAt: string;
  memberships: ArtifactConversationMembership[];
};

export type ListConversationsForArtifactOptions = GlobalArtifactsRootOptions & {
  logDiagnostic?: (message: string, error?: unknown) => void;
};

export type ListConversationsForArtifactResult = {
  conversations: RegisteredConversationEntry[];
  skippedCount: number;
};

export type CleanupStaleConversationsOptions = GlobalArtifactsRootOptions & {
  logDiagnostic?: (message: string, error?: unknown) => void;
};

export type CleanupStaleConversationsResult = {
  scannedConversations: number;
  removedMemberships: number;
  removedConversations: number;
  skippedCount: number;
};

function toRootOptions(options: GlobalArtifactsRootOptions): GlobalArtifactsRootOptions {
  return options.userHome !== undefined ? { userHome: options.userHome } : {};
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function compareIsoTimestampsAsc(leftIso: string, rightIso: string): number {
  const diff = Date.parse(leftIso) - Date.parse(rightIso);
  if (diff !== 0 && !Number.isNaN(diff)) {
    return diff;
  }
  return leftIso.localeCompare(rightIso);
}

async function assertSafeDirectoryEntry(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink()) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: symbolic links and junctions are not allowed in conversation registry storage.",
    );
  }
  if (!stat.isDirectory()) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: conversation registry storage components must be directories.",
    );
  }
}

async function assertSafeRegularFile(filePath: string, allowMissing = false): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new ConversationRegistryError(
        "UNSAFE_CONVERSATION_PATH: symbolic links are not allowed for conversation registry files.",
      );
    }
    if (!stat.isFile()) {
      throw new ConversationRegistryError(
        "UNSAFE_CONVERSATION_PATH: conversation registry file paths must be regular files.",
      );
    }
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT" && allowMissing) {
      return false;
    }
    throw error;
  }
}

export async function ensureSafeConversationRegistryRoot(
  options: GlobalArtifactsRootOptions = {},
): Promise<string> {
  const registryRoot = conversationRegistryRoot(options);
  const artifactsRoot = path.dirname(registryRoot);
  const userHome = path.dirname(artifactsRoot);

  const homeStat = await fs.lstat(userHome);
  if (!homeStat.isDirectory()) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: the artifact user home must be a directory.",
    );
  }

  await ensureManagedDirectory(path.join(userHome, ARTIFACTS_DIRECTORY));
  await ensureManagedDirectory(registryRoot);

  const [canonicalHome, canonicalRegistryRoot] = await Promise.all([
    fs.realpath(userHome),
    fs.realpath(registryRoot),
  ]);
  const relative = path.relative(canonicalHome, canonicalRegistryRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: the conversation registry root escapes the user home.",
    );
  }
  return canonicalRegistryRoot;
}

export async function ensureSafeConversationDirectory(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
  createIfMissing = false,
): Promise<{
  canonicalConversationDir: string;
  canonicalRegisteredArtifactsDir: string;
}> {
  const validatedId = artifactConversationIdSchema.parse(artifactConversationId);
  const canonicalRegistryRoot = await ensureSafeConversationRegistryRoot(options);
  const resolvedConvDir = conversationDirectory(validatedId, options);
  const resolvedRegisteredDir = conversationRegisteredArtifactsDirectory(validatedId, options);

  if (!sameFilesystemPath(path.dirname(resolvedConvDir), canonicalRegistryRoot)) {
    // Also check against non-realpath registry root in case userHome has a platform alias (e.g. macOS /var -> /private/var)
    const configuredRegistryRoot = conversationRegistryRoot(options);
    if (!sameFilesystemPath(path.dirname(resolvedConvDir), configuredRegistryRoot)) {
      throw new ConversationRegistryError(
        "UNSAFE_CONVERSATION_PATH: the conversation directory must be a direct child of conversation-registry.",
      );
    }
  }

  if (createIfMissing) {
    await ensureManagedDirectory(resolvedConvDir);
    await ensureManagedDirectory(resolvedRegisteredDir);
  } else {
    try {
      await assertSafeDirectoryEntry(resolvedConvDir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ConversationNotFoundError(
          `Conversation ${validatedId} does not exist in conversation-registry.`,
        );
      }
      throw error;
    }
    await enforceOwnerOnlyDirectory(resolvedConvDir);

    try {
      await assertSafeDirectoryEntry(resolvedRegisteredDir);
      await enforceOwnerOnlyDirectory(resolvedRegisteredDir);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ConversationRegistryError(
          `Conversation ${validatedId} is missing its ${CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY} directory.`,
        );
      }
      throw error;
    }
  }

  const [canonicalConversationDir, canonicalRegisteredArtifactsDir] = await Promise.all([
    fs.realpath(resolvedConvDir),
    fs.realpath(resolvedRegisteredDir),
  ]);

  if (
    !sameFilesystemPath(path.dirname(canonicalConversationDir), canonicalRegistryRoot)
    || path.basename(canonicalConversationDir) !== validatedId
  ) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: the conversation directory escapes the canonical conversation-registry root.",
    );
  }

  if (
    !sameFilesystemPath(path.dirname(canonicalRegisteredArtifactsDir), canonicalConversationDir)
    || path.basename(canonicalRegisteredArtifactsDir) !== CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY
  ) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: the registered-artifacts directory escapes the conversation directory.",
    );
  }

  return {
    canonicalConversationDir,
    canonicalRegisteredArtifactsDir,
  };
}

async function writeAtomicJsonFile(
  parentDirectory: string,
  targetFilePath: string,
  payload: unknown,
  exclusive = false,
): Promise<void> {
  if (!sameFilesystemPath(path.dirname(targetFilePath), parentDirectory)) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: target file must be a direct child of its conversation directory.",
    );
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  if (exclusive) {
    await assertSafeRegularFile(targetFilePath, true);
    await fs.writeFile(targetFilePath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: OWNER_ONLY_FILE_MODE,
    });
    await assertSafeRegularFile(targetFilePath, false);
    await enforceOwnerOnlyFile(targetFilePath);
    return;
  }

  await assertSafeRegularFile(targetFilePath, true);
  const tempFilePath = path.join(
    parentDirectory,
    `${path.basename(targetFilePath)}.${TEMP_FILE_PREFIX}${randomUUID()}`,
  );

  await fs.writeFile(tempFilePath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: OWNER_ONLY_FILE_MODE,
  });

  try {
    await enforceOwnerOnlyFile(tempFilePath);
    for (let attempt = 0; attempt < 3; attempt++) {
      await assertSafeRegularFile(targetFilePath, true);
      try {
        await fs.rename(tempFilePath, targetFilePath);
        await assertSafeRegularFile(targetFilePath, false);
        await enforceOwnerOnlyFile(targetFilePath);
        return;
      } catch (error) {
        if (attempt < 2 && isWindowsReplaceBlock(error)) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        if (isWindowsReplaceBlock(error) || errorCode(error) === "EXDEV") {
          await assertSafeRegularFile(targetFilePath, true);
          await fs.copyFile(tempFilePath, targetFilePath, constants.COPYFILE_FICLONE);
          await assertSafeRegularFile(targetFilePath, false);
          await enforceOwnerOnlyFile(targetFilePath);
          await fs.unlink(tempFilePath).catch(() => undefined);
          return;
        }
        throw error;
      }
    }
  } catch (error) {
    await fs.unlink(tempFilePath).catch(() => undefined);
    throw error;
  }
}

export function parseConversationMetadata(
  raw: unknown,
  expectedConversationId?: string,
): ArtifactConversationMetadata {
  if (
    !raw
    || typeof raw !== "object"
    || !("schemaVersion" in raw)
    || raw.schemaVersion !== ARTIFACT_CONVERSATION_SCHEMA_VERSION
  ) {
    throw new ConversationRegistryError(
      `Unsupported conversation metadata schema version. Expected version ${ARTIFACT_CONVERSATION_SCHEMA_VERSION}.`,
    );
  }
  const parsed = artifactConversationMetadataSchema.parse(raw);
  if (expectedConversationId && parsed.artifactConversationId !== expectedConversationId) {
    throw new ConversationRegistryError(
      `conversation.json artifactConversationId (${parsed.artifactConversationId}) does not match directory (${expectedConversationId}).`,
    );
  }
  return parsed;
}

export function parseConversationMembership(
  raw: unknown,
  expectedConversationId?: string,
  expectedArtifactId?: string,
): ArtifactConversationMembership {
  if (
    !raw
    || typeof raw !== "object"
    || !("schemaVersion" in raw)
    || raw.schemaVersion !== ARTIFACT_CONVERSATION_SCHEMA_VERSION
  ) {
    throw new ConversationRegistryError(
      `Unsupported conversation membership schema version. Expected version ${ARTIFACT_CONVERSATION_SCHEMA_VERSION}.`,
    );
  }
  const parsed = artifactConversationMembershipSchema.parse(raw);
  if (expectedConversationId && parsed.artifactConversationId !== expectedConversationId) {
    throw new ConversationRegistryError(
      `Membership artifactConversationId (${parsed.artifactConversationId}) does not match conversation (${expectedConversationId}).`,
    );
  }
  if (expectedArtifactId && parsed.artifactId !== expectedArtifactId) {
    throw new ConversationRegistryError(
      `Membership artifactId (${parsed.artifactId}) does not match filename (${expectedArtifactId}).`,
    );
  }
  return parsed;
}

export async function readConversationMetadata(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<ArtifactConversationMetadata> {
  const validatedId = artifactConversationIdSchema.parse(artifactConversationId);
  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedId,
    options,
    false,
  );
  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);

  try {
    await assertSafeRegularFile(metadataPath, false);
    await enforceOwnerOnlyFile(metadataPath);
    const rawText = await fs.readFile(metadataPath, "utf8");
    const rawJson: unknown = JSON.parse(rawText);
    return parseConversationMetadata(rawJson, validatedId);
  } catch (error) {
    if (error instanceof ConversationNotFoundError || error instanceof ConversationRegistryError) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw new ConversationRegistryError(
        `Conversation ${validatedId} is missing ${CONVERSATION_METADATA_FILE}.`,
      );
    }
    throw new ConversationRegistryError(
      `Conversation ${validatedId} has invalid ${CONVERSATION_METADATA_FILE}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createConversationAndRegisterArtifact(
  input: CreateConversationAndRegisterInput,
): Promise<ConversationRegistrationResult> {
  const conversationName = conversationNameSchema.parse(input.conversationName);
  const artifactId = artifactIdSchema.parse(input.artifactId);
  const artifactConversationId = input.artifactConversationId
    ? artifactConversationIdSchema.parse(input.artifactConversationId)
    : randomUUID();
  const timestamp = input.registeredAt
    ? z.string().datetime().parse(input.registeredAt)
    : new Date().toISOString();

  const rootOptions = toRootOptions(input);
  await ensureSafeConversationRegistryRoot(rootOptions);
  const targetConvDir = conversationDirectory(artifactConversationId, rootOptions);

  // Atomically claim creation ownership of the conversation directory so a losing concurrent caller never enters rollback
  try {
    await fs.mkdir(targetConvDir, { recursive: false, mode: OWNER_ONLY_DIRECTORY_MODE });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new ConversationRegistryError(
        `Conversation ${artifactConversationId} already exists.`,
      );
    }
    throw error;
  }

  const conversation: ArtifactConversationMetadata = {
    schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
    artifactConversationId,
    conversationName,
    createdAt: timestamp,
  };

  const membership: ArtifactConversationMembership = {
    schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
    artifactConversationId,
    artifactId,
    registeredAt: timestamp,
  };

  try {
    const {
      canonicalConversationDir,
      canonicalRegisteredArtifactsDir,
    } = await ensureSafeConversationDirectory(artifactConversationId, rootOptions, true);

    const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
    await writeAtomicJsonFile(canonicalConversationDir, metadataPath, conversation, true);

    const membershipPath = path.join(canonicalRegisteredArtifactsDir, `${artifactId}.json`);
    await writeAtomicJsonFile(canonicalRegisteredArtifactsDir, membershipPath, membership, false);
  } catch (error) {
    await fs.rm(targetConvDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return { conversation, membership };
}

export async function registerArtifactInConversation(
  input: RegisterArtifactInConversationInput,
): Promise<ConversationRegistrationResult> {
  const artifactConversationId = artifactConversationIdSchema.parse(input.artifactConversationId);
  const artifactId = artifactIdSchema.parse(input.artifactId);
  const registeredAt = input.registeredAt
    ? z.string().datetime().parse(input.registeredAt)
    : new Date().toISOString();

  const rootOptions = toRootOptions(input);
  const conversation = await readConversationMetadata(artifactConversationId, rootOptions);
  const { canonicalRegisteredArtifactsDir } = await ensureSafeConversationDirectory(
    artifactConversationId,
    rootOptions,
    false,
  );

  const membership: ArtifactConversationMembership = {
    schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
    artifactConversationId,
    artifactId,
    registeredAt,
  };

  const membershipPath = path.join(canonicalRegisteredArtifactsDir, `${artifactId}.json`);
  await writeAtomicJsonFile(canonicalRegisteredArtifactsDir, membershipPath, membership, false);

  return { conversation, membership };
}

export async function removeArtifactFromConversation(
  artifactConversationId: string,
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<boolean> {
  const validatedConvId = artifactConversationIdSchema.parse(artifactConversationId);
  const validatedArtifactId = artifactIdSchema.parse(artifactId);

  let canonicalRegisteredArtifactsDir: string;
  try {
    const safeDirs = await ensureSafeConversationDirectory(validatedConvId, options, false);
    canonicalRegisteredArtifactsDir = safeDirs.canonicalRegisteredArtifactsDir;
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return false;
    }
    throw error;
  }

  const membershipPath = path.join(canonicalRegisteredArtifactsDir, `${validatedArtifactId}.json`);

  try {
    const stat = await fs.lstat(membershipPath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new ConversationRegistryError(
        "UNSAFE_CONVERSATION_PATH: membership removal target must be a file.",
      );
    }
    await fs.unlink(membershipPath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function removeConversation(
  artifactConversationId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<boolean> {
  const validatedConvId = artifactConversationIdSchema.parse(artifactConversationId);

  let canonicalConversationDir: string;
  try {
    const safeDirs = await ensureSafeConversationDirectory(validatedConvId, options, false);
    canonicalConversationDir = safeDirs.canonicalConversationDir;
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return false;
    }
    throw error;
  }

  await fs.rm(canonicalConversationDir, { recursive: true, force: true });
  return true;
}

export async function listConversationsForArtifact(
  currentArtifactId: string,
  options: ListConversationsForArtifactOptions = {},
): Promise<ListConversationsForArtifactResult> {
  const validatedCurrentArtifactId = artifactIdSchema.parse(currentArtifactId);
  const logDiagnostic = options.logDiagnostic;
  const rootOptions = toRootOptions(options);
  const registryRoot = conversationRegistryRoot(rootOptions);

  let rootStat: import("node:fs").Stats;
  try {
    rootStat = await fs.lstat(registryRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { conversations: [], skippedCount: 0 };
    }
    throw error;
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: conversation-registry root must be a regular directory.",
    );
  }

  const canonicalRegistryRoot = await ensureSafeConversationRegistryRoot(rootOptions);
  const convEntries = await fs.readdir(canonicalRegistryRoot, { withFileTypes: true });

  const conversations: RegisteredConversationEntry[] = [];
  let skippedCount = 0;

  for (const convEntry of convEntries) {
    if (convEntry.name.startsWith(".")) {
      continue;
    }

    if (convEntry.isSymbolicLink() || !convEntry.isDirectory()) {
      skippedCount++;
      logDiagnostic?.(`Skipping non-directory or symlink entry in conversation-registry: ${convEntry.name}`);
      continue;
    }

    const parsedConvId = artifactConversationIdSchema.safeParse(convEntry.name);
    if (!parsedConvId.success) {
      skippedCount++;
      logDiagnostic?.(`Skipping invalid conversation directory name: ${convEntry.name}`);
      continue;
    }
    const convId = parsedConvId.data;

    let canonicalRegisteredArtifactsDir: string;
    try {
      const safeDirs = await ensureSafeConversationDirectory(convId, rootOptions, false);
      canonicalRegisteredArtifactsDir = safeDirs.canonicalRegisteredArtifactsDir;
    } catch (error) {
      skippedCount++;
      logDiagnostic?.(`Skipping unsafe or incomplete conversation directory ${convId}`, error);
      continue;
    }

    // Fast path: check if registered-artifacts/<currentArtifactId>.json exists before reading conversation.json or other memberships
    const candidateMembershipPath = path.join(
      canonicalRegisteredArtifactsDir,
      `${validatedCurrentArtifactId}.json`,
    );

    try {
      const exists = await assertSafeRegularFile(candidateMembershipPath, true);
      if (!exists) {
        continue;
      }
    } catch (error) {
      skippedCount++;
      logDiagnostic?.(`Skipping unsafe membership entry for ${validatedCurrentArtifactId} in ${convId}`, error);
      continue;
    }

    let conversation: ArtifactConversationMetadata;
    try {
      conversation = await readConversationMetadata(convId, rootOptions);
    } catch (error) {
      skippedCount++;
      logDiagnostic?.(`Skipping corrupt conversation metadata in ${convId}`, error);
      continue;
    }

    let memberFiles: import("node:fs").Dirent[];
    try {
      memberFiles = await fs.readdir(canonicalRegisteredArtifactsDir, { withFileTypes: true });
    } catch (error) {
      skippedCount++;
      logDiagnostic?.(`Could not read registered-artifacts for conversation ${convId}`, error);
      continue;
    }

    const memberships: ArtifactConversationMembership[] = [];
    let currentArtifactMembership: ArtifactConversationMembership | undefined;

    for (const memberEntry of memberFiles) {
      if (memberEntry.name.startsWith(".") || memberEntry.name.includes(`.${TEMP_FILE_PREFIX}`)) {
        continue;
      }

      if (memberEntry.isSymbolicLink() || !memberEntry.isFile() || !memberEntry.name.endsWith(".json")) {
        skippedCount++;
        logDiagnostic?.(`Skipping invalid file in ${convId}/registered-artifacts: ${memberEntry.name}`);
        continue;
      }

      const rawArtifactId = memberEntry.name.slice(0, -".json".length);
      const parsedArtifactId = artifactIdSchema.safeParse(rawArtifactId);
      if (!parsedArtifactId.success) {
        skippedCount++;
        logDiagnostic?.(`Skipping invalid membership filename in ${convId}: ${memberEntry.name}`);
        continue;
      }

      const memberFilePath = path.join(canonicalRegisteredArtifactsDir, memberEntry.name);
      try {
        await assertSafeRegularFile(memberFilePath, false);
        await enforceOwnerOnlyFile(memberFilePath);
        const rawMemberText = await fs.readFile(memberFilePath, "utf8");
        const rawMemberJson: unknown = JSON.parse(rawMemberText);
        const membership = parseConversationMembership(
          rawMemberJson,
          convId,
          parsedArtifactId.data,
        );
        memberships.push(membership);
        if (membership.artifactId === validatedCurrentArtifactId) {
          currentArtifactMembership = membership;
        }
      } catch (error) {
        skippedCount++;
        logDiagnostic?.(`Skipping corrupt membership ${memberEntry.name} in ${convId}`, error);
      }
    }

    if (!currentArtifactMembership) {
      // The current artifact's membership was either corrupt or removed concurrently
      continue;
    }

    memberships.sort((left, right) => {
      const timeOrder = compareIsoTimestampsAsc(left.registeredAt, right.registeredAt);
      if (timeOrder !== 0) return timeOrder;
      return left.artifactId.localeCompare(right.artifactId);
    });

    conversations.push({
      conversation,
      currentArtifactRegisteredAt: currentArtifactMembership.registeredAt,
      memberships,
    });
  }

  conversations.sort((left, right) => {
    const timeOrder = compareIsoTimestampsAsc(
      right.currentArtifactRegisteredAt,
      left.currentArtifactRegisteredAt,
    );
    if (timeOrder !== 0) return timeOrder;
    return left.conversation.artifactConversationId.localeCompare(
      right.conversation.artifactConversationId,
    );
  });

  return {
    conversations,
    skippedCount,
  };
}

export async function cleanupStaleConversations(
  options: CleanupStaleConversationsOptions = {},
): Promise<CleanupStaleConversationsResult> {
  const logDiagnostic = options.logDiagnostic;
  const rootOptions = toRootOptions(options);
  const registryRoot = conversationRegistryRoot(rootOptions);
  const collectionRoot = globalArtifactsRoot(rootOptions);

  const result: CleanupStaleConversationsResult = {
    scannedConversations: 0,
    removedMemberships: 0,
    removedConversations: 0,
    skippedCount: 0,
  };

  let rootStat: import("node:fs").Stats;
  try {
    rootStat = await fs.lstat(registryRoot);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return result;
    }
    logDiagnostic?.("Could not stat conversation-registry root during cleanup", error);
    return result;
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    logDiagnostic?.("Skipping conversation cleanup: conversation-registry root is not a regular directory");
    return result;
  }

  let canonicalRegistryRoot: string;
  try {
    canonicalRegistryRoot = await ensureSafeConversationRegistryRoot(rootOptions);
  } catch (error) {
    logDiagnostic?.("Failed to validate conversation-registry root during cleanup", error);
    return result;
  }

  let convEntries: import("node:fs").Dirent[];
  try {
    convEntries = await fs.readdir(canonicalRegistryRoot, { withFileTypes: true });
  } catch (error) {
    logDiagnostic?.("Failed to enumerate conversation-registry during cleanup", error);
    return result;
  }

  for (const convEntry of convEntries) {
    if (convEntry.name.startsWith(".")) {
      continue;
    }

    if (convEntry.isSymbolicLink() || !convEntry.isDirectory()) {
      result.skippedCount++;
      continue;
    }

    const parsedConvId = artifactConversationIdSchema.safeParse(convEntry.name);
    if (!parsedConvId.success) {
      result.skippedCount++;
      continue;
    }
    const convId = parsedConvId.data;
    result.scannedConversations++;

    let canonicalConversationDir: string;
    let canonicalRegisteredArtifactsDir: string;
    try {
      const safeDirs = await ensureSafeConversationDirectory(convId, rootOptions, false);
      canonicalConversationDir = safeDirs.canonicalConversationDir;
      canonicalRegisteredArtifactsDir = safeDirs.canonicalRegisteredArtifactsDir;
    } catch (error) {
      result.skippedCount++;
      logDiagnostic?.(`Skipping unsafe or incomplete conversation ${convId} during cleanup`, error);
      continue;
    }

    let memberEntries: import("node:fs").Dirent[];
    try {
      memberEntries = await fs.readdir(canonicalRegisteredArtifactsDir, { withFileTypes: true });
    } catch (error) {
      result.skippedCount++;
      logDiagnostic?.(`Could not read registered-artifacts for ${convId} during cleanup`, error);
      continue;
    }

    let remainingValidMemberships = 0;
    let hadSkippedEntries = false;

    for (const memberEntry of memberEntries) {
      if (memberEntry.name.startsWith(".") || memberEntry.name.includes(`.${TEMP_FILE_PREFIX}`)) {
        continue;
      }

      if (memberEntry.isSymbolicLink() || !memberEntry.isFile() || !memberEntry.name.endsWith(".json")) {
        result.skippedCount++;
        hadSkippedEntries = true;
        continue;
      }

      const rawArtifactId = memberEntry.name.slice(0, -".json".length);
      const parsedArtifactId = artifactIdSchema.safeParse(rawArtifactId);
      if (!parsedArtifactId.success) {
        result.skippedCount++;
        hadSkippedEntries = true;
        continue;
      }
      const artifactId = parsedArtifactId.data;
      const memberFilePath = path.join(canonicalRegisteredArtifactsDir, memberEntry.name);

      const manifestPath = path.join(collectionRoot, artifactId, ARTIFACT_MANIFEST_FILE);
      let artifactExists = false;
      try {
        const manifestStat = await fs.lstat(manifestPath);
        artifactExists = !manifestStat.isSymbolicLink() && manifestStat.isFile();
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          logDiagnostic?.(`Could not stat artifact manifest for ${artifactId}`, error);
          hadSkippedEntries = true;
          continue;
        }
      }

      if (!artifactExists) {
        try {
          await fs.unlink(memberFilePath);
          result.removedMemberships++;
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            logDiagnostic?.(`Failed to remove stale membership ${memberFilePath}`, error);
            hadSkippedEntries = true;
          }
        }
      } else {
        remainingValidMemberships++;
      }
    }

    if (remainingValidMemberships === 0 && !hadSkippedEntries) {
      try {
        // Atomically remove registered-artifacts only if it is genuinely empty;
        // if a concurrent registration added a membership or temp file after readdir, rmdir fails with ENOTEMPTY.
        await fs.rmdir(canonicalRegisteredArtifactsDir);
        const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
        await fs.unlink(metadataPath).catch((error) => {
          if (errorCode(error) !== "ENOENT") throw error;
        });
        await fs.rmdir(canonicalConversationDir);
        result.removedConversations++;
      } catch (error) {
        const code = errorCode(error);
        if (code !== "ENOTEMPTY" && code !== "EEXIST") {
          logDiagnostic?.(`Failed to remove empty conversation directory ${canonicalConversationDir}`, error);
        }
      }
    }
  }

  return result;
}
