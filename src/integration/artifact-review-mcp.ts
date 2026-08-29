import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs, watch as watchFs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  assertArtifactDirectory,
  artifactPaths,
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
} from "../shared/artifact-validation";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactManifestSchema,
  commentsDocumentSchema,
  type ArtifactManifest,
  type ReviewDecision,
} from "../shared/contracts";
import {
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  REVIEW_SUBMISSION_FILE,
} from "../shared/artifact-files";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = "3.0.0";
const WAIT_TOOL_NAME = "wait_for_artifact_review";
const UPDATE_TOOL_NAME = "update_artifact";
const UPDATE_TOKEN_TTL_MS = 60 * 60 * 1000;

type JsonObject = Record<string, any>;

type ArtifactContext = {
  artifactDirectory: string;
  artifactId: string;
  workspaceRoot: string;
  threadId: string;
  reviewRound: number;
  artifactSha256: string;
  manifest: ArtifactManifest;
  manifestPath: string;
  artifactPath: string;
  commentsPath: string;
  submissionPath: string;
};

type ReviewWaitResult = {
  schemaVersion: 3;
  artifactId: string;
  workspaceRoot: string;
  threadId: string;
  reviewRound: number;
  artifactSha256: string;
  decision: ReviewDecision;
  submittedAt: string;
  artifactPath: string;
  commentsPath: string;
};

type UpdateGrant = {
  artifactDirectory: string;
  artifactId: string;
  threadId: string;
  reviewRound: number;
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
  const manifest = parseArtifactManifest(manifestRaw);
  const threadId = manifest.origin.threadId;
  const codexCwd = manifest.origin.codexCwd;
  if (!threadId) throw new Error("The artifact is not linked to a Codex thread.");
  if (!codexCwd || !path.isAbsolute(codexCwd)) throw new Error("The artifact origin codexCwd is invalid.");
  const workspaceRoot = assertArtifactDirectory(manifest, artifactDirectory);
  const artifactSha256 = sha256(markdown);
  parseBoundCommentsDocument(JSON.parse(commentsRaw), {
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    artifactSha256,
  });
  return {
    artifactDirectory,
    artifactId: manifest.artifactId,
    workspaceRoot,
    threadId,
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
  const currentComments = parseBoundCommentsDocument(JSON.parse(currentCommentsRaw), {
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    artifactSha256: currentArtifactSha256,
  });
  const submission = parseBoundReviewSubmission(rawSubmission, {
    artifactId: context.artifactId,
    reviewRound: context.reviewRound,
    threadId: context.threadId,
    artifactSha256: currentArtifactSha256,
    commentsSha256: sha256(currentCommentsRaw),
  });
  if (submission.decision === "revise" && currentComments.comments.length === 0) {
    throw new Error("A review request must include at least one comment.");
  }
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    workspaceRoot: context.workspaceRoot,
    threadId: context.threadId,
    reviewRound: context.reviewRound,
    artifactSha256: currentArtifactSha256,
    decision: submission.decision,
    submittedAt: submission.submittedAt,
    artifactPath: context.artifactPath,
    commentsPath: context.commentsPath,
  };
}

async function waitForSubmission(context: ArtifactContext, signal: AbortSignal): Promise<ReviewWaitResult> {
  const existing = await readValidatedSubmission(context);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
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
      if (backupModes.get(index) === "copied") {
        await fs.copyFile(staged[index]!, targets[index]!);
      } else {
        await fs.rename(staged[index]!, targets[index]!);
      }
    }
    const submissionIndex = targets.length - 1;
    if (backupModes.get(submissionIndex) === "copied") {
      await fs.rm(targets[submissionIndex]!, { force: true });
    }
    await Promise.all(backups.map((backup) => fs.rm(backup, { force: true }).catch(() => {})));
    return { manifest: nextManifest, artifactSha256: nextArtifactSha256 };
  } catch (error) {
    for (const index of [...backupModes.keys()].reverse()) {
      const backup = backups[index]!;
      if (await exists(backup).catch(() => false)) {
        if (backupModes.get(index) === "copied") {
          await fs.copyFile(backup, targets[index]!).catch(() => {});
        } else {
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
  for (const [token, grant] of updateGrants) {
    if (grant.expiresAt <= now) updateGrants.delete(token);
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
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

async function handleWaitTool(id: unknown, args: JsonObject | undefined): Promise<void> {
  const controller = new AbortController();
  pending.set(requestKey(id), controller);
  try {
    const context = await loadArtifactContext(args?.artifactDirectory);
    const result = await waitForSubmission(context, controller.signal);
    if (result.decision !== "revise") {
      respond(id, toolResult(result));
      return;
    }
    pruneUpdateGrants();
    const updateToken = randomUUID();
    updateGrants.set(updateToken, {
      artifactDirectory: context.artifactDirectory,
      artifactId: context.artifactId,
      threadId: context.threadId,
      reviewRound: context.reviewRound,
      expiresAt: Date.now() + UPDATE_TOKEN_TTL_MS,
    });
    respond(id, toolResult({ ...result, updateToken }));
  } catch (error) {
    respond(id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
  } finally {
    pending.delete(requestKey(id));
  }
}

async function handleUpdateTool(id: unknown, args: JsonObject | undefined): Promise<void> {
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
      context.artifactDirectory !== grant.artifactDirectory
      || context.artifactId !== grant.artifactId
      || context.threadId !== grant.threadId
      || context.reviewRound !== grant.reviewRound
      || context.reviewRound !== expectedReviewRound
    ) {
      throw new Error("The artifact update token does not match the current review round.");
    }
    const submission = await readValidatedSubmission(context);
    if (!submission || submission.decision !== "revise") {
      throw new Error("The current artifact round was not submitted for Review.");
    }
    const updated = await commitReviewRound(context, markdown);
    updateGrants.delete(updateToken);
    respond(id, toolResult({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: context.artifactId,
      workspaceRoot: context.workspaceRoot,
      threadId: context.threadId,
      reviewRound: updated.manifest.reviewRound,
      artifactSha256: updated.artifactSha256,
      artifactPath: context.artifactPath,
      commentsPath: context.commentsPath,
    }));
  } catch (error) {
    respond(id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
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
      instructions: "Use wait_for_artifact_review after creating a reviewable artifact. On Review, use the returned one-time token with update_artifact to replace artifact.md in place and start the next review round in the same Codex turn.",
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
        name: WAIT_TOOL_NAME,
        title: "Wait for artifact review",
        description: "Wait for the user to review a Markdown artifact in VS Code, then return Review, Proceed, or Just save to the same Codex turn.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: {
              type: "string",
              description: "Absolute path to .codex-artifacts/artifacts/<artifact-id>.",
            },
          },
          required: ["artifactDirectory"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      {
        name: UPDATE_TOOL_NAME,
        title: "Update artifact review",
        description: "Transactionally update artifact.md for a submitted Review, reset comments, and advance the same artifact to its next review round, including when Windows blocks rename for an open editor.",
        inputSchema: {
          type: "object",
          properties: {
            artifactDirectory: { type: "string" },
            expectedReviewRound: { type: "integer", minimum: 1 },
            updateToken: { type: "string" },
            markdown: { type: "string", minLength: 1 },
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
    if (params?.name === WAIT_TOOL_NAME) {
      await handleWaitTool(id, params?.arguments);
      return;
    }
    if (params?.name === UPDATE_TOOL_NAME) {
      await handleUpdateTool(id, params?.arguments);
      return;
    }
    respond(id, { content: [{ type: "text", text: `Unknown tool: ${String(params?.name)}` }], isError: true });
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
