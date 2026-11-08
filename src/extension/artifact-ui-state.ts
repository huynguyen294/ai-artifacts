import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  OWNER_ONLY_FILE_MODE,
  artifactCollectionRoot,
  artifactDirectory,
  artifactUiStatePath,
  conversationDirectory,
  conversationRegistryRoot,
  sessionUiStatePath,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  enforceOwnerOnlyFile,
  ensureManagedDirectory,
} from "../shared/artifact-validation";
import {
  UI_STATE_SCHEMA_VERSION,
  artifactConversationIdSchema,
  artifactIdSchema,
  uiStateSchema,
  type UiState,
} from "../shared/contracts";

export const DEFAULT_UI_STATE: UiState = {
  schemaVersion: UI_STATE_SCHEMA_VERSION,
  pinned: false,
};

export type UiStatePatch = {
  pinned?: boolean;
  archivedAt?: string | null;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function writeAtomicJsonFile(filePath: string, data: unknown): Promise<void> {
  const parentDir = path.dirname(filePath);
  await ensureManagedDirectory(parentDir);

  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`UNSAFE_UI_STATE_PATH: symbolic links are not allowed for UI state file ${filePath}`);
    }
  } catch (err) {
    if (errorCode(err) !== "ENOENT") throw err;
  }

  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  const tempPath = path.join(parentDir, `.tmp-${path.basename(filePath)}-${randomUUID()}`);

  await fs.writeFile(tempPath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: OWNER_ONLY_FILE_MODE,
  });

  try {
    await enforceOwnerOnlyFile(tempPath);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(tempPath, filePath);
        await enforceOwnerOnlyFile(filePath);
        return;
      } catch (error) {
        if (attempt < 2 && isWindowsReplaceBlock(error)) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        if (isWindowsReplaceBlock(error) || errorCode(error) === "EXDEV") {
          const destStat = await fs.lstat(filePath).catch(() => undefined);
          if (destStat && (destStat.isSymbolicLink() || !destStat.isFile())) {
            throw new Error(`UNSAFE_UI_STATE_PATH: copy target must be a regular file`);
          }
          await fs.copyFile(tempPath, filePath);
          await enforceOwnerOnlyFile(filePath);
          await fs.unlink(tempPath).catch(() => undefined);
          return;
        }
        throw error;
      }
    }
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

async function validateRealDirectory(dirPath: string, expectedParent: string): Promise<void> {
  const resolved = path.resolve(dirPath);
  const resolvedParent = path.resolve(expectedParent);
  if (!resolved.startsWith(resolvedParent) || path.dirname(resolved) !== resolvedParent) {
    throw new Error(`Target directory is not a direct canonical child of ${resolvedParent}`);
  }

  const parentStat = await fs.lstat(resolvedParent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Parent root directory ${resolvedParent} cannot be a symbolic link or junction`);
  }

  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Target path ${resolved} must be a real directory`);
  }

  const [realParent, realDir] = await Promise.all([
    fs.realpath(resolvedParent),
    fs.realpath(resolved),
  ]);
  if (path.dirname(realDir).toLowerCase() !== realParent.toLowerCase()) {
    throw new Error(`Target path ${resolved} escapes its canonical parent ${resolvedParent}`);
  }
}

export async function readUiStateFile(filePath: string): Promise<UiState> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`UNSAFE_UI_STATE_PATH: symbolic links are not allowed for UI state file ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`UNSAFE_UI_STATE_PATH: UI state path ${filePath} must be a regular file`);
    }
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return uiStateSchema.parse(parsed);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { ...DEFAULT_UI_STATE };
    }
    throw error;
  }
}

function applyPatchToUiState(current: UiState, patch: UiStatePatch): UiState {
  const nextPinned = patch.pinned !== undefined ? patch.pinned : (current.pinned ?? false);
  let nextArchivedAt: string | undefined;

  if (patch.archivedAt === null) {
    nextArchivedAt = undefined;
  } else if (patch.archivedAt !== undefined) {
    nextArchivedAt = patch.archivedAt;
  } else {
    nextArchivedAt = current.archivedAt;
  }

  const result: UiState = {
    schemaVersion: UI_STATE_SCHEMA_VERSION,
    ...(nextPinned ? { pinned: true } : { pinned: false }),
    ...(nextArchivedAt ? { archivedAt: nextArchivedAt } : {}),
  };
  return uiStateSchema.parse(result);
}

// ---------------------------------------------------------------------------
// Artifact UI State
// ---------------------------------------------------------------------------

export async function getArtifactUiState(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<UiState> {
  artifactIdSchema.parse(artifactId);
  const filePath = artifactUiStatePath(artifactId, options);
  return readUiStateFile(filePath);
}

export async function patchArtifactUiState(
  artifactId: string,
  patch: UiStatePatch,
  options: GlobalArtifactsRootOptions = {},
): Promise<UiState> {
  artifactIdSchema.parse(artifactId);
  const targetDir = artifactDirectory(artifactId, options);
  const collectionRoot = artifactCollectionRoot(options);
  await validateRealDirectory(targetDir, collectionRoot);

  const filePath = artifactUiStatePath(artifactId, options);
  const current = await readUiStateFile(filePath);
  const next = applyPatchToUiState(current, patch);

  await writeAtomicJsonFile(filePath, next);
  return next;
}

// ---------------------------------------------------------------------------
// Session UI State
// ---------------------------------------------------------------------------

export async function getSessionUiState(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<UiState> {
  artifactConversationIdSchema.parse(sessionId);
  const filePath = sessionUiStatePath(sessionId, options);
  return readUiStateFile(filePath);
}

export async function patchSessionUiState(
  sessionId: string,
  patch: UiStatePatch,
  options: GlobalArtifactsRootOptions = {},
): Promise<UiState> {
  artifactConversationIdSchema.parse(sessionId);
  const targetDir = conversationDirectory(sessionId, options);
  const registryRoot = conversationRegistryRoot(options);
  await validateRealDirectory(targetDir, registryRoot);

  const filePath = sessionUiStatePath(sessionId, options);
  const current = await readUiStateFile(filePath);
  const next = applyPatchToUiState(current, patch);

  await writeAtomicJsonFile(filePath, next);
  return next;
}

