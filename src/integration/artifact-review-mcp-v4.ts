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
  resolveWorkspaceRootForArtifactCreation,
  workspaceEvidenceSchema,
  type WorkspaceEvidence,
} from "../shared/workspace-registry";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = "4.1.0";
const CREATE_AND_WAIT_TOOL_NAME = "create_and_wait_for_artifact";
const UPDATE_AND_WAIT_TOOL_NAME = "update_and_wait_for_artifact";
const UPDATE_TOKEN_TTL_MS = 60 * 60 * 1000;
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
};

type UpdateGrant = {
  artifactDirectory: string;
  artifactId: string;
  reviewSessionId: string;
  reviewRound: number;
  artifactSha256: string;
  commentsSha256: string;
  expiresAt: number;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function parseCreateArguments(args: JsonObject | undefined): {
  workspaceRoot: string;
  workspaceEvidence: WorkspaceEvidence;
  title: string;
  kind: string;
  markdown: string;
} {
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
      "WORKSPACE_EVIDENCE_REQUIRED: declare single-workspace, active-file, explicit-user-path, or explicit-user-folder evidence. Project markers and inferred folder names are not evidence.",
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

async function createArtifact(args: JsonObject | undefined): Promise<ArtifactContext> {
  const input = parseCreateArguments(args);
  const workspaceRoot = await resolveWorkspaceRootForArtifactCreation(
    input.workspaceRoot,
    input.workspaceEvidence,
  );
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
  let rawSubmission: unknown;
  try {
    rawSubmission = await readJson(context.submissionPath);
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
  const submission = parseBoundReviewSubmission(rawSubmission, {
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
  };
}

const activeArtifactWaiters = new Set<string>();

async function waitForSubmission(context: ArtifactContext, signal: AbortSignal): Promise<ReviewWaitResult> {
  const key = samePathKey(context.artifactDirectory);
  if (activeArtifactWaiters.has(key)) throw new Error("ARTIFACT_ALREADY_WAITING: another live tool call owns this artifact.");
  activeArtifactWaiters.add(key);
  try {
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
        signal.removeEventListener("abort", onAbort);
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
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  } finally {
    activeArtifactWaiters.delete(key);
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
const updateGrants = new Map<string, UpdateGrant>();

function pruneUpdateGrants(): void {
  const now = Date.now();
  for (const [token, grant] of updateGrants) if (grant.expiresAt <= now) updateGrants.delete(token);
}

function grantUpdate(context: ArtifactContext, result: ReviewWaitResult): ReviewWaitResult & { updateToken?: string } {
  if (result.decision !== "revise") return result;
  pruneUpdateGrants();
  const updateToken = randomUUID();
  updateGrants.set(updateToken, {
    artifactDirectory: context.artifactDirectory,
    artifactId: context.artifactId,
    reviewSessionId: context.reviewSessionId,
    reviewRound: context.reviewRound,
    artifactSha256: result.artifactSha256,
    commentsSha256: result.commentsSha256,
    expiresAt: Date.now() + UPDATE_TOKEN_TTL_MS,
  });
  return { ...result, updateToken };
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
  return {
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

async function handleCreateAndWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  try {
    const context = await createArtifact(args);
    const result = await waitForSubmission(context, controller.signal);
    respond(id, toolResult(grantUpdate(context, result)));
  } catch (error) {
    respond(id, toolError(error));
  } finally {
    pending.delete(requestKey(id));
  }
}

async function handleUpdateAndWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  try {
    pruneUpdateGrants();
    const artifactDirectory = args?.artifactDirectory;
    const expectedReviewRound = args?.expectedReviewRound;
    const updateToken = args?.updateToken;
    const markdown = args?.markdown;
    if (typeof updateToken !== "string" || !updateToken) throw new Error("updateToken is required.");
    if (!Number.isInteger(expectedReviewRound) || expectedReviewRound < 1) {
      throw new Error("expectedReviewRound must be a positive integer.");
    }
    if (typeof markdown !== "string" || !markdown.trim()) throw new Error("markdown must be non-empty.");
    const grant = updateGrants.get(updateToken);
    if (!grant) throw new Error("The artifact update token is invalid or expired.");
    const context = await loadArtifactContext(artifactDirectory);
    if (
      samePathKey(context.artifactDirectory) !== samePathKey(grant.artifactDirectory)
      || context.artifactId !== grant.artifactId
      || context.reviewSessionId !== grant.reviewSessionId
      || context.reviewRound !== grant.reviewRound
      || context.reviewRound !== expectedReviewRound
    ) {
      throw new Error("The artifact update token does not match the current review round.");
    }
    const submission = await readValidatedSubmission(context);
    if (!submission || submission.decision !== "revise") {
      throw new Error("The current artifact round was not submitted for Review.");
    }
    if (
      submission.artifactSha256 !== grant.artifactSha256
      || submission.commentsSha256 !== grant.commentsSha256
    ) {
      throw new Error("The artifact update token no longer matches the reviewed content.");
    }
    await commitReviewRound(context, markdown);
    updateGrants.delete(updateToken);
    const updatedContext = await loadArtifactContext(context.artifactDirectory);
    const result = await waitForSubmission(updatedContext, controller.signal);
    respond(id, toolResult(grantUpdate(updatedContext, result)));
  } catch (error) {
    respond(id, toolError(error));
  } finally {
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
      instructions: "Create reviewable Markdown with create_and_wait_for_artifact only after supplying typed workspace evidence; project markers, cwd, and folder order are not evidence. On Review, replace Review responses with answers only for the immediately preceding comment round, then use the returned one-time token with update_and_wait_for_artifact. When Proceed returns approve for kind implementation-plan, implement the approved plan immediately in the same turn. Both lifecycle tools keep the originating Codex turn waiting for the next user decision.",
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
        name: CREATE_AND_WAIT_TOOL_NAME,
        title: "Create and wait for artifact review",
        description: "Create a secure Markdown artifact inside a currently registered VS Code workspace folder after validating typed ownership evidence, then wait for Review, Proceed, or Just save in the same Codex turn.",
        inputSchema: {
          type: "object",
          properties: {
            workspaceRoot: { type: "string", description: "Absolute path of a workspace folder currently open in VS Code." },
            workspaceEvidence: {
              description: "Why this exact workspace belongs to the request. Project files, package.json, cwd, and folder order are not evidence.",
              oneOf: [
                {
                  type: "object",
                  properties: { kind: { const: "single-workspace" } },
                  required: ["kind"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "active-file" },
                    filePath: { type: "string", description: "Concrete active file path supplied by IDE context." },
                  },
                  required: ["kind", "filePath"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "explicit-user-path" },
                    path: { type: "string", description: "Existing absolute path explicitly supplied by the user." },
                    userText: { type: "string", minLength: 1, maxLength: 500, description: "Exact relevant text from the user's message." },
                  },
                  required: ["kind", "path", "userText"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "explicit-user-folder" },
                    userText: { type: "string", minLength: 1, maxLength: 500, description: "Exact user text naming one registered workspace folder." },
                  },
                  required: ["kind", "userText"],
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
        name: UPDATE_AND_WAIT_TOOL_NAME,
        title: "Update and wait for artifact review",
        description: "Transactionally update the same reviewed artifact with a one-time token, advance its round, then wait for the next decision in the same Codex turn.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1 },
            updateToken: { type: "string" },
            markdown: { type: "string", minLength: 1, maxLength: MAX_MARKDOWN_BYTES },
          },
          required: ["artifactDirectory", "expectedReviewRound", "updateToken", "markdown"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
    ] });
    return;
  }
  if (method === "tools/call") {
    if (params?.name === CREATE_AND_WAIT_TOOL_NAME) {
      await handleCreateAndWaitTool(id, params?.arguments);
      return;
    }
    if (params?.name === UPDATE_AND_WAIT_TOOL_NAME) {
      await handleUpdateAndWaitTool(id, params?.arguments);
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
    pending.get(requestKey(request.params?.requestId))?.abort();
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
