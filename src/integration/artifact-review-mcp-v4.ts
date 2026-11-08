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
} from "../shared/artifact-validation";
import {
  ARTIFACT_SCHEMA_VERSION,
  MCP_VERSION,
  ArtifactConnectionInvalidError,
  ArtifactConnectionWriteError,
  WindowConnectionMismatchError,
  WindowConnectionStaleError,
  WindowNotFoundError,
  WindowSelectionExpiredError,
  WindowSelectionRequiredError,
  artifactConversationIdSchema,
  artifactConversationMembershipSchema,
  artifactIdSchema,
  artifactKindSchema,
  artifactManifestSchema,
  artifactWindowConnectionInputSchema,
  commentsDocumentSchema,
  conversationNameSchema,
  explicitWindowConnectionInputSchema,
  reconnectConnectionInputSchema,
  ARTIFACT_CONVERSATION_SCHEMA_VERSION,
  ConversationMigrationRequiredError,
  type ArtifactConnection,
  type ArtifactConversationMetadata,
  type ArtifactManifest,
  type CommentsDocument,
  type ExplicitWindowConnectionInput,
  type ReconnectConnectionInput,
  type ReviewDecision,
  type SessionContext,
  type WorkSession,
  type CreateArtifactReviewResult,
  type InspectArtifactReviewResult,
  type JoinSessionResult,
} from "../shared/contracts";
import {
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  REVIEW_SUBMISSION_FILE,
  conversationMetadataPath,
  conversationRegisteredArtifactPath,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  ConversationNotFoundError,
  ConversationRegistryError,
  createConversationAndRegisterArtifact,
  createSession,
  readConversationMetadata,
  readSession,
  registerArtifactInConversation,
  registerArtifactInSession,
  removeArtifactFromConversation,
  removeArtifactFromSession,
  removeConversation,
} from "../shared/conversation-artifact-registry";
import { readFreshWorkspaceSnapshots, workspaceRegistryDirectory } from "../shared/workspace-registry";
import {
  WindowSelectionTokenStore,
  buildWindowCandidates,
  resolveArtifactWindowCandidates,
  selectFocusedWindowTarget,
  selectReconnectWindowTarget,
  type WindowCandidate,
} from "../shared/window-routing";
import { commitArtifactConnectionRequest, readArtifactConnection } from "../shared/artifact-connection";
import { resolveWorkSessionContext } from "../shared/work-session-context";
import { isPlanProceedKind } from "../shared/artifact-kinds";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = String(MCP_VERSION);
const RESOLVE_WINDOW_TOOL_NAME = "resolve_artifact_window";
const CREATE_TOOL_NAME = "create_artifact";
const WAIT_TOOL_NAME = "wait_for_artifact_review";
const INSPECT_TOOL_NAME = "inspect_artifact_review";
const JOIN_SESSION_TOOL_NAME = "join_session";
const ADVANCE_AND_WAIT_TOOL_NAME = "advance_and_wait_for_artifact";
const ROUND_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const LIFECYCLE_JSON_READ_ATTEMPTS = 21;
const LIFECYCLE_JSON_READ_RETRY_MS = 50;
const testArtifactIds =
  process.env.NODE_ENV === "test"
    ? (process.env.CODEX_ARTIFACTS_TEST_ARTIFACT_IDS ?? "").split(",").filter(Boolean)
    : [];

type JsonObject = Record<string, any>;

type ArtifactContext = {
  artifactDirectory: string;
  artifactId: string;
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
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  commentsSha256: string;
  comments: CommentsDocument;
  decision: ReviewDecision;
  submittedAt: string;
  artifactPath: string;
  commentsPath: string;
  submissionSha256: string;
  artifactUrl?: string;
  artifactLink?: string;
  nextAction?: {
    type: "process-review-feedback" | "execute-approved-plan" | "approved";
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
  | "WINDOW_NOT_FOUND"
  | "WINDOW_SELECTION_REQUIRED"
  | "WINDOW_SELECTION_EXPIRED"
  | "WINDOW_CONNECTION_STALE"
  | "WINDOW_CONNECTION_MISMATCH"
  | "ARTIFACT_CONNECTION_INVALID"
  | "ARTIFACT_CONNECTION_WRITE_FAILED"
  | "ARTIFACT_NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_REGISTRY_INVALID"
  | "CONVERSATION_MIGRATION_REQUIRED";

type ArtifactRecoveryMetadata = {
  code: ArtifactRecoveryCode;
  retryable: boolean;
  expectedNextTool?:
    | typeof INSPECT_TOOL_NAME
    | typeof WAIT_TOOL_NAME
    | typeof ADVANCE_AND_WAIT_TOOL_NAME
    | typeof RESOLVE_WINDOW_TOOL_NAME
    | typeof CREATE_TOOL_NAME
    | typeof JOIN_SESSION_TOOL_NAME;
  reuseRoundToken: boolean;
  useSameArtifactHandle: boolean;
  currentReviewRound?: number;
  artifactConversationId?: string;
};

class ArtifactRecoveryError extends Error {
  readonly recovery: ArtifactRecoveryMetadata;

  constructor(message: string, recovery: ArtifactRecoveryMetadata) {
    super(message);
    this.name = "ArtifactRecoveryError";
    this.recovery = recovery;
  }
}

class McpWindowSelectionRequiredError extends Error {
  readonly status = "selection-required" as const;
  readonly code = "WINDOW_SELECTION_REQUIRED" as const;
  readonly retryable = true as const;
  readonly lifecycleMutated = false as const;
  readonly takeoverOccurred = false as const;
  readonly expectedNextTool: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME | typeof JOIN_SESSION_TOOL_NAME;
  readonly useSameArtifactHandle: boolean;
  readonly candidates: WindowCandidate[];

  constructor(
    message: string,
    candidates: WindowCandidate[],
    context: {
      expectedNextTool: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME | typeof JOIN_SESSION_TOOL_NAME;
      useSameArtifactHandle: boolean;
    },
  ) {
    super(message);
    this.name = "WindowSelectionRequiredError";
    this.candidates = candidates;
    this.expectedNextTool = context.expectedNextTool;
    this.useSameArtifactHandle = context.useSameArtifactHandle;
  }
}

function recoveryError(
  code: ArtifactRecoveryCode,
  message: string,
  options: Omit<ArtifactRecoveryMetadata, "code" | "useSameArtifactHandle"> & {
    useSameArtifactHandle?: boolean;
  },
): ArtifactRecoveryError {
  return new ArtifactRecoveryError(`${code}: ${message}`, {
    code,
    useSameArtifactHandle: options.useSameArtifactHandle ?? true,
    ...options,
  });
}

type RecoveryContext = {
  isCreate?: boolean;
  entryTool?: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME | typeof JOIN_SESSION_TOOL_NAME;
  hasArtifactHandle?: boolean;
};

function asLifecycleRecoveryError(error: unknown, context: RecoveryContext = {}): unknown {
  if (error instanceof McpWindowSelectionRequiredError || error instanceof WindowSelectionRequiredError) return error;
  if (error instanceof ArtifactRecoveryError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const defaultNextTool = context.entryTool ?? (context.isCreate ? CREATE_TOOL_NAME : INSPECT_TOOL_NAME);
  const useSameHandle = context.hasArtifactHandle ?? !context.isCreate;

  if (error instanceof ConversationMigrationRequiredError || message.startsWith("CONVERSATION_MIGRATION_REQUIRED:")) {
    const text = message.startsWith("CONVERSATION_MIGRATION_REQUIRED:")
      ? message.slice("CONVERSATION_MIGRATION_REQUIRED:".length).trim()
      : message;
    const convId =
      error instanceof ConversationMigrationRequiredError
        ? error.artifactConversationId
        : (message.split("Conversation ")[1]?.split(" ")[0] ?? "");
    return recoveryError("CONVERSATION_MIGRATION_REQUIRED", text, {
      retryable: false,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
      useSameArtifactHandle: useSameHandle,
      artifactConversationId: convId,
    });
  }
  if (error instanceof ConversationNotFoundError || message.startsWith("CONVERSATION_NOT_FOUND:")) {
    const text = message.startsWith("CONVERSATION_NOT_FOUND:")
      ? message.slice("CONVERSATION_NOT_FOUND:".length).trim()
      : message;
    return recoveryError("CONVERSATION_NOT_FOUND", text, {
      retryable: false,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
      useSameArtifactHandle: useSameHandle,
    });
  }
  if (error instanceof ConversationRegistryError || message.startsWith("CONVERSATION_REGISTRY_INVALID:")) {
    const text = message.startsWith("CONVERSATION_REGISTRY_INVALID:")
      ? message.slice("CONVERSATION_REGISTRY_INVALID:".length).trim()
      : message;
    return recoveryError("CONVERSATION_REGISTRY_INVALID", text, {
      retryable: false,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
      useSameArtifactHandle: useSameHandle,
    });
  }
  if (errorCode(error) === "ENOENT" || message.startsWith("ARTIFACT_NOT_FOUND:")) {
    const text = message.startsWith("ARTIFACT_NOT_FOUND:")
      ? message.slice("ARTIFACT_NOT_FOUND:".length).trim()
      : error instanceof Error
        ? error.message
        : String(error);
    return recoveryError("ARTIFACT_NOT_FOUND", text, {
      retryable: false,
      reuseRoundToken: false,
      useSameArtifactHandle: false,
    });
  }
  if (error instanceof WindowNotFoundError || message.startsWith("WINDOW_NOT_FOUND:")) {
    const text = message.startsWith("WINDOW_NOT_FOUND:")
      ? message.slice("WINDOW_NOT_FOUND:".length).trim()
      : error instanceof Error
        ? error.message
        : String(error);
    return recoveryError("WINDOW_NOT_FOUND", text, {
      retryable: true,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof WindowSelectionExpiredError || message.startsWith("WINDOW_SELECTION_EXPIRED:")) {
    const text = message.startsWith("WINDOW_SELECTION_EXPIRED:")
      ? message.slice("WINDOW_SELECTION_EXPIRED:".length).trim()
      : error instanceof Error
        ? error.message
        : String(error);
    return recoveryError("WINDOW_SELECTION_EXPIRED", text, {
      retryable: true,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof WindowConnectionMismatchError) {
    const text = message.slice("WINDOW_CONNECTION_MISMATCH:".length).trim();
    return recoveryError("WINDOW_CONNECTION_MISMATCH", text, {
      retryable: false,
      expectedNextTool: defaultNextTool,
      reuseRoundToken: false,
    });
  }
  if (error instanceof WindowConnectionStaleError) {
    const text = message.slice("WINDOW_CONNECTION_STALE:".length).trim();
    return recoveryError("WINDOW_CONNECTION_STALE", text, {
      retryable: true,
      expectedNextTool: defaultNextTool,
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
    return recoveryError(
      "ARTIFACT_CONNECTION_WRITE_FAILED",
      message.slice("ARTIFACT_CONNECTION_WRITE_FAILED:".length).trim(),
      {
        retryable: true,
        expectedNextTool: defaultNextTool,
        reuseRoundToken: false,
      },
    );
  }
  return error;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reviewDecisionAction(kind: string, decision: ReviewDecision): ReviewWaitResult["nextAction"] {
  if (decision === "revise") {
    return {
      type: "process-review-feedback",
      instruction:
        "Process every comment in comments.comments. Answer all questions visibly in chat and include artifactLink before starting the next wait. For requested changes, supply complete replacement markdown; for question-only feedback, omit markdown to preserve the artifact bytes and SHA. If feedback needs clarification, ask the user and do not consume the round token or advance until clarified. Otherwise call advance_and_wait_for_artifact immediately in this same turn using the retained exact artifactDirectory, the returned reviewRound as expectedReviewRound, and the returned roundToken, then continue waiting for the next review. Never directly edit managed lifecycle files, including artifact.md, and never put conversational answers into the artifact Markdown.",
    };
  }
  if (decision !== "approve") return undefined;
  if (isPlanProceedKind(kind)) {
    return {
      type: "execute-approved-plan",
      instruction:
        "Execute the approved plan immediately in this same turn. Perform all in-scope code, file, workspace, and command actions described by the plan. Do not stop after acknowledging approval and do not ask for another confirmation. Pause only for a genuine blocker or authority outside the approved scope.",
    };
  }
  return {
    type: "approved",
    instruction:
      "The user has approved this artifact. Acknowledge the approval and conclude the review. Do not automatically implement code or start another review round.",
  };
}

async function readManagedFile(artifactDirectory: string, filePath: string): Promise<string> {
  const safeFilePath = await ensureSafeManagedArtifactFile(artifactDirectory, filePath);
  return fs.readFile(safeFilePath, "utf8");
}

async function readManagedJson(artifactDirectory: string, filePath: string): Promise<unknown> {
  return JSON.parse(await readManagedFile(artifactDirectory, filePath));
}

async function readOptionalManagedFile(artifactDirectory: string, filePath: string): Promise<string | undefined> {
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

async function writeNewManagedFile(artifactDirectory: string, filePath: string, contents: string): Promise<void> {
  const safeFilePath = await ensureSafeManagedArtifactFile(artifactDirectory, filePath, { allowMissing: true });
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
  const safeTarget = await ensureSafeManagedArtifactFile(artifactDirectory, target, { allowMissing: true });
  await fs.copyFile(safeSource, safeTarget, exclusive ? constants.COPYFILE_EXCL : 0);
  await ensureSafeManagedArtifactFile(artifactDirectory, safeTarget);
}

async function renameManagedFileToMissingTarget(
  artifactDirectory: string,
  source: string,
  target: string,
): Promise<void> {
  const safeSource = await ensureSafeManagedArtifactFile(artifactDirectory, source);
  const safeTarget = await ensureSafeManagedArtifactFile(artifactDirectory, target, { allowMissing: true });
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
  const testUserHome = process.env.NODE_ENV === "test" ? process.env.CODEX_ARTIFACTS_TEST_USER_HOME : undefined;
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

function workspaceSnapshotsDir(): string {
  const rootOptions = globalRootOptions();
  return workspaceRegistryDirectory(rootOptions);
}

const windowTokenStore = new WindowSelectionTokenStore();

type OptionalConversationInput = {
  artifactConversationId?: string;
  conversationName?: string;
};

function parseOptionalConversationArguments(args: JsonObject | undefined): OptionalConversationInput {
  const rawConvId = args?.artifactConversationId;
  const rawConvName = args?.conversationName;

  let artifactConversationId: string | undefined;
  if (rawConvId !== undefined) {
    const parsed = artifactConversationIdSchema.safeParse(rawConvId);
    if (!parsed.success) {
      throw new Error("INVALID_ARTIFACT_INPUT: artifactConversationId must be a valid UUID.");
    }
    artifactConversationId = parsed.data;
  }

  let conversationName: string | undefined;
  if (rawConvName !== undefined) {
    if (typeof rawConvName !== "string") {
      throw new Error("INVALID_ARTIFACT_INPUT: conversationName must contain 1 to 200 non-blank characters.");
    }
    const parsed = conversationNameSchema.safeParse(rawConvName.trim());
    if (!parsed.success) {
      throw new Error("INVALID_ARTIFACT_INPUT: conversationName must contain 1 to 200 non-blank characters.");
    }
    conversationName = parsed.data;
  }

  return {
    ...(artifactConversationId !== undefined ? { artifactConversationId } : {}),
    ...(conversationName !== undefined ? { conversationName } : {}),
  };
}

type CreateArtifactInput = OptionalConversationInput & {
  title: string;
  kind: string;
  markdown: string;
  connection?: ExplicitWindowConnectionInput;
};

function parseCreateArguments(args: JsonObject | undefined): CreateArtifactInput {
  if (args && typeof args === "object") {
    const recognizedKeys = new Set([
      "title",
      "kind",
      "markdown",
      "connection",
      "artifactConversationId",
      "conversationName",
    ]);
    for (const key of Object.keys(args)) {
      if (!recognizedKeys.has(key)) {
        throw new Error(`INVALID_ARTIFACT_INPUT: unrecognized key '${key}'.`);
      }
    }
  }

  const title = args?.title;
  const kind = args?.kind;
  const markdown = args?.markdown;
  const connectionRaw = args?.connection;

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

  let connection: ExplicitWindowConnectionInput | undefined;
  if (connectionRaw !== undefined) {
    const parsed = explicitWindowConnectionInputSchema.safeParse(connectionRaw);
    if (!parsed.success) {
      throw new Error(
        "INVALID_ARTIFACT_INPUT: connection must be an object with targetMode: 'explicit-window' and a valid UUID selectionToken.",
      );
    }
    connection = parsed.data;
  }

  const conversationArgs = parseOptionalConversationArguments(args);

  return {
    title: title.trim(),
    kind,
    markdown,
    ...(connection ? { connection } : {}),
    ...conversationArgs,
  };
}

async function resolveCreateTarget(input: CreateArtifactInput): Promise<{ windowInstanceId: string }> {
  const snapshotsDir = workspaceSnapshotsDir();
  const now = Date.now();
  const snapshots = await readFreshWorkspaceSnapshots(snapshotsDir);

  if (input.connection) {
    const grant = windowTokenStore.claim(input.connection.selectionToken, now);
    const targetSnapshot = snapshots.find((s) => s.instanceId === grant.windowInstanceId);
    if (!targetSnapshot) {
      windowTokenStore.release(input.connection.selectionToken);
      throw new WindowSelectionExpiredError("target window is no longer open; resolve active windows again.");
    }
    windowTokenStore.consume(input.connection.selectionToken);
    return {
      windowInstanceId: targetSnapshot.instanceId,
    };
  }

  const selection = selectFocusedWindowTarget(snapshots);
  if (selection.status === "matched") {
    return {
      windowInstanceId: selection.targetWindow.instanceId,
    };
  }

  if (selection.status === "selection-required") {
    const candidates = buildWindowCandidates(selection.candidates, windowTokenStore, now);
    throw new McpWindowSelectionRequiredError(
      "WINDOW_SELECTION_REQUIRED: multiple candidate VS Code windows found. Select a target window.",
      candidates,
      {
        expectedNextTool: CREATE_TOOL_NAME,
        useSameArtifactHandle: false,
      },
    );
  }

  throw new WindowNotFoundError("no active VS Code window was found.");
}

async function persistArtifact(
  input: CreateArtifactInput,
  target: { windowInstanceId: string },
): Promise<{
  context: ArtifactContext;
  connection: ArtifactConnection;
  conversation: WorkSession | undefined;
  session: SessionContext | null;
}> {
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

    let createdConversationId: string | undefined;
    let registeredInExistingConversationId: string | undefined;

    try {
      const safeArtifactDirectory = await ensureSafeGlobalArtifactDirectory(artifactId, artifactDirectory, rootOptions);
      const files = artifactPaths(safeArtifactDirectory);
      const manifest = artifactManifestSchema.parse({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        kind: input.kind,
        artifactId,
        title: input.title,
        createdAt,
        updatedAt: createdAt,
        reviewRound: 1,
        reviewSessionId,
      });
      const comments = commentsDocumentSchema.parse({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        artifactId,
        reviewRound: 1,
        artifactSha256: sha256(input.markdown),
        comments: [],
      });
      await writeNewManagedFile(safeArtifactDirectory, files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "after-manifest") {
        throw new Error("Injected artifact creation failure after manifest write.");
      }
      await writeNewManagedFile(safeArtifactDirectory, files.artifactPath, input.markdown);
      await writeNewManagedFile(safeArtifactDirectory, files.commentsPath, `${JSON.stringify(comments, null, 2)}\n`);
      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "at-conversation") {
        throw new ConversationRegistryError("Injected conversation registration failure.");
      }

      let conversation: WorkSession | undefined;
      let session: SessionContext | null = null;
      if (input.artifactConversationId) {
        await preflightConversationVersion(input.artifactConversationId, rootOptions);
        const reg = await registerArtifactInSession(input.artifactConversationId, artifactId, {
          ...rootOptions,
          registeredAt: createdAt,
        });
        registeredInExistingConversationId = input.artifactConversationId;
        conversation = reg.session;
        session = await resolveWorkSessionContext(conversation.sessionId, rootOptions);
      } else if (input.conversationName) {
        const created = await createSession({
          ...rootOptions,
          title: input.conversationName,
          createdAt,
        });
        createdConversationId = created.sessionId;
        const reg = await registerArtifactInSession(created.sessionId, artifactId, {
          ...rootOptions,
          registeredAt: createdAt,
        });
        conversation = reg.session;
        session = await resolveWorkSessionContext(conversation.sessionId, rootOptions);
      } else {
        conversation = undefined;
        session = null;
      }

      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "at-connection") {
        throw new Error("Injected connection write failure.");
      }
      const connection = await commitArtifactConnectionRequest(safeArtifactDirectory, {
        windowInstanceId: target.windowInstanceId,
        source: "create",
      });
      const context = await loadArtifactContext(safeArtifactDirectory);
      return { context, connection, conversation, session };
    } catch (error) {
      if (createdConversationId) {
        await removeConversation(createdConversationId, rootOptions).catch(() => undefined);
      } else if (registeredInExistingConversationId) {
        await removeArtifactFromSession(registeredInExistingConversationId, artifactId, rootOptions).catch(
          () => undefined,
        );
      }
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

async function preflightConversationVersion(
  artifactConversationId: string,
  rootOptions: GlobalArtifactsRootOptions = globalRootOptions(),
): Promise<void> {
  const metadataPath = conversationMetadataPath(artifactConversationId, rootOptions);
  try {
    const rawText = await fs.readFile(metadataPath, "utf8");
    const rawJson = JSON.parse(rawText);
    if (
      rawJson &&
      typeof rawJson === "object" &&
      "schemaVersion" in rawJson &&
      rawJson.schemaVersion === ARTIFACT_CONVERSATION_SCHEMA_VERSION
    ) {
      throw new ConversationMigrationRequiredError(artifactConversationId);
    }
  } catch (error) {
    if (
      error instanceof ConversationMigrationRequiredError ||
      (error instanceof Error && error.name === "ConversationMigrationRequiredError") ||
      (error instanceof Error && error.message.startsWith("CONVERSATION_MIGRATION_REQUIRED:"))
    ) {
      throw error;
    }
  }
}

async function createArtifact(args: JsonObject | undefined): Promise<{
  context: ArtifactContext;
  connection: ArtifactConnection;
  conversation: WorkSession | undefined;
  session: SessionContext | null;
}> {
  const input = parseCreateArguments(args);
  if (input.artifactConversationId) {
    try {
      await preflightConversationVersion(input.artifactConversationId, globalRootOptions());
      await readSession(input.artifactConversationId, globalRootOptions());
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ConversationNotFoundError(`conversation ${input.artifactConversationId} not found`);
      }
      throw error;
    }
  }
  const target = await resolveCreateTarget(input);
  return persistArtifact(input, target);
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
  let artifactDirectory: string;
  try {
    artifactDirectory = await ensureSafeGlobalArtifactDirectory(candidateArtifactId, rawDirectory, rootOptions);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw recoveryError("ARTIFACT_NOT_FOUND", "the artifact directory does not exist.", {
        retryable: false,
        reuseRoundToken: false,
        useSameArtifactHandle: false,
      });
    }
    throw error;
  }
  const files = artifactPaths(artifactDirectory);
  let manifest: ArtifactManifest;
  let markdown: string;
  try {
    const loaded = await retryTransientLifecycleJson(async () => {
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
    manifest = loaded.manifest;
    markdown = loaded.markdown;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw recoveryError("ARTIFACT_NOT_FOUND", "the artifact lifecycle files do not exist.", {
        retryable: false,
        reuseRoundToken: false,
        useSameArtifactHandle: false,
      });
    }
    throw error;
  }
  const artifactSha256 = sha256(markdown);
  return {
    artifactDirectory,
    artifactId: manifest.artifactId,
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
  const nextAction = reviewDecisionAction(context.manifest.kind, submission.decision);
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    kind: context.manifest.kind,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: currentArtifactSha256,
    commentsSha256: currentCommentsSha256,
    comments: currentComments,
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
    throw recoveryError(
      "ARTIFACT_ALREADY_WAITING",
      "another live tool call owns this artifact; choose reconnect or intentional takeover from the user's intent.",
      {
        retryable: true,
        reuseRoundToken: false,
        currentReviewRound: reviewRound,
      },
    );
  }
  let resolveSettled = (): void => {};
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
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
  const waiter =
    reservedWaiter ??
    reserveArtifactWaiter(context.artifactDirectory, waiterRequestKey, context.reviewRound, controller);
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
      const notFoundError = (): ArtifactRecoveryError =>
        recoveryError("ARTIFACT_NOT_FOUND", "the artifact directory or manifest no longer exists.", {
          retryable: false,
          reuseRoundToken: false,
          useSameArtifactHandle: false,
        });

      const check = async (): Promise<void> => {
        if (settled || checking) return;
        checking = true;
        try {
          try {
            await fs.access(context.manifestPath);
          } catch (accessError) {
            if (errorCode(accessError) === "ENOENT") {
              finish(notFoundError());
              return;
            }
          }
          const submission = await readValidatedSubmission(context);
          if (submission) finish(undefined, submission);
        } catch (error) {
          if (errorCode(error) === "ENOENT") {
            finish(notFoundError());
            return;
          }
          finish(error);
        } finally {
          checking = false;
        }
      };
      const onAbort = (): void =>
        finish(Object.assign(new Error("Artifact review wait was cancelled."), { name: "AbortError" }));
      const watcher = watchFs(context.artifactDirectory, { persistent: true }, (_event, filename) => {
        if (filename == null || String(filename) === REVIEW_SUBMISSION_FILE) void check();
      });
      watcher.on("error", (error) => {
        if (errorCode(error) === "ENOENT") {
          finish(notFoundError());
          return;
        }
        finish(error);
      });
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

async function backupTarget(artifactDirectory: string, target: string, backup: string): Promise<BackupMode> {
  const safeTarget = await ensureSafeManagedArtifactFile(artifactDirectory, target);
  const safeBackup = await ensureSafeManagedArtifactFile(artifactDirectory, backup, { allowMissing: true });
  if (await managedFileExists(artifactDirectory, safeBackup)) {
    throw new Error(`Artifact transaction backup already exists: ${path.basename(safeBackup)}`);
  }
  try {
    if (
      process.env.NODE_ENV === "test" &&
      process.env.CODEX_ARTIFACTS_TEST_LOCK_ARTIFACT === "1" &&
      path.basename(safeTarget) === ARTIFACT_MARKDOWN_FILE
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
  const testTransactionId =
    process.env.NODE_ENV === "test" ? process.env.CODEX_ARTIFACTS_TEST_TRANSACTION_ID : undefined;
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
    await writeNewManagedFile(
      context.artifactDirectory,
      lockPath,
      `${JSON.stringify({
        artifactId: context.artifactId,
        fromReviewRound: context.reviewRound,
        toReviewRound: nextManifest.reviewRound,
        startedAt: new Date().toISOString(),
      })}\n`,
    );
    const stagedWrites = await Promise.allSettled([
      writeNewManagedFile(context.artifactDirectory, staged[0]!, markdown),
      writeNewManagedFile(context.artifactDirectory, staged[1]!, `${JSON.stringify(nextManifest, null, 2)}\n`),
      writeNewManagedFile(context.artifactDirectory, staged[2]!, `${JSON.stringify(nextComments, null, 2)}\n`),
    ]);
    const failedStagedWrite = stagedWrites.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedStagedWrite) throw failedStagedWrite.reason;
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!;
      if (!(await managedFileExists(context.artifactDirectory, target))) {
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
    await Promise.all(
      backups.map((backup) => removeManagedFileIfExists(context.artifactDirectory, backup).catch(() => {})),
    );
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
    await Promise.all(
      staged.map((filePath) => removeManagedFileIfExists(context.artifactDirectory, filePath).catch(() => {})),
    );
    await Promise.all(
      backups.map((filePath) => removeManagedFileIfExists(context.artifactDirectory, filePath).catch(() => {})),
    );
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
  const safeTitle = rawTitle.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
  return `[${safeTitle}](${artifactUrl})`;
}

function grantSubmittedRound(
  context: ArtifactContext,
  result: ReviewWaitResult,
): ReviewWaitResult & {
  roundToken?: string;
  roundTokenSource?: "submitted-review";
  artifactUrl?: string;
  artifactLink?: string;
} {
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
      context.artifactId !== grant.artifactId ||
      context.reviewSessionId !== grant.reviewSessionId ||
      context.reviewRound !== grant.reviewRound
    )
      return false;
    const inspection = await readArtifactInspection(context);
    return (
      inspection.artifactSha256 === grant.artifactSha256 &&
      inspection.commentsSha256 === grant.commentsSha256 &&
      (inspection.submission !== undefined) === grant.submissionExpected &&
      inspection.submissionSha256 === grant.submissionSha256
    );
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
  if (error instanceof McpWindowSelectionRequiredError) {
    const structuredContent = {
      message,
      code: error.code,
      status: error.status,
      retryable: error.retryable,
      expectedNextTool: error.expectedNextTool,
      lifecycleMutated: error.lifecycleMutated,
      takeoverOccurred: error.takeoverOccurred,
      useSameArtifactHandle: error.useSameArtifactHandle,
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

type BaseArtifactHandle = {
  artifactDirectory: string;
  artifactId: string;
  artifactPath: string;
  artifactUrl: string;
  artifactLink: string;
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  kind: string;
  artifactConversationId?: string | undefined;
  conversationName?: string | undefined;
  connection?: ArtifactConnection | undefined;
};

function artifactHandle(
  context: ArtifactContext,
  connection?: ArtifactConnection,
  conversation?: ArtifactConversationMetadata | WorkSession,
): BaseArtifactHandle {
  const artifactUrl = toArtifactFileUrl(context.artifactPath);
  const artifactLink = formatArtifactLink(context.manifest.title, artifactUrl);
  const convId = conversation
    ? "sessionId" in conversation
      ? conversation.sessionId
      : conversation.artifactConversationId
    : undefined;
  const convName = conversation
    ? "title" in conversation
      ? conversation.title
      : conversation.conversationName
    : undefined;
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
    ...(convId
      ? {
          artifactConversationId: convId,
          ...(convName !== undefined ? { conversationName: convName } : {}),
        }
      : {}),
    ...(connection
      ? {
          connection: {
            schemaVersion: connection.schemaVersion,
            windowInstanceId: connection.windowInstanceId,
            connectionRevision: connection.connectionRevision,
            openRequestId: connection.openRequestId,
            source: connection.source,
            updatedAt: connection.updatedAt,
          },
        }
      : {}),
  };
}

function parseOptionalEchoConversationId(args: JsonObject | undefined): string | undefined {
  if (args?.artifactConversationId === undefined) return undefined;
  const parsed = artifactConversationIdSchema.safeParse(args.artifactConversationId);
  if (!parsed.success) {
    throw new Error("INVALID_ARTIFACT_INPUT: artifactConversationId must be a valid UUID.");
  }
  return parsed.data;
}

function parseExpectedReviewRound(args: JsonObject | undefined): number {
  const expectedReviewRound = args?.expectedReviewRound;
  if (!Number.isInteger(expectedReviewRound) || expectedReviewRound < 1) {
    throw new Error("expectedReviewRound must be a positive integer.");
  }
  return expectedReviewRound;
}

function roundMismatchError(currentReviewRound: number, expectedReviewRound: number): ArtifactRecoveryError {
  return recoveryError(
    "ROUND_MISMATCH",
    `the artifact is at review round ${currentReviewRound}, not ${expectedReviewRound}.`,
    {
      retryable: true,
      expectedNextTool: INSPECT_TOOL_NAME,
      reuseRoundToken: false,
      currentReviewRound,
    },
  );
}

async function handleResolveWindowTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    const query = typeof args?.query === "string" ? args.query : undefined;
    const snapshotsDir = workspaceSnapshotsDir();
    const snapshots = await readFreshWorkspaceSnapshots(snapshotsDir);
    const resolution = resolveArtifactWindowCandidates(query, snapshots, windowTokenStore, Date.now());
    respond(id, toolResult(resolution));
  } catch (error) {
    respond(id, toolError(error));
  }
}

async function handleCreateTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    const { context, connection, conversation, session } = await createArtifact(args);
    const baseHandle = artifactHandle(context, connection, conversation);
    const result: CreateArtifactReviewResult =
      session !== null && conversation !== undefined
        ? {
            ...baseHandle,
            artifactConversationId: conversation.sessionId,
            ...(baseHandle.conversationName !== undefined ? { conversationName: baseHandle.conversationName } : {}),
            session,
          }
        : {
            ...baseHandle,
            session: null,
          };
    respond(id, toolResult(result));
  } catch (error) {
    respond(
      id,
      toolError(
        asLifecycleRecoveryError(error, {
          isCreate: true,
          entryTool: CREATE_TOOL_NAME,
          hasArtifactHandle: false,
        }),
      ),
    );
  }
}

const WAIT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "artifactDirectory",
  "expectedReviewRound",
  "takeover",
  "artifactConversationId",
]);

const INSPECT_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "artifactDirectory",
  "expectedReviewRound",
  "takeover",
  "intent",
  "connection",
  "artifactConversationId",
  "conversationName",
]);

const ADVANCE_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "artifactDirectory",
  "expectedReviewRound",
  "roundToken",
  "markdown",
  "artifactConversationId",
]);

const JOIN_ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "sessionId",
  "artifactId",
  "takeover",
  "expectedReviewRound",
  "intent",
  "connection",
]);

function assertAllowedToolKeys(toolName: string, args: JsonObject | undefined, allowedKeys: ReadonlySet<string>): void {
  for (const key of Object.keys(args ?? {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(`INVALID_ARTIFACT_INPUT: ${toolName} received unrecognized key(s): ${key}.`);
    }
  }
}

async function handleWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  let reservedWaiter: ActiveArtifactWaiter | undefined;
  let artifactDirectory: string | undefined;
  try {
    assertAllowedToolKeys(WAIT_TOOL_NAME, args, WAIT_ALLOWED_KEYS);
    const expectedReviewRound = parseExpectedReviewRound(args);
    const artifactConversationId = parseOptionalEchoConversationId(args);
    artifactDirectory = args?.artifactDirectory;
    if (typeof artifactDirectory !== "string" || !path.isAbsolute(artifactDirectory)) {
      throw new Error("artifactDirectory must be an absolute path.");
    }
    if (args?.takeover === true) await detachActiveArtifactWaiter(artifactDirectory);
    reservedWaiter = reserveArtifactWaiter(artifactDirectory, requestKey(id), expectedReviewRound, controller);
    const context = await loadArtifactContext(artifactDirectory);
    if (context.reviewRound !== expectedReviewRound) {
      throw roundMismatchError(context.reviewRound, expectedReviewRound);
    }
    const result = await waitForSubmission(context, requestKey(id), controller, false, reservedWaiter);
    reservedWaiter = undefined;
    respond(
      id,
      toolResult({
        ...grantSubmittedRound(context, result),
        ...(artifactConversationId ? { artifactConversationId } : {}),
      }),
    );
  } catch (error) {
    respond(id, toolError(asLifecycleRecoveryError(error)));
  } finally {
    if (reservedWaiter && artifactDirectory) releaseArtifactWaiter(artifactDirectory, reservedWaiter);
    pending.delete(requestKey(id));
  }
}

type ArtifactInspectionRaw = Awaited<ReturnType<typeof readArtifactInspection>>;

type InspectCoreInput = {
  artifactDirectory: string;
  expectedReviewRound?: number | undefined;
  takeover?: boolean | undefined;
  intent?: "explicit-chat-update" | "reconnect" | undefined;
  connection?: ReconnectConnectionInput | undefined;
  artifactConversationId?: string | undefined;
  conversationName?: string | undefined;
  expectedNextTool?: typeof CREATE_TOOL_NAME | typeof INSPECT_TOOL_NAME | typeof JOIN_SESSION_TOOL_NAME | undefined;
};

type InspectCoreResult = {
  context: ArtifactContext;
  inspection: ArtifactInspectionRaw;
  session: WorkSession | undefined;
  sessionContext: SessionContext | null;
  connection: ArtifactConnection | null;
  roundToken?: string | undefined;
  roundTokenSource?: "chat-inspection" | "chat-update" | "submitted-review" | undefined;
};

async function executeInspectCore(input: InspectCoreInput): Promise<InspectCoreResult> {
  const { artifactDirectory, intent, expectedReviewRound, takeover, connection: reconnectConnectionInput } = input;
  let context = await loadArtifactContext(artifactDirectory);
  if (expectedReviewRound !== undefined && context.reviewRound !== expectedReviewRound) {
    throw roundMismatchError(context.reviewRound, expectedReviewRound);
  }

  const rootOptions = globalRootOptions();
  if (input.artifactConversationId) {
    try {
      await preflightConversationVersion(input.artifactConversationId, rootOptions);
      await readSession(input.artifactConversationId, rootOptions);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ConversationNotFoundError(`conversation ${input.artifactConversationId} not found`);
      }
      throw error;
    }
  }

  let targetReconnectWindow: { windowInstanceId: string } | undefined;

  // Routing preflight happens BEFORE takeover and BEFORE conversation registration when intent is reconnect
  if (intent === "reconnect") {
    const snapshotsDir = workspaceSnapshotsDir();
    const now = Date.now();
    const snapshots = await readFreshWorkspaceSnapshots(snapshotsDir);
    const currentConnection = await readArtifactConnection(context.artifactDirectory, { allowMissing: true });

    if (reconnectConnectionInput?.targetMode === "explicit-window") {
      const grant = windowTokenStore.claim(reconnectConnectionInput.selectionToken, now);
      const targetSnapshot = snapshots.find((s) => s.instanceId === grant.windowInstanceId);
      if (!targetSnapshot) {
        windowTokenStore.release(reconnectConnectionInput.selectionToken);
        throw new WindowSelectionExpiredError("target window is no longer open; resolve active windows again.");
      }
      windowTokenStore.consume(reconnectConnectionInput.selectionToken);
      targetReconnectWindow = {
        windowInstanceId: targetSnapshot.instanceId,
      };
    } else {
      const aiAffinityId =
        reconnectConnectionInput?.targetMode === "artifact-window"
          ? reconnectConnectionInput.windowInstanceId
          : undefined;
      const persistedAffinityId = currentConnection?.windowInstanceId;
      const selection = selectReconnectWindowTarget(snapshots, aiAffinityId, persistedAffinityId);
      if (selection.status === "matched") {
        targetReconnectWindow = {
          windowInstanceId: selection.targetWindow.instanceId,
        };
      } else if (selection.status === "selection-required") {
        const candidates = buildWindowCandidates(selection.candidates, windowTokenStore, now);
        throw new McpWindowSelectionRequiredError(
          "WINDOW_SELECTION_REQUIRED: multiple candidate VS Code windows found. Select a target window.",
          candidates,
          {
            expectedNextTool: input.expectedNextTool ?? INSPECT_TOOL_NAME,
            useSameArtifactHandle: true,
          },
        );
      } else {
        throw new WindowNotFoundError("no active VS Code window was found.");
      }
    }
  }

  if (intent === "explicit-chat-update") {
    const preCheckInspection = await readArtifactInspection(context);
    if (preCheckInspection.comments.comments.length > 0 || preCheckInspection.submission) {
      throw new Error("explicit-chat-update requires an empty review round without saved comments or a submission.");
    }
  }

  if (takeover === true) {
    await detachActiveArtifactWaiter(artifactDirectory);
    context = await loadArtifactContext(artifactDirectory);
    if (expectedReviewRound !== undefined && context.reviewRound !== expectedReviewRound) {
      throw roundMismatchError(context.reviewRound, expectedReviewRound);
    }
  }

  const inspection = await readArtifactInspection(context);

  let createdInspectConversationId: string | undefined;
  let existingInspectConversationId: string | undefined;
  let previousMembershipRegisteredAt: string | undefined;
  let session: WorkSession | undefined;
  let sessionContext: SessionContext | null = null;
  if (input.artifactConversationId) {
    existingInspectConversationId = input.artifactConversationId;
    const reg = await registerArtifactInSession(
      input.artifactConversationId,
      context.artifactId,
      rootOptions,
    );
    previousMembershipRegisteredAt = reg.previousRegisteredAt;
    session = reg.session;
    try {
      sessionContext = await resolveWorkSessionContext(session.sessionId, rootOptions);
    } catch (error) {
      if (previousMembershipRegisteredAt !== undefined) {
        await registerArtifactInSession(existingInspectConversationId, context.artifactId, {
          ...rootOptions,
          registeredAt: previousMembershipRegisteredAt,
        }).catch(() => undefined);
      } else {
        await removeArtifactFromSession(existingInspectConversationId, context.artifactId, rootOptions).catch(
          () => undefined,
        );
      }
      throw error;
    }
  } else if (input.conversationName) {
    const created = await createSession({
      ...rootOptions,
      title: input.conversationName,
    });
    createdInspectConversationId = created.sessionId;
    try {
      const reg = await registerArtifactInSession(created.sessionId, context.artifactId, rootOptions);
      session = reg.session;
      sessionContext = await resolveWorkSessionContext(session.sessionId, rootOptions);
    } catch (error) {
      await removeConversation(created.sessionId, rootOptions).catch(() => undefined);
      throw error;
    }
  } else {
    session = undefined;
    sessionContext = null;
  }

  let connection: ArtifactConnection | null = null;
  try {
    if (intent === "reconnect" && targetReconnectWindow) {
      if (
        process.env.NODE_ENV === "test" &&
        process.env.CODEX_ARTIFACTS_TEST_FAIL_RECONNECT === "invalid-state-at-connection"
      ) {
        throw new ArtifactConnectionInvalidError("Injected invalid connection state during commit.");
      }
      try {
        connection = await commitArtifactConnectionRequest(context.artifactDirectory, {
          windowInstanceId: targetReconnectWindow.windowInstanceId,
          source: "inspect",
        });
      } catch (err) {
        if (err instanceof ArtifactConnectionInvalidError || err instanceof ArtifactConnectionWriteError) {
          throw err;
        }
        const detail = err instanceof Error ? err.message : String(err);
        throw new ArtifactConnectionWriteError(`failed to update connection state: ${detail}`);
      }
    } else {
      connection = await readArtifactConnection(context.artifactDirectory, { allowMissing: true });
    }
  } catch (error) {
    if (createdInspectConversationId) {
      await removeConversation(createdInspectConversationId, rootOptions).catch(() => undefined);
    } else if (existingInspectConversationId) {
      if (previousMembershipRegisteredAt !== undefined) {
        await registerArtifactInSession(existingInspectConversationId, context.artifactId, {
          ...rootOptions,
          registeredAt: previousMembershipRegisteredAt,
        }).catch(() => undefined);
      } else {
        await removeArtifactFromSession(existingInspectConversationId, context.artifactId, rootOptions).catch(
          () => undefined,
        );
      }
    }
    throw error;
  }

  const { roundToken, roundTokenSource } = grantInspectedRound(
    context,
    inspection,
    intent === "explicit-chat-update" ? intent : undefined,
  );

  return {
    context,
    inspection,
    session,
    sessionContext,
    connection,
    roundToken,
    roundTokenSource,
  };
}

async function handleInspectTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    assertAllowedToolKeys(INSPECT_TOOL_NAME, args, INSPECT_ALLOWED_KEYS);
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
    const expectedReviewRound = args?.expectedReviewRound !== undefined ? parseExpectedReviewRound(args) : undefined;
    const conversationArgs = parseOptionalConversationArguments(args);

    const connectionRaw = args?.connection;
    let reconnectConnectionInput: ReconnectConnectionInput | undefined;

    if (intent === "reconnect") {
      if (connectionRaw !== undefined) {
        const parsed = reconnectConnectionInputSchema.safeParse(connectionRaw);
        if (!parsed.success) {
          throw new Error(
            "INVALID_ARTIFACT_INPUT: connection must be an object with targetMode: 'explicit-window' and a valid UUID selectionToken, or targetMode: 'artifact-window' and a valid UUID windowInstanceId.",
          );
        }
        reconnectConnectionInput = parsed.data;
      }
    } else {
      if (connectionRaw !== undefined) {
        if (artifactWindowConnectionInputSchema.safeParse(connectionRaw).success) {
          throw new Error(
            "INVALID_ARTIFACT_INPUT: artifact-window connection is only supported when intent is reconnect.",
          );
        }
        if (!explicitWindowConnectionInputSchema.safeParse(connectionRaw).success) {
          throw new Error(
            "INVALID_ARTIFACT_INPUT: connection must be an object with targetMode: 'explicit-window' and a valid UUID selectionToken.",
          );
        }
      }
    }

    const { context, inspection, session, sessionContext, connection, roundToken, roundTokenSource } =
      await executeInspectCore({
        artifactDirectory,
        expectedReviewRound,
        takeover: args?.takeover,
        intent,
        connection: reconnectConnectionInput,
        artifactConversationId: conversationArgs.artifactConversationId,
        conversationName: conversationArgs.conversationName,
        expectedNextTool: INSPECT_TOOL_NAME,
      });

    const baseHandle = artifactHandle(context, connection ?? undefined, session);
    const validRoundTokenSource =
      roundTokenSource === "chat-inspection" || roundTokenSource === "chat-update"
        ? roundTokenSource
        : undefined;
    const result: InspectArtifactReviewResult =
      sessionContext !== null && session !== undefined
        ? {
            ...baseHandle,
            artifactConversationId: session.sessionId,
            ...(baseHandle.conversationName !== undefined ? { conversationName: baseHandle.conversationName } : {}),
            manifest: context.manifest,
            markdown: inspection.markdown,
            comments: inspection.comments,
            commentsSha256: inspection.commentsSha256,
            ...(inspection.submission !== undefined ? { submission: inspection.submission } : {}),
            ...(inspection.submissionSha256 !== undefined ? { submissionSha256: inspection.submissionSha256 } : {}),
            ...(roundToken !== undefined ? { roundToken } : {}),
            ...(validRoundTokenSource !== undefined ? { roundTokenSource: validRoundTokenSource } : {}),
            session: sessionContext,
          }
        : {
            ...baseHandle,
            manifest: context.manifest,
            markdown: inspection.markdown,
            comments: inspection.comments,
            commentsSha256: inspection.commentsSha256,
            ...(inspection.submission !== undefined ? { submission: inspection.submission } : {}),
            ...(inspection.submissionSha256 !== undefined ? { submissionSha256: inspection.submissionSha256 } : {}),
            ...(roundToken !== undefined ? { roundToken } : {}),
            ...(validRoundTokenSource !== undefined ? { roundTokenSource: validRoundTokenSource } : {}),
            session: null,
          };
    respond(id, toolResult(result));
  } catch (error) {
    respond(id, toolError(asLifecycleRecoveryError(error, { entryTool: INSPECT_TOOL_NAME, hasArtifactHandle: true })));
  }
}

async function handleJoinSessionTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    assertAllowedToolKeys(JOIN_SESSION_TOOL_NAME, args, JOIN_ALLOWED_KEYS);
    const sessionId = args?.sessionId;
    if (typeof sessionId !== "string" || !artifactConversationIdSchema.safeParse(sessionId).success) {
      throw new Error("sessionId must be a valid UUID.");
    }

    const rootOptions = globalRootOptions();

    if (args?.artifactId === undefined) {
      if (
        args?.takeover !== undefined ||
        args?.expectedReviewRound !== undefined ||
        args?.intent !== undefined ||
        args?.connection !== undefined
      ) {
        throw new Error("Inspect options (takeover, expectedReviewRound, intent, connection) require artifactId.");
      }
      try {
        await preflightConversationVersion(sessionId, rootOptions);
        await readSession(sessionId, rootOptions);
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          throw new ConversationNotFoundError(`conversation ${sessionId} not found`);
        }
        throw error;
      }
      const sessionContext = await resolveWorkSessionContext(sessionId, rootOptions);
      const result: JoinSessionResult = {
        session: sessionContext,
      };
      respond(id, toolResult(result));
      return;
    }

    const artifactIdRaw = args.artifactId;
    if (typeof artifactIdRaw !== "string" || !artifactIdSchema.safeParse(artifactIdRaw).success) {
      throw new Error("INVALID_ARTIFACT_INPUT: artifactId must be a valid artifact ID.");
    }
    const artifactId = artifactIdRaw;
    const canonicalDir = path.join(globalArtifactsRoot(rootOptions), artifactId);

    const intent = args?.intent;
    if (intent !== undefined && intent !== "explicit-chat-update" && intent !== "reconnect") {
      throw new Error(`Invalid intent: ${String(intent)}.`);
    }
    if (intent === "explicit-chat-update" && args?.expectedReviewRound === undefined) {
      throw new Error("expectedReviewRound is required when intent is explicit-chat-update.");
    }
    const expectedReviewRound = args?.expectedReviewRound !== undefined ? parseExpectedReviewRound(args) : undefined;

    if (args?.takeover !== undefined && typeof args.takeover !== "boolean") {
      throw new Error("INVALID_ARTIFACT_INPUT: takeover must be a boolean.");
    }

    const connectionRaw = args?.connection;
    let reconnectConnectionInput: ReconnectConnectionInput | undefined;

    if (intent === "reconnect") {
      if (connectionRaw !== undefined) {
        const parsed = reconnectConnectionInputSchema.safeParse(connectionRaw);
        if (!parsed.success) {
          throw new Error(
            "INVALID_ARTIFACT_INPUT: connection must be an object with targetMode: 'explicit-window' and a valid UUID selectionToken, or targetMode: 'artifact-window' and a valid UUID windowInstanceId.",
          );
        }
        reconnectConnectionInput = parsed.data;
      }
    } else {
      if (connectionRaw !== undefined) {
        throw new Error("INVALID_ARTIFACT_INPUT: connection is only supported when intent is reconnect.");
      }
    }

    const { context, inspection, session, sessionContext, connection, roundToken, roundTokenSource } =
      await executeInspectCore({
        artifactDirectory: canonicalDir,
        expectedReviewRound,
        takeover: args?.takeover,
        intent,
        connection: reconnectConnectionInput,
        artifactConversationId: sessionId,
        expectedNextTool: JOIN_SESSION_TOOL_NAME,
      });

    const baseHandle = artifactHandle(context, connection ?? undefined, session);
    const validRoundTokenSource =
      roundTokenSource === "chat-inspection" || roundTokenSource === "chat-update"
        ? roundTokenSource
        : undefined;
    const result: JoinSessionResult = {
      session: sessionContext!,
      inspection: {
        ...baseHandle,
        artifactConversationId: session!.sessionId,
        ...(baseHandle.conversationName !== undefined ? { conversationName: baseHandle.conversationName } : {}),
        manifest: context.manifest,
        markdown: inspection.markdown,
        comments: inspection.comments,
        commentsSha256: inspection.commentsSha256,
        ...(inspection.submission !== undefined ? { submission: inspection.submission } : {}),
        ...(inspection.submissionSha256 !== undefined ? { submissionSha256: inspection.submissionSha256 } : {}),
        ...(roundToken !== undefined ? { roundToken } : {}),
        ...(validRoundTokenSource !== undefined ? { roundTokenSource: validRoundTokenSource } : {}),
      },
    };
    respond(id, toolResult(result));
  } catch (error) {
    respond(
      id,
      toolError(
        asLifecycleRecoveryError(error, {
          entryTool: JOIN_SESSION_TOOL_NAME,
          hasArtifactHandle: args?.artifactId !== undefined,
        }),
      ),
    );
  }
}

async function handleAdvanceAndWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  let claimedToken: string | undefined;
  let committedReviewRound: number | undefined;
  try {
    pruneRoundGrants();
    assertAllowedToolKeys(ADVANCE_AND_WAIT_TOOL_NAME, args, ADVANCE_ALLOWED_KEYS);
    const expectedReviewRound = parseExpectedReviewRound(args);
    const artifactConversationId = parseOptionalEchoConversationId(args);
    const roundToken = args?.roundToken;
    const markdown = args?.markdown;
    if (typeof roundToken !== "string" || !roundToken) throw new Error("roundToken is required.");
    if (markdown !== undefined && (typeof markdown !== "string" || !markdown.trim())) {
      throw new Error("markdown must be non-empty when supplied.");
    }
    if (claimedRoundTokens.has(roundToken)) {
      throw recoveryError(
        "ROUND_TOKEN_IN_USE",
        "the artifact round token is already being used by another request; wait for that request instead of retrying concurrently.",
        {
          retryable: true,
          reuseRoundToken: false,
        },
      );
    }
    if (consumedRoundTokens.has(roundToken)) {
      throw recoveryError(
        "ROUND_TOKEN_ALREADY_CONSUMED",
        "the artifact round token was already consumed; inspect the same artifact before taking another action.",
        {
          retryable: true,
          expectedNextTool: INSPECT_TOOL_NAME,
          reuseRoundToken: false,
        },
      );
    }
    const grant = roundGrants.get(roundToken);
    if (!grant) {
      throw recoveryError(
        "ROUND_TOKEN_INVALID_OR_EXPIRED",
        "the artifact round token is invalid, expired, or was lost after MCP restart; inspect the same artifact for current state.",
        {
          retryable: true,
          expectedNextTool: INSPECT_TOOL_NAME,
          reuseRoundToken: false,
        },
      );
    }
    claimedRoundTokens.add(roundToken);
    claimedToken = roundToken;

    const context = await loadArtifactContext(args?.artifactDirectory);
    if (
      samePathKey(context.artifactDirectory) !== samePathKey(grant.artifactDirectory) ||
      context.artifactId !== grant.artifactId ||
      context.reviewSessionId !== grant.reviewSessionId ||
      context.reviewRound !== grant.reviewRound ||
      context.reviewRound !== expectedReviewRound
    ) {
      roundGrants.delete(roundToken);
      throw recoveryError(
        "ROUND_MISMATCH",
        "the artifact round token does not match the current artifact, session, or review round.",
        {
          retryable: true,
          expectedNextTool: INSPECT_TOOL_NAME,
          reuseRoundToken: false,
          currentReviewRound: context.reviewRound,
        },
      );
    }
    const inspection = await readArtifactInspection(context);
    if (
      inspection.artifactSha256 !== grant.artifactSha256 ||
      inspection.commentsSha256 !== grant.commentsSha256 ||
      (inspection.submission !== undefined) !== grant.submissionExpected ||
      inspection.submissionSha256 !== grant.submissionSha256
    ) {
      roundGrants.delete(roundToken);
      throw recoveryError(
        "ROUND_STATE_CHANGED",
        "the artifact round token no longer matches the inspected content (Markdown, comments, or submission).",
        {
          retryable: true,
          expectedNextTool: INSPECT_TOOL_NAME,
          reuseRoundToken: false,
          currentReviewRound: context.reviewRound,
        },
      );
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
      throw recoveryError(
        "ARTIFACT_ALREADY_WAITING",
        "detach the live waiter only when the user's intent requires inspection or a direct chat update.",
        {
          retryable: true,
          reuseRoundToken: false,
          currentReviewRound: context.reviewRound,
        },
      );
    }
    if (controller.signal.aborted) {
      throw recoveryError(
        "ADVANCE_CANCELLED_BEFORE_COMMIT",
        "artifact review advance was cancelled before commit; the current token remains valid.",
        {
          retryable: true,
          expectedNextTool: ADVANCE_AND_WAIT_TOOL_NAME,
          reuseRoundToken: true,
          currentReviewRound: context.reviewRound,
        },
      );
    }

    let committed: Awaited<ReturnType<typeof commitReviewRound>>;
    try {
      committed = await commitReviewRound(context, markdown ?? inspection.markdown);
    } catch (commitError) {
      if (await roundStateMatchesGrant(grant)) {
        const detail = commitError instanceof Error ? commitError.message : String(commitError);
        throw recoveryError(
          "ADVANCE_ROLLED_BACK",
          `the round commit failed and the original state was restored: ${detail}`,
          {
            retryable: true,
            expectedNextTool: ADVANCE_AND_WAIT_TOOL_NAME,
            reuseRoundToken: true,
            currentReviewRound: context.reviewRound,
          },
        );
      }
      roundGrants.delete(roundToken);
      throw recoveryError(
        "ROUND_STATE_CHANGED",
        "the round commit failed and current state could not be confirmed; inspect the same artifact before retrying.",
        {
          retryable: true,
          expectedNextTool: INSPECT_TOOL_NAME,
          reuseRoundToken: false,
        },
      );
    }
    roundGrants.delete(roundToken);
    consumedRoundTokens.set(roundToken, Date.now() + ROUND_TOKEN_TTL_MS);
    claimedRoundTokens.delete(roundToken);
    claimedToken = undefined;
    committedReviewRound = committed.manifest.reviewRound;

    const updatedContext = await loadArtifactContext(context.artifactDirectory);
    const result = await waitForSubmission(updatedContext, requestKey(id), controller);
    respond(
      id,
      toolResult({
        ...grantSubmittedRound(updatedContext, result),
        ...(artifactConversationId ? { artifactConversationId } : {}),
      }),
    );
  } catch (error) {
    if (committedReviewRound !== undefined) {
      const detail = error instanceof Error ? error.message : String(error);
      respond(
        id,
        toolError(
          recoveryError(
            "ADVANCE_COMMITTED",
            `review round ${committedReviewRound} committed, but the follow-up wait did not complete: ${detail}`,
            {
              retryable: true,
              expectedNextTool: WAIT_TOOL_NAME,
              reuseRoundToken: false,
              currentReviewRound: committedReviewRound,
            },
          ),
        ),
      );
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
        "Use artifact review tools to review plans and artifacts in VS Code.",
        "By default, create_artifact routes to the currently focused VS Code window (or the sole live window) without prior resolution.",
        "When multiple windows exist and none or multiple are focused, create_artifact returns WINDOW_SELECTION_REQUIRED with candidates and single-use selection tokens.",
        "To query windows or inspect active candidates, call resolve_artifact_window.",
        "Pass connection: { targetMode: 'explicit-window', selectionToken } when targeting a specific candidate, or connection: { targetMode: 'artifact-window', windowInstanceId } to inspect_artifact_review (intent=reconnect) as an advisory affinity hint.",
        "Create returns the exact artifactDirectory, reviewRound, and committed connection metadata; retain them and call wait_for_artifact_review. A non-null Work Session context is returned only when a Session is selected or explicitly created.",
        "Create and inspect without artifactConversationId or conversationName are standalone and return session: null without creating or registering a Work Session. While a chat has an active Session, pass its ID unless the user explicitly requests standalone; a name without an ID explicitly creates a new Session.",
        "Use the work-session skill to join or refresh an exact Session with join_session and sessionId; supply artifactId only when the request also calls for artifact inspection and registration in that Session.",
        "A cancelled waiter never ends or deletes the artifact.",
        "Both wait_for_artifact_review and advance_and_wait_for_artifact return the complete validated comments document for every submitted decision; read feedback from comments.comments. A revise result also returns nextAction.type=process-review-feedback and a one-time roundToken so feedback can be processed without an additional inspection just to fetch comments.",
        "Treat comments returned by a Review submission and comments read through inspect_artifact_review with the same policy: answer questions visibly in chat before calling advance_and_wait_for_artifact, update Markdown only for requested changes, omit markdown for question-only feedback, and ask for clarification without consuming the token when needed.",
        "Do not add Review responses to the artifact.",
        "Pure reconnect uses inspect_artifact_review with intent=reconnect on the exact handle and same round; routing prioritizes sole live window, validated advisory artifact-window affinity, and unique focused window, or explicit candidate via selectionToken.",
        "For chat escape, inspect the exact handle with takeover=true.",
        "If inspection has no comments or submission, reattach with wait_for_artifact_review without advancing.",
        "When updating an artifact directly from chat on an empty round, inspect with takeover=true, expectedReviewRound, and intent=explicit-chat-update, then advance with replacement markdown.",
        "Follow structured recovery metadata on lifecycle errors, keep the same exact handle, and never replay when commit state is uncertain.",
        "When Proceed returns approve for kind plan or implementation-plan, obey nextAction and execute the complete approved plan immediately in the same turn; do not stop at acknowledgement or ask for another confirmation.",
        "When Proceed returns approve for any other kind, acknowledge the approval and conclude the review without automatically implementing code or starting another review round.",
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
    respond(id, {
      tools: [
        {
          name: RESOLVE_WINDOW_TOOL_NAME,
          title: "Resolve artifact window",
          description:
            "Query active VS Code windows and return candidate targets with single-use selection tokens for explicit window routing. Returns status ('focused', 'selection-required', or 'not-found'), focusedWindow (if any), and candidates list.",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                maxLength: 500,
                description:
                  "Optional case-insensitive query matched against window candidate label, active file, and folder paths.",
              },
            },
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        },
        {
          name: CREATE_TOOL_NAME,
          title: "Create artifact",
          description:
            "Create a secure schema-v6 Markdown artifact in global AI Artifacts storage, optionally register it in an explicitly selected or newly requested Work Session, atomically commit its schema-v1 window-routing connection (routing to the focused VS Code window by default, or an explicit candidate via selectionToken), and return the exact persistent handle, nullable session context, and connection metadata without waiting.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 200 },
              kind: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
              markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_BYTES },
              artifactConversationId: {
                type: "string",
                format: "uuid",
                description:
                  "Optional exact Work Session UUID. Registers or refreshes the artifact in that Session. Omit this and conversationName for standalone behavior. If both are supplied, this ID takes precedence.",
              },
              conversationName: {
                type: "string",
                minLength: 1,
                maxLength: 200,
                description:
                  "Explicit name for a new Work Session when artifactConversationId is omitted. Omit both Session arguments for standalone behavior; omission does not create a Session.",
              },
              connection: {
                type: "object",
                description: "Optional explicit window targeting connection parameters.",
                properties: {
                  targetMode: { const: "explicit-window" },
                  selectionToken: {
                    type: "string",
                    format: "uuid",
                    description:
                      "Window selection token returned by resolve_artifact_window or an earlier WINDOW_SELECTION_REQUIRED response.",
                  },
                },
                required: ["targetMode", "selectionToken"],
                additionalProperties: false,
              },
            },
            required: ["title", "kind", "markdown"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        {
          name: WAIT_TOOL_NAME,
          title: "Wait for artifact review",
          description:
            "Attach one transient waiter to an exact artifact round. Return an existing submission immediately, or wait for Review, Proceed, or Just save. Every decision returns the complete validated comments document; read comments.comments. Review returns a process-review-feedback next action and round token. An approved plan returns an execute-approved-plan next action. An approved non-plan returns an approved next action. Takeover safely detaches the previous waiter.",
          inputSchema: {
            type: "object",
            properties: {
              artifactDirectory: { type: "string" },
              expectedReviewRound: { type: "integer", minimum: 1 },
              takeover: { type: "boolean", default: false },
              artifactConversationId: {
                type: "string",
                format: "uuid",
                description: "Optional active conversation UUID echoed back in the lifecycle result.",
              },
            },
            required: ["artifactDirectory", "expectedReviewRound"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        {
          name: INSPECT_TOOL_NAME,
          title: "Inspect artifact review",
          description:
            "Read the current manifest, Markdown, comments, optional submission, connection metadata, and validated hashes for an exact artifact. Session registration occurs only when artifactConversationId or conversationName is supplied; omission is standalone. With intent=reconnect, re-evaluate and atomically bind an active VS Code window (sole live window, validated artifact-window affinity, unique focused window, or explicit via connection.selectionToken). Takeover first cancels and drains its current waiter. Returns a one-time round token when saved feedback is present or when intent is explicit-chat-update.",
          inputSchema: {
            type: "object",
            properties: {
              artifactDirectory: { type: "string" },
              expectedReviewRound: {
                type: "integer",
                minimum: 1,
                description: "Expected current review round. Required when intent is explicit-chat-update.",
              },
              takeover: { type: "boolean", default: false },
              intent: {
                type: "string",
                enum: ["explicit-chat-update", "reconnect"],
                description:
                  "Specify reconnect to bind the artifact to an active VS Code window, or explicit-chat-update when the user explicitly requests changes in chat on a round without saved comments.",
              },
              artifactConversationId: {
                type: "string",
                format: "uuid",
                description:
                  "Optional exact Work Session UUID. Registers or refreshes the artifact in that Session. Omit this and conversationName for standalone behavior. If both are supplied, this ID takes precedence.",
              },
              conversationName: {
                type: "string",
                minLength: 1,
                maxLength: 200,
                description:
                  "Explicit name for a new Work Session when artifactConversationId is omitted. Omit both Session arguments for standalone behavior; omission does not create a Session.",
              },
              connection: {
                description:
                  "Optional window targeting connection parameters for reconnect. Provide artifact-window with cached windowInstanceId as an advisory affinity hint, or explicit-window with selectionToken for user-selected window.",
                oneOf: [
                  {
                    type: "object",
                    description: "Advisory affinity hint targeting a previously bound VS Code window.",
                    properties: {
                      targetMode: { const: "artifact-window" },
                      windowInstanceId: {
                        type: "string",
                        format: "uuid",
                        description: "Previously committed windowInstanceId for this artifact.",
                      },
                    },
                    required: ["targetMode", "windowInstanceId"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    description: "Explicit window targeting with selection token.",
                    properties: {
                      targetMode: { const: "explicit-window" },
                      selectionToken: {
                        type: "string",
                        format: "uuid",
                        description:
                          "Window selection token returned by resolve_artifact_window or an earlier WINDOW_SELECTION_REQUIRED response.",
                      },
                    },
                    required: ["targetMode", "selectionToken"],
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ["artifactDirectory"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        {
          name: JOIN_SESSION_TOOL_NAME,
          title: "Join work session",
          description:
            "Join an existing work session. Provide only sessionId to read its full session context (metadata, instructions, and categorized artifacts catalog) without opening, takeover, or token generation. Provide both sessionId and artifactId to inspect the target artifact and join the session, updating membership and window connection as appropriate.",
          inputSchema: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                format: "uuid",
                description: "Active work session UUID to join.",
              },
              artifactId: {
                type: "string",
                description: "Optional artifact ID to inspect and link to the session.",
              },
              takeover: {
                type: "boolean",
                default: false,
                description: "Safely detach any existing waiter on the target artifact before inspecting.",
              },
              expectedReviewRound: {
                type: "integer",
                minimum: 1,
                description: "Expected current review round. Required when intent is explicit-chat-update.",
              },
              intent: {
                type: "string",
                enum: ["explicit-chat-update", "reconnect"],
                description:
                  "Specify reconnect to bind the artifact to an active VS Code window, or explicit-chat-update when requesting changes on an empty round.",
              },
              connection: {
                description: "Optional window targeting connection parameters for reconnect.",
                oneOf: [
                  {
                    type: "object",
                    description: "Advisory affinity hint targeting a previously bound VS Code window.",
                    properties: {
                      targetMode: { const: "artifact-window" },
                      windowInstanceId: {
                        type: "string",
                        format: "uuid",
                        description: "Previously committed windowInstanceId for this artifact.",
                      },
                    },
                    required: ["targetMode", "windowInstanceId"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    description: "Explicit window targeting with selection token.",
                    properties: {
                      targetMode: { const: "explicit-window" },
                      selectionToken: {
                        type: "string",
                        format: "uuid",
                        description:
                          "Window selection token returned by resolve_artifact_window or an earlier WINDOW_SELECTION_REQUIRED response.",
                      },
                    },
                    required: ["targetMode", "selectionToken"],
                    additionalProperties: false,
                  },
                ],
              },
            },
            required: ["sessionId"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        {
          name: ADVANCE_AND_WAIT_TOOL_NAME,
          title: "Advance and wait for artifact review",
          description:
            "Consume a validated one-time round token, optionally replace the complete Markdown, advance and reset the artifact round transactionally, then wait for the next review. Omitting markdown preserves the artifact bytes and SHA. Return the next round's complete validated comments document at comments, with a process-review-feedback next action and new token for revise, an execute-approved-plan next action for an approved plan, or an approved next action for an approved non-plan.",
          inputSchema: {
            type: "object",
            properties: {
              artifactDirectory: { type: "string" },
              expectedReviewRound: { type: "integer", minimum: 1 },
              roundToken: { type: "string" },
              markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_BYTES },
              artifactConversationId: {
                type: "string",
                format: "uuid",
                description: "Optional active conversation UUID echoed back in the lifecycle result.",
              },
            },
            required: ["artifactDirectory", "expectedReviewRound", "roundToken"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        },
      ],
    });
    return;
  }
  if (method === "tools/call") {
    if (params?.name === RESOLVE_WINDOW_TOOL_NAME) {
      await handleResolveWindowTool(id, params?.arguments);
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
    if (params?.name === JOIN_SESSION_TOOL_NAME) {
      await handleJoinSessionTool(id, params?.arguments);
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
