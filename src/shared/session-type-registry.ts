import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SESSION_TYPE_ID,
  SESSION_TYPES_SCHEMA_VERSION,
  sessionTypeSchema,
  sessionTypesDocumentSchema,
  type SessionType,
  type SessionTypesDocument,
} from "./contracts";
import {
  OWNER_ONLY_FILE_MODE,
  aiArtifactsRoot,
  sessionTypesFilePath,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  enforceOwnerOnlyFile,
  ensureManagedDirectory,
} from "./artifact-validation";
import {
  countSessionsByType as countSessionsFromRegistry,
  reassignSessionType as reassignSessionsFromRegistry,
} from "./conversation-artifact-registry";

export class SessionTypeError extends Error {
  readonly code = "SESSION_TYPE_ERROR" as const;
  constructor(message: string) {
    super(`SESSION_TYPE_ERROR: ${message}`);
    this.name = "SessionTypeError";
  }
}

export const DEFAULT_SESSION_TYPES: readonly SessionType[] = [
  { id: "conversation", label: "Conversation" },
  { id: "project", label: "Project" },
  { id: "feature", label: "Feature" },
  { id: "fix", label: "Fix" },
] as const;

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function writeAtomicTypesDocument(
  filePath: string,
  doc: SessionTypesDocument,
): Promise<void> {
  const parentDir = path.dirname(filePath);
  await ensureManagedDirectory(parentDir);

  const serialized = `${JSON.stringify(doc, null, 2)}\n`;
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
          await fs.copyFile(tempPath, filePath);
          await enforceOwnerOnlyFile(filePath);
          await fs.unlink(tempPath).catch(() => undefined);
          return;
        }
        throw error;
      }
    }
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Initializes session-types.json with default types if the file does not already exist.
 */
export async function ensureSessionTypesDocument(
  options: GlobalArtifactsRootOptions = {},
): Promise<SessionTypesDocument> {
  const filePath = sessionTypesFilePath(options);
  try {
    const rawText = await fs.readFile(filePath, "utf8");
    const rawJson = JSON.parse(rawText);
    return sessionTypesDocumentSchema.parse(rawJson);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      const initialDoc: SessionTypesDocument = {
        schemaVersion: SESSION_TYPES_SCHEMA_VERSION,
        types: [...DEFAULT_SESSION_TYPES],
      };
      await writeAtomicTypesDocument(filePath, initialDoc);
      return initialDoc;
    }
    throw new SessionTypeError(
      `Failed to read session-types.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Lists all registered session types.
 */
export async function listSessionTypes(
  options: GlobalArtifactsRootOptions = {},
): Promise<SessionType[]> {
  const doc = await ensureSessionTypesDocument(options);
  return doc.types;
}

/**
 * Validates whether a given typeId exists in the registered types.
 */
export async function isValidSessionTypeId(
  typeId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<boolean> {
  const types = await listSessionTypes(options);
  return types.some((t) => t.id === typeId);
}

/**
 * Creates a new session type with a unique generated ID.
 */
export async function createSessionType(
  rawLabel: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<SessionType> {
  const label = rawLabel.trim();
  if (!label) {
    throw new SessionTypeError("Session type label must not be blank.");
  }
  if (label.length > 100) {
    throw new SessionTypeError("Session type label must not exceed 100 characters.");
  }

  const doc = await ensureSessionTypesDocument(options);
  const normalizedLabel = label.toLowerCase();
  const exists = doc.types.some((t) => t.label.trim().toLowerCase() === normalizedLabel);
  if (exists) {
    throw new SessionTypeError(`Session type with label "${label}" already exists.`);
  }

  const newType: SessionType = {
    id: randomUUID(),
    label,
  };
  sessionTypeSchema.parse(newType);

  const updatedDoc: SessionTypesDocument = {
    ...doc,
    types: [...doc.types, newType],
  };

  const filePath = sessionTypesFilePath(options);
  await writeAtomicTypesDocument(filePath, updatedDoc);
  return newType;
}

/**
 * Renames an existing session type while preserving its ID.
 */
export async function renameSessionType(
  id: string,
  rawLabel: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<SessionType> {
  const label = rawLabel.trim();
  if (!label) {
    throw new SessionTypeError("Session type label must not be blank.");
  }
  if (label.length > 100) {
    throw new SessionTypeError("Session type label must not exceed 100 characters.");
  }

  const doc = await ensureSessionTypesDocument(options);
  const targetIndex = doc.types.findIndex((t) => t.id === id);
  if (targetIndex === -1) {
    throw new SessionTypeError(`Session type with id "${id}" does not exist.`);
  }

  const normalizedLabel = label.toLowerCase();
  const duplicate = doc.types.some(
    (t, idx) => idx !== targetIndex && t.label.trim().toLowerCase() === normalizedLabel,
  );
  if (duplicate) {
    throw new SessionTypeError(`Session type with label "${label}" already exists.`);
  }

  const updatedType: SessionType = {
    id,
    label,
  };
  sessionTypeSchema.parse(updatedType);

  const newTypes = [...doc.types];
  newTypes[targetIndex] = updatedType;

  const updatedDoc: SessionTypesDocument = {
    ...doc,
    types: newTypes,
  };

  const filePath = sessionTypesFilePath(options);
  await writeAtomicTypesDocument(filePath, updatedDoc);
  return updatedType;
}

/**
 * Callback interface to update sessions when deleting a session type.
 */
export type SessionTypeReassigner = {
  countSessionsByType: (typeId: string, options?: GlobalArtifactsRootOptions) => Promise<number>;
  reassignSessionType: (
    oldTypeId: string,
    newTypeId: string,
    options?: GlobalArtifactsRootOptions,
  ) => Promise<number>;
};

/**
 * Counts how many sessions are currently using the specified session type.
 */
export async function countSessionsByType(
  typeId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<number> {
  return countSessionsFromRegistry(typeId, options);
}

/**
 * Deletes a session type.
 * Default type ("conversation") cannot be deleted.
 * If sessions currently use this type, they are reassigned to "conversation" before deletion.
 */
export async function deleteSessionType(
  id: string,
  reassigner?: SessionTypeReassigner,
  options: GlobalArtifactsRootOptions = {},
): Promise<{ affectedSessionsCount: number }> {
  if (id === DEFAULT_SESSION_TYPE_ID) {
    throw new SessionTypeError(`Default session type "${DEFAULT_SESSION_TYPE_ID}" cannot be deleted.`);
  }

  const doc = await ensureSessionTypesDocument(options);
  const targetIndex = doc.types.findIndex((t) => t.id === id);
  if (targetIndex === -1) {
    throw new SessionTypeError(`Session type with id "${id}" does not exist.`);
  }

  let affectedSessionsCount = 0;
  if (reassigner) {
    affectedSessionsCount = await reassigner.reassignSessionType(
      id,
      DEFAULT_SESSION_TYPE_ID,
      options,
    );
  } else {
    affectedSessionsCount = await reassignSessionsFromRegistry(
      id,
      DEFAULT_SESSION_TYPE_ID,
      options,
    );
  }

  const newTypes = doc.types.filter((t) => t.id !== id);
  const updatedDoc: SessionTypesDocument = {
    ...doc,
    types: newTypes,
  };

  const filePath = sessionTypesFilePath(options);
  await writeAtomicTypesDocument(filePath, updatedDoc);

  return { affectedSessionsCount };
}
