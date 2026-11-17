import { constants } from "node:fs";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { lock as acquireProperLock } from "proper-lockfile";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  type GlobalArtifactsRootOptions,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  WORK_SESSION_WAITERS_DIRECTORY,
  WORK_SESSION_WAITERS_LOCK_FILE,
  WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
  artifactDirectory,
  workSessionWaiterRecordPath,
  workSessionWaiterRequestPath,
  workSessionWaiterRequestsDirectory,
  workSessionWaitersDirectory,
  workSessionWaitersLockPath,
} from "./artifact-files";
import {
  enforceOwnerOnlyDirectory,
  enforceOwnerOnlyFile,
  ensureSafeGlobalArtifactDirectory,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
  sameFilesystemPath,
} from "./artifact-validation";
import { artifactConversationIdSchema, artifactIdSchema } from "./contracts";
import {
  ConversationNotFoundError,
  ConversationRegistryError,
  resolveSafeWorkSessionDirectory,
} from "./conversation-artifact-registry";
import {
  SESSION_WAITER_LEASE_TTL_MS,
  SESSION_WAITER_LOCK_RETRIES,
  SESSION_WAITER_LOCK_RETRY_INTERVAL_MS,
  SESSION_WAITER_LOCK_STALE_MS,
  SESSION_WAITER_LOCK_UPDATE_MS,
  SESSION_WAITER_SCHEMA_VERSION,
  SessionWaitCancelReason,
  SessionWaitRequestSent,
  SessionWaitArtifactReference,
  SessionWaiterBusyError,
  SessionWaiterIoError,
  SessionWaiterLockLostError,
  SessionWaiterNotWaitingError,
  SessionWaiterRecord,
  SessionWaiterRequest,
  SessionWaiterRequestExistsError,
  SessionWaiterSnapshot,
  allocateUniqueWaiterName,
  requestWaiterInSessionInputSchema,
  sessionWaitIdSchema,
  sessionWaiterOwnerInstanceIdSchema,
  sessionWaiterRecordSchema,
  sessionWaiterRequestSchema,
  waitInSessionInputSchema,
} from "./session-waiter-contracts";

const UUID_JSON_FILENAME_REGEX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i;
const TEMP_FILE_TAG = ".tmp-";

export type SessionWaiterTimingOptions = {
  leaseTtlMs?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  lockStaleMs?: number;
  lockUpdateMs?: number;
  lockRetries?: number;
  lockRetryIntervalMs?: number;
};

export type SessionWaiterLockOperation =
  | "register"
  | "renew"
  | "send"
  | "claim"
  | "cancel"
  | "cleanup";

export type SessionWaiterStoreTestHooks = {
  onLockAcquired?: (
    operation: SessionWaiterLockOperation,
    guard: { assertNotCompromised: () => void },
  ) => Promise<void> | void;
  beforePublishWaiter?: () => Promise<void> | void;
  beforeRenewRead?: () => Promise<void> | void;
  beforeRenewUtimes?: () => Promise<void> | void;
  beforePublishRequest?: () => Promise<void> | void;
  afterPublishRequest?: () => Promise<void> | void;
  beforeClaimUnlink?: () => Promise<void> | void;
};

export type SessionWaiterStoreOptions = GlobalArtifactsRootOptions & {
  now?: () => Date;
  timing?: SessionWaiterTimingOptions;
  onLockCompromised?: (error: Error) => void;
  _testHooks?: SessionWaiterStoreTestHooks;
};

export type RegisterSessionWaiterInput = {
  sessionId: string;
  waitId?: string;
  ownerInstanceId: string;
  waitingFor: string;
  name?: string;
  artifactId?: string;
};

export type RegisterSessionWaiterResult = {
  sessionId: string;
  waitId: string;
  waiter: SessionWaiterSnapshot;
  waitersDirectory: string;
  waiterRequestsDirectory: string;
};

export type RenewSessionWaiterLeaseInput = {
  sessionId: string;
  waitId: string;
  ownerInstanceId: string;
};

export type RenewSessionWaiterLeaseResult =
  | {
      status: "renewed";
      waiter: SessionWaiterSnapshot;
    }
  | {
      status: "cancelled";
      reason: SessionWaitCancelReason;
    };

export type SendSessionWaiterRequestInput = {
  sessionId: string;
  waitId: string;
  requestMessage: string;
  artifactId?: string;
};

export type ClaimSessionWaiterRequestInput = {
  sessionId: string;
  waitId: string;
  ownerInstanceId: string;
};

export type ClaimSessionWaiterRequestResult =
  | {
      status: "idle";
      waiter: SessionWaiterSnapshot;
    }
  | {
      status: "requested";
      sessionId: string;
      waitId: string;
      waiter: SessionWaiterSnapshot;
      request: SessionWaiterRequest;
    }
  | {
      status: "cancelled";
      sessionId: string;
      waitId: string;
      reason: SessionWaitCancelReason;
    };

export type CancelSessionWaiterInput = {
  sessionId: string;
  waitId: string;
  expectedOwnerInstanceId?: string;
};

export type CancelSessionWaiterResult = {
  sessionId: string;
  waitId: string;
  cancelled: boolean;
  waiterExisted: boolean;
  requestRemoved: boolean;
};

export type CleanupExpiredSessionWaitersResult = {
  sessionId: string;
  removedWaiters: number;
  removedRequests: number;
};

function toRootOptions(options: GlobalArtifactsRootOptions = {}): GlobalArtifactsRootOptions {
  return options.userHome !== undefined ? { userHome: options.userHome } : {};
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function resolveNowMs(options: SessionWaiterStoreOptions): number {
  return (options.now?.() ?? new Date()).getTime();
}

function buildWaiterSnapshot(
  record: SessionWaiterRecord,
  mtimeMs: number,
): SessionWaiterSnapshot {
  const truncatedMtimeMs = Math.trunc(mtimeMs);
  return {
    ...record,
    heartbeatAt: new Date(truncatedMtimeMs).toISOString(),
    expiresAt: new Date(truncatedMtimeMs + record.leaseTtlMs).toISOString(),
  };
}

/**
 * Returns whether a Session waiter lease has expired as of `nowMs`.
 */
export function isSessionWaiterExpired(
  snapshot: Pick<SessionWaiterSnapshot, "expiresAt">,
  nowMs: number = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return nowMs >= expiresAtMs;
}

function parseWaitIdFilename(filename: string): string | null {
  if (
    filename === WORK_SESSION_WAITERS_LOCK_FILE
    || filename.includes(TEMP_FILE_TAG)
    || filename.startsWith(".")
  ) {
    return null;
  }
  const match = UUID_JSON_FILENAME_REGEX.exec(filename);
  const candidate = match?.[1];
  if (!candidate) {
    return null;
  }
  const parsed = sessionWaitIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

const TRANSIENT_DELETION_ERROR_CODES = new Set(["ENOENT", "EPERM", "EACCES", "EBUSY"]);

function isMissingRegisteredArtifactsRegistryError(error: unknown): boolean {
  return (
    error instanceof ConversationRegistryError
    && error.message.includes(
      `is missing its ${CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY} directory.`,
    )
  );
}

async function resolveWorkSessionForWaiterOperation(
  sessionId: string,
  rootOptions: GlobalArtifactsRootOptions,
): Promise<Awaited<ReturnType<typeof resolveSafeWorkSessionDirectory>>> {
  try {
    return await resolveSafeWorkSessionDirectory(sessionId, rootOptions);
  } catch (error) {
    if (!isMissingRegisteredArtifactsRegistryError(error)) {
      throw error;
    }
    // Windows recursive fs.rm can remove registered-artifacts/ milliseconds before conversation.json.
    for (let attempt = 0; attempt < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      try {
        return await resolveSafeWorkSessionDirectory(sessionId, rootOptions);
      } catch (retryError) {
        if (retryError instanceof ConversationNotFoundError) {
          throw retryError;
        }
        if (!isMissingRegisteredArtifactsRegistryError(retryError)) {
          throw retryError;
        }
      }
    }
    throw error;
  }
}

async function doesWorkSessionExist(
  sessionId: string,
  options: GlobalArtifactsRootOptions,
): Promise<boolean> {
  try {
    await resolveWorkSessionForWaiterOperation(sessionId, options);
    return true;
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return false;
    }
    throw error;
  }
}

export async function isWorkSessionDeleted(
  sessionId: string,
  options: GlobalArtifactsRootOptions = {},
  retryIfPresent = false,
): Promise<boolean> {
  if (!(await doesWorkSessionExist(sessionId, options))) {
    return true;
  }
  if (!retryIfPresent) {
    return false;
  }
  // Windows recursive fs.rm can remove child entries milliseconds before conversation.json.
  await new Promise((resolve) => setTimeout(resolve, 25));
  return !(await doesWorkSessionExist(sessionId, options));
}

async function rethrowConversationNotFoundIfDeleted(
  sessionId: string,
  rootOptions: GlobalArtifactsRootOptions,
  error: unknown,
): Promise<void> {
  if (error instanceof ConversationNotFoundError) {
    throw error;
  }
  if (error instanceof Error && error.message.startsWith("UNSAFE_SESSION_WAITER_PATH")) {
    return;
  }
  const code = errorCode(error);
  const isTransient =
    (code !== undefined && TRANSIENT_DELETION_ERROR_CODES.has(code))
    || error instanceof SessionWaiterIoError
    || error instanceof SessionWaiterLockLostError
    || isMissingRegisteredArtifactsRegistryError(error);
  if (!isTransient) {
    return;
  }
  if (await isWorkSessionDeleted(sessionId, rootOptions, true)) {
    throw new ConversationNotFoundError(`Session ${sessionId} does not exist.`);
  }
}

async function inspectDirectSessionSubdirectoryIfExists(
  canonicalConversationDir: string,
  subdirName: string,
  options: { enforcePermissions?: boolean } = {},
): Promise<string | null> {
  const targetDir = path.join(canonicalConversationDir, subdirName);
  let stat;
  try {
    stat = await fs.lstat(targetDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    throw new SessionWaiterIoError(
      `Failed to inspect session waiter directory ${targetDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stat.isSymbolicLink()) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: ${targetDir} must not be a symbolic link.`,
    );
  }
  if (!stat.isDirectory()) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: ${targetDir} must be a directory.`,
    );
  }
  if (options.enforcePermissions) {
    await enforceOwnerOnlyDirectory(targetDir);
  }

  let canonicalSubdir: string;
  try {
    canonicalSubdir = await fs.realpath(targetDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (!sameFilesystemPath(path.dirname(canonicalSubdir), canonicalConversationDir)) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: ${targetDir} escapes its session directory.`,
    );
  }
  return canonicalSubdir;
}

async function ensureDirectSessionSubdirectory(
  canonicalConversationDir: string,
  subdirName: string,
  sessionId: string,
  rootOptions: GlobalArtifactsRootOptions,
): Promise<string> {
  let existing: string | null;
  try {
    existing = await inspectDirectSessionSubdirectoryIfExists(
      canonicalConversationDir,
      subdirName,
      { enforcePermissions: true },
    );
  } catch (error) {
    await rethrowConversationNotFoundIfDeleted(sessionId, rootOptions, error);
    throw error;
  }
  if (existing) {
    return existing;
  }

  const targetDir = path.join(canonicalConversationDir, subdirName);
  try {
    // Non-recursive mkdir avoids recreating a Session directory after deleteSession.
    await fs.mkdir(targetDir, { recursive: false, mode: OWNER_ONLY_DIRECTORY_MODE });
  } catch (error) {
    const code = errorCode(error);
    if (code !== "EEXIST") {
      await rethrowConversationNotFoundIfDeleted(sessionId, rootOptions, error);
      if (code === "ENOENT") {
        throw new ConversationNotFoundError(`Session ${sessionId} does not exist.`);
      }
      throw new SessionWaiterIoError(
        `Failed to create session waiter directory ${targetDir}: ${error instanceof Error ? error.message : String(error)}`,
        { sessionId },
      );
    }
  }

  let verified: string | null;
  try {
    verified = await inspectDirectSessionSubdirectoryIfExists(
      canonicalConversationDir,
      subdirName,
      { enforcePermissions: true },
    );
  } catch (error) {
    await rethrowConversationNotFoundIfDeleted(sessionId, rootOptions, error);
    throw error;
  }
  if (!verified) {
    throw new ConversationNotFoundError(`Session ${sessionId} does not exist.`);
  }
  return verified;
}

async function assertSafeRegularChildFile(
  parentDir: string,
  filePath: string,
  allowMissing: boolean,
  options: { enforcePermissions?: boolean } = {},
): Promise<boolean> {
  if (!sameFilesystemPath(path.dirname(filePath), parentDir)) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: ${filePath} must be a direct child of ${parentDir}.`,
    );
  }

  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (allowMissing) {
        return false;
      }
      throw error;
    }
    throw new SessionWaiterIoError(
      `Failed to inspect file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (stat.isSymbolicLink()) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: symbolic links are not allowed at ${filePath}.`,
    );
  }
  if (!stat.isFile()) {
    throw new SessionWaiterIoError(
      `UNSAFE_SESSION_WAITER_PATH: ${filePath} must be a regular file.`,
    );
  }
  if (options.enforcePermissions) {
    await enforceOwnerOnlyFile(filePath);
  }
  return true;
}

async function readWaiterFileAndStat(
  waitersDir: string,
  expectedWaitId: string,
  filePath: string,
): Promise<SessionWaiterSnapshot | null> {
  try {
    await assertSafeRegularChildFile(waitersDir, filePath, false);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }

  let fileHandle;
  try {
    fileHandle = await fs.open(filePath, constants.O_RDONLY);
    const [stat, rawText] = await Promise.all([
      fileHandle.stat(),
      fileHandle.readFile("utf8"),
    ]);
    const parsedJson: unknown = JSON.parse(rawText);
    const parsedRecord = sessionWaiterRecordSchema.safeParse(parsedJson);
    if (!parsedRecord.success || parsedRecord.data.waitId !== expectedWaitId) {
      return null;
    }
    return buildWaiterSnapshot(parsedRecord.data, stat.mtime.getTime());
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

async function readWaiterRequestFile(
  requestsDir: string,
  expectedWaitId: string,
  filePath: string,
): Promise<SessionWaiterRequest | null> {
  const exists = await assertSafeRegularChildFile(requestsDir, filePath, true);
  if (!exists) {
    return null;
  }

  try {
    const rawText = await fs.readFile(filePath, "utf8");
    const parsedJson: unknown = JSON.parse(rawText);
    const parsedRequest = sessionWaiterRequestSchema.safeParse(parsedJson);
    if (!parsedRequest.success || parsedRequest.data.waitId !== expectedWaitId) {
      return null;
    }
    return parsedRequest.data;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function publishNewJsonFileUnderLock(
  parentDir: string,
  targetFilePath: string,
  payload: unknown,
  options: { mtimeDate?: Date } = {},
): Promise<void> {
  const targetAlreadyExists = await assertSafeRegularChildFile(parentDir, targetFilePath, true);
  if (targetAlreadyExists) {
    throw Object.assign(new Error(`Target file already exists: ${targetFilePath}`), {
      code: "EEXIST",
    });
  }

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const tempFilePath = path.join(
    parentDir,
    `${path.basename(targetFilePath)}${TEMP_FILE_TAG}${randomUUID()}`,
  );

  await fs.writeFile(tempFilePath, serialized, {
    encoding: "utf8",
    flag: "wx",
    mode: OWNER_ONLY_FILE_MODE,
  });

  try {
    await enforceOwnerOnlyFile(tempFilePath);
    if (options.mtimeDate) {
      await fs.utimes(tempFilePath, options.mtimeDate, options.mtimeDate);
    }

    try {
      await fs.link(tempFilePath, targetFilePath);
    } catch (error) {
      const code = errorCode(error);
      if (code === "EEXIST") {
        throw error;
      }
      if (code === "ENOTSUP" || code === "EXDEV") {
        const racedExisting = await assertSafeRegularChildFile(parentDir, targetFilePath, true);
        if (racedExisting) {
          throw Object.assign(new Error(`Target file already exists: ${targetFilePath}`), {
            code: "EEXIST",
          });
        }
        await fs.rename(tempFilePath, targetFilePath);
      } else {
        throw error;
      }
    }

    await assertSafeRegularChildFile(parentDir, targetFilePath, false, {
      enforcePermissions: true,
    });
  } finally {
    await fs.unlink(tempFilePath).catch(() => undefined);
  }
}

type WaiterLockContext = {
  sessionId: string;
  canonicalConversationDir: string;
  waitersDir: string;
  requestsDir: string;
  signal: AbortSignal;
  assertNotCompromised: () => void;
  markCommitted: () => void;
};

async function withSessionWaiterLock<T>(
  sessionId: string,
  operation: SessionWaiterLockOperation,
  options: SessionWaiterStoreOptions,
  fn: (context: WaiterLockContext) => Promise<T>,
): Promise<T> {
  const rootOptions = toRootOptions(options);
  const resolved = await resolveWorkSessionForWaiterOperation(sessionId, rootOptions);
  const waitersDir = await ensureDirectSessionSubdirectory(
    resolved.canonicalConversationDir,
    WORK_SESSION_WAITERS_DIRECTORY,
    sessionId,
    rootOptions,
  );
  const lockfilePath = workSessionWaitersLockPath(sessionId, rootOptions);

  const lockStaleMs = options.timing?.lockStaleMs ?? SESSION_WAITER_LOCK_STALE_MS;
  const lockUpdateMs = options.timing?.lockUpdateMs ?? SESSION_WAITER_LOCK_UPDATE_MS;
  const lockRetries = options.timing?.lockRetries ?? SESSION_WAITER_LOCK_RETRIES;
  const lockRetryIntervalMs =
    options.timing?.lockRetryIntervalMs ?? SESSION_WAITER_LOCK_RETRY_INTERVAL_MS;

  let compromisedError: Error | null = null;
  const lockAbortController = new AbortController();

  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireProperLock(resolved.canonicalConversationDir, {
      lockfilePath,
      stale: lockStaleMs,
      update: lockUpdateMs,
      realpath: true,
      retries: {
        retries: lockRetries,
        factor: 1,
        minTimeout: lockRetryIntervalMs,
        maxTimeout: lockRetryIntervalMs,
        randomize: false,
      },
      onCompromised: (err: Error) => {
        compromisedError = err;
        lockAbortController.abort(err);
        options.onLockCompromised?.(err);
      },
    });
  } catch (error) {
    const code = errorCode(error);
    if (code === "ELOCKED") {
      throw new SessionWaiterBusyError(
        `Could not acquire session waiter coordination lock within retry budget.`,
        { sessionId },
      );
    }
    await rethrowConversationNotFoundIfDeleted(sessionId, rootOptions, error);
    throw new SessionWaiterIoError(
      `Failed to acquire session waiter lock: ${error instanceof Error ? error.message : String(error)}`,
      { sessionId },
    );
  }

  const assertNotCompromised = () => {
    if (compromisedError) {
      throw new SessionWaiterLockLostError(
        `Session waiter lock was lost: ${compromisedError.message}`,
        { sessionId },
      );
    }
  };

  let caughtError = false;
  let capturedError: unknown;
  let committed = false;
  const markCommitted = () => {
    committed = true;
  };
  try {
    const current = await resolveWorkSessionForWaiterOperation(sessionId, rootOptions);
    const verifiedWaitersDir = await inspectDirectSessionSubdirectoryIfExists(
      current.canonicalConversationDir,
      WORK_SESSION_WAITERS_DIRECTORY,
    );
    const requestsDir = workSessionWaiterRequestsDirectory(sessionId, rootOptions);
    const guard = { assertNotCompromised };
    await options._testHooks?.onLockAcquired?.(operation, guard);
    assertNotCompromised();

    const result = await fn({
      sessionId,
      canonicalConversationDir: current.canonicalConversationDir,
      waitersDir: verifiedWaitersDir ?? waitersDir,
      requestsDir,
      signal: lockAbortController.signal,
      assertNotCompromised,
      markCommitted,
    });
    if (!committed) {
      assertNotCompromised();
    }
    return result;
  } catch (error) {
    caughtError = true;
    capturedError = error;
    throw error;
  } finally {
    try {
      await release?.();
    } catch (error) {
      const code = errorCode(error);
      if (
        code !== "ERELEASED"
        && code !== "ENOTACQUIRED"
        && code !== "ENOENT"
        && !caughtError
        && !committed
      ) {
        // Ignore only expected compromised/deleted lock cleanup states.
        await rethrowConversationNotFoundIfDeleted(sessionId, rootOptions, error);
        throw new SessionWaiterIoError(
          `Failed to release session waiter lock: ${error instanceof Error ? error.message : String(error)}`,
          { sessionId },
        );
      }
    }
    if (!caughtError && !committed && compromisedError) {
      await rethrowConversationNotFoundIfDeleted(
        sessionId,
        rootOptions,
        new SessionWaiterLockLostError(
          `Session waiter lock was lost: ${(compromisedError as Error).message}`,
          { sessionId },
        ),
      );
      assertNotCompromised();
    }
    void capturedError;
  }
}

async function scanWaiterSnapshots(
  waitersDir: string,
  nowMs: number,
): Promise<{
  active: SessionWaiterSnapshot[];
  expired: SessionWaiterSnapshot[];
}> {
  let entries;
  try {
    entries = await fs.readdir(waitersDir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return { active: [], expired: [] };
    }
    throw error;
  }

  const active: SessionWaiterSnapshot[] = [];
  const expired: SessionWaiterSnapshot[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.isDirectory()) {
      continue;
    }
    const waitId = parseWaitIdFilename(entry.name);
    if (!waitId) {
      continue;
    }
    const filePath = path.join(waitersDir, entry.name);
    const snapshot = await readWaiterFileAndStat(waitersDir, waitId, filePath);
    if (!snapshot) {
      continue;
    }
    if (isSessionWaiterExpired(snapshot, nowMs)) {
      expired.push(snapshot);
    } else {
      active.push(snapshot);
    }
  }

  active.sort((a, b) => {
    const timeDiff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.waitId.localeCompare(b.waitId);
  });

  return { active, expired };
}

async function cleanupExpiredSessionWaitersUnderLock(
  context: WaiterLockContext,
  nowMs: number,
): Promise<CleanupExpiredSessionWaitersResult> {
  const { active, expired } = await scanWaiterSnapshots(context.waitersDir, nowMs);
  const activeWaitIds = new Set(active.map((item) => item.waitId));
  let removedWaiters = 0;
  let removedRequests = 0;

  for (const snapshot of expired) {
    const waiterPath = path.join(context.waitersDir, `${snapshot.waitId}.json`);
    try {
      await fs.unlink(waiterPath);
      removedWaiters++;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }

  const canonicalRequestsDir = await inspectDirectSessionSubdirectoryIfExists(
    context.canonicalConversationDir,
    WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
  );
  if (canonicalRequestsDir) {
    let requestEntries: Array<{ name: string; isSymbolicLink: () => boolean; isDirectory: () => boolean }> = [];
    try {
      requestEntries = await fs.readdir(canonicalRequestsDir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }
    }

    for (const entry of requestEntries) {
      if (entry.isSymbolicLink() || entry.isDirectory()) {
        continue;
      }
      const waitId = parseWaitIdFilename(entry.name);
      if (!waitId || activeWaitIds.has(waitId)) {
        continue;
      }
      const requestPath = path.join(canonicalRequestsDir, entry.name);
      const parsedRequest = await readWaiterRequestFile(canonicalRequestsDir, waitId, requestPath);
      if (!parsedRequest) {
        continue;
      }
      try {
        await fs.unlink(requestPath);
        removedRequests++;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }
    }
  }

  return {
    sessionId: context.sessionId,
    removedWaiters,
    removedRequests,
  };
}

/**
 * Resolves and validates a global schema-v6 artifact snapshot reference for Session waiters.
 */
export async function resolveSessionWaitArtifactReference(
  artifactId: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<SessionWaitArtifactReference> {
  const validatedId = artifactIdSchema.parse(artifactId);
  const rootOptions = toRootOptions(options);
  const candidateDir = artifactDirectory(validatedId, rootOptions);

  try {
    await fs.lstat(candidateDir);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw Object.assign(
        new Error(`ARTIFACT_NOT_FOUND: Artifact ${validatedId} does not exist.`),
        { code: "ENOENT" },
      );
    }
    throw error;
  }

  let canonicalArtifactDir: string;
  let artifactPath: string;
  let manifestTitle: string;
  try {
    canonicalArtifactDir = await ensureSafeGlobalArtifactDirectory(
      validatedId,
      candidateDir,
      rootOptions,
    );
    const manifestPath = await ensureSafeManagedArtifactFile(
      canonicalArtifactDir,
      path.join(canonicalArtifactDir, ARTIFACT_MANIFEST_FILE),
    );
    const manifestRaw: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const manifest = parseArtifactManifest(manifestRaw);
    if (manifest.artifactId !== validatedId) {
      throw Object.assign(
        new Error(`ARTIFACT_NOT_FOUND: Artifact manifest ID does not match ${validatedId}.`),
        { code: "ENOENT" },
      );
    }
    manifestTitle = manifest.title;
    artifactPath = await ensureSafeManagedArtifactFile(
      canonicalArtifactDir,
      path.join(canonicalArtifactDir, ARTIFACT_MARKDOWN_FILE),
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ARTIFACT_NOT_FOUND:")) {
      throw error;
    }
    if (errorCode(error) === "ENOENT") {
      throw Object.assign(
        new Error(`ARTIFACT_NOT_FOUND: Artifact ${validatedId} does not exist.`),
        { code: "ENOENT" },
      );
    }
    throw error;
  }

  return {
    artifactId: validatedId,
    title: manifestTitle,
    artifactPath,
    artifactDirectory: canonicalArtifactDir,
  };
}

/**
 * Registers a new active waiter record under the Session's coordination mutex.
 */
export async function registerSessionWaiter(
  input: RegisterSessionWaiterInput,
  options: SessionWaiterStoreOptions = {},
): Promise<RegisterSessionWaiterResult> {
  const validatedInput = waitInSessionInputSchema.parse({
    sessionId: input.sessionId,
    waitingFor: input.waitingFor,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
  });
  const validatedOwnerInstanceId = sessionWaiterOwnerInstanceIdSchema.parse(
    input.ownerInstanceId,
  );
  const requestedWaitId =
    input.waitId !== undefined ? sessionWaitIdSchema.parse(input.waitId) : undefined;
  const rootOptions = toRootOptions(options);
  const leaseTtlMs = options.timing?.leaseTtlMs ?? SESSION_WAITER_LEASE_TTL_MS;

  await resolveWorkSessionForWaiterOperation(validatedInput.sessionId, rootOptions);
  const artifact =
    validatedInput.artifactId !== undefined
      ? await resolveSessionWaitArtifactReference(validatedInput.artifactId, rootOptions)
      : undefined;

  return withSessionWaiterLock(
    validatedInput.sessionId,
    "register",
    options,
    async (context) => {
      await ensureDirectSessionSubdirectory(
        context.canonicalConversationDir,
        WORK_SESSION_WAITERS_DIRECTORY,
        context.sessionId,
        rootOptions,
      );
      const requestsDir = await ensureDirectSessionSubdirectory(
        context.canonicalConversationDir,
        WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
        context.sessionId,
        rootOptions,
      );

      const nowMs = resolveNowMs(options);
      await cleanupExpiredSessionWaitersUnderLock(context, nowMs);
      const { active } = await scanWaiterSnapshots(context.waitersDir, nowMs);

      const allocatedName = allocateUniqueWaiterName(
        validatedInput.name,
        active.map((waiter) => waiter.name),
      );

      let waitId = requestedWaitId ?? randomUUID();
      if (!requestedWaitId) {
        while (
          await assertSafeRegularChildFile(
            context.waitersDir,
            workSessionWaiterRecordPath(context.sessionId, waitId, rootOptions),
            true,
          )
        ) {
          waitId = randomUUID();
        }
      }

      const nowDate = new Date(nowMs);
      const record: SessionWaiterRecord = {
        schemaVersion: SESSION_WAITER_SCHEMA_VERSION,
        waitId,
        ownerInstanceId: validatedOwnerInstanceId,
        name: allocatedName,
        waitingFor: validatedInput.waitingFor,
        createdAt: nowDate.toISOString(),
        leaseTtlMs,
        ...(artifact ? { artifact } : {}),
      };

      await options._testHooks?.beforePublishWaiter?.();
      context.assertNotCompromised();

      const targetPath = path.join(context.waitersDir, `${waitId}.json`);
      await publishNewJsonFileUnderLock(
        context.waitersDir,
        targetPath,
        record,
        options.now ? { mtimeDate: nowDate } : {},
      );
      const snapshot = await readWaiterFileAndStat(context.waitersDir, waitId, targetPath);
      if (!snapshot) {
        throw new SessionWaiterIoError(
          `Newly registered waiter ${waitId} could not be read back from disk.`,
          { sessionId: context.sessionId, waitId },
        );
      }

      context.assertNotCompromised();
      return {
        sessionId: context.sessionId,
        waitId,
        waiter: snapshot,
        waitersDirectory: context.waitersDir,
        waiterRequestsDirectory: requestsDir,
      };
    },
  );
}

/**
 * Reads active non-expired waiter snapshots in read-only mode without creating directories or locks.
 */
export async function readActiveSessionWaiters(
  sessionId: string,
  options: SessionWaiterStoreOptions = {},
): Promise<SessionWaiterSnapshot[]> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const rootOptions = toRootOptions(options);
  const resolved = await resolveWorkSessionForWaiterOperation(validatedSessionId, rootOptions);
  const waitersDir = await inspectDirectSessionSubdirectoryIfExists(
    resolved.canonicalConversationDir,
    WORK_SESSION_WAITERS_DIRECTORY,
  );
  if (!waitersDir) {
    return [];
  }

  const nowMs = resolveNowMs(options);
  const { active } = await scanWaiterSnapshots(waitersDir, nowMs);
  return active;
}

/**
 * Extends an active waiter's lease by updating only the existing file's mtime via fs.utimes.
 */
export async function renewSessionWaiterLease(
  input: RenewSessionWaiterLeaseInput,
  options: SessionWaiterStoreOptions = {},
): Promise<RenewSessionWaiterLeaseResult> {
  const validatedSessionId = artifactConversationIdSchema.parse(input.sessionId);
  const validatedWaitId = sessionWaitIdSchema.parse(input.waitId);
  const validatedOwnerInstanceId = sessionWaiterOwnerInstanceIdSchema.parse(
    input.ownerInstanceId,
  );
  const rootOptions = toRootOptions(options);

  try {
    const preResolved = await resolveWorkSessionForWaiterOperation(validatedSessionId, rootOptions);
    const preWaitersDir = await inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITERS_DIRECTORY,
    );
    if (!preWaitersDir) {
      const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
      return {
        status: "cancelled",
        reason: stillExists ? "waiter-removed" : "session-deleted",
      };
    }

    return await withSessionWaiterLock(validatedSessionId, "renew", options, async (context) => {
      await options._testHooks?.beforeRenewRead?.();
      context.assertNotCompromised();

      const waiterPath = path.join(context.waitersDir, `${validatedWaitId}.json`);
      const snapshot = await readWaiterFileAndStat(
        context.waitersDir,
        validatedWaitId,
        waiterPath,
      );
      if (!snapshot) {
        const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
        return {
          status: "cancelled",
          reason: stillExists ? "waiter-removed" : "session-deleted",
        };
      }

      if (snapshot.ownerInstanceId !== validatedOwnerInstanceId) {
        throw new SessionWaiterNotWaitingError(
          `Waiter ${validatedWaitId} is owned by another MCP instance.`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }

      const nowMs = resolveNowMs(options);
      if (isSessionWaiterExpired(snapshot, nowMs)) {
        return { status: "cancelled", reason: "lease-expired" };
      }

      await options._testHooks?.beforeRenewUtimes?.();
      context.assertNotCompromised();

      const touchDate = new Date(nowMs);
      try {
        await fs.utimes(waiterPath, touchDate, touchDate);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
          return {
            status: "cancelled",
            reason: stillExists ? "waiter-removed" : "session-deleted",
          };
        }
        throw new SessionWaiterIoError(
          `Failed to renew waiter lease timestamp: ${error instanceof Error ? error.message : String(error)}`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }

      const updated = await readWaiterFileAndStat(
        context.waitersDir,
        validatedWaitId,
        waiterPath,
      );
      if (!updated) {
        const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
        return {
          status: "cancelled",
          reason: stillExists ? "waiter-removed" : "session-deleted",
        };
      }

      context.assertNotCompromised();
      return {
        status: "renewed",
        waiter: updated,
      };
    });
  } catch (error) {
    try {
      await rethrowConversationNotFoundIfDeleted(validatedSessionId, rootOptions, error);
    } catch (mappedError) {
      if (mappedError instanceof ConversationNotFoundError) {
        return { status: "cancelled", reason: "session-deleted" };
      }
      throw mappedError;
    }
    throw error;
  }
}

/**
 * Publishes an unqueued request targeting a currently waiting Session waiter.
 */
export async function sendSessionWaiterRequest(
  input: SendSessionWaiterRequestInput,
  options: SessionWaiterStoreOptions = {},
): Promise<SessionWaitRequestSent> {
  const validatedInput = requestWaiterInSessionInputSchema.parse(input);
  const rootOptions = toRootOptions(options);

  const preResolved = await resolveWorkSessionForWaiterOperation(
    validatedInput.sessionId,
    rootOptions,
  );
  const artifact =
    validatedInput.artifactId !== undefined
      ? await resolveSessionWaitArtifactReference(validatedInput.artifactId, rootOptions)
      : undefined;

  const preWaitersDir = await inspectDirectSessionSubdirectoryIfExists(
    preResolved.canonicalConversationDir,
    WORK_SESSION_WAITERS_DIRECTORY,
  );
  if (!preWaitersDir) {
    const stillExists = await doesWorkSessionExist(validatedInput.sessionId, rootOptions);
    if (!stillExists) {
      throw new ConversationNotFoundError(`Session ${validatedInput.sessionId} does not exist.`);
    }
    throw new SessionWaiterNotWaitingError(
      `Waiter ${validatedInput.waitId} is not waiting in session ${validatedInput.sessionId}.`,
      { sessionId: validatedInput.sessionId, waitId: validatedInput.waitId },
    );
  }

  return withSessionWaiterLock(validatedInput.sessionId, "send", options, async (context) => {
    const nowMs = resolveNowMs(options);
    const waiterPath = path.join(context.waitersDir, `${validatedInput.waitId}.json`);
    const snapshot = await readWaiterFileAndStat(
      context.waitersDir,
      validatedInput.waitId,
      waiterPath,
    );
    if (!snapshot || isSessionWaiterExpired(snapshot, nowMs)) {
      throw new SessionWaiterNotWaitingError(
        `Waiter ${validatedInput.waitId} is not waiting or has expired.`,
        { sessionId: context.sessionId, waitId: validatedInput.waitId },
      );
    }

    const requestsDir = await ensureDirectSessionSubdirectory(
      context.canonicalConversationDir,
      WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
      context.sessionId,
      rootOptions,
    );
    const requestPath = path.join(requestsDir, `${validatedInput.waitId}.json`);
    const requestAlreadyExists = await assertSafeRegularChildFile(requestsDir, requestPath, true);
    if (requestAlreadyExists) {
      throw new SessionWaiterRequestExistsError(
        `A request already exists for waiter ${validatedInput.waitId}.`,
        { sessionId: context.sessionId, waitId: validatedInput.waitId },
      );
    }

    await options._testHooks?.beforePublishRequest?.();
    context.assertNotCompromised();

    const requestPayload: SessionWaiterRequest = {
      schemaVersion: SESSION_WAITER_SCHEMA_VERSION,
      waitId: validatedInput.waitId,
      requestMessage: validatedInput.requestMessage,
      createdAt: new Date(nowMs).toISOString(),
      ...(artifact ? { artifact } : {}),
    };

    try {
      await publishNewJsonFileUnderLock(requestsDir, requestPath, requestPayload);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new SessionWaiterRequestExistsError(
          `A request already exists for waiter ${validatedInput.waitId}.`,
          { sessionId: context.sessionId, waitId: validatedInput.waitId },
        );
      }
      if (error instanceof SessionWaiterIoError) {
        throw error;
      }
      throw new SessionWaiterIoError(
        `Failed to publish waiter request: ${error instanceof Error ? error.message : String(error)}`,
        { sessionId: context.sessionId, waitId: validatedInput.waitId },
      );
    }

    await options._testHooks?.afterPublishRequest?.();
    context.assertNotCompromised();

    const verifyNowMs = resolveNowMs(options);
    let verifiedSnapshot: SessionWaiterSnapshot | null = null;
    let sessionMissing = false;
    try {
      verifiedSnapshot = await readWaiterFileAndStat(
        context.waitersDir,
        validatedInput.waitId,
        waiterPath,
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        sessionMissing = true;
      } else {
        throw error;
      }
    }

    if (sessionMissing || !verifiedSnapshot || isSessionWaiterExpired(verifiedSnapshot, verifyNowMs)) {
      await fs.unlink(requestPath).catch(() => undefined);
      const stillExists = await doesWorkSessionExist(context.sessionId, rootOptions);
      if (!stillExists) {
        throw new ConversationNotFoundError(`Session ${context.sessionId} does not exist.`);
      }
      throw new SessionWaiterNotWaitingError(
        `Waiter ${validatedInput.waitId} disappeared while publishing request.`,
        { sessionId: context.sessionId, waitId: validatedInput.waitId },
      );
    }

    context.assertNotCompromised();
    return {
      status: "sent",
      sessionId: context.sessionId,
      waitId: validatedInput.waitId,
      createdAt: requestPayload.createdAt,
    };
  });
}

/**
 * Attempts to claim a pending request for an owned waiter using unlink(waiterPath) as the commit point.
 */
export async function claimSessionWaiterRequest(
  input: ClaimSessionWaiterRequestInput,
  options: SessionWaiterStoreOptions = {},
): Promise<ClaimSessionWaiterRequestResult> {
  const validatedSessionId = artifactConversationIdSchema.parse(input.sessionId);
  const validatedWaitId = sessionWaitIdSchema.parse(input.waitId);
  const validatedOwnerInstanceId = sessionWaiterOwnerInstanceIdSchema.parse(
    input.ownerInstanceId,
  );
  const rootOptions = toRootOptions(options);

  try {
    const preResolved = await resolveWorkSessionForWaiterOperation(validatedSessionId, rootOptions);
    const preWaitersDir = await inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITERS_DIRECTORY,
    );
    if (!preWaitersDir) {
      const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
      return {
        status: "cancelled",
        sessionId: validatedSessionId,
        waitId: validatedWaitId,
        reason: stillExists ? "waiter-removed" : "session-deleted",
      };
    }

    return await withSessionWaiterLock(validatedSessionId, "claim", options, async (context) => {
      const waiterPath = path.join(context.waitersDir, `${validatedWaitId}.json`);
      const snapshot = await readWaiterFileAndStat(
        context.waitersDir,
        validatedWaitId,
        waiterPath,
      );
      if (!snapshot) {
        const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
        return {
          status: "cancelled",
          sessionId: validatedSessionId,
          waitId: validatedWaitId,
          reason: stillExists ? "waiter-removed" : "session-deleted",
        };
      }

      if (snapshot.ownerInstanceId !== validatedOwnerInstanceId) {
        throw new SessionWaiterNotWaitingError(
          `Waiter ${validatedWaitId} is owned by another MCP instance.`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }

      const nowMs = resolveNowMs(options);
      if (isSessionWaiterExpired(snapshot, nowMs)) {
        return {
          status: "cancelled",
          sessionId: validatedSessionId,
          waitId: validatedWaitId,
          reason: "lease-expired",
        };
      }

      const requestsDir = await inspectDirectSessionSubdirectoryIfExists(
        context.canonicalConversationDir,
        WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
      );
      if (!requestsDir) {
        return {
          status: "idle",
          waiter: snapshot,
        };
      }

      const requestPath = path.join(requestsDir, `${validatedWaitId}.json`);
      const request = await readWaiterRequestFile(requestsDir, validatedWaitId, requestPath);
      if (!request) {
        return {
          status: "idle",
          waiter: snapshot,
        };
      }

      await options._testHooks?.beforeClaimUnlink?.();
      context.assertNotCompromised();

      try {
        await fs.unlink(waiterPath);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          const stillExists = await doesWorkSessionExist(validatedSessionId, rootOptions);
          return {
            status: "cancelled",
            sessionId: validatedSessionId,
            waitId: validatedWaitId,
            reason: stillExists ? "waiter-removed" : "session-deleted",
          };
        }
        throw new SessionWaiterIoError(
          `Failed to unlink claimed waiter record: ${error instanceof Error ? error.message : String(error)}`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }

      // unlink(waiterPath) is the irreversible claim commit; keep the validated request payload if cleanup fails.
      context.markCommitted();
      await fs.unlink(requestPath).catch(() => undefined);

      return {
        status: "requested",
        sessionId: validatedSessionId,
        waitId: validatedWaitId,
        waiter: snapshot,
        request,
      };
    });
  } catch (error) {
    try {
      await rethrowConversationNotFoundIfDeleted(validatedSessionId, rootOptions, error);
    } catch (mappedError) {
      if (mappedError instanceof ConversationNotFoundError) {
        return {
          status: "cancelled",
          sessionId: validatedSessionId,
          waitId: validatedWaitId,
          reason: "session-deleted",
        };
      }
      throw mappedError;
    }
    throw error;
  }
}

/**
 * Cancels an active waiter record under the coordination mutex and cleans up its request file.
 */
export async function cancelSessionWaiter(
  input: CancelSessionWaiterInput,
  options: SessionWaiterStoreOptions = {},
): Promise<CancelSessionWaiterResult> {
  const validatedSessionId = artifactConversationIdSchema.parse(input.sessionId);
  const validatedWaitId = sessionWaitIdSchema.parse(input.waitId);
  const expectedOwnerInstanceId =
    input.expectedOwnerInstanceId !== undefined
      ? sessionWaiterOwnerInstanceIdSchema.parse(input.expectedOwnerInstanceId)
      : undefined;
  const rootOptions = toRootOptions(options);

  const preResolved = await resolveWorkSessionForWaiterOperation(validatedSessionId, rootOptions);
  const [preWaitersDir, preRequestsDir] = await Promise.all([
    inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITERS_DIRECTORY,
    ),
    inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
    ),
  ]);
  if (!preWaitersDir && !preRequestsDir) {
    return {
      sessionId: validatedSessionId,
      waitId: validatedWaitId,
      cancelled: false,
      waiterExisted: false,
      requestRemoved: false,
    };
  }

  return withSessionWaiterLock(validatedSessionId, "cancel", options, async (context) => {
    const waiterPath = path.join(context.waitersDir, `${validatedWaitId}.json`);
    let waiterExisted = false;

    if (expectedOwnerInstanceId !== undefined) {
      const existing = await readWaiterFileAndStat(
        context.waitersDir,
        validatedWaitId,
        waiterPath,
      );
      if (existing && existing.ownerInstanceId !== expectedOwnerInstanceId) {
        throw new SessionWaiterNotWaitingError(
          `Waiter ${validatedWaitId} is owned by another MCP instance.`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }
    }

    try {
      await fs.unlink(waiterPath);
      waiterExisted = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw new SessionWaiterIoError(
          `Failed to cancel waiter ${validatedWaitId}: ${error instanceof Error ? error.message : String(error)}`,
          { sessionId: validatedSessionId, waitId: validatedWaitId },
        );
      }
    }

    let requestRemoved = false;
    const requestsDir = await inspectDirectSessionSubdirectoryIfExists(
      context.canonicalConversationDir,
      WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
    );
    if (requestsDir) {
      const requestPath = path.join(requestsDir, `${validatedWaitId}.json`);
      try {
        await fs.unlink(requestPath);
        requestRemoved = true;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") {
          throw new SessionWaiterIoError(
            `Failed to remove request for cancelled waiter ${validatedWaitId}: ${error instanceof Error ? error.message : String(error)}`,
            { sessionId: validatedSessionId, waitId: validatedWaitId },
          );
        }
      }
    }

    context.assertNotCompromised();
    return {
      sessionId: validatedSessionId,
      waitId: validatedWaitId,
      cancelled: waiterExisted,
      waiterExisted,
      requestRemoved,
    };
  });
}

/**
 * Removes expired waiter records and orphaned request files under the coordination mutex.
 */
export async function cleanupExpiredSessionWaiters(
  sessionId: string,
  options: SessionWaiterStoreOptions = {},
): Promise<CleanupExpiredSessionWaitersResult> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const rootOptions = toRootOptions(options);

  const preResolved = await resolveWorkSessionForWaiterOperation(validatedSessionId, rootOptions);
  const [preWaitersDir, preRequestsDir] = await Promise.all([
    inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITERS_DIRECTORY,
    ),
    inspectDirectSessionSubdirectoryIfExists(
      preResolved.canonicalConversationDir,
      WORK_SESSION_WAITER_REQUESTS_DIRECTORY,
    ),
  ]);
  if (!preWaitersDir && !preRequestsDir) {
    return {
      sessionId: validatedSessionId,
      removedWaiters: 0,
      removedRequests: 0,
    };
  }

  return withSessionWaiterLock(validatedSessionId, "cleanup", options, async (context) => {
    const nowMs = resolveNowMs(options);
    return cleanupExpiredSessionWaitersUnderLock(context, nowMs);
  });
}
