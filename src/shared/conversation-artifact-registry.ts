import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ARTIFACT_CONVERSATION_SCHEMA_VERSION,
  DEFAULT_SESSION_TYPE_ID,
  WORK_SESSION_LAYOUT_SCHEMA_VERSION,
  WORK_SESSION_SCHEMA_VERSION,
  ConversationMigrationRequiredError,
  artifactConversationIdSchema,
  artifactConversationMembershipSchema,
  artifactConversationMetadataSchema,
  artifactIdSchema,
  conversationNameSchema,
  sessionInstructionsSchema,
  sessionTitleSchema,
  sessionTypeIdSchema,
  workSessionLayoutSchema,
  workSessionMetadataSchema,
  type ArtifactConversationMembership,
  type ArtifactConversationMetadata,
  type WorkSession,
  type WorkSessionLayout,
  type WorkSessionMetadata,
} from "./contracts";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  CONVERSATION_METADATA_FILE,
  CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  CONVERSATION_V1_BACKUP_FILE,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  WORK_SESSION_INSTRUCTIONS_FILE,
  WORK_SESSION_LAYOUT_FILE,
  conversationDirectory,
  conversationMetadataPath,
  conversationRegisteredArtifactPath,
  conversationRegisteredArtifactsDirectory,
  conversationRegistryRoot,
  conversationV1BackupPath,
  globalArtifactsRoot,
  workSessionLayoutPath,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  enforceOwnerOnlyDirectory,
  enforceOwnerOnlyFile,
  ensureManagedDirectory,
  parseArtifactManifest,
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

export type CreateSessionInput = GlobalArtifactsRootOptions & {
  title: string;
  sessionId?: string;
  typeId?: string;
  instructions?: string;
  createdAt?: string;
};

export type MigrationCandidateEntry = {
  sessionId: string;
  title: string;
  createdAt: string;
  artifactCount: number;
};

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

export function compareIsoTimestampsAsc(leftIso: string, rightIso: string): number {
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

async function writeAtomicTextFile(
  parentDirectory: string,
  targetFilePath: string,
  content: string,
  exclusive = false,
): Promise<void> {
  if (!sameFilesystemPath(path.dirname(targetFilePath), parentDirectory)) {
    throw new ConversationRegistryError(
      "UNSAFE_CONVERSATION_PATH: target file must be a direct child of its conversation directory.",
    );
  }

  if (exclusive) {
    await assertSafeRegularFile(targetFilePath, true);
    await fs.writeFile(targetFilePath, content, {
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

  await fs.writeFile(tempFilePath, content, {
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

async function writeAtomicJsonFile(
  parentDirectory: string,
  targetFilePath: string,
  payload: unknown,
  exclusive = false,
): Promise<void> {
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  return writeAtomicTextFile(parentDirectory, targetFilePath, serialized, exclusive);
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

export function parseWorkSessionMetadata(
  raw: unknown,
  expectedSessionId?: string,
): WorkSessionMetadata {
  if (
    !raw
    || typeof raw !== "object"
    || !("schemaVersion" in raw)
    || raw.schemaVersion !== WORK_SESSION_SCHEMA_VERSION
  ) {
    throw new ConversationRegistryError(
      `Unsupported work session metadata schema version. Expected version ${WORK_SESSION_SCHEMA_VERSION}.`,
    );
  }
  const parsed = workSessionMetadataSchema.parse(raw);
  if (expectedSessionId && parsed.sessionId !== expectedSessionId) {
    throw new ConversationRegistryError(
      `conversation.json sessionId (${parsed.sessionId}) does not match directory (${expectedSessionId}).`,
    );
  }
  return parsed;
}

export function parseWorkSessionLayout(raw: unknown): WorkSessionLayout {
  if (
    !raw
    || typeof raw !== "object"
    || !("schemaVersion" in raw)
    || raw.schemaVersion !== WORK_SESSION_LAYOUT_SCHEMA_VERSION
  ) {
    throw new ConversationRegistryError(
      `Unsupported work session layout schema version. Expected version ${WORK_SESSION_LAYOUT_SCHEMA_VERSION}.`,
    );
  }
  return workSessionLayoutSchema.parse(raw);
}

export function reconcileSessionLayout(
  registeredMemberships: ArtifactConversationMembership[],
  layoutRaw: WorkSessionLayout | null | undefined,
  createdAt: string,
): {
  working: string[];
  references: string[];
  archived: string[];
  updatedAt: string;
} {
  const registeredMap = new Map<string, ArtifactConversationMembership>();
  for (const m of registeredMemberships) {
    registeredMap.set(m.artifactId, m);
  }

  const seen = new Set<string>();
  const working: string[] = [];
  const references: string[] = [];
  const archived: string[] = [];

  const filterZone = (zoneSource: string[] | undefined, target: string[]) => {
    if (!Array.isArray(zoneSource)) return;
    for (const id of zoneSource) {
      if (typeof id === "string" && registeredMap.has(id) && !seen.has(id)) {
        seen.add(id);
        target.push(id);
      }
    }
  };

  if (layoutRaw) {
    filterZone(layoutRaw.working, working);
    filterZone(layoutRaw.references, references);
    filterZone(layoutRaw.archived, archived);
  }

  const unplaced: ArtifactConversationMembership[] = [];
  for (const [id, membership] of registeredMap.entries()) {
    if (!seen.has(id)) {
      unplaced.push(membership);
    }
  }

  unplaced.sort((a, b) => {
    const diff = compareIsoTimestampsAsc(a.registeredAt, b.registeredAt);
    if (diff !== 0) return diff;
    return a.artifactId.localeCompare(b.artifactId);
  });

  for (const m of unplaced) {
    seen.add(m.artifactId);
    working.push(m.artifactId);
  }

  let latestIso = createdAt;
  for (const m of registeredMemberships) {
    if (compareIsoTimestampsAsc(m.registeredAt, latestIso) > 0) {
      latestIso = m.registeredAt;
    }
  }

  return {
    working,
    references,
    archived,
    updatedAt: latestIso,
  };
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

/**
 * Deletes a Work Session directory and all of its metadata, instructions, layout, and memberships.
 * Artifact files themselves in ~/.ai-artifacts/artifacts/ are NEVER deleted by this function.
 *
 * Verifies that the target directory contains valid Work Session v2 metadata matching sessionId
 * before performing deletion.
 */
export async function deleteSession(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<boolean> {
  const validatedConvId = artifactConversationIdSchema.parse(sessionId);

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

  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  await assertSafeRegularFile(metadataPath, false);
  const rawContent = await fs.readFile(metadataPath, "utf8");
  const rawJson = JSON.parse(rawContent);
  parseWorkSessionMetadata(rawJson, validatedConvId);

  await fs.rm(canonicalConversationDir, { recursive: true, force: true });
  return true;
}

export async function readSessionInstructions(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<string> {
  const validatedId = artifactConversationIdSchema.parse(sessionId);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedId,
    rootOptions,
    false,
  );
  const instructionsPath = path.join(canonicalConversationDir, WORK_SESSION_INSTRUCTIONS_FILE);
  try {
    const exists = await assertSafeRegularFile(instructionsPath, true);
    if (!exists) return "";
    await enforceOwnerOnlyFile(instructionsPath);
    return await fs.readFile(instructionsPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "";
    throw error;
  }
}

export async function writeSessionInstructions(
  sessionId: string,
  instructions: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<void> {
  const validatedId = artifactConversationIdSchema.parse(sessionId);
  const validatedInstructions = sessionInstructionsSchema.parse(instructions);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedId,
    rootOptions,
    false,
  );

  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  await assertSafeRegularFile(metadataPath, false);
  await enforceOwnerOnlyFile(metadataPath);
  const rawMeta = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  if (
    rawMeta &&
    typeof rawMeta === "object" &&
    "schemaVersion" in rawMeta &&
    rawMeta.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION
  ) {
    throw new ConversationMigrationRequiredError(validatedId);
  }
  parseWorkSessionMetadata(rawMeta, validatedId);

  const instructionsPath = path.join(canonicalConversationDir, WORK_SESSION_INSTRUCTIONS_FILE);
  await writeAtomicTextFile(canonicalConversationDir, instructionsPath, validatedInstructions, false);
}

export async function createSession(
  input: CreateSessionInput,
): Promise<WorkSession> {
  const title = sessionTitleSchema.parse(input.title);
  const sessionId = input.sessionId
    ? artifactConversationIdSchema.parse(input.sessionId)
    : randomUUID();
  const typeId = input.typeId
    ? sessionTypeIdSchema.parse(input.typeId)
    : DEFAULT_SESSION_TYPE_ID;
  const instructions = input.instructions ?? "";
  const createdAt = input.createdAt
    ? z.string().datetime().parse(input.createdAt)
    : new Date().toISOString();

  const rootOptions = toRootOptions(input);
  await ensureSafeConversationRegistryRoot(rootOptions);
  const targetConvDir = conversationDirectory(sessionId, rootOptions);

  try {
    await fs.mkdir(targetConvDir, { recursive: false, mode: OWNER_ONLY_DIRECTORY_MODE });
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new ConversationRegistryError(`Session ${sessionId} already exists.`);
    }
    throw error;
  }

  const metadata: WorkSessionMetadata = {
    schemaVersion: WORK_SESSION_SCHEMA_VERSION,
    sessionId,
    title,
    typeId,
    createdAt,
  };

  try {
    const { canonicalConversationDir } = await ensureSafeConversationDirectory(
      sessionId,
      rootOptions,
      true,
    );
    const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
    await writeAtomicJsonFile(canonicalConversationDir, metadataPath, metadata, true);
    const instructionsPath = path.join(canonicalConversationDir, WORK_SESSION_INSTRUCTIONS_FILE);
    await writeAtomicTextFile(canonicalConversationDir, instructionsPath, instructions, true);
  } catch (error) {
    await fs.rm(targetConvDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }

  return {
    ...metadata,
    instructions,
    working: [],
    references: [],
    archived: [],
    updatedAt: createdAt,
  };
}

export async function readSession(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession> {
  const validatedId = artifactConversationIdSchema.parse(sessionId);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir, canonicalRegisteredArtifactsDir } =
    await ensureSafeConversationDirectory(validatedId, rootOptions, false);

  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  let rawJson: unknown;
  try {
    await assertSafeRegularFile(metadataPath, false);
    await enforceOwnerOnlyFile(metadataPath);
    const rawText = await fs.readFile(metadataPath, "utf8");
    rawJson = JSON.parse(rawText);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new ConversationNotFoundError(`Session ${validatedId} does not exist.`);
    }
    throw error;
  }

  if (
    rawJson
    && typeof rawJson === "object"
    && "schemaVersion" in rawJson
    && rawJson.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION
  ) {
    throw new ConversationMigrationRequiredError(validatedId);
  }

  const metadata = parseWorkSessionMetadata(rawJson, validatedId);

  const memberFiles = await fs.readdir(canonicalRegisteredArtifactsDir, { withFileTypes: true });
  const memberships: ArtifactConversationMembership[] = [];
  for (const entry of memberFiles) {
    if (entry.name.startsWith(".") || !entry.name.endsWith(".json") || !entry.isFile()) continue;
    const rawArtifactId = entry.name.slice(0, -".json".length);
    if (!artifactIdSchema.safeParse(rawArtifactId).success) continue;
    try {
      const memberPath = path.join(canonicalRegisteredArtifactsDir, entry.name);
      await assertSafeRegularFile(memberPath, false);
      await enforceOwnerOnlyFile(memberPath);
      const memberText = await fs.readFile(memberPath, "utf8");
      const memberJson = JSON.parse(memberText);
      memberships.push(parseConversationMembership(memberJson, validatedId, rawArtifactId));
    } catch {
      // skip invalid membership entry
    }
  }

  const layoutFilePath = path.join(canonicalConversationDir, WORK_SESSION_LAYOUT_FILE);
  let layout: WorkSessionLayout | null = null;
  try {
    const exists = await assertSafeRegularFile(layoutFilePath, true);
    if (exists) {
      const layoutText = await fs.readFile(layoutFilePath, "utf8");
      layout = parseWorkSessionLayout(JSON.parse(layoutText));
    }
  } catch {
    layout = null;
  }

  const reconciled = reconcileSessionLayout(memberships, layout, metadata.createdAt);
  const instructions = await readSessionInstructions(validatedId, rootOptions);

  return {
    ...metadata,
    instructions,
    working: reconciled.working,
    references: reconciled.references,
    archived: reconciled.archived,
    updatedAt: reconciled.updatedAt,
  };
}

export async function listSessions(
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession[]> {
  const rootOptions = toRootOptions(options);
  const registryRoot = conversationRegistryRoot(rootOptions);

  try {
    const rootStat = await fs.lstat(registryRoot);
    if (!rootStat.isDirectory()) return [];
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const canonicalRoot = await ensureSafeConversationRegistryRoot(rootOptions);
  const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
  const sessions: WorkSession[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const parsedId = artifactConversationIdSchema.safeParse(entry.name);
    if (!parsedId.success) continue;
    const convId = parsedId.data;

    try {
      const metaPath = path.join(canonicalRoot, convId, CONVERSATION_METADATA_FILE);
      const metaRaw = JSON.parse(await fs.readFile(metaPath, "utf8"));
      if (metaRaw?.schemaVersion === WORK_SESSION_SCHEMA_VERSION) {
        const session = await readSession(convId, rootOptions);
        sessions.push(session);
      }
    } catch {
      // skip invalid or v1 entries
    }
  }

  sessions.sort((a, b) => {
    const diff = compareIsoTimestampsAsc(b.updatedAt, a.updatedAt);
    if (diff !== 0) return diff;
    return a.sessionId.localeCompare(b.sessionId);
  });

  return sessions;
}

export async function updateSessionDetails(
  sessionId: string,
  details: { title?: string; instructions?: string },
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession> {
  const validatedId = artifactConversationIdSchema.parse(sessionId);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedId,
    rootOptions,
    false,
  );

  const current = await readSession(validatedId, rootOptions);
  const newTitle = details.title !== undefined ? sessionTitleSchema.parse(details.title) : current.title;
  let newInstructions = current.instructions;

  if (details.instructions !== undefined) {
    newInstructions = sessionInstructionsSchema.parse(details.instructions);
    await writeSessionInstructions(validatedId, newInstructions, rootOptions);
  }

  if (details.title !== undefined) {
    const updatedMeta: WorkSessionMetadata = {
      schemaVersion: WORK_SESSION_SCHEMA_VERSION,
      sessionId: validatedId,
      title: newTitle,
      typeId: current.typeId,
      createdAt: current.createdAt,
    };

    const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
    await writeAtomicJsonFile(canonicalConversationDir, metadataPath, updatedMeta, false);
  }

  return {
    ...current,
    title: newTitle,
    instructions: newInstructions,
  };
}

export async function setSessionType(
  sessionId: string,
  rawTypeId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession> {
  const validatedId = artifactConversationIdSchema.parse(sessionId);
  const typeId = sessionTypeIdSchema.parse(rawTypeId);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedId,
    rootOptions,
    false,
  );

  const current = await readSession(validatedId, rootOptions);

  const updatedMeta: WorkSessionMetadata = {
    schemaVersion: WORK_SESSION_SCHEMA_VERSION,
    sessionId: validatedId,
    title: current.title,
    typeId,
    createdAt: current.createdAt,
  };

  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  await writeAtomicJsonFile(canonicalConversationDir, metadataPath, updatedMeta, false);

  return {
    ...current,
    typeId,
  };
}

export async function registerArtifactInSession(
  sessionId: string,
  artifactId: string,
  options: GlobalArtifactsRootOptions & { registeredAt?: string } = {},
): Promise<{
  session: WorkSession;
  previousRegisteredAt?: string | undefined;
  added: boolean;
}> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  const rootOptions = toRootOptions(options);

  const { canonicalConversationDir, canonicalRegisteredArtifactsDir } = await ensureSafeConversationDirectory(
    validatedSessionId,
    rootOptions,
    false,
  );

  const metadataFilePath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  await assertSafeRegularFile(metadataFilePath, false);
  await enforceOwnerOnlyFile(metadataFilePath);
  const rawMetaText = await fs.readFile(metadataFilePath, "utf8");
  const rawMetaJson = JSON.parse(rawMetaText);
  if (
    rawMetaJson
    && typeof rawMetaJson === "object"
    && "schemaVersion" in rawMetaJson
    && rawMetaJson.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION
  ) {
    throw new ConversationMigrationRequiredError(validatedSessionId);
  }
  parseWorkSessionMetadata(rawMetaJson, validatedSessionId);

  const membershipPath = path.join(
    canonicalRegisteredArtifactsDir,
    `${validatedArtifactId}.json`,
  );

  let previousRegisteredAt: string | undefined;
  let added = true;

  try {
    const exists = await assertSafeRegularFile(membershipPath, true);
    if (exists) {
      const rawText = await fs.readFile(membershipPath, "utf8");
      const parsed = artifactConversationMembershipSchema.safeParse(JSON.parse(rawText));
      if (parsed.success) {
        previousRegisteredAt = parsed.data.registeredAt;
        added = false;
      }
    }
  } catch {
    previousRegisteredAt = undefined;
  }

  const registeredAt = options.registeredAt
    ? z.string().datetime().parse(options.registeredAt)
    : new Date().toISOString();

  const membership: ArtifactConversationMembership = {
    schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
    artifactConversationId: validatedSessionId,
    artifactId: validatedArtifactId,
    registeredAt,
  };

  await writeAtomicJsonFile(canonicalRegisteredArtifactsDir, membershipPath, membership, false);

  try {
    const session = await readSession(validatedSessionId, rootOptions);
    return { session, previousRegisteredAt, added };
  } catch (readError) {
    if (added) {
      await fs.unlink(membershipPath).catch(() => {});
    } else if (previousRegisteredAt !== undefined) {
      const rollbackMembership: ArtifactConversationMembership = {
        schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
        artifactConversationId: validatedSessionId,
        artifactId: validatedArtifactId,
        registeredAt: previousRegisteredAt,
      };
      await writeAtomicJsonFile(canonicalRegisteredArtifactsDir, membershipPath, rollbackMembership, false).catch(() => {});
    }
    throw readError;
  }
}

export async function moveArtifactInSession(
  sessionId: string,
  artifactId: string,
  targetZone: "working" | "references" | "archived",
  targetIndex: number,
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  const rootOptions = toRootOptions(options);

  const session = await readSession(validatedSessionId, rootOptions);

  const allIds = new Set([...session.working, ...session.references, ...session.archived]);
  if (!allIds.has(validatedArtifactId)) {
    throw new ConversationRegistryError(
      `Artifact ${validatedArtifactId} does not belong to session ${validatedSessionId}.`,
    );
  }

  const newWorking = session.working.filter((id) => id !== validatedArtifactId);
  const newReferences = session.references.filter((id) => id !== validatedArtifactId);
  const newArchived = session.archived.filter((id) => id !== validatedArtifactId);

  const targetList =
    targetZone === "working"
      ? newWorking
      : targetZone === "references"
      ? newReferences
      : newArchived;

  const clampedIndex = Math.max(0, Math.min(targetIndex, targetList.length));
  targetList.splice(clampedIndex, 0, validatedArtifactId);

  const layout: WorkSessionLayout = {
    schemaVersion: WORK_SESSION_LAYOUT_SCHEMA_VERSION,
    working: newWorking,
    references: newReferences,
    archived: newArchived,
  };

  const { canonicalConversationDir } = await ensureSafeConversationDirectory(
    validatedSessionId,
    rootOptions,
    false,
  );
  const layoutFilePath = path.join(canonicalConversationDir, WORK_SESSION_LAYOUT_FILE);
  await writeAtomicJsonFile(canonicalConversationDir, layoutFilePath, layout, false);

  return {
    ...session,
    working: newWorking,
    references: newReferences,
    archived: newArchived,
  };
}

export async function removeArtifactFromSession(
  sessionId: string,
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<boolean> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  const rootOptions = toRootOptions(options);

  let canonicalConversationDir: string;
  let canonicalRegisteredArtifactsDir: string;
  try {
    const safeDirs = await ensureSafeConversationDirectory(validatedSessionId, rootOptions, false);
    canonicalConversationDir = safeDirs.canonicalConversationDir;
    canonicalRegisteredArtifactsDir = safeDirs.canonicalRegisteredArtifactsDir;
  } catch (error) {
    if (error instanceof ConversationNotFoundError) return false;
    throw error;
  }

  const membershipPath = path.join(
    canonicalRegisteredArtifactsDir,
    `${validatedArtifactId}.json`,
  );

  let removed = false;
  try {
    await fs.unlink(membershipPath);
    removed = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }

  const layoutPath = path.join(canonicalConversationDir, WORK_SESSION_LAYOUT_FILE);
  try {
    const exists = await assertSafeRegularFile(layoutPath, true);
    if (exists) {
      const layoutText = await fs.readFile(layoutPath, "utf8");
      const layout = parseWorkSessionLayout(JSON.parse(layoutText));
      const hasInWorking = layout.working.includes(validatedArtifactId);
      const hasInRef = layout.references.includes(validatedArtifactId);
      const hasInArch = layout.archived.includes(validatedArtifactId);
      if (hasInWorking || hasInRef || hasInArch) {
        const updatedLayout: WorkSessionLayout = {
          schemaVersion: WORK_SESSION_LAYOUT_SCHEMA_VERSION,
          working: layout.working.filter((id) => id !== validatedArtifactId),
          references: layout.references.filter((id) => id !== validatedArtifactId),
          archived: layout.archived.filter((id) => id !== validatedArtifactId),
        };
        await writeAtomicJsonFile(canonicalConversationDir, layoutPath, updatedLayout, false);
      }
    }
  } catch {
    // ignore layout cleanup failure
  }

  return removed;
}

export async function listSessionsForArtifact(
  currentArtifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<WorkSession[]> {
  const validatedCurrentArtifactId = artifactIdSchema.parse(currentArtifactId);
  const allSessions = await listSessions(options);
  const matching: WorkSession[] = [];
  for (const session of allSessions) {
    const allIds = new Set([...session.working, ...session.references, ...session.archived]);
    if (allIds.has(validatedCurrentArtifactId)) {
      matching.push(session);
    }
  }
  return matching;
}

export async function listCandidatesForArtifact(
  currentArtifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<MigrationCandidateEntry[]> {
  const validatedCurrentArtifactId = artifactIdSchema.parse(currentArtifactId);
  const candidates = await listMigrationCandidates(options);
  const matching: MigrationCandidateEntry[] = [];
  const rootOptions = toRootOptions(options);

  for (const candidate of candidates) {
    try {
      const { canonicalRegisteredArtifactsDir } = await ensureSafeConversationDirectory(
        candidate.sessionId,
        rootOptions,
        false,
      );
      const membershipPath = path.join(
        canonicalRegisteredArtifactsDir,
        `${validatedCurrentArtifactId}.json`,
      );
      const exists = await assertSafeRegularFile(membershipPath, true);
      if (exists) {
        matching.push(candidate);
      }
    } catch {
      // skip invalid or unreadable candidate
    }
  }

  return matching;
}

export async function listMigrationCandidates(
  options: GlobalArtifactsRootOptions = {},
): Promise<MigrationCandidateEntry[]> {
  const rootOptions = toRootOptions(options);
  const registryRoot = conversationRegistryRoot(rootOptions);

  try {
    const rootStat = await fs.lstat(registryRoot);
    if (!rootStat.isDirectory()) return [];
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }

  const canonicalRoot = await ensureSafeConversationRegistryRoot(rootOptions);
  const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
  const candidates: MigrationCandidateEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const parsedId = artifactConversationIdSchema.safeParse(entry.name);
    if (!parsedId.success) continue;
    const convId = parsedId.data;

    try {
      const { canonicalConversationDir, canonicalRegisteredArtifactsDir } =
        await ensureSafeConversationDirectory(convId, rootOptions, false);
      const metaPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
      const metaRaw = JSON.parse(await fs.readFile(metaPath, "utf8"));
      if (metaRaw?.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION) {
        const v1Meta = parseConversationMetadata(metaRaw, convId);
        const memberFiles = await fs.readdir(canonicalRegisteredArtifactsDir, { withFileTypes: true });
        const validCount = memberFiles.filter(
          (f) => f.isFile() && f.name.endsWith(".json") && !f.name.startsWith("."),
        ).length;
        candidates.push({
          sessionId: convId,
          title: v1Meta.conversationName,
          createdAt: v1Meta.createdAt,
          artifactCount: validCount,
        });
      }
    } catch {
      // skip invalid/corrupt candidate
    }
  }

  return candidates;
}

export async function migrateConversationToSession(
  conversationId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<{ status: "migrated" | "already-v2"; session: WorkSession }> {
  const validatedId = artifactConversationIdSchema.parse(conversationId);
  const rootOptions = toRootOptions(options);
  const { canonicalConversationDir, canonicalRegisteredArtifactsDir } =
    await ensureSafeConversationDirectory(validatedId, rootOptions, false);

  const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
  const rawText = await fs.readFile(metadataPath, "utf8");
  const rawJson = JSON.parse(rawText);

  if (
    rawJson
    && typeof rawJson === "object"
    && "schemaVersion" in rawJson
    && rawJson.schemaVersion === WORK_SESSION_SCHEMA_VERSION
  ) {
    const session = await readSession(validatedId, rootOptions);
    return { status: "already-v2", session };
  }

  const v1Meta = parseConversationMetadata(rawJson, validatedId);

  const memberFiles = await fs.readdir(canonicalRegisteredArtifactsDir, { withFileTypes: true });
  const memberships: ArtifactConversationMembership[] = [];
  for (const entry of memberFiles) {
    if (entry.name.startsWith(".") || !entry.name.endsWith(".json") || !entry.isFile()) continue;
    const rawArtifactId = entry.name.slice(0, -".json".length);
    if (!artifactIdSchema.safeParse(rawArtifactId).success) continue;
    try {
      const memberPath = path.join(canonicalRegisteredArtifactsDir, entry.name);
      await assertSafeRegularFile(memberPath, false);
      await enforceOwnerOnlyFile(memberPath);
      const memberText = await fs.readFile(memberPath, "utf8");
      const parsed = parseConversationMembership(JSON.parse(memberText), validatedId, rawArtifactId);
      memberships.push(parsed);
    } catch {
      // skip invalid or corrupt membership entry
    }
  }

  const backupPath = path.join(canonicalConversationDir, CONVERSATION_V1_BACKUP_FILE);
  await fs.writeFile(backupPath, rawText, {
    encoding: "utf8",
    mode: OWNER_ONLY_FILE_MODE,
  });

  memberships.sort((a, b) => {
    const diff = compareIsoTimestampsAsc(a.registeredAt, b.registeredAt);
    if (diff !== 0) return diff;
    return a.artifactId.localeCompare(b.artifactId);
  });

  const initialLayout: WorkSessionLayout = {
    schemaVersion: WORK_SESSION_LAYOUT_SCHEMA_VERSION,
    working: memberships.map((m) => m.artifactId),
    references: [],
    archived: [],
  };

  const layoutPath = path.join(canonicalConversationDir, WORK_SESSION_LAYOUT_FILE);
  await writeAtomicJsonFile(canonicalConversationDir, layoutPath, initialLayout, false);

  const instructionsPath = path.join(canonicalConversationDir, WORK_SESSION_INSTRUCTIONS_FILE);
  await writeAtomicTextFile(canonicalConversationDir, instructionsPath, "", false);

  const v2Meta: WorkSessionMetadata = {
    schemaVersion: WORK_SESSION_SCHEMA_VERSION,
    sessionId: validatedId,
    title: v1Meta.conversationName,
    typeId: DEFAULT_SESSION_TYPE_ID,
    createdAt: v1Meta.createdAt,
  };

  await writeAtomicJsonFile(canonicalConversationDir, metadataPath, v2Meta, false);

  const session = await readSession(validatedId, rootOptions);
  return { status: "migrated", session };
}

export async function reassignSessionType(
  oldTypeId: string,
  newTypeId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<number> {
  const sessions = await listSessions(options);
  let updatedCount = 0;
  for (const session of sessions) {
    if (session.typeId === oldTypeId) {
      await setSessionType(session.sessionId, newTypeId, options);
      updatedCount++;
    }
  }
  return updatedCount;
}

export async function countSessionsByType(
  typeId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<number> {
  const sessions = await listSessions(options);
  return sessions.filter((s) => s.typeId === typeId).length;
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
      const markdownPath = path.join(collectionRoot, artifactId, ARTIFACT_MARKDOWN_FILE);
      let isArtifactValid = false;
      let shouldRemoveMembership = false;

      try {
        const manifestStat = await fs.lstat(manifestPath);
        if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
          shouldRemoveMembership = true;
        } else {
          const markdownStat = await fs.lstat(markdownPath);
          if (markdownStat.isSymbolicLink() || !markdownStat.isFile()) {
            shouldRemoveMembership = true;
          } else {
            const rawManifestJson = await fs.readFile(manifestPath, "utf8");
            const parsedJson = JSON.parse(rawManifestJson);
            const manifest = parseArtifactManifest(parsedJson);

            if (manifest.artifactId === artifactId) {
              isArtifactValid = true;
            } else {
              shouldRemoveMembership = true;
            }
          }
        }
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") {
          shouldRemoveMembership = true;
        } else if (
          error instanceof SyntaxError
          || error instanceof z.ZodError
          || (error instanceof Error && error.message.includes("artifact schema version"))
        ) {
          shouldRemoveMembership = true;
        } else {
          logDiagnostic?.(`Could not validate artifact ${artifactId} for membership cleanup`, error);
          hadSkippedEntries = true;
          continue;
        }
      }

      if (shouldRemoveMembership && !isArtifactValid) {
        try {
          await fs.unlink(memberFilePath);
          result.removedMemberships++;
        } catch (error) {
          if (errorCode(error) !== "ENOENT") {
            logDiagnostic?.(`Failed to remove stale membership ${memberFilePath}`, error);
            hadSkippedEntries = true;
          }
        }
      } else if (isArtifactValid) {
        remainingValidMemberships++;
      }
    }

    // Inspect conversation schema version
    let isWorkSessionV2 = false;
    let isConversationV1 = false;
    const metadataPath = path.join(canonicalConversationDir, CONVERSATION_METADATA_FILE);
    try {
      const metaText = await fs.readFile(metadataPath, "utf8");
      const metaJson = JSON.parse(metaText);
      if (metaJson?.schemaVersion === WORK_SESSION_SCHEMA_VERSION) {
        parseWorkSessionMetadata(metaJson, convId);
        isWorkSessionV2 = true;
      } else if (metaJson?.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION) {
        parseConversationMetadata(metaJson, convId);
        isConversationV1 = true;
      } else {
        logDiagnostic?.(`Unrecognized conversation schema version in ${metadataPath}`, metaJson);
        hadSkippedEntries = true;
      }
    } catch (error) {
      logDiagnostic?.(`Failed to inspect conversation metadata ${metadataPath}`, error);
      hadSkippedEntries = true;
    }

    if (isWorkSessionV2) {
      // For Work Session v2, clean up stale artifact IDs from layout.json if layout exists
      const layoutPath = path.join(canonicalConversationDir, WORK_SESSION_LAYOUT_FILE);
      try {
        const exists = await assertSafeRegularFile(layoutPath, true);
        if (exists) {
          const layoutText = await fs.readFile(layoutPath, "utf8");
          const layout = parseWorkSessionLayout(JSON.parse(layoutText));
          const currentMemberFiles = await fs.readdir(canonicalRegisteredArtifactsDir);
          const currentMemberIds = new Set(
            currentMemberFiles
              .filter((f) => f.endsWith(".json") && !f.startsWith("."))
              .map((f) => f.slice(0, -".json".length)),
          );
          const updatedLayout: WorkSessionLayout = {
            schemaVersion: WORK_SESSION_LAYOUT_SCHEMA_VERSION,
            working: layout.working.filter((id) => currentMemberIds.has(id)),
            references: layout.references.filter((id) => currentMemberIds.has(id)),
            archived: layout.archived.filter((id) => currentMemberIds.has(id)),
          };
          await writeAtomicJsonFile(canonicalConversationDir, layoutPath, updatedLayout, false);
        }
      } catch {
        // ignore layout prune failure during retention cleanup
      }
      // Critical: WorkSession v2 is PRESERVED even if it has 0 memberships!
    } else if (isConversationV1) {
      // v1 cleanup: remove empty conversation directory
      if (remainingValidMemberships === 0 && !hadSkippedEntries) {
        try {
          // Atomically remove registered-artifacts only if it is genuinely empty;
          // if a concurrent registration added a membership or temp file after readdir, rmdir fails with ENOTEMPTY.
          await fs.rmdir(canonicalRegisteredArtifactsDir);
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
  }

  return result;
}
