import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_CONNECTION_SCHEMA_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  ArtifactConnectionInvalidError,
  ArtifactConnectionWriteError,
  WindowConnectionMismatchError,
  WindowConnectionStaleError,
  WORKSPACE_SELECTION_TTL_MS,
  artifactConnectionSchema,
  type ArtifactConnection,
  type ArtifactConnectionHint,
} from "./contracts";
import {
  ARTIFACT_CONNECTION_FILE,
  ARTIFACT_CONNECTION_LOCK_FILE,
  ARTIFACT_MANIFEST_FILE,
  OWNER_ONLY_FILE_MODE,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  assertManagedArtifactFilePath,
  ensureSafeGlobalArtifactDirectory,
  ensureSafeManagedArtifactFile,
  parseArtifactConnection,
  parseArtifactManifest,
  sameFilesystemPath,
} from "./artifact-validation";
import {
  readFreshWorkspaceSnapshots,
  workspaceCandidateId,
  type ResolvedFolderCandidate,
  type ResolvedWindowGroup,
  type WorkspaceRegistrySnapshot,
  type WorkspaceWindowSelectionGrant,
} from "./workspace-registry";

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
}

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

const ARTIFACT_MANIFEST_READ_ATTEMPTS = 5;
const ARTIFACT_MANIFEST_READ_RETRY_MS = 15;

function isTransientManifestReadError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "EBUSY" || code === "EACCES" || code === "EPERM";
}

async function waitForManifestReadRetry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ARTIFACT_MANIFEST_READ_RETRY_MS));
}

async function acquireConnectionLock(artifactDirectory: string): Promise<string> {
  const lockPath = path.join(artifactDirectory, ARTIFACT_CONNECTION_LOCK_FILE);
  const safeLockPath = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    lockPath,
    { allowMissing: true },
  );

  const maxAttempts = 100;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.writeFile(safeLockPath, String(process.pid), {
        flag: "wx",
        mode: OWNER_ONLY_FILE_MODE,
      });
      await ensureSafeManagedArtifactFile(artifactDirectory, safeLockPath);
      return safeLockPath;
    } catch (error) {
      if (errorCode(error) === "EEXIST" || isWindowsReplaceBlock(error)) {
        try {
          const stat = await fs.lstat(safeLockPath);
          if (Date.now() - stat.mtimeMs > 15_000) {
            await fs.unlink(safeLockPath).catch(() => {});
          }
        } catch {
          // ignore stat/unlink errors
        }
        await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 20));
        continue;
      }
      throw error;
    }
  }
  throw new Error("FAILED_TO_ACQUIRE_LOCK: artifact connection is currently locked by another operation.");
}

async function releaseConnectionLock(artifactDirectory: string, lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await ensureSafeManagedArtifactFile(artifactDirectory, lockPath);
      await fs.unlink(lockPath);
      return;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      if (attempt < 4 && isWindowsReplaceBlock(error)) {
        await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

export async function withArtifactConnectionLock<T>(
  artifactDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = await acquireConnectionLock(artifactDirectory);
  try {
    return await operation();
  } finally {
    await releaseConnectionLock(artifactDirectory, lockPath);
  }
}

async function writeConnectionStagingFile(
  filePath: string,
  data: string,
): Promise<ManagedStagingFileIdentity> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let identity: ManagedStagingFileIdentity | undefined;
  let failed = false;
  let failure: unknown;

  try {
    handle = await fs.open(filePath, "wx", OWNER_ONLY_FILE_MODE);
    const stat = await handle.stat({ bigint: true });
    identity = { dev: stat.dev, ino: stat.ino };

    if (isTestEnvironment() && process.env.CODEX_ARTIFACTS_TEST_FAIL_CONNECTION_WRITE === "temp-write") {
      await handle.writeFile("injected-partial-connection-staging\n", { encoding: "utf8" });
      throw Object.assign(new Error("EIO: i/o error writing connection staging file"), {
        code: "EIO",
      });
    }

    await handle.writeFile(data, { encoding: "utf8" });
  } catch (error) {
    failed = true;
    failure = error;
  }

  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
    }
  }

  if (failed) {
    if (identity) {
      await removeOwnedConnectionStagingFile(filePath, identity).catch(() => {});
    }
    throw failure;
  }

  return identity!;
}

type ManagedStagingFileIdentity = {
  dev: bigint;
  ino: bigint;
};

async function removeOwnedConnectionStagingFile(
  filePath: string,
  identity: ManagedStagingFileIdentity,
): Promise<void> {
  try {
    const stat = await fs.lstat(filePath, { bigint: true });
    if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino) return;
    await fs.unlink(filePath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

async function renameManagedFileOperation(
  source: string,
  target: string,
): Promise<void> {
  if (isTestEnvironment() && process.env.CODEX_ARTIFACTS_TEST_FAIL_CONNECTION_WRITE === "rename") {
    const error = Object.assign(new Error("EBUSY: resource busy or locked"), {
      code: "EBUSY",
    });
    throw error;
  }
  await fs.rename(source, target);
}

async function replaceManagedFileWithRetry(
  artifactDirectory: string,
  source: string,
  target: string,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
    const safeTarget = await ensureSafeManagedArtifactFile(
      artifactDirectory,
      target,
      { allowMissing: true },
    );
    try {
      await renameManagedFileOperation(safeSource, safeTarget);
      await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
      return;
    } catch (error) {
      if (attempt < 4 && isWindowsReplaceBlock(error)) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

function defaultGlobalRootOptions(options?: GlobalArtifactsRootOptions): GlobalArtifactsRootOptions {
  if (options?.userHome) return options;
  const testUserHome = process.env.CODEX_ARTIFACTS_TEST_USER_HOME;
  return testUserHome ? { userHome: testUserHome } : {};
}

export type ValidatedArtifactConnectionParent = {
  artifactId: string;
  artifactDirectory: string;
  workspaceRoot: string;
};

export async function validateArtifactConnectionParent(
  artifactDirectory: string,
  rootOptions?: GlobalArtifactsRootOptions,
): Promise<ValidatedArtifactConnectionParent> {
  const resolvedRootOptions = defaultGlobalRootOptions(rootOptions);
  const candidateArtifactId = path.basename(path.resolve(artifactDirectory));
  const safeDirectory = await ensureSafeGlobalArtifactDirectory(
    candidateArtifactId,
    artifactDirectory,
    resolvedRootOptions,
  );

  const manifestPath = path.join(safeDirectory, ARTIFACT_MANIFEST_FILE);
  let manifest: ReturnType<typeof parseArtifactManifest> | undefined;

  for (let attempt = 0; attempt < ARTIFACT_MANIFEST_READ_ATTEMPTS; attempt++) {
    let safeManifestPath: string;
    try {
      safeManifestPath = await ensureSafeManagedArtifactFile(
        safeDirectory,
        manifestPath,
        { allowMissing: true },
      );
    } catch (err) {
      throw new ArtifactConnectionInvalidError(
        `unsafe artifact manifest path: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let raw: string;
    try {
      raw = await fs.readFile(safeManifestPath, "utf8");
    } catch (err) {
      if (attempt < ARTIFACT_MANIFEST_READ_ATTEMPTS - 1 && isTransientManifestReadError(err)) {
        await waitForManifestReadRetry();
        continue;
      }
      throw new ArtifactConnectionInvalidError(
        `failed to read artifact manifest: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      if (attempt < ARTIFACT_MANIFEST_READ_ATTEMPTS - 1) {
        await waitForManifestReadRetry();
        continue;
      }
      throw new ArtifactConnectionInvalidError(
        `malformed JSON in artifact manifest: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      manifest = parseArtifactManifest(json);
      break;
    } catch (err) {
      if (attempt < ARTIFACT_MANIFEST_READ_ATTEMPTS - 1) {
        await waitForManifestReadRetry();
        continue;
      }
      throw new ArtifactConnectionInvalidError(
        `invalid artifact manifest: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!manifest) {
    throw new ArtifactConnectionInvalidError("artifact manifest remained unreadable after bounded retry.");
  }

  if (manifest.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new ArtifactConnectionInvalidError(
      `unsupported manifest schemaVersion: expected ${ARTIFACT_SCHEMA_VERSION}, got ${manifest.schemaVersion}`,
    );
  }

  if (manifest.artifactId !== candidateArtifactId) {
    throw new ArtifactConnectionInvalidError(
      `manifest artifactId mismatch: manifest has ${manifest.artifactId}, directory basename is ${candidateArtifactId}`,
    );
  }

  return {
    artifactId: manifest.artifactId,
    artifactDirectory: safeDirectory,
    workspaceRoot: manifest.location.workspaceRoot,
  };
}

export type ReadArtifactConnectionOptions = {
  allowMissing?: boolean;
  boundedRetry?: boolean;
  rootOptions?: GlobalArtifactsRootOptions;
};

export async function readArtifactConnection(
  artifactDirectory: string,
  options: ReadArtifactConnectionOptions = {},
): Promise<ArtifactConnection | null> {
  const { allowMissing = true, boundedRetry = true, rootOptions } = options;
  const resolvedRootOptions = defaultGlobalRootOptions(rootOptions);

  let parent: ValidatedArtifactConnectionParent;
  try {
    parent = await validateArtifactConnectionParent(artifactDirectory, resolvedRootOptions);
  } catch (error) {
    if (allowMissing && errorCode(error) === "ENOENT") return null;
    throw error;
  }

  const safeDirectory = parent.artifactDirectory;
  const filePath = path.join(safeDirectory, ARTIFACT_CONNECTION_FILE);
  let safeFilePath: string;
  try {
    safeFilePath = await ensureSafeManagedArtifactFile(
      safeDirectory,
      filePath,
      { allowMissing: true },
    );
  } catch (err) {
    throw new ArtifactConnectionInvalidError(
      `unsafe connection file path: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const maxAttempts = boundedRetry ? 5 : 1;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await fs.readFile(safeFilePath, "utf8");
      if (!raw.trim()) {
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          continue;
        }
        throw new ArtifactConnectionInvalidError("artifact-connection.json is empty.");
      }
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (err) {
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          continue;
        }
        throw new ArtifactConnectionInvalidError(
          `malformed JSON in artifact-connection.json: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      let parsed: ArtifactConnection;
      try {
        parsed = parseArtifactConnection(json);
      } catch (err) {
        throw new ArtifactConnectionInvalidError(
          `invalid artifact connection schema: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return parsed;
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        if (allowMissing) return null;
        throw error;
      }
      if (error instanceof ArtifactConnectionInvalidError) {
        throw error;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 15));
        continue;
      }
      throw error;
    }
  }
  return null;
}

export type CommitArtifactConnectionParams = {
  windowInstanceId: string;
  source: "create" | "inspect";
  openRequestId?: string;
};

export type CommitArtifactConnectionOptions = {
  now?: string | number;
  rootOptions?: GlobalArtifactsRootOptions;
  testOnlyStagingFileName?: string;
};

export async function commitArtifactConnectionRequest(
  artifactDirectory: string,
  params: CommitArtifactConnectionParams,
  options: CommitArtifactConnectionOptions = {},
): Promise<ArtifactConnection> {
  const parent = await validateArtifactConnectionParent(artifactDirectory, options.rootOptions);
  const safeArtifactDirectory = parent.artifactDirectory;

  return withArtifactConnectionLock(safeArtifactDirectory, async () => {
    const existing = await readArtifactConnection(safeArtifactDirectory, {
      allowMissing: true,
      boundedRetry: false,
      ...(options.rootOptions ? { rootOptions: options.rootOptions } : {}),
    });
    const connectionRevision = existing ? existing.connectionRevision + 1 : 1;
    const openRequestId = params.openRequestId ?? randomUUID();
    const updatedAt = options.now != null
      ? new Date(options.now).toISOString()
      : new Date().toISOString();

    const connectionPayload = {
      schemaVersion: ARTIFACT_CONNECTION_SCHEMA_VERSION,
      windowInstanceId: params.windowInstanceId,
      connectionRevision,
      openRequestId,
      source: params.source,
      updatedAt,
    };

    let validated: ArtifactConnection;
    try {
      validated = parseArtifactConnection(connectionPayload);
    } catch (err) {
      throw new ArtifactConnectionInvalidError(`invalid payload: ${err instanceof Error ? err.message : String(err)}`);
    }

    const targetFilePath = path.join(safeArtifactDirectory, ARTIFACT_CONNECTION_FILE);
    let tempFileName: string;
    if (options.testOnlyStagingFileName !== undefined) {
      if (!isTestEnvironment()) {
        throw new Error("testOnlyStagingFileName is only permitted in test environments.");
      }
      if (
        !/^artifact-connection\.json\.tmp-[A-Za-z0-9_-]+$/.test(options.testOnlyStagingFileName)
        || path.basename(options.testOnlyStagingFileName) !== options.testOnlyStagingFileName
      ) {
        throw new ArtifactConnectionInvalidError(
          `invalid test-only staging file name: ${options.testOnlyStagingFileName}`,
        );
      }
      tempFileName = options.testOnlyStagingFileName;
    } else {
      tempFileName = `${ARTIFACT_CONNECTION_FILE}.tmp-${randomUUID()}`;
    }
    const tempFilePath = path.join(safeArtifactDirectory, tempFileName);

    let safeTempPath: string;
    try {
      safeTempPath = await ensureSafeManagedArtifactFile(
        safeArtifactDirectory,
        tempFilePath,
        { allowMissing: true },
      );
    } catch (err) {
      throw new ArtifactConnectionInvalidError(
        `unsafe temp connection path: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let stagingIdentity: ManagedStagingFileIdentity | undefined;
    try {
      stagingIdentity = await writeConnectionStagingFile(
        safeTempPath,
        JSON.stringify(validated, null, 2) + "\n",
      );
      await ensureSafeManagedArtifactFile(safeArtifactDirectory, safeTempPath);

      await replaceManagedFileWithRetry(safeArtifactDirectory, safeTempPath, targetFilePath);
    } catch (err) {
      if (stagingIdentity) {
        await removeOwnedConnectionStagingFile(safeTempPath, stagingIdentity).catch(() => {
          // Preserve the original write/replace failure if rollback cleanup also fails.
        });
      }
      if (err instanceof ArtifactConnectionInvalidError) {
        throw err;
      }
      throw new ArtifactConnectionWriteError(
        `failed to write artifact connection: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return validated;
  });
}

export type ResolveArtifactConnectionTargetOptions = {
  workspaceRoot: string;
  artifactDirectory?: string;
  selectionGrant?: WorkspaceWindowSelectionGrant;
  connectionHint?: ArtifactConnectionHint;
  registrySnapshots?: WorkspaceRegistrySnapshot[];
  directory?: string;
  now?: number;
};

export type ResolveArtifactConnectionTargetMatched = {
  status: "matched";
  targetWindow: {
    windowInstanceId: string;
    workspaceRoot: string;
  };
  source: "token" | "existing-connection" | "hint" | "single-window";
};

export type ResolveArtifactConnectionTargetSelectionRequired = {
  status: "selection-required";
  workspaceRoot: string;
  windows: ResolvedWindowGroup[];
  candidates: ResolvedFolderCandidate[];
  message: string;
};

export type ResolveArtifactConnectionTargetNotFound = {
  status: "not-found";
  workspaceRoot: string;
  message: string;
};

export type ResolveArtifactConnectionTargetResult =
  | ResolveArtifactConnectionTargetMatched
  | ResolveArtifactConnectionTargetSelectionRequired
  | ResolveArtifactConnectionTargetNotFound;

export async function resolveArtifactConnectionTarget(
  options: ResolveArtifactConnectionTargetOptions,
): Promise<ResolveArtifactConnectionTargetResult> {
  const {
    workspaceRoot: requestedWorkspaceRoot,
    artifactDirectory,
    selectionGrant,
    connectionHint,
    directory,
    now = Date.now(),
  } = options;

  let targetWorkspaceRoot = requestedWorkspaceRoot;
  let authoritativeExisting: ArtifactConnection | null = null;

  if (artifactDirectory) {
    const parent = await validateArtifactConnectionParent(artifactDirectory);
    targetWorkspaceRoot = parent.workspaceRoot;
    if (
      requestedWorkspaceRoot
      && !sameFilesystemPath(requestedWorkspaceRoot, targetWorkspaceRoot)
    ) {
      throw new WindowConnectionMismatchError(
        `The specified workspaceRoot does not match the manifest workspaceRoot.`,
      );
    }
    authoritativeExisting = await readArtifactConnection(artifactDirectory, {
      allowMissing: true,
      boundedRetry: false,
    });
  }

  const snapshots = options.registrySnapshots
    ?? await readFreshWorkspaceSnapshots(directory, now);

  // 1. Selection grant (highest explicit authority if provided)
  if (selectionGrant) {
    if (selectionGrant.expiresAt <= now) {
      return {
        status: "not-found",
        workspaceRoot: targetWorkspaceRoot,
        message: "The selection grant has expired.",
      };
    }
    if (!sameFilesystemPath(selectionGrant.workspaceRoot, targetWorkspaceRoot)) {
      throw new WindowConnectionMismatchError("the selection token does not belong to workspaceRoot.");
    }
    const snapshot = snapshots.find((s) => s.instanceId === selectionGrant.windowInstanceId);
    if (
      snapshot
      && snapshot.folders.some((f) => sameFilesystemPath(f.realPath, targetWorkspaceRoot))
    ) {
      return {
        status: "matched",
        targetWindow: {
          windowInstanceId: selectionGrant.windowInstanceId,
          workspaceRoot: targetWorkspaceRoot,
        },
        source: "token",
      };
    }
    return {
      status: "not-found",
      workspaceRoot: targetWorkspaceRoot,
      message: "The window or workspace folder selected by the grant is no longer available.",
    };
  }

  // 2. Explicit windowInstanceId hint (P1.1: takes precedence over existing connection)
  if (connectionHint?.windowInstanceId) {
    const hintWindowId = connectionHint.windowInstanceId;
    const snapshot = snapshots.find((s) => s.instanceId === hintWindowId);
    if (!snapshot) {
      throw new WindowConnectionStaleError(
        `The window specified by the hint is stale or no longer open.`,
      );
    }
    const hasWorkspace = snapshot.folders.some((f) => sameFilesystemPath(f.realPath, targetWorkspaceRoot));
    if (!hasWorkspace) {
      throw new WindowConnectionMismatchError(
        `The window specified by the hint does not have the workspace open.`,
      );
    }
    return {
      status: "matched",
      targetWindow: {
        windowInstanceId: hintWindowId,
        workspaceRoot: targetWorkspaceRoot,
      },
      source: "hint",
    };
  }

  // 3. Existing connection file in artifact directory (if available and no explicit hint was given)
  if (authoritativeExisting) {
    const snapshot = snapshots.find((s) => s.instanceId === authoritativeExisting.windowInstanceId);
    if (
      snapshot
      && snapshot.folders.some((f) => sameFilesystemPath(f.realPath, targetWorkspaceRoot))
    ) {
      return {
        status: "matched",
        targetWindow: {
          windowInstanceId: authoritativeExisting.windowInstanceId,
          workspaceRoot: targetWorkspaceRoot,
        },
        source: "existing-connection",
      };
    }
  }

  // 4. Match against fresh registered windows
  const matchingWindows = snapshots.filter((s) =>
    s.folders.some((f) => sameFilesystemPath(f.realPath, targetWorkspaceRoot))
  );

  const singleTarget = matchingWindows[0];
  if (matchingWindows.length === 1 && singleTarget) {
    return {
      status: "matched",
      targetWindow: {
        windowInstanceId: singleTarget.instanceId,
        workspaceRoot: targetWorkspaceRoot,
      },
      source: "single-window",
    };
  }

  if (matchingWindows.length > 1) {
    const expiresAt = new Date(now + WORKSPACE_SELECTION_TTL_MS).toISOString();
    const windows: ResolvedWindowGroup[] = matchingWindows.map((s) => {
      const matchedFolder = s.folders.find((f) => sameFilesystemPath(f.realPath, targetWorkspaceRoot))!;
      const candidateId = workspaceCandidateId(s.instanceId, matchedFolder.realPath);
      const name = path.basename(matchedFolder.path) || path.basename(matchedFolder.realPath);
      const candidate: ResolvedFolderCandidate = {
        candidateId,
        name,
        path: matchedFolder.realPath,
        match: "exact-path",
        selectionToken: randomUUID(),
        expiresAt,
      };
      return {
        windowInstanceId: s.instanceId,
        focused: s.focused,
        snapshotUpdatedAt: s.updatedAt,
        workspaceFile: s.workspaceFile,
        activeFile: s.activeFile,
        folders: [candidate],
      };
    });

    return {
      status: "selection-required",
      workspaceRoot: targetWorkspaceRoot,
      windows,
      candidates: windows.flatMap((w) => w.folders),
      message: "Multiple VS Code windows have this workspace open. Select the target window.",
    };
  }

  return {
    status: "not-found",
    workspaceRoot: targetWorkspaceRoot,
    message: "No active VS Code window was found for this workspace.",
  };
}
