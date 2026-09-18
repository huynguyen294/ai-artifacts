import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs, watch as watchFs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  assertManagedArtifactFilePath,
  assertGlobalArtifactDirectory,
  artifactPaths,
  ensureSafeGlobalArtifactDirectory,
  ensureSafeGlobalArtifactsRoot,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
  sameFilesystemPath,
} from "../shared/artifact-validation";
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactConnectionInvalidError,
  ArtifactConnectionWriteError,
  WindowConnectionMismatchError,
  WindowConnectionStaleError,
  artifactIdSchema,
  artifactKindSchema,
  artifactManifestSchema,
  commentsDocumentSchema,
  WORKSPACE_SELECTION_TTL_MS,
  type ArtifactConnection,
  type ArtifactManifest,
  type ReviewDecision,
} from "../shared/contracts";
import {
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  REVIEW_SUBMISSION_FILE,
  managedWorkspaceRegistryDirectory,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  readFreshWorkspaceSnapshots,
  resolveRegisteredWorkspaceRoot,
  resolveWorkspaceCandidates,
  resolveWorkspaceRootForArtifactCreation,
  workspaceCandidateId,
  workspaceEvidenceSchema,
  workspaceRegistryDirectory,
  type ResolvedFolderCandidate,
  type ResolvedWindowGroup,
  type WorkspaceEvidence,
  type WorkspaceWindowSelectionGrant,
} from "../shared/workspace-registry";
import {
  commitArtifactConnectionRequest,
  readArtifactConnection,
  resolveArtifactConnectionTarget,
} from "../shared/artifact-connection";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = "8.0.0";
const RESOLVE_WORKSPACE_TOOL_NAME = "resolve_artifact_workspace";
const CREATE_TOOL_NAME = "create_artifact";
const WAIT_TOOL_NAME = "wait_for_artifact_review";
const INSPECT_TOOL_NAME = "inspect_artifact_review";
const ADVANCE_AND_WAIT_TOOL_NAME = "advance_and_wait_for_artifact";
const ROUND_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const LIFECYCLE_JSON_READ_ATTEMPTS = 21;
const LIFECYCLE_JSON_READ_RETRY_MS = 50;
const testArtifactIds = process.env.NODE_ENV === "test"
  ? (process.env.CODEX_ARTIFACTS_TEST_ARTIFACT_IDS ?? "").split(",").filter(Boolean)
  : [];

type JsonObject = Record<string, any>;

type ArtifactContext = {
  artifactDirectory: string;
  artifactId: string;
  workspaceRoot: string;
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  manifest: ArtifactManifest;
  manifestPath: string;
  artifactPath: string;
  commentsPath: string;
  submissionPath: string;
};

type ReviewWaitResult = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  artifactId: string;
  kind: string;
  workspaceRoot: string;
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  commentsSha256: string;
  decision: ReviewDecision;
  submittedAt: string;
  artifactPath: string;
  commentsPath: string;
  submissionSha256: string;
  artifactUrl?: string;
  artifactLink?: string;
  nextAction?: {
    type: "execute-approved-plan";
    instruction: string;
  };
};

type RoundGrant = {
  source: "submitted-review" | "chat-inspection" | "chat-update";
  artifactDirectory: string;
  artifactId: string;
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  commentsSha256: string;
  submissionExpected: boolean;
  submissionSha256?: string;
  expiresAt: number;
};

type ActiveArtifactWaiter = {
  requestKey: string;
  reviewRound: number;
  controller: AbortController;
  settled: Promise<void>;
};

type WorkspaceSelectionGrant = {
  query: string;
  candidateId: string;
  workspaceRoot: string;
  contextKey: string;
  expiresAt: number;
};

type ArtifactRecoveryCode =
  | "ROUND_TOKEN_INVALID_OR_EXPIRED"
  | "ROUND_TOKEN_IN_USE"
  | "ROUND_TOKEN_ALREADY_CONSUMED"
  | "ROUND_MISMATCH"
  | "ROUND_STATE_CHANGED"
  | "ARTIFACT_ALREADY_WAITING"
  | "ADVANCE_CANCELLED_BEFORE_COMMIT"
  | "ADVANCE_COMMITTED"
  | "ADVANCE_ROLLED_BACK"
  | "WORKSPACE_NOT_REGISTERED"
  | "WINDOW_SELECTION_REQUIRED"
  | "WINDOW_SELECTION_EXPIRED"
  | "WINDOW_CONNECTION_STALE"
  | "WINDOW_CONNECTION_MISMATCH"
  | "ARTIFACT_CONNECTION_INVALID"
  | "ARTIFACT_CONNECTION_WRITE_FAILED";

type ArtifactRecoveryMetadata = {
  code: ArtifactRecoveryCode;
  retryable: boolean;
  expectedNextTool?: typeof INSPECT_TOOL_NAME | typeof WAIT_TOOL_NAME | typeof ADVANCE_AND_WAIT_TOOL_NAME | typeof RESOLVE_WORKSPACE_TOOL_NAME | typeof CREATE_TOOL_NAME;
  reuseRoundToken: boolean;
  useSameArtifactHandle: true;
  currentReviewRound?: number;
};

class ArtifactRecoveryError extends Error {
  readonly recovery: ArtifactRecoveryMetadata;

  constructor(message: string, recovery: Omit<ArtifactRecoveryMetadata, "useSameArtifactHandle">) {
    super(message);
    this.name = "ArtifactRecoveryError";
    this.recovery = { ...recovery, useSameArtifactHandle: true };
  }
}

class WindowSelectionRequiredError extends Error {
  readonly status = "selection-required" as const;
  readonly code = "WINDOW_SELECTION_REQUIRED" as const;
  readonly retryable = true as const;
  readonly lifecycleMutated = false as const;
  readonly takeoverOccurred = false as const;
  readonly expectedNextTool: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME;
  readonly useSameArtifactHandle: boolean;
  readonly windows: ResolvedWindowGroup[];
  readonly candidates: ResolvedFolderCandidate[];

  constructor(
    message: string,
    windows: ResolvedWindowGroup[],
    candidates: ResolvedFolderCandidate[],
    context: {
      expectedNextTool: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME;
      useSameArtifactHandle: boolean;
    },
  ) {
    super(message);
    this.name = "WindowSelectionRequiredError";
    this.windows = windows;
    this.candidates = candidates;
    this.expectedNextTool = context.expectedNextTool;
    this.useSameArtifactHandle = context.useSameArtifactHandle;
  }
}

function recoveryError(
  code: ArtifactRecoveryCode,
  message: string,
  options: Omit<ArtifactRecoveryMetadata, "code" | "useSameArtifactHandle">,
): ArtifactRecoveryError {
  return new ArtifactRecoveryError(`${code}: ${message}`, { code, ...options });
}

type RecoveryContext = {
  isCreate?: boolean;
  isTaggedCreate?: boolean;
};

function asLifecycleRecoveryError(error: unknown, context: RecoveryContext = {}): unknown {
  if (error instanceof WindowSelectionRequiredError) return error;
  if (error instanceof ArtifactRecoveryError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("WORKSPACE_NOT_REGISTERED:")) {
    return recoveryError("WORKSPACE_NOT_REGISTERED", message.slice("WORKSPACE_NOT_REGISTERED:".length).trim(), {
      retryable: true,
      reuseRoundToken: false,
    });
  }
  if (message.startsWith("WINDOW_SELECTION_EXPIRED:") || message.startsWith("WORKSPACE_SELECTION_EXPIRED:")) {
    const text = message.startsWith("WINDOW_SELECTION_EXPIRED:")
      ? message.slice("WINDOW_SELECTION_EXPIRED:".length).trim()
      : message.slice("WORKSPACE_SELECTION_EXPIRED:".length).trim();
    const expectedNextTool = context.isCreate
      ? (context.isTaggedCreate ? CREATE_TOOL_NAME : RESOLVE_WORKSPACE_TOOL_NAME)
      : INSPECT_TOOL_NAME;
    return recoveryError("WINDOW_SELECTION_EXPIRED", text, {
      retryable: true,
      expectedNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof WindowConnectionMismatchError || message.startsWith("WORKSPACE_EVIDENCE_MISMATCH:")) {
    const text = error instanceof WindowConnectionMismatchError
      ? message.slice("WINDOW_CONNECTION_MISMATCH:".length).trim()
      : message.slice("WORKSPACE_EVIDENCE_MISMATCH:".length).trim();
    const expectedNextTool = context.isCreate
      ? (context.isTaggedCreate ? CREATE_TOOL_NAME : RESOLVE_WORKSPACE_TOOL_NAME)
      : INSPECT_TOOL_NAME;
    return recoveryError("WINDOW_CONNECTION_MISMATCH", text, {
      retryable: false,
      expectedNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof WindowConnectionStaleError) {
    const text = message.slice("WINDOW_CONNECTION_STALE:".length).trim();
    const expectedNextTool = context.isCreate ? CREATE_TOOL_NAME : INSPECT_TOOL_NAME;
    return recoveryError("WINDOW_CONNECTION_STALE", text, {
      retryable: true,
      expectedNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof ArtifactConnectionInvalidError) {
    return recoveryError("ARTIFACT_CONNECTION_INVALID", message.slice("ARTIFACT_CONNECTION_INVALID:".length).trim(), {
      retryable: false,
      reuseRoundToken: false,
    });
  }
  if (error instanceof ArtifactConnectionWriteError) {
    return recoveryError("ARTIFACT_CONNECTION_WRITE_FAILED", message.slice("ARTIFACT_CONNECTION_WRITE_FAILED:".length).trim(), {
      retryable: true,
      expectedNextTool: INSPECT_TOOL_NAME,
      reuseRoundToken: false,
    });
  }
  return error;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function approvedPlanAction(kind: string, decision: ReviewDecision): ReviewWaitResult["nextAction"] {
  if (decision !== "approve" || (kind !== "plan" && kind !== "implementation-plan")) return undefined;
  return {
    type: "execute-approved-plan",
    instruction: "Execute the approved plan immediately in this same turn. Perform all in-scope code, file, workspace, and command actions described by the plan. Do not stop after acknowledging approval and do not ask for another confirmation. Pause only for a genuine blocker or authority outside the approved scope.",
  };
}

async function readManagedFile(artifactDirectory: string, filePath: string): Promise<string> {
  const safeFilePath = await ensureSafeManagedArtifactFile(artifactDirectory, filePath);
  return fs.readFile(safeFilePath, "utf8");
}

async function readManagedJson(artifactDirectory: string, filePath: string): Promise<unknown> {
  return JSON.parse(await readManagedFile(artifactDirectory, filePath));
}

async function readOptionalManagedFile(
  artifactDirectory: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    return await readManagedFile(artifactDirectory, filePath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

async function managedFileExists(artifactDirectory: string, filePath: string): Promise<boolean> {
  try {
    await ensureSafeManagedArtifactFile(artifactDirectory, filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function writeNewManagedFile(
  artifactDirectory: string,
  filePath: string,
  contents: string,
): Promise<void> {
  const safeFilePath = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    filePath,
    { allowMissing: true },
  );
  await fs.writeFile(safeFilePath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: OWNER_ONLY_FILE_MODE,
  });
  await ensureSafeManagedArtifactFile(artifactDirectory, safeFilePath);
}

async function copyManagedFile(
  artifactDirectory: string,
  source: string,
  target: string,
  exclusive = false,
): Promise<void> {
  const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
  const safeTarget = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    target,
    { allowMissing: true },
  );
  await fs.copyFile(safeSource, safeTarget, exclusive ? constants.COPYFILE_EXCL : 0);
  await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
}

async function renameManagedFileToMissingTarget(
  artifactDirectory: string,
  source: string,
  target: string,
): Promise<void> {
  const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
  const safeTarget = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    target,
    { allowMissing: true },
  );
  if (await managedFileExists(artifactDirectory, safeTarget)) {
    throw new Error(`Artifact transaction target already exists: ${path.basename(safeTarget)}`);
  }
  await fs.rename(safeSource, safeTarget);
  await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
}

async function removeManagedFileIfExists(artifactDirectory: string, filePath: string): Promise<void> {
  const safeFilePath = assertManagedArtifactFilePath(artifactDirectory, filePath);
  try {
    const stat = await fs.lstat(safeFilePath);
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      throw new Error("UNSAFE_ARTIFACT_PATH: managed cleanup targets must be regular files or symbolic links.");
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  await fs.unlink(safeFilePath);
}

function samePathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function globalRootOptions(): GlobalArtifactsRootOptions {
  const testUserHome = process.env.NODE_ENV === "test"
    ? process.env.CODEX_ARTIFACTS_TEST_USER_HOME
    : undefined;
  return testUserHome ? { userHome: testUserHome } : {};
}

function artifactSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return slug || "artifact";
}

function generatedArtifactId(title: string): string {
  const testArtifactId = testArtifactIds.shift();
  if (testArtifactId !== undefined) return artifactIdSchema.parse(testArtifactId);
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${artifactSlug(title)}-${date}-${randomUUID().slice(0, 8)}`;
}

type CreateArtifactInput = {
  workspaceRoot: string;
  workspaceEvidence: WorkspaceEvidence;
  title: string;
  kind: string;
  markdown: string;
  connection?: {
    selectionToken?: string;
  };
};

function parseCreateArguments(args: JsonObject | undefined): CreateArtifactInput {
  const workspaceRoot = args?.workspaceRoot;
  const workspaceEvidence = workspaceEvidenceSchema.safeParse(args?.workspaceEvidence);
  const title = args?.title;
  const kind = args?.kind;
  const markdown = args?.markdown;
  const connectionRaw = args?.connection;

  if (typeof workspaceRoot !== "string" || !path.isAbsolute(workspaceRoot)) {
    throw new Error("WORKSPACE_NOT_REGISTERED: workspaceRoot must be an absolute path.");
  }
  if (!workspaceEvidence.success) {
    throw new Error(
      "WORKSPACE_EVIDENCE_REQUIRED: declare tagged-file or resolved-workspace evidence. Cwd, active files, project markers, inferred folder names, and workspace order are not evidence.",
    );
  }
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200) {
    throw new Error("INVALID_ARTIFACT_INPUT: title must contain 1 to 200 characters.");
  }
  if (!artifactKindSchema.safeParse(kind).success) {
    throw new Error("INVALID_ARTIFACT_INPUT: kind must be a lowercase slug.");
  }
  if (typeof markdown !== "string" || !markdown.trim()) {
    throw new Error("INVALID_ARTIFACT_INPUT: markdown must be non-empty.");
  }
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new Error(`INVALID_ARTIFACT_INPUT: markdown exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
  }

  let connection: { selectionToken?: string } | undefined;
  if (connectionRaw !== undefined) {
    if (typeof connectionRaw !== "object" || connectionRaw === null) {
      throw new Error("INVALID_ARTIFACT_INPUT: connection must be an object.");
    }
    const connObj = connectionRaw as Record<string, unknown>;
    if (connObj.selectionToken !== undefined) {
      if (
        typeof connObj.selectionToken !== "string"
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connObj.selectionToken)
      ) {
        throw new Error("INVALID_ARTIFACT_INPUT: connection.selectionToken must be a valid UUID.");
      }
      connection = { selectionToken: connObj.selectionToken };
    }
  }

  return {
    workspaceRoot,
    workspaceEvidence: workspaceEvidence.data,
    title: title.trim(),
    kind,
    markdown,
    ...(connection ? { connection } : {}),
  };
}

const workspaceSelectionGrants = new Map<string, WorkspaceWindowSelectionGrant>();
const claimedWorkspaceSelectionTokens = new Set<string>();

function pruneWorkspaceSelectionGrants(): void {
  const now = Date.now();
  for (const [token, grant] of workspaceSelectionGrants) {
    if (grant.expiresAt <= now) workspaceSelectionGrants.delete(token);
  }
}

async function resolveCreateWorkspaceRoot(input: CreateArtifactInput): Promise<{
  workspaceRoot: string;
  targetWindow: { windowInstanceId: string; workspaceRoot: string };
  selectionToken?: string;
}> {
  const rootOptions = globalRootOptions();
  const registryDir = workspaceRegistryDirectory(rootOptions);

  if (input.workspaceEvidence.kind === "resolved-workspace") {
    const evidence = input.workspaceEvidence;
    pruneWorkspaceSelectionGrants();
    if (claimedWorkspaceSelectionTokens.has(evidence.selectionToken)) {
      throw new Error("WORKSPACE_SELECTION_IN_USE: the selected workspace token is already being used.");
    }
    const grant = workspaceSelectionGrants.get(evidence.selectionToken);
    if (!grant || grant.expiresAt <= Date.now()) {
      throw new Error("WORKSPACE_SELECTION_EXPIRED: resolve the workspace again and choose a current candidate, asking the user only if the result is ambiguous.");
    }
    if (samePathKey(grant.workspaceRoot) !== samePathKey(input.workspaceRoot)) {
      throw new Error("WORKSPACE_EVIDENCE_MISMATCH: the selection token does not belong to workspaceRoot.");
    }
    if (input.connection?.selectionToken && input.connection.selectionToken !== evidence.selectionToken) {
      const connGrant = workspaceSelectionGrants.get(input.connection.selectionToken);
      if (
        !connGrant
        || connGrant.windowInstanceId !== grant.windowInstanceId
        || samePathKey(connGrant.workspaceRoot) !== samePathKey(grant.workspaceRoot)
      ) {
        throw new Error("WORKSPACE_EVIDENCE_MISMATCH: the connection selection token does not belong to the selected workspace.");
      }
    }
    const snapshots = await readFreshWorkspaceSnapshots(registryDir);
    const windowSnapshot = snapshots.find((s) => s.instanceId === grant.windowInstanceId);
    if (!windowSnapshot) {
      workspaceSelectionGrants.delete(evidence.selectionToken);
      throw new Error("WORKSPACE_SELECTION_EXPIRED: the window is no longer open; resolve and select the workspace again.");
    }
    const folderStillPresent = windowSnapshot.folders.some((f) => sameFilesystemPath(f.realPath, grant.workspaceRoot));
    if (!folderStillPresent) {
      workspaceSelectionGrants.delete(evidence.selectionToken);
      throw new Error("WORKSPACE_SELECTION_EXPIRED: the workspace folder is no longer open in the selected window; resolve and select the workspace again.");
    }
    if (workspaceCandidateId(grant.windowInstanceId, grant.workspaceRoot) !== grant.candidateId) {
      workspaceSelectionGrants.delete(evidence.selectionToken);
      throw new Error("WORKSPACE_SELECTION_EXPIRED: candidate identity mismatch; resolve and select the workspace again.");
    }
    claimedWorkspaceSelectionTokens.add(evidence.selectionToken);
    try {
      const workspaceRoot = await resolveWorkspaceRootForArtifactCreation(input.workspaceRoot, evidence, registryDir);
      return {
        workspaceRoot,
        targetWindow: { windowInstanceId: grant.windowInstanceId, workspaceRoot },
        selectionToken: evidence.selectionToken,
      };
    } catch (error) {
      claimedWorkspaceSelectionTokens.delete(evidence.selectionToken);
      throw error;
    }
  }

  // Tagged-file evidence:
  const evidence = input.workspaceEvidence;
  const workspaceRoot = await resolveWorkspaceRootForArtifactCreation(input.workspaceRoot, evidence, registryDir);

  if (input.connection?.selectionToken) {
    pruneWorkspaceSelectionGrants();
    const connToken = input.connection.selectionToken;
    if (claimedWorkspaceSelectionTokens.has(connToken)) {
      throw new Error("WINDOW_SELECTION_EXPIRED: the connection selection token is already being used.");
    }
    const connGrant = workspaceSelectionGrants.get(connToken);
    if (!connGrant || connGrant.expiresAt <= Date.now()) {
      throw new Error("WINDOW_SELECTION_EXPIRED: resolve the workspace again and choose a current candidate, asking the user only if the result is ambiguous.");
    }
    if (samePathKey(connGrant.workspaceRoot) !== samePathKey(workspaceRoot)) {
      throw new WindowConnectionMismatchError("the connection selection token does not belong to workspaceRoot.");
    }
    const snapshots = await readFreshWorkspaceSnapshots(registryDir);
    const windowSnapshot = snapshots.find((s) => s.instanceId === connGrant.windowInstanceId);
    if (!windowSnapshot) {
      workspaceSelectionGrants.delete(connToken);
      throw new Error("WINDOW_SELECTION_EXPIRED: the window is no longer open; resolve and select the workspace again.");
    }
    const folderStillPresent = windowSnapshot.folders.some((f) => sameFilesystemPath(f.realPath, connGrant.workspaceRoot));
    if (!folderStillPresent) {
      workspaceSelectionGrants.delete(connToken);
      throw new Error("WINDOW_SELECTION_EXPIRED: the workspace folder is no longer open in the selected window; resolve and select the workspace again.");
    }
    claimedWorkspaceSelectionTokens.add(connToken);
    return {
      workspaceRoot,
      targetWindow: { windowInstanceId: connGrant.windowInstanceId, workspaceRoot },
      selectionToken: connToken,
    };
  }

  // Preflight routing target
  const targetResolution = await resolveArtifactConnectionTarget({
    workspaceRoot,
    directory: registryDir,
  });

  if (targetResolution.status === "matched") {
    return {
      workspaceRoot,
      targetWindow: targetResolution.targetWindow,
    };
  }

  if (targetResolution.status === "selection-required") {
    for (const win of targetResolution.windows) {
      for (const candidate of win.folders) {
        workspaceSelectionGrants.set(candidate.selectionToken, {
          query: candidate.name,
          candidateId: candidate.candidateId,
          workspaceRoot: candidate.path,
          windowInstanceId: win.windowInstanceId,
          snapshotIdentity: `${win.windowInstanceId}:${win.snapshotUpdatedAt}`,
          expiresAt: Date.parse(candidate.expiresAt),
        });
      }
    }
    throw new WindowSelectionRequiredError(
      "WINDOW_SELECTION_REQUIRED: multiple VS Code windows have this workspace open. Select the target window.",
      targetResolution.windows,
      targetResolution.candidates,
      {
        expectedNextTool: CREATE_TOOL_NAME,
        useSameArtifactHandle: false,
      },
    );
  }

  throw new Error("WORKSPACE_NOT_REGISTERED: no active VS Code window was found for this workspace.");
}

async function persistArtifact(
  input: CreateArtifactInput,
  workspaceRoot: string,
  targetWindow: { windowInstanceId: string; workspaceRoot: string },
): Promise<{ context: ArtifactContext; connection: ArtifactConnection }> {
  const rootOptions = globalRootOptions();
  const collectionRoot = await ensureSafeGlobalArtifactsRoot(rootOptions);
  const createdAt = new Date().toISOString();
  const reviewSessionId = randomUUID();

  for (let attempt = 0; attempt < 5; attempt++) {
    const artifactId = generatedArtifactId(input.title);
    const artifactDirectory = assertGlobalArtifactDirectory(
      artifactId,
      path.join(collectionRoot, artifactId),
      rootOptions,
    );
    try {
      await fs.mkdir(artifactDirectory, { mode: OWNER_ONLY_DIRECTORY_MODE });
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }

    try {
      const safeArtifactDirectory = await ensureSafeGlobalArtifactDirectory(
        artifactId,
        artifactDirectory,
        rootOptions,
      );
      const files = artifactPaths(safeArtifactDirectory);
      const manifest = artifactManifestSchema.parse({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        kind: input.kind,
        artifactId,
        title: input.title,
        createdAt,
        updatedAt: createdAt,
        reviewRound: 1,
        location: { workspaceRoot },
        reviewSessionId,
      });
      const comments = commentsDocumentSchema.parse({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        artifactId,
        reviewRound: 1,
        artifactSha256: sha256(input.markdown),
        comments: [],
      });
      await writeNewManagedFile(
        safeArtifactDirectory,
        files.manifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "after-manifest") {
        throw new Error("Injected artifact creation failure after manifest write.");
      }
      await writeNewManagedFile(safeArtifactDirectory, files.artifactPath, input.markdown);
      await writeNewManagedFile(
        safeArtifactDirectory,
        files.commentsPath,
        `${JSON.stringify(comments, null, 2)}\n`,
      );
      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "at-connection") {
        throw new Error("Injected connection write failure.");
      }
      const connection = await commitArtifactConnectionRequest(
        safeArtifactDirectory,
        {
          windowInstanceId: targetWindow.windowInstanceId,
          source: "create",
        },
      );
      const context = await loadArtifactContext(safeArtifactDirectory);
      return { context, connection };
    } catch (error) {
      try {
        await fs.rm(artifactDirectory, { recursive: true });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "ARTIFACT_CREATE_ROLLBACK_FAILED: artifact creation failed and its new directory could not be removed.",
        );
      }
      throw error;
    }
  }
  throw new Error("ARTIFACT_CREATE_CONFLICT: could not allocate a unique artifact ID.");
}

async function createArtifact(args: JsonObject | undefined): Promise<{ context: ArtifactContext; connection: ArtifactConnection }> {
  const input = parseCreateArguments(args);
  const { workspaceRoot, targetWindow, selectionToken } = await resolveCreateWorkspaceRoot(input);
  try {
    const created = await persistArtifact(input, workspaceRoot, targetWindow);
    if (selectionToken) workspaceSelectionGrants.delete(selectionToken);
    return created;
  } finally {
    if (selectionToken) claimedWorkspaceSelectionTokens.delete(selectionToken);
  }
}

async function retryTransientLifecycleJson<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < LIFECYCLE_JSON_READ_ATTEMPTS; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof SyntaxError) || attempt === LIFECYCLE_JSON_READ_ATTEMPTS - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, LIFECYCLE_JSON_READ_RETRY_MS));
    }
  }
  throw new Error("Lifecycle JSON remained unreadable after the bounded retry window.");
}

async function loadArtifactContext(rawDirectory: unknown): Promise<ArtifactContext> {
  if (typeof rawDirectory !== "string" || !path.isAbsolute(rawDirectory)) {
    throw new Error("artifactDirectory must be an absolute path.");
  }
  const rootOptions = globalRootOptions();
  const candidateArtifactId = path.basename(path.resolve(rawDirectory));
  const artifactDirectory = await ensureSafeGlobalArtifactDirectory(
    candidateArtifactId,
    rawDirectory,
    rootOptions,
  );
  const files = artifactPaths(artifactDirectory);
  const { manifest, markdown } = await retryTransientLifecycleJson(async () => {
    const [manifestRaw, currentMarkdown, commentsRaw] = await Promise.all([
      readManagedJson(artifactDirectory, files.manifestPath),
      readManagedFile(artifactDirectory, files.artifactPath),
      readManagedFile(artifactDirectory, files.commentsPath),
    ]);
    const currentManifest = parseArtifactManifest(manifestRaw);
    if (currentManifest.artifactId !== candidateArtifactId) {
      throw new Error("The global artifact directory basename does not match its artifact id.");
    }
    parseBoundCommentsDocument(JSON.parse(commentsRaw), {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: currentManifest.artifactId,
      reviewRound: currentManifest.reviewRound,
      artifactSha256: sha256(currentMarkdown),
    });
    return { manifest: currentManifest, markdown: currentMarkdown };
  });
  const workspaceRoot = manifest.location.workspaceRoot;
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("The artifact workspace root must be an absolute path.");
  }
  const registeredWorkspaceRoot = await resolveRegisteredWorkspaceRoot(workspaceRoot);
  if (samePathKey(registeredWorkspaceRoot) !== samePathKey(workspaceRoot)) {
    throw new Error("WORKSPACE_NOT_REGISTERED: the artifact workspace no longer matches its registered canonical path.");
  }
  const artifactSha256 = sha256(markdown);
  return {
    artifactDirectory,
    artifactId: manifest.artifactId,
    workspaceRoot,
    reviewSessionId: manifest.reviewSessionId,
    reviewRound: manifest.reviewRound,
    artifactSha256,
    manifest,
    ...files,
  };
}

async function readValidatedSubmissionOnce(context: ArtifactContext): Promise<ReviewWaitResult | undefined> {
  const submissionRaw = await readOptionalManagedFile(context.artifactDirectory, context.submissionPath);
  if (submissionRaw === undefined) return undefined;
  const [currentMarkdown, currentCommentsRaw] = await Promise.all([
    readManagedFile(context.artifactDirectory, context.artifactPath),
    readManagedFile(context.artifactDirectory, context.commentsPath),
  ]);
  const currentArtifactSha256 = sha256(currentMarkdown);
  const currentCommentsSha256 = sha256(currentCommentsRaw);
  const currentComments = parseBoundCommentsDocument(JSON.parse(currentCommentsRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    artifactSha256: currentArtifactSha256,
  });
  const submission = parseBoundReviewSubmission(JSON.parse(submissionRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    reviewSessionId: context.reviewSessionId,
    artifactSha256: currentArtifactSha256,
    commentsSha256: currentCommentsSha256,
  });
  if (submission.decision === "revise" && currentComments.comments.length === 0) {
    throw new Error("A review request must include at least one comment.");
  }
  const nextAction = approvedPlanAction(context.manifest.kind, submission.decision);
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    kind: context.manifest.kind,
    workspaceRoot: context.workspaceRoot,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: currentArtifactSha256,
    commentsSha256: currentCommentsSha256,
    decision: submission.decision,
    submittedAt: submission.submittedAt,
    artifactPath: context.artifactPath,
    commentsPath: context.commentsPath,
    submissionSha256: sha256(submissionRaw),
    ...(nextAction === undefined ? {} : { nextAction }),
  };
}

async function readValidatedSubmission(context: ArtifactContext): Promise<ReviewWaitResult | undefined> {
  return retryTransientLifecycleJson(() => readValidatedSubmissionOnce(context));
}

async function readArtifactInspection(context: ArtifactContext): Promise<{
  markdown: string;
  comments: ReturnType<typeof parseBoundCommentsDocument>;
  artifactSha256: string;
  commentsSha256: string;
  submission?: ReturnType<typeof parseBoundReviewSubmission>;
  submissionSha256?: string;
}> {
  const [markdown, commentsRaw] = await Promise.all([
    readManagedFile(context.artifactDirectory, context.artifactPath),
    readManagedFile(context.artifactDirectory, context.commentsPath),
  ]);
  const artifactSha256 = sha256(markdown);
  const commentsSha256 = sha256(commentsRaw);
  const comments = parseBoundCommentsDocument(JSON.parse(commentsRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    artifactSha256,
  });

  const submissionRaw = await readOptionalManagedFile(context.artifactDirectory, context.submissionPath);
  if (submissionRaw === undefined) return { markdown, comments, artifactSha256, commentsSha256 };

  const submission = parseBoundReviewSubmission(JSON.parse(submissionRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    reviewSessionId: context.reviewSessionId,
    artifactSha256,
    commentsSha256,
  });
  return {
    markdown,
    comments,
    artifactSha256,
    commentsSha256,
    submission,
    submissionSha256: sha256(submissionRaw),
  };
}

const activeArtifactWaiters = new Map<string, ActiveArtifactWaiter>();
const activeArtifactWaiterSettlers = new WeakMap<ActiveArtifactWaiter, () => void>();

function reserveArtifactWaiter(
  artifactDirectory: string,
  waiterRequestKey: string,
  reviewRound: number,
  controller: AbortController,
): ActiveArtifactWaiter {
  const key = samePathKey(artifactDirectory);
  if (activeArtifactWaiters.has(key)) {
    throw recoveryError("ARTIFACT_ALREADY_WAITING", "another live tool call owns this artifact; choose reconnect or intentional takeover from the user's intent.", {
      retryable: true,
      reuseRoundToken: false,
      currentReviewRound: reviewRound,
    });
  }
  let resolveSettled = (): void => {};
  const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
  const waiter: ActiveArtifactWaiter = {
    requestKey: waiterRequestKey,
    reviewRound,
    controller,
    settled,
  };
  activeArtifactWaiterSettlers.set(waiter, resolveSettled);
  activeArtifactWaiters.set(key, waiter);
  return waiter;
}

function releaseArtifactWaiter(artifactDirectory: string, waiter: ActiveArtifactWaiter): void {
  const key = samePathKey(artifactDirectory);
  if (activeArtifactWaiters.get(key) === waiter) activeArtifactWaiters.delete(key);
  activeArtifactWaiterSettlers.get(waiter)?.();
  activeArtifactWaiterSettlers.delete(waiter);
}

async function detachActiveArtifactWaiter(artifactDirectory: string): Promise<void> {
  const waiter = activeArtifactWaiters.get(samePathKey(artifactDirectory));
  if (!waiter) return;
  waiter.controller.abort();
  await waiter.settled;
}

async function detachArtifactWaiterByRequestKey(waiterRequestKey: string): Promise<void> {
  for (const waiter of activeArtifactWaiters.values()) {
    if (waiter.requestKey !== waiterRequestKey) continue;
    waiter.controller.abort();
    await waiter.settled;
    return;
  }
  pending.get(waiterRequestKey)?.abort();
}

async function waitForSubmission(
  context: ArtifactContext,
  waiterRequestKey: string,
  controller: AbortController,
  takeover = false,
  reservedWaiter?: ActiveArtifactWaiter,
): Promise<ReviewWaitResult> {
  const key = samePathKey(context.artifactDirectory);
  if (takeover) await detachActiveArtifactWaiter(context.artifactDirectory);
  const waiter = reservedWaiter ?? reserveArtifactWaiter(
    context.artifactDirectory,
    waiterRequestKey,
    context.reviewRound,
    controller,
  );
  if (activeArtifactWaiters.get(key) !== waiter || waiter.reviewRound !== context.reviewRound) {
    throw new Error("ARTIFACT_WAITER_MISMATCH: waiter ownership does not match the validated artifact round.");
  }
  try {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("Artifact review wait was cancelled."), { name: "AbortError" });
    }
    const existing = await readValidatedSubmission(context);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      let settled = false;
      let checking = false;
      const finish = (error?: unknown, value?: ReviewWaitResult): void => {
        if (settled) return;
        settled = true;
        watcher.close();
        clearInterval(interval);
        controller.signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else if (value) resolve(value);
      };
      const check = async (): Promise<void> => {
        if (settled || checking) return;
        checking = true;
        try {
          const submission = await readValidatedSubmission(context);
          if (submission) finish(undefined, submission);
        } catch (error) {
          finish(error);
        } finally {
          checking = false;
        }
      };
      const onAbort = (): void => finish(Object.assign(new Error("Artifact review wait was cancelled."), { name: "AbortError" }));
      const watcher = watchFs(context.artifactDirectory, { persistent: true }, (_event, filename) => {
        if (filename == null || String(filename) === REVIEW_SUBMISSION_FILE) void check();
      });
      watcher.on("error", (error) => finish(error));
      const interval = setInterval(() => void check(), 1000);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
  } finally {
    releaseArtifactWaiter(context.artifactDirectory, waiter);
  }
}

type BackupMode = "renamed" | "copied";

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function backupTarget(
  artifactDirectory: string,
  target: string,
  backup: string,
): Promise<BackupMode> {
  const safeTarget = await ensureSafeManagedArtifactFile(artifactDirectory, target);
  const safeBackup = await ensureSafeManagedArtifactFile(
    artifactDirectory,
    backup,
    { allowMissing: true },
  );
  if (await managedFileExists(artifactDirectory, safeBackup)) {
    throw new Error(`Artifact transaction backup already exists: ${path.basename(safeBackup)}`);
  }
  try {
    if (
      process.env.NODE_ENV === "test"
      && process.env.CODEX_ARTIFACTS_TEST_LOCK_ARTIFACT === "1"
      && path.basename(safeTarget) === ARTIFACT_MARKDOWN_FILE
    ) {
      throw Object.assign(new Error("Injected Windows editor lock."), { code: "EPERM" });
    }
    await fs.rename(safeTarget, safeBackup);
    return "renamed";
  } catch (error) {
    if (!isWindowsReplaceBlock(error)) throw error;
    await copyManagedFile(artifactDirectory, safeTarget, safeBackup, true);
    return "copied";
  }
}

function generatedTransactionId(): string {
  const testTransactionId = process.env.NODE_ENV === "test"
    ? process.env.CODEX_ARTIFACTS_TEST_TRANSACTION_ID
    : undefined;
  const transactionId = testTransactionId ?? `${process.pid}-${Date.now()}-${randomUUID()}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(transactionId)) {
    throw new Error("Invalid artifact transaction id.");
  }
  return transactionId;
}

async function commitReviewRound(
  context: ArtifactContext,
  markdown: string,
): Promise<{ manifest: ArtifactManifest; artifactSha256: string }> {
  if (!markdown.trim()) throw new Error("markdown must be non-empty.");
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new Error(`markdown exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
  }
  const transactionId = generatedTransactionId();
  const nextArtifactSha256 = sha256(markdown);
  const nextManifest = artifactManifestSchema.parse({
    ...context.manifest,
    updatedAt: new Date().toISOString(),
    reviewRound: context.reviewRound + 1,
  });
  const nextComments = commentsDocumentSchema.parse({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: nextManifest.reviewRound,
    artifactSha256: nextArtifactSha256,
    comments: [],
  });
  const targets = [context.artifactPath, context.manifestPath, context.commentsPath, context.submissionPath];
  const staged = [
    `${context.artifactPath}.next-${transactionId}`,
    `${context.manifestPath}.next-${transactionId}`,
    `${context.commentsPath}.next-${transactionId}`,
  ];
  const backups = targets.map((target) => `${target}.previous-${transactionId}`);
  const lockPath = path.join(context.artifactDirectory, ARTIFACT_UPDATE_LOCK_FILE);

  const backupModes = new Map<number, BackupMode>();
  try {
    await writeNewManagedFile(context.artifactDirectory, lockPath, `${JSON.stringify({
      artifactId: context.artifactId,
      fromReviewRound: context.reviewRound,
      toReviewRound: nextManifest.reviewRound,
      startedAt: new Date().toISOString(),
    })}\n`);
    const stagedWrites = await Promise.allSettled([
      writeNewManagedFile(context.artifactDirectory, staged[0]!, markdown),
      writeNewManagedFile(
        context.artifactDirectory,
        staged[1]!,
        `${JSON.stringify(nextManifest, null, 2)}\n`,
      ),
      writeNewManagedFile(
        context.artifactDirectory,
        staged[2]!,
        `${JSON.stringify(nextComments, null, 2)}\n`,
      ),
    ]);
    const failedStagedWrite = stagedWrites.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedStagedWrite) throw failedStagedWrite.reason;
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!;
      if (!await managedFileExists(context.artifactDirectory, target)) {
        if (index === 3) continue;
        throw new Error(`Artifact transaction target is missing: ${path.basename(target)}`);
      }
      const backupMode = await backupTarget(context.artifactDirectory, target, backups[index]!);
      backupModes.set(index, backupMode);
      await ensureSafeManagedArtifactFile(context.artifactDirectory, backups[index]!);
    }
    if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_UPDATE === "after-backup") {
      throw new Error("Injected artifact update failure after backup.");
    }
    for (let index = 0; index < staged.length; index++) {
      if (backupModes.get(index) === "copied") {
        await copyManagedFile(context.artifactDirectory, staged[index]!, targets[index]!);
      } else {
        await renameManagedFileToMissingTarget(context.artifactDirectory, staged[index]!, targets[index]!);
      }
    }
    const submissionIndex = targets.length - 1;
    if (backupModes.get(submissionIndex) === "copied") {
      await removeManagedFileIfExists(context.artifactDirectory, targets[submissionIndex]!);
    }
    await Promise.all(backups.map((backup) => (
      removeManagedFileIfExists(context.artifactDirectory, backup).catch(() => {})
    )));
    return { manifest: nextManifest, artifactSha256: nextArtifactSha256 };
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const index of [...backupModes.keys()].reverse()) {
      const backup = backups[index]!;
      try {
        if (await managedFileExists(context.artifactDirectory, backup)) {
          if (backupModes.get(index) === "copied") {
            await copyManagedFile(context.artifactDirectory, backup, targets[index]!);
          } else {
            await removeManagedFileIfExists(context.artifactDirectory, targets[index]!);
            await renameManagedFileToMissingTarget(context.artifactDirectory, backup, targets[index]!);
          }
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "ARTIFACT_UPDATE_ROLLBACK_FAILED: artifact update failed and its original state could not be restored safely.",
      );
    }
    throw error;
  } finally {
    await Promise.all(staged.map((filePath) => (
      removeManagedFileIfExists(context.artifactDirectory, filePath).catch(() => {})
    )));
    await Promise.all(backups.map((filePath) => (
      removeManagedFileIfExists(context.artifactDirectory, filePath).catch(() => {})
    )));
    await removeManagedFileIfExists(context.artifactDirectory, lockPath).catch(() => {});
  }
}

const pending = new Map<string, AbortController>();
const roundGrants = new Map<string, RoundGrant>();
const claimedRoundTokens = new Set<string>();
const consumedRoundTokens = new Map<string, number>();

function pruneRoundGrants(): void {
  const now = Date.now();
  for (const [token, grant] of roundGrants) if (grant.expiresAt <= now) roundGrants.delete(token);
  for (const [token, expiresAt] of consumedRoundTokens) if (expiresAt <= now) consumedRoundTokens.delete(token);
}

function toArtifactFileUrl(filePath: string): string {
  const url = filePath.startsWith("file://") ? filePath : pathToFileURL(filePath).href;
  return url.replaceAll("(", "%28").replaceAll(")", "%29");
}

function formatArtifactLink(title: string | undefined, artifactUrl: string): string {
  const rawTitle = title?.trim().replace(/\r?\n/g, " ") || "Artifact Review";
  const safeTitle = rawTitle
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
  return `[${safeTitle}](${artifactUrl})`;
}

function grantSubmittedRound(
  context: ArtifactContext,
  result: ReviewWaitResult,
): ReviewWaitResult & { roundToken?: string; roundTokenSource?: "submitted-review"; artifactUrl?: string; artifactLink?: string } {
  const artifactUrl = toArtifactFileUrl(context.artifactPath);
  const artifactLink = formatArtifactLink(context.manifest.title, artifactUrl);
  if (result.decision !== "revise") return { ...result, artifactUrl, artifactLink };
  pruneRoundGrants();
  const roundToken = randomUUID();
  roundGrants.set(roundToken, {
    source: "submitted-review",
    artifactDirectory: context.artifactDirectory,
    artifactId: context.artifactId,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: result.artifactSha256,
    commentsSha256: result.commentsSha256,
    submissionExpected: true,
    submissionSha256: result.submissionSha256,
    expiresAt: Date.now() + ROUND_TOKEN_TTL_MS,
  });
  return { ...result, roundToken, roundTokenSource: "submitted-review", artifactUrl, artifactLink };
}

function grantInspectedRound(
  context: ArtifactContext,
  inspection: Awaited<ReturnType<typeof readArtifactInspection>>,
  intent?: string,
): { roundToken?: string; roundTokenSource?: "chat-inspection" | "chat-update" } {
  if (intent === "explicit-chat-update") {
    if (inspection.comments.comments.length > 0 || inspection.submission) {
      throw new Error("explicit-chat-update requires an empty review round without saved comments or a submission.");
    }
    pruneRoundGrants();
    const roundToken = randomUUID();
    roundGrants.set(roundToken, {
      source: "chat-update",
      artifactDirectory: context.artifactDirectory,
      artifactId: context.artifactId,
      reviewSessionId: context.reviewSessionId,
      reviewRound: context.reviewRound,
      artifactSha256: inspection.artifactSha256,
      commentsSha256: inspection.commentsSha256,
      submissionExpected: inspection.submission !== undefined,
      ...(inspection.submissionSha256 === undefined ? {} : { submissionSha256: inspection.submissionSha256 }),
      expiresAt: Date.now() + ROUND_TOKEN_TTL_MS,
    });
    return { roundToken, roundTokenSource: "chat-update" };
  }
  if (inspection.comments.comments.length === 0 && !inspection.submission) return {};
  pruneRoundGrants();
  const roundToken = randomUUID();
  roundGrants.set(roundToken, {
    source: "chat-inspection",
    artifactDirectory: context.artifactDirectory,
    artifactId: context.artifactId,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: inspection.artifactSha256,
    commentsSha256: inspection.commentsSha256,
    submissionExpected: inspection.submission !== undefined,
    ...(inspection.submissionSha256 === undefined ? {} : { submissionSha256: inspection.submissionSha256 }),
    expiresAt: Date.now() + ROUND_TOKEN_TTL_MS,
  });
  return { roundToken, roundTokenSource: "chat-inspection" };
}

async function roundStateMatchesGrant(grant: RoundGrant): Promise<boolean> {
  try {
    const context = await loadArtifactContext(grant.artifactDirectory);
    if (
      context.artifactId !== grant.artifactId
      || context.reviewSessionId !== grant.reviewSessionId
      || context.reviewRound !== grant.reviewRound
    ) return false;
    const inspection = await readArtifactInspection(context);
    return inspection.artifactSha256 === grant.artifactSha256
      && inspection.commentsSha256 === grant.commentsSha256
      && (inspection.submission !== undefined) === grant.submissionExpected
      && inspection.submissionSha256 === grant.submissionSha256;
  } catch {
    return false;
  }
}

function write(message: JsonObject): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: unknown, result: unknown): void {
  write({ jsonrpc: "2.0", id, result });
}

function respondError(id: unknown, code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

function requestKey(id: unknown): string {
  return JSON.stringify(id);
}

function toolResult(value: unknown): JsonObject {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(error: unknown): JsonObject {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof WindowSelectionRequiredError) {
    const structuredContent = {
      message,
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      expectedNextTool: error.expectedNextTool,
      lifecycleMutated: error.lifecycleMutated,
      takeoverOccurred: error.takeoverOccurred,
      useSameArtifactHandle: error.useSameArtifactHandle,
      windows: error.windows,
      candidates: error.candidates,
    };
    return {
      content: [{ type: "text", text: message }],
      structuredContent,
      isError: true,
    };
  }
  if (error instanceof ArtifactRecoveryError) {
    const structuredContent = { message, ...error.recovery };
    return {
      content: [{ type: "text", text: message }],
      structuredContent,
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function artifactHandle(context: ArtifactContext, connection?: ArtifactConnection): JsonObject {
  const artifactUrl = toArtifactFileUrl(context.artifactPath);
  const artifactLink = formatArtifactLink(context.manifest.title, artifactUrl);
  return {
    artifactDirectory: context.artifactDirectory,
    artifactId: context.artifactId,
    artifactPath: context.artifactPath,
    artifactUrl,
    artifactLink,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: context.artifactSha256,
    kind: context.manifest.kind,
    workspaceRoot: context.workspaceRoot,
    ...(connection ? {
      connection: {
        schemaVersion: connection.schemaVersion,
        windowInstanceId: connection.windowInstanceId,
        connectionRevision: connection.connectionRevision,
        openRequestId: connection.openRequestId,
        source: connection.source,
        updatedAt: connection.updatedAt,
      },
    } : {}),
  };
}

function parseExpectedReviewRound(args: JsonObject | undefined): number {
  const expectedReviewRound = args?.expectedReviewRound;
  if (!Number.isInteger(expectedReviewRound) || expectedReviewRound < 1) {
    throw new Error("expectedReviewRound must be a positive integer.");
  }
  return expectedReviewRound;
}

function roundMismatchError(currentReviewRound: number, expectedReviewRound: number): ArtifactRecoveryError {
  return recoveryError("ROUND_MISMATCH", `the artifact is at review round ${currentReviewRound}, not ${expectedReviewRound}.`, {
    retryable: true,
    expectedNextTool: INSPECT_TOOL_NAME,
    reuseRoundToken: false,
    currentReviewRound,
  });
}

async function handleResolveWorkspaceTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    const query = args?.query;
    if (typeof query !== "string") {
      throw new Error("WORKSPACE_QUERY_INVALID: query must be a string containing the user's exact workspace keyword.");
    }
    pruneWorkspaceSelectionGrants();
    const resolution = await resolveWorkspaceCandidates(query);
    if (resolution.windows.length === 0) {
      respond(id, toolResult({ status: "not-found", matchMode: "none", windows: [], candidates: [] }));
      return;
    }
    const allCandidates: Array<Record<string, unknown>> = [];
    const windows = resolution.windows.map((win) => {
      const folders = win.folders.map((folder) => {
        const selectionToken = randomUUID();
        const expiresAt = Date.now() + WORKSPACE_SELECTION_TTL_MS;
        workspaceSelectionGrants.set(selectionToken, {
          query: resolution.query,
          candidateId: folder.candidateId,
          workspaceRoot: folder.path,
          windowInstanceId: win.windowInstanceId,
          snapshotIdentity: win.snapshotIdentity,
          expiresAt,
        });
        const item = {
          candidateId: folder.candidateId,
          name: folder.name,
          path: folder.path,
          match: folder.match,
          selectionToken,
          expiresAt: new Date(expiresAt).toISOString(),
        };
        allCandidates.push(item);
        return item;
      });
      return {
        windowInstanceId: win.windowInstanceId,
        focused: win.focused,
        snapshotUpdatedAt: win.snapshotUpdatedAt,
        workspaceFile: win.workspaceFile,
        activeFile: win.activeFile,
        folders,
      };
    });
    respond(id, toolResult({
      status: "selection-required",
      matchMode: resolution.matchMode,
      windows,
      candidates: allCandidates,
    }));
  } catch (error) {
    respond(id, toolError(error));
  }
}

async function handleCreateTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const isTaggedCreate = args?.workspaceEvidence?.kind === "tagged-file";
  try {
    const { context, connection } = await createArtifact(args);
    respond(id, toolResult(artifactHandle(context, connection)));
  } catch (error) {
    respond(id, toolError(asLifecycleRecoveryError(error, { isCreate: true, isTaggedCreate })));
  }
}

async function handleWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  let reservedWaiter: ActiveArtifactWaiter | undefined;
  let artifactDirectory: string | undefined;
  try {
    const expectedReviewRound = parseExpectedReviewRound(args);
    artifactDirectory = args?.artifactDirectory;
    if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) {
      throw new Error("artifactDirectory must be an absolute path.");
    }
    if (args?.takeover === true) await detachActiveArtifactWaiter(artifactDirectory);
    reservedWaiter = reserveArtifactWaiter(
      artifactDirectory,
      requestKey(id),
      expectedReviewRound,
      controller,
    );
    const context = await loadArtifactContext(artifactDirectory);
    if (context.reviewRound !== expectedReviewRound) {
      throw roundMismatchError(context.reviewRound, expectedReviewRound);
    }
    const result = await waitForSubmission(
      context,
      requestKey(id),
      controller,
      false,
      reservedWaiter,
    );
    reservedWaiter = undefined;
    respond(id, toolResult(grantSubmittedRound(context, result)));
  } catch (error) {
    respond(id, toolError(asLifecycleRecoveryError(error)));
  } finally {
    if (reservedWaiter && artifactDirectory) releaseArtifactWaiter(artifactDirectory, reservedWaiter);
    pending.delete(requestKey(id));
  }
}

async function handleInspectTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    const artifactDirectory = args?.artifactDirectory;
    if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) {
      throw new Error("artifactDirectory must be an absolute path.");
    }
    const intent = args?.intent;
    if (intent !== undefined && intent !== "explicit-chat-update" && intent !== "reconnect") {
      throw new Error(`Invalid intent: ${String(intent)}.`);
    }
    if (intent === "explicit-chat-update" && args?.expectedReviewRound === undefined) {
      throw new Error("expectedReviewRound is required when intent is explicit-chat-update.");
    }
    const expectedReviewRound = args?.expectedReviewRound !== undefined
      ? parseExpectedReviewRound(args)
      : undefined;

    let context = await loadArtifactContext(artifactDirectory);
    if (expectedReviewRound !== undefined && context.reviewRound !== expectedReviewRound) {
      throw roundMismatchError(context.reviewRound, expectedReviewRound);
    }

    const connectionRaw = args?.connection;
    let connectionInput: { windowInstanceId?: string; selectionToken?: string } | undefined;
    if (connectionRaw !== undefined) {
      if (typeof connectionRaw !== "object" || connectionRaw === null) {
        throw new Error("INVALID_ARTIFACT_INPUT: connection must be an object.");
      }
      const connObj = connectionRaw as Record<string, unknown>;
      let windowInstanceId: string | undefined;
      let selectionToken: string | undefined;
      if (connObj.windowInstanceId !== undefined) {
        if (
          typeof connObj.windowInstanceId !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connObj.windowInstanceId)
        ) {
          throw new Error("INVALID_ARTIFACT_INPUT: connection.windowInstanceId must be a valid UUID.");
        }
        windowInstanceId = connObj.windowInstanceId;
      }
      if (connObj.selectionToken !== undefined) {
        if (
          typeof connObj.selectionToken !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connObj.selectionToken)
        ) {
          throw new Error("INVALID_ARTIFACT_INPUT: connection.selectionToken must be a valid UUID.");
        }
        selectionToken = connObj.selectionToken;
      }
      if (windowInstanceId || selectionToken) {
        connectionInput = {
          ...(windowInstanceId ? { windowInstanceId } : {}),
          ...(selectionToken ? { selectionToken } : {}),
        };
      }
    }

    let targetReconnectWindow: { windowInstanceId: string; workspaceRoot: string } | undefined;

    let claimedSelectionToken: string | undefined;
    try {
      // Routing preflight happens BEFORE takeover when intent is reconnect
      if (intent === "reconnect") {
        const rootOptions = globalRootOptions();
        const registryDir = workspaceRegistryDirectory(rootOptions);
        const workspaceRoot = context.workspaceRoot;

        if (connectionInput?.selectionToken) {
          pruneWorkspaceSelectionGrants();
          const token = connectionInput.selectionToken;
          if (claimedWorkspaceSelectionTokens.has(token)) {
            throw new Error("WINDOW_SELECTION_EXPIRED: the connection selection token is already being used.");
          }
          const connGrant = workspaceSelectionGrants.get(token);
          if (!connGrant || connGrant.expiresAt <= Date.now()) {
            throw new Error("WINDOW_SELECTION_EXPIRED: retry inspect_artifact_review on this exact artifact handle with intent=reconnect and no connection token to refresh the window candidates.");
          }
          if (samePathKey(connGrant.workspaceRoot) !== samePathKey(workspaceRoot)) {
            throw new WindowConnectionMismatchError("the connection selection token does not belong to workspaceRoot.");
          }
          const snapshots = await readFreshWorkspaceSnapshots(registryDir);
          const windowSnapshot = snapshots.find((s) => s.instanceId === connGrant.windowInstanceId);
          if (!windowSnapshot) {
            workspaceSelectionGrants.delete(token);
            throw new Error("WINDOW_SELECTION_EXPIRED: the selected window is no longer open; retry inspect_artifact_review on this exact artifact handle with intent=reconnect and no connection token.");
          }
          const folderStillPresent = windowSnapshot.folders.some((f) => sameFilesystemPath(f.realPath, connGrant.workspaceRoot));
          if (!folderStillPresent) {
            workspaceSelectionGrants.delete(token);
            throw new Error("WINDOW_SELECTION_EXPIRED: the workspace folder is no longer open in the selected window; retry inspect_artifact_review on this exact artifact handle with intent=reconnect and no connection token.");
          }
          claimedWorkspaceSelectionTokens.add(token);
          claimedSelectionToken = token;
          targetReconnectWindow = { windowInstanceId: connGrant.windowInstanceId, workspaceRoot };
        } else {
          const targetResolution = await resolveArtifactConnectionTarget({
            workspaceRoot,
            artifactDirectory: context.artifactDirectory,
            ...(connectionInput?.windowInstanceId ? { connectionHint: { windowInstanceId: connectionInput.windowInstanceId } } : {}),
            directory: registryDir,
          });

          if (targetResolution.status === "matched") {
            targetReconnectWindow = targetResolution.targetWindow;
          } else if (targetResolution.status === "selection-required") {
            for (const win of targetResolution.windows) {
              for (const candidate of win.folders) {
                workspaceSelectionGrants.set(candidate.selectionToken, {
                  query: candidate.name,
                  candidateId: candidate.candidateId,
                  workspaceRoot: candidate.path,
                  windowInstanceId: win.windowInstanceId,
                  snapshotIdentity: `${win.windowInstanceId}:${win.snapshotUpdatedAt}`,
                  expiresAt: Date.parse(candidate.expiresAt),
                });
              }
            }
            throw new WindowSelectionRequiredError(
              "WINDOW_SELECTION_REQUIRED: multiple VS Code windows have this workspace open. Select the target window.",
              targetResolution.windows,
              targetResolution.candidates,
              {
                expectedNextTool: INSPECT_TOOL_NAME,
                useSameArtifactHandle: true,
              },
            );
          } else {
            throw new Error("WORKSPACE_NOT_REGISTERED: no active VS Code window was found for this workspace.");
          }
        }
      }

      if (intent === "explicit-chat-update" && args?.takeover === true) {
        const preTakeoverInspection = await readArtifactInspection(context);
        if (preTakeoverInspection.comments.comments.length > 0 || preTakeoverInspection.submission) {
          throw new Error("explicit-chat-update requires an empty review round without saved comments or a submission.");
        }
      }

      if (args?.takeover === true) {
        await detachActiveArtifactWaiter(artifactDirectory);
        context = await loadArtifactContext(artifactDirectory);
        if (expectedReviewRound !== undefined && context.reviewRound !== expectedReviewRound) {
          throw roundMismatchError(context.reviewRound, expectedReviewRound);
        }
      }

      const inspection = await readArtifactInspection(context);
      const { roundToken, roundTokenSource } = grantInspectedRound(
        context,
        inspection,
        intent === "explicit-chat-update" ? intent : undefined,
      );

      let connection: ArtifactConnection | null = null;
      if (intent === "reconnect" && targetReconnectWindow) {
        try {
          if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_RECONNECT === "invalid-state-at-connection") {
            throw new ArtifactConnectionInvalidError("Injected invalid connection state during commit.");
          }
          connection = await commitArtifactConnectionRequest(context.artifactDirectory, {
            windowInstanceId: targetReconnectWindow.windowInstanceId,
            source: "inspect",
          });
          if (claimedSelectionToken) {
            workspaceSelectionGrants.delete(claimedSelectionToken);
          }
        } catch (error) {
          if (error instanceof ArtifactConnectionInvalidError || error instanceof ArtifactConnectionWriteError) {
            throw error;
          }
          const detail = error instanceof Error ? error.message : String(error);
          throw new ArtifactConnectionWriteError(`failed to update connection state: ${detail}`);
        }
      } else {
        connection = await readArtifactConnection(context.artifactDirectory, { allowMissing: true });
      }

      respond(id, toolResult({
        ...artifactHandle(context, connection ?? undefined),
        manifest: context.manifest,
        markdown: inspection.markdown,
        comments: inspection.comments,
        commentsSha256: inspection.commentsSha256,
        submission: inspection.submission,
        submissionSha256: inspection.submissionSha256,
        roundToken,
        ...(roundTokenSource ? { roundTokenSource } : {}),
      }));
    } finally {
      if (claimedSelectionToken) {
        claimedWorkspaceSelectionTokens.delete(claimedSelectionToken);
      }
    }
  } catch (error) {
    respond(id, toolError(asLifecycleRecoveryError(error)));
  }
}

async function handleAdvanceAndWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  let claimedToken: string | undefined;
  let committedReviewRound: number | undefined;
  try {
    pruneRoundGrants();
    const expectedReviewRound = parseExpectedReviewRound(args);
    const roundToken = args?.roundToken;
    const markdown = args?.markdown;
    if (typeof roundToken !== "string" || !roundToken) throw new Error("roundToken is required.");
    if (markdown !== undefined && (typeof markdown !== "string" || !markdown.trim())) {
      throw new Error("markdown must be non-empty when supplied.");
    }
    if (claimedRoundTokens.has(roundToken)) {
      throw recoveryError("ROUND_TOKEN_IN_USE", "the artifact round token is already being used by another request; wait for that request instead of retrying concurrently.", {
        retryable: true,
        reuseRoundToken: false,
      });
    }
    if (consumedRoundTokens.has(roundToken)) {
      throw recoveryError("ROUND_TOKEN_ALREADY_CONSUMED", "the artifact round token was already consumed; inspect the same artifact before taking another action.", {
        retryable: true,
        expectedNextTool: INSPECT_TOOL_NAME,
        reuseRoundToken: false,
      });
    }
    const grant = roundGrants.get(roundToken);
    if (!grant) {
      throw recoveryError("ROUND_TOKEN_INVALID_OR_EXPIRED", "the artifact round token is invalid, expired, or was lost after MCP restart; inspect the same artifact for current state.", {
        retryable: true,
        expectedNextTool: INSPECT_TOOL_NAME,
        reuseRoundToken: false,
      });
    }
    claimedRoundTokens.add(roundToken);
    claimedToken = roundToken;

    const context = await loadArtifactContext(args?.artifactDirectory);
    if (
      samePathKey(context.artifactDirectory) !== samePathKey(grant.artifactDirectory)
      || context.artifactId !== grant.artifactId
      || context.reviewSessionId !== grant.reviewSessionId
      || context.reviewRound !== grant.reviewRound
      || context.reviewRound !== expectedReviewRound
    ) {
      roundGrants.delete(roundToken);
      throw recoveryError("ROUND_MISMATCH", "the artifact round token does not match the current artifact, session, or review round.", {
        retryable: true,
        expectedNextTool: INSPECT_TOOL_NAME,
        reuseRoundToken: false,
        currentReviewRound: context.reviewRound,
      });
    }
    const inspection = await readArtifactInspection(context);
    if (
      inspection.artifactSha256 !== grant.artifactSha256
      || inspection.commentsSha256 !== grant.commentsSha256
      || (inspection.submission !== undefined) !== grant.submissionExpected
      || inspection.submissionSha256 !== grant.submissionSha256
    ) {
      roundGrants.delete(roundToken);
      throw recoveryError("ROUND_STATE_CHANGED", "the artifact round token no longer matches the inspected content (Markdown, comments, or submission).", {
        retryable: true,
        expectedNextTool: INSPECT_TOOL_NAME,
        reuseRoundToken: false,
        currentReviewRound: context.reviewRound,
      });
    }
    if (grant.source === "chat-update") {
      if (markdown === undefined) {
        throw new Error("markdown is required when advancing with a chat-update token.");
      }
      if (sha256(markdown) === grant.artifactSha256) {
        throw new Error("The updated markdown must differ from the current artifact content.");
      }
    }
    if (grant.source === "submitted-review" && inspection.submission?.decision !== "revise") {
      throw new Error("The current artifact round was not submitted for Review.");
    }
    if (activeArtifactWaiters.has(samePathKey(context.artifactDirectory))) {
      roundGrants.delete(roundToken);
      throw recoveryError("ARTIFACT_ALREADY_WAITING", "detach the live waiter only when the user's intent requires inspection or a direct chat update.", {
        retryable: true,
        reuseRoundToken: false,
        currentReviewRound: context.reviewRound,
      });
    }
    if (controller.signal.aborted) {
      throw recoveryError("ADVANCE_CANCELLED_BEFORE_COMMIT", "artifact review advance was cancelled before commit; the current token remains valid.", {
        retryable: true,
        expectedNextTool: ADVANCE_AND_WAIT_TOOL_NAME,
        reuseRoundToken: true,
        currentReviewRound: context.reviewRound,
      });
    }

    let committed: Awaited<ReturnType<typeof commitReviewRound>>;
    try {
      committed = await commitReviewRound(context, markdown ?? inspection.markdown);
    } catch (commitError) {
      if (await roundStateMatchesGrant(grant)) {
        const detail = commitError instanceof Error ? commitError.message : String(commitError);
        throw recoveryError("ADVANCE_ROLLED_BACK", `the round commit failed and the original state was restored: ${detail}`, {
          retryable: true,
          expectedNextTool: ADVANCE_AND_WAIT_TOOL_NAME,
          reuseRoundToken: true,
          currentReviewRound: context.reviewRound,
        });
      }
      roundGrants.delete(roundToken);
      throw recoveryError("ROUND_STATE_CHANGED", "the round commit failed and current state could not be confirmed; inspect the same artifact before retrying.", {
        retryable: true,
        expectedNextTool: INSPECT_TOOL_NAME,
        reuseRoundToken: false,
      });
    }
    roundGrants.delete(roundToken);
    consumedRoundTokens.set(roundToken, Date.now() + ROUND_TOKEN_TTL_MS);
    claimedRoundTokens.delete(roundToken);
    claimedToken = undefined;
    committedReviewRound = committed.manifest.reviewRound;

    const updatedContext = await loadArtifactContext(context.artifactDirectory);
    const result = await waitForSubmission(updatedContext, requestKey(id), controller);
    respond(id, toolResult(grantSubmittedRound(updatedContext, result)));
  } catch (error) {
    if (committedReviewRound !== undefined) {
      const detail = error instanceof Error ? error.message : String(error);
      respond(id, toolError(recoveryError("ADVANCE_COMMITTED", `review round ${committedReviewRound} committed, but the follow-up wait did not complete: ${detail}`, {
        retryable: true,
        expectedNextTool: WAIT_TOOL_NAME,
        reuseRoundToken: false,
        currentReviewRound: committedReviewRound,
      })));
    } else {
      respond(id, toolError(asLifecycleRecoveryError(error)));
    }
  } finally {
    if (claimedToken) claimedRoundTokens.delete(claimedToken);
    pending.delete(requestKey(id));
  }
}

async function handleRequest(message: JsonObject): Promise<void> {
  const { id, method, params } = message;
  if (method === "initialize") {
    const protocolVersion = typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
    respond(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions: [
      "Resolve the target workspace folder before reading project files or drafting new artifact content.",
      "With no user-tagged file, call resolve_artifact_workspace immediately using the user's exact workspace keyword; do not scan folders to normalize it first.",
      "The resolver returns fresh candidates grouped by VS Code window, including window identity, focus as a ranking hint, snapshot context, and folders.",
      "Focus is not workspace ownership evidence or a routing requirement; multiple windows alone do not require a question.",
      "Select a uniquely high-confidence candidate across all returned window groups and ask the user only when the strongest candidates remain tied or otherwise ambiguous.",
      "If the registry contains one folder overall, it returns matchMode=matched and match=single-folder even when the query text differs; a query with no match returns fresh folders grouped by window with matchMode=all-available.",
      "Each selection token binds an exact windowInstanceId and workspaceRoot.",
      "Create reviewable Markdown with create_artifact using only tagged-file evidence or a resolved-workspace selection token; tagged-file ownership remains required when a connection.selectionToken selects among windows.",
      "The official skill always sends kind=implementation-plan.",
      "Create returns the exact artifactDirectory and committed connection metadata; retain both, then call wait_for_artifact_review.",
      "Do not resolve the workspace again after creation.",
      "A cancelled waiter never ends or deletes the artifact.",
      "Treat comments returned by a Review submission and comments read through inspect_artifact_review with the same policy: answer questions visibly in chat before calling advance_and_wait_for_artifact, update Markdown only for requested changes, and omit markdown for question-only feedback.",
      "Do not add Review responses to the artifact.",
      "Pure reconnect uses inspect_artifact_review with intent=reconnect on the exact handle and same round; connection.windowInstanceId is only a hint, and a WINDOW_SELECTION_REQUIRED retry uses the chosen connection.selectionToken.",
      "Reconnect can target an unfocused live window and returns the committed connection revision and open request ID; resuming waiting without reconnecting uses wait_for_artifact_review.",
      "For chat escape, inspect the exact handle with takeover=true.",
      "If intent or handle is ambiguous, ask the user before calling a lifecycle tool and never takeover speculatively.",
      "If inspection has no comments or submission, reattach with wait_for_artifact_review without advancing.",
      "When updating an artifact directly from chat on an empty round, inspect with takeover=true, expectedReviewRound, and intent=explicit-chat-update, then advance with replacement markdown.",
      "Follow structured recovery metadata on lifecycle errors, keep the same exact handle, and never replay when commit state is uncertain.",
      "When Proceed returns approve for kind plan or implementation-plan, obey nextAction and execute the complete approved plan immediately in the same turn; do not stop at acknowledgement or ask for another confirmation.",
      "Proceed ends only the review round, not the authorized execution.",
      "Just save ends the round without execution.",
      "Reconnect later by explicitly inspecting, advancing without markdown, and waiting again; reconnect must not repeat an already executed action.",
      "After creation, use only the exact returned artifactDirectory for wait, inspect, advance, and reconnect.",
      "Never scan global artifact storage or a workspace to discover an artifact, and never infer an artifact handle from cwd.",
    ].join(" "),
    });
    return;
  }
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools: [
      {
        name: RESOLVE_WORKSPACE_TOOL_NAME,
        title: "Resolve artifact workspace",
        description: "Read fresh VS Code workspace snapshots and return workspace-folder candidates grouped by live window for the user's exact keyword. Common separators such as spaces, hyphens, underscores, dots, and slashes are normalized. Focus is a ranking hint, not ownership evidence or a routing requirement. A registry with one folder overall returns matchMode=matched with match=single-folder even when the query differs. No query match returns fresh folders grouped by window with matchMode=all-available. Each selection token binds the exact window and workspace tuple. This tool never mutates lifecycle files. The caller may choose one uniquely high-confidence candidate across all groups and should ask the user only when the strongest candidates remain tied or otherwise ambiguous.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 2, maxLength: 500, description: "Exact workspace keyword or path from the user's message." },
          },
          required: ["query"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: CREATE_TOOL_NAME,
        title: "Create artifact",
        description: "Create a secure schema-v5 Markdown artifact in global AI Artifacts storage for a currently registered VS Code workspace target, atomically commit its schema-v1 window-routing connection, and return the exact persistent handle plus connection metadata without waiting.",
        inputSchema: {
          type: "object",
          properties: {
            workspaceRoot: { type: "string", description: "Absolute path of the target workspace folder currently registered by VS Code. Used for ownership validation and retained as artifact metadata; it is not the artifact storage location." },
            workspaceEvidence: {
              description: "Creation evidence for this exact workspace. Only a user-tagged file or a candidate chosen from the current resolver result is accepted.",
              oneOf: [
                {
                  type: "object",
                  properties: {
                    kind: { const: "tagged-file" },
                    filePath: { type: "string", description: "Absolute path of a file explicitly tagged by the user." },
                  },
                  required: ["kind", "filePath"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "resolved-workspace" },
                    selectionToken: { type: "string", format: "uuid", description: "Opaque token for the candidate chosen from resolve_artifact_workspace." },
                  },
                  required: ["kind", "selectionToken"],
                  additionalProperties: false,
                },
              ],
            },
            title: { type: "string", minLength: 1, maxLength: 200 },
            kind: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
            markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_BYTES },
            connection: {
              type: "object",
              description: "Optional routing connection parameters.",
              properties: {
                selectionToken: {
                  type: "string",
                  format: "uuid",
                  description: "Optional window-selection token returned by an earlier create_artifact WINDOW_SELECTION_REQUIRED response for this tagged-file request.",
                },
              },
              additionalProperties: false,
            },
          },
          required: ["workspaceRoot", "workspaceEvidence", "title", "kind", "markdown"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      {
        name: WAIT_TOOL_NAME,
        title: "Wait for artifact review",
        description: "Attach one transient waiter to an exact artifact round. Return an existing submission immediately, or wait for Review, Proceed, or Just save. An approved plan returns an explicit execute-approved-plan next action. Takeover safely detaches the previous waiter.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1 },
            takeover: { type: "boolean", default: false },
          },
          required: ["artifactDirectory", "expectedReviewRound"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      {
        name: INSPECT_TOOL_NAME,
        title: "Inspect artifact review",
        description: "Read the current manifest, Markdown, comments, optional submission, connection metadata, and validated hashes for an exact artifact. With intent=reconnect, revalidate and atomically bind a target live VS Code window without requiring focus. Takeover first cancels and drains its current waiter. Returns a one-time round token when saved feedback is present or when intent is explicit-chat-update.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1, description: "Expected current review round. Required when intent is explicit-chat-update." },
            takeover: { type: "boolean", default: false },
            intent: {
              type: "string",
              enum: ["explicit-chat-update", "reconnect"],
              description: "Specify reconnect to bind the artifact to an active VS Code window, or explicit-chat-update when the user explicitly requests changes in chat on a round without saved comments.",
            },
            connection: {
              type: "object",
              properties: {
                windowInstanceId: {
                  type: "string",
                  minLength: 1,
                  description: "Optional live windowInstanceId hint for reconnect. The server revalidates it against the workspace stored in the exact artifact manifest.",
                },
                selectionToken: {
                  type: "string",
                  format: "uuid",
                  description: "Optional window-selection token returned by an earlier inspect_artifact_review reconnect response with WINDOW_SELECTION_REQUIRED for this exact artifact handle.",
                },
              },
              additionalProperties: false,
            },
          },
          required: ["artifactDirectory"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      {
        name: ADVANCE_AND_WAIT_TOOL_NAME,
        title: "Advance and wait for artifact review",
        description: "Consume a validated one-time round token, optionally replace the complete Markdown, advance and reset the artifact round transactionally, then attach a waiter. Omitting markdown preserves the artifact bytes and SHA.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1 },
            roundToken: { type: "string" },
            markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_BYTES },
          },
          required: ["artifactDirectory", "expectedReviewRound", "roundToken"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
    ] });
    return;
  }
  if (method === "tools/call") {
    if (params?.name === RESOLVE_WORKSPACE_TOOL_NAME) {
      await handleResolveWorkspaceTool(id, params?.arguments);
      return;
    }
    if (params?.name === CREATE_TOOL_NAME) {
      await handleCreateTool(id, params?.arguments);
      return;
    }
    if (params?.name === WAIT_TOOL_NAME) {
      await handleWaitTool(id, params?.arguments);
      return;
    }
    if (params?.name === INSPECT_TOOL_NAME) {
      await handleInspectTool(id, params?.arguments);
      return;
    }
    if (params?.name === ADVANCE_AND_WAIT_TOOL_NAME) {
      await handleAdvanceAndWaitTool(id, params?.arguments);
      return;
    }
    respond(id, toolError(new Error(`Unknown tool: ${String(params?.name)}`)));
    return;
  }
  respondError(id, -32601, `Method not found: ${String(method)}`);
}

function handleMessage(message: unknown): void {
  if (!message || typeof message !== "object") return;
  const request = message as JsonObject;
  if (request.method === "notifications/cancelled") {
    void detachArtifactWaiterByRequestKey(requestKey(request.params?.requestId));
    return;
  }
  if (request.id === undefined) return;
  void handleRequest(request).catch((error) => {
    respondError(request.id, -32603, error instanceof Error ? error.message : String(error));
  });
}

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    handleMessage(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`Invalid MCP message: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
for (const controller of pending.values()) controller.abort();
