import { createHash } from "node:crypto";
import { promises as fs, watch as watchFs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import {
  assertArtifactDirectory,
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
} from "../shared/artifact-validation";
import {
  ARTIFACT_SCHEMA_VERSION,
  type ReviewDecision,
} from "../shared/contracts";

const SERVER_NAME = "codex-artifacts";
const SERVER_VERSION = "2.0.0";
const TOOL_NAME = "wait_for_plan_review";
const SUBMISSION_FILE = "review-submission.json";

type JsonObject = Record<string, any>;

type ArtifactContext = {
  artifactDirectory: string;
  artifactId: string;
  workspaceRoot: string;
  threadId: string;
  planPath: string;
  commentsPath: string;
  submissionPath: string;
};

type ReviewWaitResult = {
  schemaVersion: 2;
  artifactId: string;
  workspaceRoot: string;
  threadId: string;
  decision: ReviewDecision;
  submittedAt: string;
  planPath: string;
  commentsPath: string;
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
  const manifestPath = path.join(artifactDirectory, "artifact.json");
  const planPath = path.join(artifactDirectory, "plan.md");
  const commentsPath = path.join(artifactDirectory, "comments.json");
  const [manifestRaw, plan, commentsRaw] = await Promise.all([
    readJson(manifestPath),
    fs.readFile(planPath, "utf8"),
    fs.readFile(commentsPath, "utf8"),
  ]);
  const manifest = parseArtifactManifest(manifestRaw);
  const threadId = manifest.origin.threadId;
  const codexCwd = manifest.origin.codexCwd;
  if (!threadId) throw new Error("The artifact is not linked to a Codex thread.");
  if (!codexCwd || !path.isAbsolute(codexCwd)) throw new Error("The artifact origin codexCwd is invalid.");
  const workspaceRoot = assertArtifactDirectory(manifest, artifactDirectory);
  parseBoundCommentsDocument(JSON.parse(commentsRaw), {
    artifactId: manifest.artifactId,
    planSha256: sha256(plan),
  });
  return {
    artifactDirectory,
    artifactId: manifest.artifactId,
    workspaceRoot,
    threadId,
    planPath,
    commentsPath,
    submissionPath: path.join(artifactDirectory, SUBMISSION_FILE),
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

  const [currentPlan, currentCommentsRaw] = await Promise.all([
    fs.readFile(context.planPath, "utf8"),
    fs.readFile(context.commentsPath, "utf8"),
  ]);
  const currentPlanSha256 = sha256(currentPlan);
  const currentComments = parseBoundCommentsDocument(JSON.parse(currentCommentsRaw), {
    artifactId: context.artifactId,
    planSha256: currentPlanSha256,
  });
  const submission = parseBoundReviewSubmission(rawSubmission, {
    artifactId: context.artifactId,
    threadId: context.threadId,
    planSha256: currentPlanSha256,
    commentsSha256: sha256(currentCommentsRaw),
  });
  if (submission.decision === "revise" && currentComments.comments.length === 0) {
    throw new Error("A revision request must include at least one comment.");
  }
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: context.artifactId,
    workspaceRoot: context.workspaceRoot,
    threadId: context.threadId,
    decision: submission.decision,
    submittedAt: submission.submittedAt,
    planPath: context.planPath,
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
    const onAbort = (): void => finish(Object.assign(new Error("Plan review wait was cancelled."), { name: "AbortError" }));
    const watcher = watchFs(context.artifactDirectory, { persistent: true }, (_event, filename) => {
      if (filename == null || String(filename) === SUBMISSION_FILE) void check();
    });
    watcher.on("error", (error) => finish(error));
    const interval = setInterval(() => void check(), 1000);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

const pending = new Map<string, AbortController>();

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

async function handleRequest(message: JsonObject): Promise<void> {
  const { id, method, params } = message;
  if (method === "initialize") {
    const protocolVersion = typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18";
    respond(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions: "Use wait_for_plan_review after creating and validating a Codex plan artifact. Keep the current turn open until the user requests a revision, approves the plan for implementation, or asks to save it without implementation.",
    });
    return;
  }
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools: [{
      name: TOOL_NAME,
      title: "Wait for plan review",
      description: "Wait for the user to review a Codex plan artifact in VS Code, then return a revision request, approval to implement, or a request to save without implementation. Call this immediately after validating the artifact and do not end the current turn first.",
      inputSchema: {
        type: "object",
        properties: {
          artifactDirectory: {
            type: "string",
            description: "Absolute path to .codex-artifacts/plans/<artifact-id>.",
          },
        },
        required: ["artifactDirectory"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }] });
    return;
  }
  if (method === "tools/call") {
    if (params?.name !== TOOL_NAME) {
      respond(id, { content: [{ type: "text", text: `Unknown tool: ${String(params?.name)}` }], isError: true });
      return;
    }
    const controller = new AbortController();
    pending.set(requestKey(id), controller);
    try {
      const context = await loadArtifactContext(params?.arguments?.artifactDirectory);
      const result = await waitForSubmission(context, controller.signal);
      respond(id, {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      });
    } catch (error) {
      respond(id, {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      });
    } finally {
      pending.delete(requestKey(id));
    }
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
