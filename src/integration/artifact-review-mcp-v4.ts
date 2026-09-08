import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs, watch as watchFs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  assertArtifactDirectory,
  artifactPaths,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
} from "../shared/artifact-validation";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactKindSchema,
  artifactManifestSchema,
  commentsDocumentSchema,
  type ArtifactManifest,
  type ReviewDecision,
} from "../shared/contracts";
import {
  ARTIFACT_COLLECTION_DIRECTORY,
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  ARTIFACTS_DIRECTORY,
  COMMENTS_FILE,
  REVIEW_SUBMISSION_FILE,
} from "../shared/artifact-files";
import {
  resolveRegisteredWorkspaceRoot,
  resolveWorkspaceCandidates,
  resolveWorkspaceRootForArtifactCreation,
  workspaceEvidenceSchema,
  type WorkspaceEvidence,
} from "../shared/workspace-registry";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = "6.0.0";
const RESOLVE_WORKSPACE_TOOL_NAME = "resolve_artifact_workspace";
const CREATE_TOOL_NAME = "create_artifact";
const WAIT_TOOL_NAME = "wait_for_artifact_review";
const INSPECT_TOOL_NAME = "inspect_artifact_review";
const ADVANCE_AND_WAIT_TOOL_NAME = "advance_and_wait_for_artifact";
const ROUND_TOKEN_TTL_MS = 60 * 60 * 1000;
const WORKSPACE_SELECTION_TTL_MS = 10 * 60 * 1000;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

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
  | "WORKSPACE_NOT_REGISTERED";

type ArtifactRecoveryMetadata = {
  code: ArtifactRecoveryCode;
  retryable: boolean;
  expectedNextTool?: typeof INSPECT_TOOL_NAME | typeof WAIT_TOOL_NAME | typeof ADVANCE_AND_WAIT_TOOL_NAME;
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

function recoveryError(
  code: ArtifactRecoveryCode,
  message: string,
  options: Omit<ArtifactRecoveryMetadata, "code" | "useSameArtifactHandle">,
): ArtifactRecoveryError {
  return new ArtifactRecoveryError(`${code}: ${message}`, { code, ...options });
}

function asLifecycleRecoveryError(error: unknown): unknown {
  if (error instanceof ArtifactRecoveryError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("WORKSPACE_NOT_REGISTERED:")) {
    return recoveryError("WORKSPACE_NOT_REGISTERED", message.slice("WORKSPACE_NOT_REGISTERED:".length).trim(), {
      retryable: true,
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

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function samePathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertNotSymlink(filePath: string): Promise<void> {
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink()) throw new Error("UNSAFE_ARTIFACT_PATH: symbolic links and junctions are not allowed in the artifact storage path.");
  if (!stat.isDirectory()) throw new Error("UNSAFE_ARTIFACT_PATH: artifact storage components must be directories.");
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  try {
    await assertNotSymlink(directory);
    return;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  try {
    await fs.mkdir(directory);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  await assertNotSymlink(directory);
}

async function safeArtifactCollectionRoot(workspaceRoot: string): Promise<string> {
  const artifactsDirectory = path.join(workspaceRoot, ARTIFACTS_DIRECTORY);
  const collectionDirectory = path.join(artifactsDirectory, ARTIFACT_COLLECTION_DIRECTORY);
  await ensureSafeDirectory(artifactsDirectory);
  await ensureSafeDirectory(collectionDirectory);
  const [workspaceRealPath, collectionRealPath] = await Promise.all([
    fs.realpath(workspaceRoot),
    fs.realpath(collectionDirectory),
  ]);
  if (!isPathInside(workspaceRealPath, collectionRealPath)) {
    throw new Error("UNSAFE_ARTIFACT_PATH: artifact storage resolves outside the registered workspace.");
  }
  return collectionRealPath;
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
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `${artifactSlug(title)}-${date}-${randomUUID().slice(0, 8)}`;
}

type CreateArtifactInput = {
  workspaceRoot: string;
  workspaceEvidence: WorkspaceEvidence;
  title: string;
  kind: string;
  markdown: string;
};

function parseCreateArguments(args: JsonObject | undefined): CreateArtifactInput {
  const workspaceRoot = args?.workspaceRoot;
  const workspaceEvidence = workspaceEvidenceSchema.safeParse(args?.workspaceEvidence);
  const title = args?.title;
  const kind = args?.kind;
  const markdown = args?.markdown;
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
  return { workspaceRoot, workspaceEvidence: workspaceEvidence.data, title: title.trim(), kind, markdown };
}

const workspaceSelectionGrants = new Map<string, WorkspaceSelectionGrant>();
const claimedWorkspaceSelectionTokens = new Set<string>();

function pruneWorkspaceSelectionGrants(): void {
  const now = Date.now();
  for (const [token, grant] of workspaceSelectionGrants) {
    if (grant.expiresAt <= now) workspaceSelectionGrants.delete(token);
  }
}

function workspaceCandidateId(workspaceRoot: string): string {
  return sha256(samePathKey(workspaceRoot)).slice(0, 16);
}

async function resolveCreateWorkspaceRoot(input: CreateArtifactInput): Promise<{
  workspaceRoot: string;
  selectionToken?: string;
}> {
  const evidence = input.workspaceEvidence;
  if (evidence.kind === "tagged-file") {
    return {
      workspaceRoot: await resolveWorkspaceRootForArtifactCreation(input.workspaceRoot, evidence),
    };
  }

  pruneWorkspaceSelectionGrants();
  if (claimedWorkspaceSelectionTokens.has(evidence.selectionToken)) {
    throw new Error("WORKSPACE_SELECTION_IN_USE: the selected workspace token is already being used.");
  }
  const grant = workspaceSelectionGrants.get(evidence.selectionToken);
  if (!grant) {
    throw new Error("WORKSPACE_SELECTION_EXPIRED: resolve the workspace again and choose a current candidate, asking the user only if the result is ambiguous.");
  }
  if (samePathKey(grant.workspaceRoot) !== samePathKey(input.workspaceRoot)) {
    throw new Error("WORKSPACE_EVIDENCE_MISMATCH: the selection token does not belong to workspaceRoot.");
  }
  const current = await resolveWorkspaceCandidates(grant.query);
  const candidateStillValid = current.candidates.some((candidate) => (
    workspaceCandidateId(candidate.path) === grant.candidateId
    && samePathKey(candidate.path) === samePathKey(grant.workspaceRoot)
  ));
  if (current.contextKey !== grant.contextKey || !candidateStillValid) {
    workspaceSelectionGrants.delete(evidence.selectionToken);
    throw new Error("WORKSPACE_SELECTION_EXPIRED: the workspace registry changed; resolve and select the workspace again.");
  }
  claimedWorkspaceSelectionTokens.add(evidence.selectionToken);
  try {
    return {
      workspaceRoot: await resolveWorkspaceRootForArtifactCreation(input.workspaceRoot, evidence),
      selectionToken: evidence.selectionToken,
    };
  } catch (error) {
    claimedWorkspaceSelectionTokens.delete(evidence.selectionToken);
    throw error;
  }
}

async function persistArtifact(input: CreateArtifactInput, workspaceRoot: string): Promise<ArtifactContext> {
  const collectionRoot = await safeArtifactCollectionRoot(workspaceRoot);
  const createdAt = new Date().toISOString();
  const reviewSessionId = randomUUID();

  for (let attempt = 0; attempt < 5; attempt++) {
    const artifactId = generatedArtifactId(input.title);
    const artifactDirectory = path.join(collectionRoot, artifactId);
    if (!isPathInside(collectionRoot, artifactDirectory) || samePathKey(path.dirname(artifactDirectory)) !== samePathKey(collectionRoot)) {
      throw new Error("UNSAFE_ARTIFACT_PATH: generated artifact directory escaped the collection root.");
    }
    try {
      await fs.mkdir(artifactDirectory);
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }

    const files = artifactPaths(artifactDirectory);
    try {
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
      await fs.writeFile(files.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_CREATE === "after-manifest") {
        throw new Error("Injected artifact creation failure after manifest write.");
      }
      await fs.writeFile(files.artifactPath, input.markdown, { encoding: "utf8", flag: "wx" });
      await fs.writeFile(files.commentsPath, `${JSON.stringify(comments, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return loadArtifactContext(artifactDirectory);
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

async function createArtifact(args: JsonObject | undefined): Promise<ArtifactContext> {
  const input = parseCreateArguments(args);
  const { workspaceRoot, selectionToken } = await resolveCreateWorkspaceRoot(input);
  try {
    const context = await persistArtifact(input, workspaceRoot);
    if (selectionToken) workspaceSelectionGrants.delete(selectionToken);
    return context;
  } finally {
    if (selectionToken) claimedWorkspaceSelectionTokens.delete(selectionToken);
  }
}

async function loadArtifactContext(rawDirectory: unknown): Promise<ArtifactContext> {
  if (typeof rawDirectory !== "string" || !path.isAbsolute(rawDirectory)) {
    throw new Error("artifactDirectory must be an absolute path.");
  }
  const artifactDirectory = path.resolve(rawDirectory);
  const files = artifactPaths(artifactDirectory);
  const [manifestRaw, markdown, commentsRaw] = await Promise.all([
    readJson(files.manifestPath),
    fs.readFile(files.artifactPath, "utf8"),
    fs.readFile(files.commentsPath, "utf8"),
  ]);
  const manifest = artifactManifestSchema.parse(manifestRaw);
  const workspaceRoot = assertArtifactDirectory(manifest, artifactDirectory);
  const registeredWorkspaceRoot = await resolveRegisteredWorkspaceRoot(workspaceRoot);
  if (samePathKey(registeredWorkspaceRoot) !== samePathKey(workspaceRoot)) {
    throw new Error("WORKSPACE_NOT_REGISTERED: the artifact workspace no longer matches its registered canonical path.");
  }
  const artifactSha256 = sha256(markdown);
  parseBoundCommentsDocument(JSON.parse(commentsRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    artifactSha256,
  });
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

async function readValidatedSubmission(context: ArtifactContext): Promise<ReviewWaitResult | undefined> {
  let submissionRaw: string;
  try {
    submissionRaw = await fs.readFile(context.submissionPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  const [currentMarkdown, currentCommentsRaw] = await Promise.all([
    fs.readFile(context.artifactPath, "utf8"),
    fs.readFile(context.commentsPath, "utf8"),
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
    threadId: undefined,
    artifactSha256: currentArtifactSha256,
    commentsSha256: currentCommentsSha256,
  });
  if (submission.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new Error("Legacy submissions cannot drive an MCP-owned lifecycle.");
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

async function readArtifactInspection(context: ArtifactContext): Promise<{
  markdown: string;
  comments: ReturnType<typeof parseBoundCommentsDocument>;
  artifactSha256: string;
  commentsSha256: string;
  submission?: ReturnType<typeof parseBoundReviewSubmission>;
  submissionSha256?: string;
}> {
  const [markdown, commentsRaw] = await Promise.all([
    fs.readFile(context.artifactPath, "utf8"),
    fs.readFile(context.commentsPath, "utf8"),
  ]);
  const artifactSha256 = sha256(markdown);
  const commentsSha256 = sha256(commentsRaw);
  const comments = parseBoundCommentsDocument(JSON.parse(commentsRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    artifactSha256,
  });

  let submissionRaw: string | undefined;
  try {
    submissionRaw = await fs.readFile(context.submissionPath, "utf8");
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (submissionRaw === undefined) return { markdown, comments, artifactSha256, commentsSha256 };

  const submission = parseBoundReviewSubmission(JSON.parse(submissionRaw), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    reviewSessionId: context.reviewSessionId,
    threadId: undefined,
    artifactSha256,
    commentsSha256,
  });
  if (submission.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error("Legacy submissions cannot drive an MCP-owned lifecycle.");
  }
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

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

type BackupMode = "renamed" | "copied";

function isWindowsReplaceBlock(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

async function backupTarget(target: string, backup: string): Promise<BackupMode> {
  try {
    if (
      process.env.NODE_ENV === "test"
      && process.env.CODEX_ARTIFACTS_TEST_LOCK_ARTIFACT === "1"
      && path.basename(target) === ARTIFACT_MARKDOWN_FILE
    ) {
      throw Object.assign(new Error("Injected Windows editor lock."), { code: "EPERM" });
    }
    await fs.rename(target, backup);
    return "renamed";
  } catch (error) {
    if (!isWindowsReplaceBlock(error)) throw error;
    await fs.copyFile(target, backup, constants.COPYFILE_EXCL);
    return "copied";
  }
}

async function commitReviewRound(
  context: ArtifactContext,
  markdown: string,
): Promise<{ manifest: ArtifactManifest; artifactSha256: string }> {
  if (!markdown.trim()) throw new Error("markdown must be non-empty.");
  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    throw new Error(`markdown exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
  }
  const transactionId = `${process.pid}-${Date.now()}-${randomUUID()}`;
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
  await fs.writeFile(lockPath, `${JSON.stringify({
    artifactId: context.artifactId,
    fromReviewRound: context.reviewRound,
    toReviewRound: nextManifest.reviewRound,
    startedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", flag: "wx" });

  const backupModes = new Map<number, BackupMode>();
  try {
    await Promise.all([
      fs.writeFile(staged[0]!, markdown, "utf8"),
      fs.writeFile(staged[1]!, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8"),
      fs.writeFile(staged[2]!, `${JSON.stringify(nextComments, null, 2)}\n`, "utf8"),
    ]);
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index]!;
      if (!await exists(target)) {
        if (index === 3) continue;
        throw new Error(`Artifact transaction target is missing: ${path.basename(target)}`);
      }
      backupModes.set(index, await backupTarget(target, backups[index]!));
    }
    if (process.env.NODE_ENV === "test" && process.env.CODEX_ARTIFACTS_TEST_FAIL_UPDATE === "after-backup") {
      throw new Error("Injected artifact update failure after backup.");
    }
    for (let index = 0; index < staged.length; index++) {
      if (backupModes.get(index) === "copied") await fs.copyFile(staged[index]!, targets[index]!);
      else await fs.rename(staged[index]!, targets[index]!);
    }
    const submissionIndex = targets.length - 1;
    if (backupModes.get(submissionIndex) === "copied") await fs.rm(targets[submissionIndex]!, { force: true });
    await Promise.all(backups.map((backup) => fs.rm(backup, { force: true }).catch(() => {})));
    return { manifest: nextManifest, artifactSha256: nextArtifactSha256 };
  } catch (error) {
    for (const index of [...backupModes.keys()].reverse()) {
      const backup = backups[index]!;
      if (await exists(backup).catch(() => false)) {
        if (backupModes.get(index) === "copied") await fs.copyFile(backup, targets[index]!).catch(() => {});
        else {
          await fs.rm(targets[index]!, { force: true }).catch(() => {});
          await fs.rename(backup, targets[index]!).catch(() => {});
        }
      }
    }
    throw error;
  } finally {
    await Promise.all(staged.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
    await fs.rm(lockPath, { force: true }).catch(() => {});
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

function grantSubmittedRound(context: ArtifactContext, result: ReviewWaitResult): ReviewWaitResult & { roundToken?: string; roundTokenSource?: "submitted-review" } {
  if (result.decision !== "revise") return result;
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
  return { ...result, roundToken, roundTokenSource: "submitted-review" };
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

function artifactHandle(context: ArtifactContext): JsonObject {
  return {
    artifactDirectory: context.artifactDirectory,
    artifactId: context.artifactId,
    artifactPath: context.artifactPath,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: context.artifactSha256,
    kind: context.manifest.kind,
    workspaceRoot: context.workspaceRoot,
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
    if (resolution.candidates.length === 0) {
      respond(id, toolResult({ status: "not-found", matchMode: "none", candidates: [] }));
      return;
    }
    const candidates = resolution.candidates.map((candidate) => {
      const candidateId = workspaceCandidateId(candidate.path);
      const selectionToken = randomUUID();
      const expiresAt = Date.now() + WORKSPACE_SELECTION_TTL_MS;
      workspaceSelectionGrants.set(selectionToken, {
        query: resolution.query,
        candidateId,
        workspaceRoot: candidate.path,
        contextKey: resolution.contextKey,
        expiresAt,
      });
      return {
        candidateId,
        name: candidate.name,
        path: candidate.path,
        match: candidate.match,
        selectionToken,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    });
    respond(id, toolResult({
      status: "selection-required",
      matchMode: resolution.matchMode,
      candidates,
    }));
  } catch (error) {
    respond(id, toolError(error));
  }
}

async function handleCreateTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  try {
    const context = await createArtifact(args);
    respond(id, toolResult(artifactHandle(context)));
  } catch (error) {
    respond(id, toolError(error));
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
    if (intent !== undefined && intent !== "explicit-chat-update") {
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
    const { roundToken, roundTokenSource } = grantInspectedRound(context, inspection, intent);
    respond(id, toolResult({
      ...artifactHandle(context),
      manifest: context.manifest,
      markdown: inspection.markdown,
      comments: inspection.comments,
      commentsSha256: inspection.commentsSha256,
      submission: inspection.submission,
      submissionSha256: inspection.submissionSha256,
      roundToken,
      ...(roundTokenSource ? { roundTokenSource } : {}),
    }));
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
    instructions: "Resolve the target workspace folder before reading project files or drafting new artifact content. With no user-tagged file, call resolve_artifact_workspace immediately using the user's exact workspace keyword; do not scan folders to normalize it first. The resolver operates within one uniquely identified VS Code workspace context. If that context contains one folder, it returns that folder with matchMode=matched and match=single-folder even when the query text differs. In a multi-root workspace, a query with no match returns every folder in that same context with matchMode=all-available. It never combines folders from different VS Code windows; WORKSPACE_CONTEXT_AMBIGUOUS requires the user to focus the intended window and retry. Select a uniquely high-confidence candidate from the returned names and paths; ask the user only when the result remains ambiguous. Create reviewable Markdown with create_artifact using only tagged-file evidence or a resolved-workspace selection token. The official skill always sends kind=implementation-plan. Retain the exact artifactDirectory handle, then call wait_for_artifact_review. Do not resolve the workspace again after creation. A cancelled waiter never ends or deletes the artifact. Treat comments returned by a Review submission and comments read through inspect_artifact_review with the same policy: answer questions visibly in chat before calling advance_and_wait_for_artifact, update Markdown only for requested changes, and omit markdown for question-only feedback. Do not add Review responses to the artifact. Pure reconnect uses wait on the exact handle and same round. For chat escape, inspect the exact handle with takeover=true. If intent or handle is ambiguous, ask the user before calling a lifecycle tool and never takeover speculatively. If inspection has no comments or submission, reattach with wait_for_artifact_review without advancing. When updating an artifact directly from chat on an empty round, inspect with takeover=true, expectedReviewRound, and intent=explicit-chat-update, then advance with replacement markdown. Follow structured recovery metadata on lifecycle errors, keep the same exact handle, and never replay when commit state is uncertain. When Proceed returns approve for kind plan or implementation-plan, obey nextAction and execute the complete approved plan immediately in the same turn; do not stop at acknowledgement or ask for another confirmation. Proceed ends only the review round, not the authorized execution. Just save ends the round without execution. Reconnect later by explicitly inspecting, advancing without markdown, and waiting again; reconnect must not repeat an already executed action. Never select the latest artifact from a workspace or infer an artifact handle from cwd.",
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
        description: "Read one uniquely scoped fresh VS Code workspace context and return workspace-folder name/path candidates for the user's exact keyword. Common separators such as spaces, hyphens, underscores, dots, and slashes are normalized. A one-folder context returns matchMode=matched with match=single-folder even when the query differs. In a multi-root context, no query match returns every folder in that context with matchMode=all-available. The resolver never combines different VS Code windows and returns WORKSPACE_CONTEXT_AMBIGUOUS when the registry cannot identify one unique context. This tool never mutates lifecycle files. The caller may choose one uniquely high-confidence candidate and should ask the user only when the result is ambiguous.",
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
        description: "Create a secure schema-v4 Markdown artifact inside a currently registered VS Code workspace folder and return its exact persistent handle without waiting.",
        inputSchema: {
          type: "object",
          properties: {
            workspaceRoot: { type: "string", description: "Absolute path of a workspace folder currently open in VS Code." },
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
        description: "Read the current manifest, Markdown, comments, optional submission, and validated hashes for an exact artifact. Takeover first cancels and drains its current waiter. Returns a one-time round token when saved feedback is present or when intent is explicit-chat-update.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1, description: "Expected current review round. Required when intent is explicit-chat-update." },
            takeover: { type: "boolean", default: false },
            intent: {
              type: "string",
              enum: ["explicit-chat-update"],
              description: "Specify explicit-chat-update when the user explicitly requests changes in chat on a round without saved comments.",
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
