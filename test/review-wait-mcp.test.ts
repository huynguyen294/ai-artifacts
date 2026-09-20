import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, chmod, copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import {
  ARTIFACTS_DIRECTORY,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import { ARTIFACT_SCHEMA_VERSION } from "../src/shared/contracts";

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const initialMarkdown = "# Artifact\n\nBuild the MCP review bridge.\n";

type TrackedRequest = { id: number; promise: Promise<any>; sent: Promise<void> };
type TestClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  requestTracked: (method: string, params?: Record<string, unknown>) => TrackedRequest;
  notify: (method: string, params?: Record<string, unknown>) => void;
  stop: () => void;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.test-${randomUUID()}`;
  await writeFile(temporaryPath, value, "utf8");
  try {
    await rename(temporaryPath, filePath);
  } catch (error: any) {
    if (error?.code !== "EPERM" && error?.code !== "EACCES" && error?.code !== "EBUSY" && error?.code !== "EXDEV") {
      throw error;
    }
    await copyFile(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function waitUntil<T>(read: () => Promise<T | undefined>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for MCP filesystem state.");
}

async function workspaceFixture(options: { stale?: boolean; folderName?: string } = {}): Promise<{
  workspace: string;
  registry: string;
  userHome: string;
  globalRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "ai-artifacts-mcp-v7-"));
  temporaryDirectories.push(root);
  const workspace = path.join(root, options.folderName ?? "workspace");
  const registry = path.join(root, "registry");
  const userHome = path.join(root, "home");
  await Promise.all([mkdir(workspace), mkdir(registry), mkdir(userHome)]);
  const now = Date.now();
  const instanceId = randomUUID();
  await writeFile(path.join(registry, `${instanceId}.json`), `${JSON.stringify({
    schemaVersion: 2,
    instanceId,
    processId: process.pid,
    workspaceFile: null,
    focused: true,
    folders: [{ path: workspace, realPath: await realpath(workspace) }],
    activeFile: null,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(options.stale ? now - 1_000 : now + 60_000).toISOString(),
  }, null, 2)}\n`, "utf8");
  return { workspace, registry, userHome, globalRoot: globalArtifactsRoot({ userHome }) };
}

function startClient(registry: string, extraEnvironment: NodeJS.ProcessEnv = {}): TestClient {
  const script = path.resolve("dist", "integration", "codex-artifacts-review-mcp.mjs");
  const userHome = path.join(path.dirname(registry), "home");
  const processHandle = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_USER_HOME: userHome,
      ...extraEnvironment,
      CODEX_ARTIFACTS_REGISTRY_DIRECTORY: registry,
    },
  });
  processes.push(processHandle);
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  createInterface({ input: processHandle.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  processHandle.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`MCP server exited with ${code}`));
    pending.clear();
  });
  const requestTracked = (method: string, params: Record<string, unknown> = {}): TrackedRequest => {
    const id = nextId++;
    let markSent = (): void => {};
    const sent = new Promise<void>((resolve) => { markSent = resolve; });
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, markSent);
    });
    return { id, promise, sent };
  };
  return {
    request(method, params = {}) {
      return requestTracked(method, params).promise;
    },
    requestTracked,
    notify(method, params = {}) {
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    stop() {
      processHandle.kill();
    },
  };
}

async function initialize(client: TestClient): Promise<void> {
  const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
  expect(initialized.serverInfo.version).toBe("9.0.0");
  expect(initialized.instructions).toContain("resolve_artifact_window");
  expect(initialized.instructions).toContain("create_artifact");
  expect(initialized.instructions).toContain("inspect_artifact_review");
  expect(initialized.instructions).toContain("Treat comments returned by a Review submission");
  expect(initialized.instructions).toContain("Do not add Review responses to the artifact");
  expect(initialized.instructions).toContain("execute the complete approved plan immediately");
  expect(initialized.instructions).toContain("Pure reconnect uses inspect_artifact_review with intent=reconnect");
  expect(initialized.instructions).toContain("After creation, use only the exact returned artifactDirectory");
  expect(initialized.instructions).toContain("Never scan global artifact storage or a workspace");
  expect(initialized.instructions).not.toContain("resolve_artifact_workspace");
  expect(initialized.instructions).not.toContain("latest artifact from a workspace");
  client.notify("notifications/initialized");
}

async function callTool(client: TestClient, name: string, args: Record<string, unknown>): Promise<any> {
  return client.request("tools/call", { name, arguments: args });
}

function callToolTracked(client: TestClient, name: string, args: Record<string, unknown>): TrackedRequest {
  return client.requestTracked("tools/call", { name, arguments: args });
}

async function taggedEvidence(workspace: string): Promise<{ kind: "tagged-file"; filePath: string }> {
  const filePath = path.join(workspace, "AGENTS.md");
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, "# Workspace\n", "utf8");
  }
  return { kind: "tagged-file", filePath };
}

async function createArtifact(
  client: TestClient,
  _workspace?: string,
  options: { title?: string; kind?: string; markdown?: string; connection?: Record<string, unknown> } = {},
): Promise<Record<string, any>> {
  const args: Record<string, unknown> = {
    title: options.title ?? "MCP bridge",
    kind: options.kind ?? "implementation-plan",
    markdown: options.markdown ?? initialMarkdown,
  };
  if (options.connection) {
    args.connection = options.connection;
  }
  const result = await callTool(client, "create_artifact", args);
  expect(result.isError).not.toBe(true);
  return result.structuredContent;
}

async function waitForRound(artifactDirectory: string, reviewRound: number): Promise<Record<string, any>> {
  return waitUntil(async () => {
    try {
      const [manifestRaw, commentsRaw] = await Promise.all([
        readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
        readFile(path.join(artifactDirectory, "comments.json"), "utf8"),
      ]);
      const manifest = JSON.parse(manifestRaw);
      const comments = JSON.parse(commentsRaw);
      try {
        await access(path.join(artifactDirectory, ".artifact-update.lock"));
        return undefined;
      } catch {
        return manifest.reviewRound === reviewRound && comments.reviewRound === reviewRound ? manifest : undefined;
      }
    } catch {
      return undefined;
    }
  });
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function expectNoTransactionResidue(artifactDirectory: string): Promise<void> {
  const entries = await readdir(artifactDirectory);
  expect(entries.filter((entry) => (
    entry === ".artifact-update.lock"
    || entry.includes(".next-")
    || entry.includes(".previous-")
  ))).toEqual([]);
}

function comment(body: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    block: { id: "paragraph-001", type: "paragraph", heading: null },
    selection: { quote: "review bridge", start: 14, end: 27, prefix: "Build the MCP ", suffix: "." },
    body,
  };
}

async function writeComments(artifactDirectory: string, bodies: string[]): Promise<string> {
  const [manifestRaw, markdown] = await Promise.all([
    readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
    readFile(path.join(artifactDirectory, "artifact.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const commentsRaw = `${JSON.stringify({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    artifactSha256: sha256(markdown),
    comments: bodies.map(comment),
  }, null, 2)}\n`;
  await atomicWrite(path.join(artifactDirectory, "comments.json"), commentsRaw);
  return commentsRaw;
}

async function submitDecision(
  artifactDirectory: string,
  decision: "revise" | "approve" | "save",
  bodies: string[] = decision === "revise" ? ["Add recovery behavior."] : [],
): Promise<void> {
  const commentsRaw = await writeComments(artifactDirectory, bodies);
  const submissionRaw = await createSubmissionDocument(artifactDirectory, decision, commentsRaw);
  await atomicWrite(path.join(artifactDirectory, "review-submission.json"), submissionRaw);
}

async function createSubmissionDocument(
  artifactDirectory: string,
  decision: "revise" | "approve" | "save",
  commentsRaw: string,
): Promise<string> {
  const [manifestRaw, markdown] = await Promise.all([
    readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
    readFile(path.join(artifactDirectory, "artifact.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  return `${JSON.stringify({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    reviewSessionId: manifest.reviewSessionId,
    submittedAt: new Date().toISOString(),
    decision,
    artifactSha256: sha256(markdown),
    commentsSha256: sha256(commentsRaw),
  }, null, 2)}\n`;
}

async function cancelAndRead(client: TestClient, tracked: TrackedRequest): Promise<any> {
  client.notify("notifications/cancelled", { requestId: tracked.id });
  return tracked.promise;
}

afterEach(async () => {
  for (const processHandle of processes.splice(0)) processHandle.kill();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact review MCP server v8", () => {
  it("lists the resolver plus four lifecycle tools and creates a detached schema-v6 global artifact immediately", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const tools = await client.request("tools/list");
    expect(tools.tools.map((tool: any) => tool.name)).toEqual([
      "resolve_artifact_window",
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact_review",
      "advance_and_wait_for_artifact",
    ]);
    const createTool = tools.tools.find((tool: any) => tool.name === "create_artifact");
    expect(createTool.description).toContain("schema-v6");
    expect(createTool.description).toContain("global AI Artifacts storage");
    expect(createTool.description).not.toContain("schema-v5");
    expect(createTool.inputSchema.additionalProperties).toBe(false);
    expect(createTool.inputSchema.properties).not.toHaveProperty("workspaceRoot");
    expect(createTool.inputSchema.properties).not.toHaveProperty("workspaceEvidence");
    expect(createTool.inputSchema.required).toEqual(expect.arrayContaining([
      "title",
      "kind",
      "markdown",
    ]));
    const createWindowTokenDescription = createTool.inputSchema.properties.connection.properties.selectionToken.description;
    expect(createWindowTokenDescription).toContain("WINDOW_SELECTION_REQUIRED response");
    expect(createWindowTokenDescription).not.toContain("resolve_artifact_workspace");
    const inspectTool = tools.tools.find((tool: any) => tool.name === "inspect_artifact_review");
    const connectionOneOf = inspectTool.inputSchema.properties.connection.oneOf;
    expect(connectionOneOf).toBeDefined();
    const explicitVariant = connectionOneOf.find((variant: any) => variant.properties?.targetMode?.const === "explicit-window");
    const affinityVariant = connectionOneOf.find((variant: any) => variant.properties?.targetMode?.const === "artifact-window");
    expect(explicitVariant).toBeDefined();
    expect(affinityVariant).toBeDefined();
    expect(affinityVariant.properties.windowInstanceId.format).toBe("uuid");
    const reconnectTokenDescription = explicitVariant.properties.selectionToken.description;
    expect(reconnectTokenDescription).toContain("WINDOW_SELECTION_REQUIRED response");
    expect(reconnectTokenDescription).not.toContain("resolve_artifact_workspace");

    const created = await createArtifact(client, fixture.workspace);
    expect(created).toMatchObject({
      reviewRound: 1,
      kind: "implementation-plan",
    });
    expect(path.dirname(created.artifactDirectory)).toBe(await realpath(fixture.globalRoot));
    await expect(access(path.join(fixture.workspace, ARTIFACTS_DIRECTORY))).rejects.toThrow();
    expect(created.artifactSha256).toBe(sha256(initialMarkdown));
    expect(created.artifactUrl).toMatch(/^file:\/\/\/.+\/artifact\.md$/);
    expect(created.artifactLink).toBe(`[MCP bridge](${created.artifactUrl})`);
    expect(await readdir(created.artifactDirectory)).toEqual(expect.arrayContaining([
      "artifact.json",
      "artifact.md",
      "comments.json",
      "artifact-connection.json",
    ]));
    const manifest = JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"));
    expect(manifest).toMatchObject({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: created.artifactId,
    });
    expect(manifest).not.toHaveProperty("location");
    if (process.platform !== "win32") {
      expect((await stat(created.artifactDirectory)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
      for (const fileName of ["artifact.json", "artifact.md", "comments.json", "artifact-connection.json"]) {
        expect((await stat(path.join(created.artifactDirectory, fileName))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      }
    }
    await expect(access(path.join(created.artifactDirectory, "review-submission.json"))).rejects.toThrow();
  });

  it("round-trips an MCP-created artifact through the Extension Store and back to the MCP waiter", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Cross-component review" });
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });

    const initial = await store.load();
    expect(initial.artifact).toMatchObject({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: created.artifactId,
      reviewRound: 1,
      reviewSessionId: created.reviewSessionId,
    });
    expect(initial.artifact).not.toHaveProperty("location");
    const paragraph = initial.blocks.find((block) => block.type === "paragraph");
    expect(paragraph).toBeDefined();
    const quote = "review bridge";
    const start = paragraph!.text.indexOf(quote);
    expect(start).toBeGreaterThanOrEqual(0);
    const commented = await store.addComment({
      blockId: paragraph!.id,
      selection: { quote, start, end: start + quote.length },
      body: "Add recovery behavior.",
    });
    expect(commented.comments.comments).toHaveLength(1);

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    const submitted = await store.submitReview("revise");
    expect(submitted.submission).toMatchObject({
      artifactId: created.artifactId,
      reviewRound: 1,
      reviewSessionId: created.reviewSessionId,
      decision: "revise",
    });

    const reviewed = await waiting.promise;
    const commentsRaw = await readFile(path.join(created.artifactDirectory, "comments.json"), "utf8");
    expect(reviewed.structuredContent).toMatchObject({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: created.artifactId,
      reviewSessionId: created.reviewSessionId,
      reviewRound: 1,
      artifactSha256: sha256(initialMarkdown),
      commentsSha256: sha256(commentsRaw),
      decision: "revise",
      roundToken: expect.any(String),
    });

    const replacement = "# Artifact\n\nBuild the MCP review bridge with recovery behavior.\n";
    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: reviewed.structuredContent.roundToken,
      markdown: replacement,
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);

    const round2 = await store.load();
    expect(round2.artifact).toMatchObject({
      artifactId: created.artifactId,
      reviewRound: 2,
      reviewSessionId: created.reviewSessionId,
    });
    expect(round2.artifact).not.toHaveProperty("location");
    expect(round2.markdown).toBe(replacement);
    expect(round2.comments).toMatchObject({
      reviewRound: 2,
      artifactSha256: sha256(replacement),
      comments: [],
    });
    expect(round2.submission).toBeUndefined();
    expect((await cancelAndRead(client, advancing)).isError).toBe(true);
  });

  it("rejects an MCP artifact when the Extension Store is configured for another global root", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Root mismatch" });
    const otherUserHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-other-home-"));
    temporaryDirectories.push(otherUserHome);
    const otherGlobalRoot = globalArtifactsRoot({ userHome: otherUserHome });
    const store = new ArtifactStore(created.artifactPath, { userHome: otherUserHome });

    await expect(store.load()).rejects.toThrow("direct child of the collection root");
    await expect(access(otherGlobalRoot)).rejects.toThrow();
  });

  it("makes both producer and consumer reject a cross-boundary schema mismatch", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Schema mismatch" });
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    const manifestPath = path.join(created.artifactDirectory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, `${JSON.stringify({ ...manifest, schemaVersion: 4 }, null, 2)}\n`, "utf8");

    await expect(store.load()).rejects.toThrow("supports version 6");
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("supports version 6");
  });

  it("makes both producer and consumer reject a cross-boundary round mismatch", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Round mismatch" });
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    const commentsPath = path.join(created.artifactDirectory, "comments.json");
    const comments = JSON.parse(await readFile(commentsPath, "utf8"));
    await writeFile(commentsPath, `${JSON.stringify({ ...comments, reviewRound: 2 }, null, 2)}\n`, "utf8");

    await expect(store.load()).rejects.toThrow("current artifact review round");
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("current artifact review round");
  });

  it("makes both producer and consumer reject a cross-boundary artifact hash mismatch", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Hash mismatch" });
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    await writeFile(created.artifactPath, `${initialMarkdown}\nChanged outside the lifecycle.\n`, "utf8");

    await expect(store.load()).rejects.toThrow("outside the artifact review update protocol");
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("outside the artifact review update protocol");
  });

  it("makes both producer and consumer reject a cross-boundary review-session mismatch", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Session mismatch" });
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    await store.submitReview("approve");
    const submissionPath = path.join(created.artifactDirectory, "review-submission.json");
    const submission = JSON.parse(await readFile(submissionPath, "utf8"));
    await writeFile(submissionPath, `${JSON.stringify({
      ...submission,
      reviewSessionId: "22222222-2222-4222-8222-222222222222",
    }, null, 2)}\n`, "utf8");

    await expect(store.load()).rejects.toThrow("does not belong to this artifact lifecycle");
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("does not belong to this artifact lifecycle");
  });

  it("preserves the default create, wait, Review, advance, and wait flow", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace);
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await submitDecision(created.artifactDirectory, "revise");
    const reviewed = await waiting.promise;
    expect(reviewed.structuredContent).toMatchObject({ decision: "revise", reviewRound: 1 });
    expect(reviewed.structuredContent.roundToken).toEqual(expect.any(String));
    expect(reviewed.structuredContent.artifactUrl).toMatch(/^file:\/\/\/.+\/artifact\.md$/);
    expect(reviewed.structuredContent.artifactLink).toBe(`[MCP bridge](${reviewed.structuredContent.artifactUrl})`);

    const replacement = "# Artifact\n\nBuild the bridge with recovery behavior.\n";
    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: reviewed.structuredContent.roundToken,
      markdown: replacement,
    });
    await advancing.sent;
    const round2 = await waitForRound(created.artifactDirectory, 2);
    expect(round2.reviewSessionId).toBe(created.reviewSessionId);
    expect(await readFile(created.artifactPath, "utf8")).toBe(replacement);
    await expect(access(path.join(created.artifactDirectory, "review-submission.json"))).rejects.toThrow();
    await submitDecision(created.artifactDirectory, "approve");
    const approved = await advancing.promise;
    expect(approved.structuredContent).toMatchObject({
      decision: "approve",
      reviewRound: 2,
      nextAction: {
        type: "execute-approved-plan",
        instruction: expect.stringContaining("Execute the approved plan immediately in this same turn"),
      },
    });
    expect(approved.structuredContent.roundToken).toBeUndefined();

    const replay = await callTool(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: reviewed.structuredContent.roundToken,
    });
    expect(replay.isError).toBe(true);
    expect(replay.structuredContent).toMatchObject({
      code: "ROUND_TOKEN_ALREADY_CONSUMED",
      expectedNextTool: "inspect_artifact_review",
      reuseRoundToken: false,
      useSameArtifactHandle: true,
    });
  });

  it.each(["plan", "implementation-plan"])(
    "returns an immediate execution directive when Proceed approves a %s",
    async (kind) => {
      const fixture = await workspaceFixture();
      const client = startClient(fixture.registry);
      await initialize(client);
      const created = await createArtifact(client, fixture.workspace, {
        title: `Approved ${kind}`,
        kind,
      });
      const waiting = callToolTracked(client, "wait_for_artifact_review", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
      });
      await waiting.sent;
      await submitDecision(created.artifactDirectory, "approve");
      const approved = await waiting.promise;
      expect(approved.isError, approved.content?.[0]?.text).not.toBe(true);
      expect(approved.structuredContent).toMatchObject({
        decision: "approve",
        kind,
        nextAction: {
          type: "execute-approved-plan",
          instruction: expect.stringContaining("Perform all in-scope code, file, workspace, and command actions"),
        },
      });
    },
  );

  it("cancels only the waiter and can attach again to the same artifact round", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Cancelled waiter" });
    const firstWait = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await firstWait.sent;
    const cancelled = await cancelAndRead(client, firstWait);
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content[0].text).toContain("cancelled");
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });

    const secondWait = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await secondWait.sent;
    await submitDecision(created.artifactDirectory, "save");
    expect((await secondWait.promise).structuredContent).toMatchObject({ decision: "save", reviewRound: 1 });

    const reconnectInspection = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
    });
    expect(reconnectInspection.structuredContent).toMatchObject({
      reviewRound: 1,
      submission: { decision: "save" },
      roundToken: expect.any(String),
    });
    const reconnecting = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: reconnectInspection.structuredContent.roundToken,
    });
    await reconnecting.sent;
    await waitForRound(created.artifactDirectory, 2);
    expect(await readFile(created.artifactPath, "utf8")).toBe(initialMarkdown);
    expect((await cancelAndRead(client, reconnecting)).isError).toBe(true);
  });

  it("uses takeover to inspect comments without a submission, then advances unchanged Markdown", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Chat escape" });
    const oldWait = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await oldWait.sent;
    await writeComments(created.artifactDirectory, ["How does reconnect work?"]);
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      takeover: true,
    });
    expect((await oldWait.promise).isError).toBe(true);
    expect(inspected.structuredContent.comments.comments).toHaveLength(1);
    expect(inspected.structuredContent.submission).toBeUndefined();
    expect(inspected.structuredContent.roundToken).toEqual(expect.any(String));

    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);
    expect(await readFile(created.artifactPath, "utf8")).toBe(initialMarkdown);
    const comments = JSON.parse(await readFile(path.join(created.artifactDirectory, "comments.json"), "utf8"));
    expect(comments).toMatchObject({ reviewRound: 2, artifactSha256: created.artifactSha256, comments: [] });
    expect((await cancelAndRead(client, advancing)).isError).toBe(true);
  });

  it("does not grant a token when inspection has no feedback and permits reattachment to the same round", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "No comments" });
    const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    expect(inspected.structuredContent.roundToken).toBeUndefined();
    expect(inspected.structuredContent.artifactUrl).toMatch(/^file:\/\/\/.+\/artifact\.md$/);
    expect(inspected.structuredContent.artifactLink).toBe(`[No comments](${inspected.structuredContent.artifactUrl})`);
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await submitDecision(created.artifactDirectory, "approve");
    const approved = await waiting.promise;
    expect(approved.isError, approved.content?.[0]?.text).not.toBe(true);
    expect(approved.structuredContent).toMatchObject({ decision: "approve", reviewRound: 1 });
  });

  it("keeps waiting while a submission file is transiently incomplete", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Transient submission" });
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await new Promise((resolve) => setTimeout(resolve, 50));

    let settled = false;
    void waiting.promise.then(() => { settled = true; });
    await writeFile(path.join(created.artifactDirectory, "review-submission.json"), Buffer.alloc(256));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);

    await submitDecision(created.artifactDirectory, "approve");
    expect((await waiting.promise).structuredContent).toMatchObject({
      decision: "approve",
      reviewRound: 1,
    });
  });

  it("attaches a waiter while comments are transiently incomplete", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Transient attach" });
    await writeFile(path.join(created.artifactDirectory, "comments.json"), Buffer.alloc(256));

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    let settled = false;
    void waiting.promise.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);

    await submitDecision(created.artifactDirectory, "approve");
    expect((await waiting.promise).structuredContent).toMatchObject({
      decision: "approve",
      reviewRound: 1,
    });
  });

  it("keeps waiting while comments are transiently incomplete beside a complete submission", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Transient comments" });
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const validCommentsRaw = await writeComments(created.artifactDirectory, []);
    const validSubmissionRaw = await createSubmissionDocument(
      created.artifactDirectory,
      "approve",
      validCommentsRaw,
    );
    let settled = false;
    void waiting.promise.then(() => { settled = true; });
    await writeFile(path.join(created.artifactDirectory, "comments.json"), Buffer.alloc(256));
    await atomicWrite(path.join(created.artifactDirectory, "review-submission.json"), validSubmissionRaw);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);

    await atomicWrite(path.join(created.artifactDirectory, "comments.json"), validCommentsRaw);
    expect((await waiting.promise).structuredContent).toMatchObject({
      decision: "approve",
      reviewRound: 1,
    });
  });

  it("fails closed after bounded retries for a persistently malformed submission", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Malformed submission" });
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await new Promise((resolve) => setTimeout(resolve, 50));

    await writeFile(path.join(created.artifactDirectory, "review-submission.json"), "{not-json", "utf8");
    const result = await waiting.promise;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("JSON");
  });

  it("returns structured recovery instead of advancing while the artifact already has a waiter", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Active waiter recovery" });
    await writeComments(created.artifactDirectory, ["Keep this round waiting."]);
    const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;

    const duplicateWait = await callTool(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(duplicateWait.structuredContent).toMatchObject({
      code: "ARTIFACT_ALREADY_WAITING",
      reuseRoundToken: false,
      currentReviewRound: 1,
    });
    const blockedAdvance = await callTool(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
    });
    expect(blockedAdvance.structuredContent).toMatchObject({
      code: "ARTIFACT_ALREADY_WAITING",
      reuseRoundToken: false,
      currentReviewRound: 1,
    });

    await submitDecision(created.artifactDirectory, "approve", ["Keep this round waiting."]);
    expect((await waiting.promise).structuredContent.decision).toBe("approve");
  });

  it("validates arguments when intent is explicit-chat-update", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Validate intent" });

    const missingRound = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "explicit-chat-update",
    });
    expect(missingRound.isError).toBe(true);
    expect(missingRound.content[0].text).toContain("expectedReviewRound is required when intent is explicit-chat-update");

    const invalidIntent = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "unknown-intent",
    });
    expect(invalidIntent.isError).toBe(true);
    expect(invalidIntent.content[0].text).toContain("Invalid intent");

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    const wrongRound = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      takeover: true,
      intent: "explicit-chat-update",
      expectedReviewRound: 2,
    });
    expect(wrongRound.isError).toBe(true);
    expect(wrongRound.content[0].text).toContain("at review round 1, not 2");
    expect(wrongRound.structuredContent).toMatchObject({
      code: "ROUND_MISMATCH",
      expectedNextTool: "inspect_artifact_review",
      reuseRoundToken: false,
      currentReviewRound: 1,
    });
    await submitDecision(created.artifactDirectory, "approve");
    expect((await waiting.promise).structuredContent).toMatchObject({ decision: "approve", reviewRound: 1 });
  });

  it("rejects explicit-chat-update when the round has saved comments", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Chat update with comments" });
    await writeComments(created.artifactDirectory, ["Do not discard this feedback."]);
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      intent: "explicit-chat-update",
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("requires an empty review round");
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
  });

  it("rejects explicit-chat-update when the round already has a submission", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Chat update after submission" });
    await submitDecision(created.artifactDirectory, "save");
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      intent: "explicit-chat-update",
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("requires an empty review round");
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
  });

  it("grants a chat-update token on an empty round and advances with modified Markdown", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Chat update" });

    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      takeover: true,
      expectedReviewRound: 1,
      intent: "explicit-chat-update",
    });
    expect(inspected.isError).toBeFalsy();
    expect(inspected.structuredContent.roundToken).toEqual(expect.any(String));
    expect(inspected.structuredContent.roundTokenSource).toBe("chat-update");

    const missingMarkdown = await callTool(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
    });
    expect(missingMarkdown.isError).toBe(true);
    expect(missingMarkdown.content[0].text).toContain("markdown is required when advancing with a chat-update token");

    const unchangedMarkdown = await callTool(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: initialMarkdown,
    });
    expect(unchangedMarkdown.isError).toBe(true);
    expect(unchangedMarkdown.content[0].text).toContain("updated markdown must differ from the current artifact content");

    const updatedMarkdown = "# Artifact\n\nUpdated directly from chat without comments.\n";
    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: updatedMarkdown,
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);
    expect(await readFile(created.artifactPath, "utf8")).toBe(updatedMarkdown);
    const comments = JSON.parse(await readFile(path.join(created.artifactDirectory, "comments.json"), "utf8"));
    expect(comments).toMatchObject({ reviewRound: 2, comments: [] });
    expect(await cancelAndRead(client, advancing)).toMatchObject({
      isError: true,
      structuredContent: {
        code: "ADVANCE_COMMITTED",
        expectedNextTool: "wait_for_artifact_review",
        reuseRoundToken: false,
        currentReviewRound: 2,
      },
    });
  });

  it("rejects a chat-update token when state changes after inspection", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Changed chat update" });
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      intent: "explicit-chat-update",
    });
    await writeComments(created.artifactDirectory, ["State changed after inspection."]);

    const result = await callTool(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: "# Artifact\n\nThis update must be rejected.\n",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no longer matches the inspected content");
    expect(result.structuredContent).toMatchObject({
      code: "ROUND_STATE_CHANGED",
      expectedNextTool: "inspect_artifact_review",
      reuseRoundToken: false,
      currentReviewRound: 1,
    });
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
  });

  it.each(["artifact", "comments", "submission"] as const)(
    "rejects a chat token when %s state changes after inspection",
    async (target) => {
      const fixture = await workspaceFixture();
      const client = startClient(fixture.registry);
      await initialize(client);
      const created = await createArtifact(client, fixture.workspace, { title: `Changed ${target}` });
      await writeComments(created.artifactDirectory, ["Please inspect this."]);
      const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });

      if (target === "submission") {
        await submitDecision(created.artifactDirectory, "approve", ["Please inspect this."]);
      } else if (target === "comments") {
        const commentsPath = path.join(created.artifactDirectory, "comments.json");
        const comments = JSON.parse(await readFile(commentsPath, "utf8"));
        comments.comments[0].body = "Changed after inspection.";
        await writeFile(commentsPath, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
      } else {
        const markdown = `${initialMarkdown}\nChanged after inspection.\n`;
        await writeFile(created.artifactPath, markdown, "utf8");
        const commentsPath = path.join(created.artifactDirectory, "comments.json");
        const comments = JSON.parse(await readFile(commentsPath, "utf8"));
        comments.artifactSha256 = sha256(markdown);
        await writeFile(commentsPath, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
      }

      const result = await callTool(client, "advance_and_wait_for_artifact", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
        roundToken: inspected.structuredContent.roundToken,
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no longer matches the inspected content");
      expect(result.structuredContent).toMatchObject({
        code: "ROUND_STATE_CHANGED",
        expectedNextTool: "inspect_artifact_review",
        reuseRoundToken: false,
      });
      expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
    },
  );

  it("issues a fresh inspection token after MCP restart", async () => {
    const fixture = await workspaceFixture();
    const firstClient = startClient(fixture.registry);
    await initialize(firstClient);
    const created = await createArtifact(firstClient, fixture.workspace, { title: "Restart" });
    await writeComments(created.artifactDirectory, ["Reconnect this artifact."]);
    const firstInspection = await callTool(firstClient, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    firstClient.stop();

    const secondClient = startClient(fixture.registry);
    await initialize(secondClient);
    const staleToken = await callTool(secondClient, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: firstInspection.structuredContent.roundToken,
    });
    expect(staleToken.structuredContent).toMatchObject({
      code: "ROUND_TOKEN_INVALID_OR_EXPIRED",
      expectedNextTool: "inspect_artifact_review",
      reuseRoundToken: false,
    });
    const secondInspection = await callTool(secondClient, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    expect(secondInspection.structuredContent.roundToken).toEqual(expect.any(String));
    expect(secondInspection.structuredContent.roundToken).not.toBe(firstInspection.structuredContent.roundToken);
    const advancing = callToolTracked(secondClient, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: secondInspection.structuredContent.roundToken,
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);
    expect((await cancelAndRead(secondClient, advancing)).isError).toBe(true);
  });

  it("allows only one concurrent transaction to consume a round token", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Concurrent advance" });
    await writeComments(created.artifactDirectory, ["Advance once."]);
    const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    const args = {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: "# Updated once\n",
    };
    const first = callToolTracked(client, "advance_and_wait_for_artifact", args);
    const second = callToolTracked(client, "advance_and_wait_for_artifact", args);
    await Promise.all([first.sent, second.sent]);
    await waitForRound(created.artifactDirectory, 2);
    await submitDecision(created.artifactDirectory, "approve");
    const results = await Promise.all([first.promise, second.promise]);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.structuredContent?.decision === "approve")).toHaveLength(1);
    expect(results.find((result) => result.isError)?.structuredContent.code).toMatch(/ROUND_TOKEN_(IN_USE|ALREADY_CONSUMED)/);
  });

  it("retains the round and token when a transaction rolls back", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_FAIL_UPDATE: "after-backup",
    });
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Rollback" });
    await writeComments(created.artifactDirectory, ["Trigger rollback."]);
    const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    const args = {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: "# Must roll back\n",
    };
    const failed = await callTool(client, "advance_and_wait_for_artifact", args);
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent).toMatchObject({
      code: "ADVANCE_ROLLED_BACK",
      expectedNextTool: "advance_and_wait_for_artifact",
      reuseRoundToken: true,
      currentReviewRound: 1,
    });
    expect(await readFile(created.artifactPath, "utf8")).toBe(initialMarkdown);
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
    if (process.platform !== "win32") {
      expect((await stat(created.artifactDirectory)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
      for (const fileName of ["artifact.json", "artifact.md", "comments.json"]) {
        expect((await stat(path.join(created.artifactDirectory, fileName))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      }
    }
    await expectNoTransactionResidue(created.artifactDirectory);
    const retried = await callTool(client, "advance_and_wait_for_artifact", args);
    expect(retried.content[0].text).toContain("Injected artifact update failure");
    expect(retried.structuredContent).toMatchObject({ code: "ADVANCE_ROLLED_BACK", reuseRoundToken: true });
    await expectNoTransactionResidue(created.artifactDirectory);
  });

  it("advances through the Windows-lock copy fallback without replacing the artifact directory", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_LOCK_ARTIFACT: "1",
    });
    await initialize(client);
    const created = await createArtifact(client, fixture.workspace, { title: "Locked editor" });
    await writeComments(created.artifactDirectory, ["Update while open."]);
    const inspected = await callTool(client, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: inspected.structuredContent.roundToken,
      markdown: "# Updated under lock\n",
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);
    await submitDecision(created.artifactDirectory, "save");
    expect((await advancing.promise).structuredContent.decision).toBe("save");
    await expectNoTransactionResidue(created.artifactDirectory);
    expect(await readdir(fixture.globalRoot)).toHaveLength(1);
    await expect(access(path.join(fixture.workspace, ARTIFACTS_DIRECTORY))).rejects.toThrow();
  });

  it.each(["lock", "staged", "backup"] as const)(
    "rejects a linked %s transaction entry, rolls back, and removes transaction residue",
    async (target) => {
      const fixture = await workspaceFixture();
      const transactionId = `linked-${target}`;
      const client = startClient(fixture.registry, {
        CODEX_ARTIFACTS_TEST_TRANSACTION_ID: transactionId,
      });
      await initialize(client);
      const created = await createArtifact(client, fixture.workspace, { title: `Linked ${target}` });
      await writeComments(created.artifactDirectory, ["Exercise transaction path safety."]);
      const inspected = await callTool(client, "inspect_artifact_review", {
        artifactDirectory: created.artifactDirectory,
      });
      const outside = path.join(path.dirname(fixture.workspace), `outside-${target}`);
      await mkdir(outside);
      const linkedPath = target === "lock"
        ? path.join(created.artifactDirectory, ".artifact-update.lock")
        : target === "staged"
          ? `${created.artifactPath}.next-${transactionId}`
          : `${created.artifactPath}.previous-${transactionId}`;
      await createDirectoryLink(outside, linkedPath);

      const result = await callTool(client, "advance_and_wait_for_artifact", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
        roundToken: inspected.structuredContent.roundToken,
        markdown: "# Unsafe transaction must roll back\n",
      });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("symbolic links");
      expect(result.structuredContent).toMatchObject({
        code: "ADVANCE_ROLLED_BACK",
        expectedNextTool: "advance_and_wait_for_artifact",
        reuseRoundToken: true,
        currentReviewRound: 1,
      });
      expect(await readFile(created.artifactPath, "utf8")).toBe(initialMarkdown);
      expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({
        reviewRound: 1,
      });
      await expectNoTransactionResidue(created.artifactDirectory);
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "restores owner-only permissions across advance and submitted lifecycle files",
    async () => {
      const fixture = await workspaceFixture();
      const client = startClient(fixture.registry);
      await initialize(client);
      const created = await createArtifact(client, fixture.workspace, { title: "POSIX permissions" });
      const lifecycleFiles = ["artifact.json", "artifact.md", "comments.json"];
      await Promise.all(lifecycleFiles.map((fileName) => (
        chmod(path.join(created.artifactDirectory, fileName), 0o666)
      )));
      await writeComments(created.artifactDirectory, ["Advance with hardened permissions."]);
      await chmod(path.join(created.artifactDirectory, "comments.json"), 0o666);
      const inspected = await callTool(client, "inspect_artifact_review", {
        artifactDirectory: created.artifactDirectory,
      });
      const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
        roundToken: inspected.structuredContent.roundToken,
        markdown: "# Owner-only round two\n",
      });
      await advancing.sent;
      await waitForRound(created.artifactDirectory, 2);
      for (const fileName of lifecycleFiles) {
        expect((await stat(path.join(created.artifactDirectory, fileName))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      }
      await expectNoTransactionResidue(created.artifactDirectory);

      await submitDecision(created.artifactDirectory, "approve");
      expect((await advancing.promise).structuredContent.decision).toBe("approve");
      for (const fileName of [...lifecycleFiles, "review-submission.json"]) {
        expect((await stat(path.join(created.artifactDirectory, fileName))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      }
      expect((await stat(created.artifactDirectory)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
      await expectNoTransactionResidue(created.artifactDirectory);
    },
  );

  it("rejects legacy workspaceRoot or workspaceEvidence on create_artifact and reports WINDOW_NOT_FOUND when no live windows", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const legacyArgs = await callTool(client, "create_artifact", {
      workspaceRoot: fixture.workspace,
      title: "Legacy args",
      kind: "implementation-plan",
      markdown: "# Legacy args\n",
    });
    expect(legacyArgs.isError).toBe(true);
    expect(legacyArgs.content[0].text).toContain("unrecognized key");

    const stale = await workspaceFixture({ stale: true });
    const staleClient = startClient(stale.registry);
    await initialize(staleClient);
    const unresolved = await callTool(staleClient, "resolve_artifact_window", { query: "workspace" });
    expect(unresolved.structuredContent).toEqual({
      status: "not-found",
      matchMode: "none",
      candidates: [],
      message: "No active VS Code windows found in the window registry.",
    });
    const staleResult = await callTool(staleClient, "create_artifact", {
      title: "Stale",
      kind: "implementation-plan",
      markdown: "# Stale\n",
    });
    expect(staleResult.isError).toBe(true);
    expect(staleResult.content[0].text).toContain("WINDOW_NOT_FOUND");
    await expect(access(stale.globalRoot)).rejects.toThrow();
  });

  it("resolves window candidates and consumes the chosen token once", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const resolved = await callTool(client, "resolve_artifact_window", {});
    expect(resolved.structuredContent).toMatchObject({
      status: "matched",
      candidates: expect.arrayContaining([
        expect.objectContaining({
          selectionToken: expect.any(String),
        }),
      ]),
    });
    const selected = resolved.structuredContent.candidates[0];

    const created = await callTool(client, "create_artifact", {
      title: "Selected window",
      kind: "implementation-plan",
      markdown: "# Content\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: selected.selectionToken,
      },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent.connection).toMatchObject({
      windowInstanceId: selected.windowInstanceId,
      connectionRevision: 1,
      source: "create",
    });

    const replay = await callTool(client, "create_artifact", {
      title: "Replay",
      kind: "implementation-plan",
      markdown: "# Replay\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: selected.selectionToken,
      },
    });
    expect(replay.isError).toBe(true);
    expect(replay.content[0].text).toContain("WINDOW_SELECTION_EXPIRED");
  });

  it("returns window candidates matching query across multiple windows", async () => {
    const fixture = await workspaceFixture();
    const secondWorkspace = path.join(path.dirname(fixture.workspace), "script-runner");
    await mkdir(secondWorkspace);
    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: secondWorkspace, realPath: await realpath(secondWorkspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");
    const client = startClient(fixture.registry);
    await initialize(client);

    const resolved = await callTool(client, "resolve_artifact_window", { query: "script-runner" });
    expect(resolved.structuredContent).toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({
          windowInstanceId: secondInstanceId,
          selectionToken: expect.any(String),
        }),
      ]),
    });
  });

  it("groups candidates and returns selection-required when multiple windows exist and none are focused", async () => {
    const fixture = await workspaceFixture();
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    const secondWorkspace = path.join(path.dirname(fixture.workspace), "other-window");
    await mkdir(secondWorkspace);
    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: secondWorkspace, realPath: await realpath(secondWorkspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");
    const client = startClient(fixture.registry);
    await initialize(client);

    const result = await callTool(client, "resolve_artifact_window", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "selection-required",
      candidates: expect.arrayContaining([
        expect.objectContaining({ windowInstanceId: firstSnapshot.instanceId }),
        expect.objectContaining({ windowInstanceId: secondInstanceId }),
      ]),
    });
  });

  it("invalidates window selection when selected window terminates from registry", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const resolved = await callTool(client, "resolve_artifact_window", {});
    const selected = resolved.structuredContent.candidates[0];

    const snapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    await rm(snapshotPath, { force: true });

    const staleSelection = await callTool(client, "create_artifact", {
      title: "Stale selection",
      kind: "implementation-plan",
      markdown: "# Stale selection\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: selected.selectionToken,
      },
    });
    expect(staleSelection.isError).toBe(true);
    expect(staleSelection.content[0].text).toContain("WINDOW_SELECTION_EXPIRED");
  });

  it("keeps window selection valid when window loses focus", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const resolved = await callTool(client, "resolve_artifact_window", {});
    const selected = resolved.structuredContent.candidates[0];

    const snapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    snapshot.focused = false;
    await atomicWrite(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);

    const created = await callTool(client, "create_artifact", {
      title: "Unfocused window creation",
      kind: "implementation-plan",
      markdown: "# Content\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: selected.selectionToken,
      },
    });
    expect(created.isError).toBeFalsy();
    expect(created.structuredContent.connection).toMatchObject({
      windowInstanceId: selected.windowInstanceId,
    });
  });

  it("rejects oversized Markdown and rolls back partial creation", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const oversized = await callTool(client, "create_artifact", {
      title: "Oversized",
      kind: "implementation-plan",
      markdown: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(oversized.content[0].text).toContain("exceeds");

    const failingClient = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_FAIL_CREATE: "after-manifest",
    });
    await initialize(failingClient);
    const partial = await callTool(failingClient, "create_artifact", {
      title: "Partial",
      kind: "implementation-plan",
      markdown: "# Partial\n",
    });
    expect(partial.isError).toBe(true);
    expect(await readdir(fixture.globalRoot)).toEqual([]);
  });

  it("retries a global artifact id collision without modifying the existing directory", async () => {
    const fixture = await workspaceFixture();
    const collisionDirectory = path.join(fixture.globalRoot, "collision-artifact-001");
    await mkdir(collisionDirectory, { recursive: true });
    await writeFile(path.join(collisionDirectory, "existing.txt"), "keep", "utf8");
    const client = startClient(fixture.registry, {
      CODEX_ARTIFACTS_TEST_ARTIFACT_IDS: "collision-artifact-001,recovered-artifact-001",
    });
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Collision" });
    expect(created.artifactId).toBe("recovered-artifact-001");
    expect(created.artifactDirectory).toBe(path.join(await realpath(fixture.globalRoot), "recovered-artifact-001"));
    expect(await readFile(path.join(collisionDirectory, "existing.txt"), "utf8")).toBe("keep");
  });

  it("rejects a linked artifact storage path without modifying its target", async () => {
    const fixture = await workspaceFixture();
    const outside = path.join(path.dirname(fixture.workspace), "outside");
    await mkdir(outside);
    await symlink(outside, path.join(fixture.userHome, ARTIFACTS_DIRECTORY), process.platform === "win32" ? "junction" : "dir");
    const client = startClient(fixture.registry);
    await initialize(client);
    const result = await callTool(client, "create_artifact", {
      title: "Unsafe",
      kind: "implementation-plan",
      markdown: "# Unsafe\n",
    });
    expect(result.content[0].text).toContain("UNSAFE_ARTIFACT_PATH");
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects an exact artifact handle outside the global collection root before reading files", async () => {
    const fixture = await workspaceFixture();
    const outsideArtifact = path.join(fixture.workspace, "outside-artifact-001");
    await mkdir(outsideArtifact);
    const client = startClient(fixture.registry);
    await initialize(client);

    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: outsideArtifact,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("must be a direct child of the collection root");
  });

  it.each(["artifact.json", "artifact.md", "comments.json", "review-submission.json"])(
    "rejects a linked lifecycle file before reading its target: %s",
    async (fileName) => {
      const fixture = await workspaceFixture();
      const client = startClient(fixture.registry);
      await initialize(client);
      const created = await createArtifact(client, fixture.workspace, { title: `Linked ${fileName}` });
      const outside = path.join(path.dirname(fixture.workspace), `outside-${fileName.replace(".", "-")}`);
      await mkdir(outside);
      const lifecyclePath = path.join(created.artifactDirectory, fileName);
      await rm(lifecyclePath, { force: true });
      await createDirectoryLink(outside, lifecyclePath);

      const inspected = await callTool(client, "inspect_artifact_review", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
      });
      expect(inspected.isError).toBe(true);
      expect(inspected.content[0].text).toContain("symbolic links");
      expect(await readdir(outside)).toEqual([]);
    },
  );

  it.each([3, 4, 5])("rejects an existing schema-v%s artifact", async (schemaVersion) => {
    const fixture = await workspaceFixture();
    const artifactId = `legacy-artifact-${schemaVersion}`;
    const artifactDirectory = path.join(fixture.globalRoot, artifactId);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "artifact.md"), initialMarkdown, "utf8");
    const timestamp = new Date().toISOString();
    await writeFile(path.join(artifactDirectory, "artifact.json"), JSON.stringify({
      schemaVersion,
      kind: "implementation-plan",
      artifactId,
      title: `Legacy schema ${schemaVersion}`,
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewRound: 1,
      location: { workspaceRoot: fixture.workspace },
      reviewSessionId: "33333333-3333-4333-8333-333333333333",
    }), "utf8");
    await writeFile(path.join(artifactDirectory, "comments.json"), JSON.stringify({
      schemaVersion,
      artifactId,
      reviewRound: 1,
      artifactSha256: sha256(initialMarkdown),
      comments: [],
    }), "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory,
      expectedReviewRound: 1,
    });
    expect(inspected.isError).toBe(true);
    expect(inspected.content[0].text).toContain("supports version 6");
  });

  it("generates correctly formatted and URL-encoded artifactUrl and artifactLink for paths with spaces, special characters, and Unicode", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Special & Unicode Plan #1" });
    expect(created.artifactUrl).toMatch(/^file:\/\/\/.+\/artifact\.md$/);
    expect(created.artifactLink).toBe(`[Special & Unicode Plan #1](${created.artifactUrl})`);
  });

  it("creates artifact with connection file, returns exact connection metadata, and preserves core contracts", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Connected artifact plan" });
    expect(created.connection).toBeDefined();
    expect(created.connection.schemaVersion).toBe(1);
    expect(created.connection.connectionRevision).toBe(1);
    expect(created.connection.source).toBe("create");
    expect(created.connection.openRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    const connContent = JSON.parse(await readFile(connPath, "utf8"));
    expect(connContent).toEqual(created.connection);
    expect(connContent).not.toHaveProperty("workspaceRoot");
  });

  it("returns WINDOW_SELECTION_REQUIRED without creating artifact directory when multiple windows are open and none is focused", async () => {
    const fixture = await workspaceFixture();
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    const result = await callTool(client, "create_artifact", {
      title: "Ambiguous window plan",
      kind: "plan",
      markdown: "# Plan\n",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WINDOW_SELECTION_REQUIRED");
    expect(result.structuredContent).toMatchObject({
      status: "selection-required",
      candidates: expect.arrayContaining([
        expect.objectContaining({ windowInstanceId: secondInstanceId }),
      ]),
    });
    expect(result.structuredContent.candidates).toHaveLength(2);

    try {
      const files = await readdir(fixture.globalRoot);
      expect(files).toEqual([]);
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
    }
  });

  it("allows disambiguating multi-window creation using connection.selectionToken", async () => {
    const fixture = await workspaceFixture();
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    const preflight = await callTool(client, "create_artifact", {
      title: "Disambiguated plan",
      kind: "plan",
      markdown: "# Plan\n",
    });
    expect(preflight.isError).toBe(true);

    const targetCandidate = preflight.structuredContent.candidates.find(
      (c: any) => c.windowInstanceId === secondInstanceId,
    );
    expect(targetCandidate?.selectionToken).toBeDefined();

    const created = await callTool(client, "create_artifact", {
      title: "Disambiguated plan",
      kind: "plan",
      markdown: "# Plan\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: targetCandidate.selectionToken,
      },
    });

    expect(created.isError).toBeFalsy();
    expect(created.structuredContent.connection).toMatchObject({
      windowInstanceId: secondInstanceId,
      connectionRevision: 1,
      source: "create",
    });
  });

  it("rejects invalid connection.selectionToken before mutation", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const result = await callTool(client, "create_artifact", {
      title: "Mismatched token plan",
      kind: "plan",
      markdown: "# Plan\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: randomUUID(),
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WINDOW_SELECTION_EXPIRED");
    expect(result.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_EXPIRED",
      retryable: true,
      expectedNextTool: "create_artifact",
    });

    try {
      const files = await readdir(fixture.globalRoot);
      expect(files).toEqual([]);
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
    }
  });

  it("rolls back newly allocated artifact directory if connection commit fails", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry, { CODEX_ARTIFACTS_TEST_FAIL_CREATE: "at-connection" });
    await initialize(client);

    const result = await callTool(client, "create_artifact", {
      title: "Connection failure rollback plan",
      kind: "plan",
      markdown: "# Plan\n",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Injected connection write failure");

    try {
      const files = await readdir(fixture.globalRoot);
      expect(files).toEqual([]);
    } catch (err: any) {
      expect(err.code).toBe("ENOENT");
    }
  });

  it("reconnects artifact with matching fresh window ID, updates revision and openRequestId, preserves round and comments", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Reconnect test plan" });
    expect(created.connection).toBeDefined();
    expect(created.connection.connectionRevision).toBe(1);
    expect(created.connection.source).toBe("create");

    const reconnected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });

    expect(reconnected.isError).toBeFalsy();
    expect(reconnected.structuredContent.connection).toMatchObject({
      windowInstanceId: created.connection.windowInstanceId,
      connectionRevision: 2,
      source: "inspect",
    });
    expect(reconnected.structuredContent.connection.openRequestId).not.toBe(created.connection.openRequestId);
    expect(reconnected.structuredContent.connection.openRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(reconnected.structuredContent.manifest.reviewRound).toBe(1);

    const diskConn = JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact-connection.json"), "utf8"));
    expect(diskConn).toEqual(reconnected.structuredContent.connection);
  });

  it("reconnects with stale window ID by falling back to unique matching workspace window", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Stale window fallback plan" });
    const originalWindowId = created.connection.windowInstanceId;

    const now = Date.now();
    const freshInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${freshInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: freshInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    await rm(path.join(fixture.registry, `${originalWindowId}.json`), { force: true });

    // Reconnect WITHOUT connection hint: falls back to unique matching fresh window
    const reconnectedNoHint = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });

    expect(reconnectedNoHint.isError).toBeFalsy();
    expect(reconnectedNoHint.structuredContent.connection).toMatchObject({
      windowInstanceId: freshInstanceId,
      connectionRevision: 2,
      source: "inspect",
    });

    // Reconnect WITH invalid selectionToken: fails with WINDOW_SELECTION_EXPIRED
    const reconnectedWithStaleToken = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "explicit-window",
        selectionToken: randomUUID(),
      },
    });

    expect(reconnectedWithStaleToken.isError).toBe(true);
    expect(reconnectedWithStaleToken.content[0].text).toContain("WINDOW_SELECTION_EXPIRED");
    expect(reconnectedWithStaleToken.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_EXPIRED",
      retryable: true,
      expectedNextTool: "inspect_artifact_review",
    });
  });

  it("returns WINDOW_SELECTION_REQUIRED on reconnect when multi-window ambiguous without detaching active waiter", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Ambiguous reconnect plan" });
    const originalWindowId = created.connection.windowInstanceId;

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;

    // Remove original window and introduce two fresh windows for the same workspace
    await rm(path.join(fixture.registry, `${originalWindowId}.json`), { force: true });
    const now = Date.now();
    const secondInstanceId = randomUUID();
    const thirdInstanceId = randomUUID();
    for (const winId of [secondInstanceId, thirdInstanceId]) {
      await writeFile(path.join(fixture.registry, `${winId}.json`), `${JSON.stringify({
        schemaVersion: 2,
        instanceId: winId,
        processId: process.pid,
        workspaceFile: null,
        focused: false,
        folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
        activeFile: null,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      }, null, 2)}\n`, "utf8");
    }

    const reconnectAttempt = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      takeover: true,
    });

    expect(reconnectAttempt.isError).toBe(true);
    expect(reconnectAttempt.content[0].text).toContain("WINDOW_SELECTION_REQUIRED");
    expect(reconnectAttempt.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_REQUIRED",
      status: "selection-required",
      retryable: true,
      expectedNextTool: "inspect_artifact_review",
      lifecycleMutated: false,
      takeoverOccurred: false,
      useSameArtifactHandle: true,
      candidates: expect.any(Array),
    });

    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    await store.submitReview("approve");

    const waitResult = await waiting.promise;
    expect(waitResult.isError).toBeFalsy();
    expect(waitResult.structuredContent.decision).toBe("approve");
  });

  it("reconnect creates valid v1 connection on artifact missing artifact-connection.json", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Missing connection test" });
    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    await rm(connPath, { force: true });

    const plainInspect = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
    });
    expect(plainInspect.isError).toBeFalsy();
    expect(plainInspect.structuredContent.connection).toBeUndefined();

    const reconnected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });
    expect(reconnected.isError).toBeFalsy();
    expect(reconnected.structuredContent.connection).toMatchObject({
      connectionRevision: 1,
      source: "inspect",
    });
    const diskConn = JSON.parse(await readFile(connPath, "utf8"));
    expect(diskConn).toEqual(reconnected.structuredContent.connection);
  });

  it("returns ARTIFACT_CONNECTION_WRITE_FAILED recovery error and leaves lifecycle files untouched on reconnect failure", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Failing reconnect plan" });
    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    const originalConnRaw = await readFile(connPath, "utf8");
    const manifestRaw = await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8");

    const failingClient = startClient(fixture.registry, { CODEX_ARTIFACTS_TEST_FAIL_CONNECTION_WRITE: "rename" });
    await initialize(failingClient);

    const result = await callTool(failingClient, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("failed to write artifact connection");
    expect(result.structuredContent).toMatchObject({
      code: "ARTIFACT_CONNECTION_WRITE_FAILED",
      retryable: true,
      expectedNextTool: "inspect_artifact_review",
    });

    expect(await readFile(connPath, "utf8")).toBe(originalConnRaw);
    expect(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8")).toBe(manifestRaw);

    const entries = await readdir(created.artifactDirectory);
    expect(entries.filter((entry) => entry.includes(".tmp-"))).toEqual([]);
    await expect(access(path.join(created.artifactDirectory, ".artifact-connection.lock"))).rejects.toThrow();
  });

  it("preserves ARTIFACT_CONNECTION_INVALID classification when invalid state is detected during connection commit", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Invalid commit-state plan" });
    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    const originalConnRaw = await readFile(connPath, "utf8");

    const failingClient = startClient(fixture.registry, {
      CODEX_ARTIFACTS_TEST_FAIL_RECONNECT: "invalid-state-at-connection",
    });
    await initialize(failingClient);

    const result = await callTool(failingClient, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "ARTIFACT_CONNECTION_INVALID",
      retryable: false,
      useSameArtifactHandle: true,
    });
    expect(result.structuredContent).not.toHaveProperty("expectedNextTool");
    expect(await readFile(connPath, "utf8")).toBe(originalConnRaw);
  });

  it("prevents replay of selectionToken on reconnect and returns WINDOW_SELECTION_EXPIRED", async () => {
    const fixture = await workspaceFixture();
    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    const client = startClient(fixture.registry);
    await initialize(client);

    const resolved = await callTool(client, "resolve_artifact_window", {});
    const targetCandidate = resolved.structuredContent.candidates.find(
      (c: any) => c.windowInstanceId === secondInstanceId,
    );
    expect(targetCandidate?.selectionToken).toBeDefined();

    const created = await callTool(client, "create_artifact", {
      title: "Replay prevention plan",
      kind: "plan",
      markdown: "# Plan\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: targetCandidate.selectionToken,
      },
    });
    expect(created.isError).toBeFalsy();

    // Replay the same selection token on inspect reconnect -> MUST FAIL with WINDOW_SELECTION_EXPIRED
    const replayed = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.structuredContent.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "explicit-window",
        selectionToken: targetCandidate.selectionToken,
      },
    });
    expect(replayed.isError).toBe(true);
    expect(replayed.content[0].text).toContain("WINDOW_SELECTION_EXPIRED");
    expect(replayed.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_EXPIRED",
      retryable: true,
      expectedNextTool: "inspect_artifact_review",
      useSameArtifactHandle: true,
    });
  });

  it("wait_for_artifact_review and advance_and_wait_for_artifact do not modify artifact-connection.json", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Preserved connection plan" });
    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    const initialConn = JSON.parse(await readFile(connPath, "utf8"));

    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    const loaded = await store.load();
    const paragraph = loaded.blocks.find((block) => block.type === "paragraph")!;
    const quote = "review bridge";
    const start = paragraph.text.indexOf(quote);
    await store.addComment({
      blockId: paragraph.id,
      selection: { quote, start, end: start + quote.length },
      body: "Needs revision",
    });

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;
    await store.submitReview("revise");
    const waitResult = await waiting.promise;
    expect(waitResult.structuredContent.decision).toBe("revise");

    expect(JSON.parse(await readFile(connPath, "utf8"))).toEqual(initialConn);

    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: waitResult.structuredContent.roundToken,
      markdown: "# Artifact Round 2\n\nUpdated content.\n",
    });
    await advancing.sent;
    await waitForRound(created.artifactDirectory, 2);

    const manifest = JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"));
    expect(manifest.reviewRound).toBe(2);

    const connAfterAdvance = JSON.parse(await readFile(connPath, "utf8"));
    expect(connAfterAdvance).toEqual(initialConn);
    expect((await cancelAndRead(client, advancing)).isError).toBe(true);
  });

  it("create ambiguity returns WINDOW_SELECTION_REQUIRED with expectedNextTool create_artifact and no directory created", async () => {
    const fixture = await workspaceFixture();
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    const ambiguousCreate = await callTool(client, "create_artifact", {
      title: "Ambiguous plan",
      kind: "plan",
      markdown: "# Plan\n",
    });

    expect(ambiguousCreate.isError).toBe(true);
    expect(ambiguousCreate.content[0].text).toContain("WINDOW_SELECTION_REQUIRED");
    expect(ambiguousCreate.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_REQUIRED",
      status: "selection-required",
      retryable: true,
      expectedNextTool: "create_artifact",
      lifecycleMutated: false,
      takeoverOccurred: false,
      useSameArtifactHandle: false,
      candidates: expect.any(Array),
    });

    // Verify retry with chosen token succeeds
    const token = ambiguousCreate.structuredContent.candidates[0].selectionToken;
    const successfulCreate = await callTool(client, "create_artifact", {
      title: "Ambiguous plan",
      kind: "plan",
      markdown: "# Plan\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: token,
      },
    });
    expect(successfulCreate.isError).toBeFalsy();

    // Verify token replay on create returns WINDOW_SELECTION_EXPIRED with expectedNextTool create_artifact
    const replayed = await callTool(client, "create_artifact", {
      title: "Replayed plan",
      kind: "plan",
      markdown: "# Plan\n",
      connection: {
        targetMode: "explicit-window",
        selectionToken: token,
      },
    });
    expect(replayed.isError).toBe(true);
    expect(replayed.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_EXPIRED",
      retryable: true,
      expectedNextTool: "create_artifact",
    });
  });

  it("malformed connection JSON reconnect fails with ARTIFACT_CONNECTION_INVALID before takeover and preserves waiter", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Corrupt connection test" });
    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    await writeFile(connPath, "{ corrupt json ... invalid", "utf8");

    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await waiting.sent;

    const failedReconnect = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
    });

    expect(failedReconnect.isError).toBe(true);
    expect(failedReconnect.structuredContent).toMatchObject({
      code: "ARTIFACT_CONNECTION_INVALID",
      retryable: false,
      useSameArtifactHandle: true,
    });
    expect(failedReconnect.structuredContent).not.toHaveProperty("expectedNextTool");

    // Waiter must still be alive and receive review
    const store = new ArtifactStore(created.artifactPath, { userHome: fixture.userHome });
    await store.submitReview("approve");

    const waitResult = await waiting.promise;
    expect(waitResult.isError).toBeFalsy();
    expect(waitResult.structuredContent.decision).toBe("approve");
  });

  it("reconnect with valid affinity targets non-focused window over another focused window, and increments revision", async () => {
    const fixture = await workspaceFixture();
    // Window 1 from fixture: make it non-focused
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);
    const winAId = firstSnapshot.instanceId;

    // Window 2: focused
    const now = Date.now();
    const winBId = randomUUID();
    await writeFile(path.join(fixture.registry, `${winBId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: winBId,
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    // Create artifact directly targeting Window A explicitly first
    const resolved = await callTool(client, "resolve_artifact_window", {});
    const tokenA = resolved.structuredContent.candidates.find((c: any) => c.windowInstanceId === winAId)!.selectionToken;

    const created = await createArtifact(client, fixture.workspace, {
      title: "Affinity test",
      connection: {
        targetMode: "explicit-window",
        selectionToken: tokenA,
      },
    });
    expect(created.connection.windowInstanceId).toBe(winAId);
    expect(created.connection.connectionRevision).toBe(1);

    // Reconnect with artifact-window affinity for winAId
    // Window A is non-focused, Window B is focused. Window A MUST win!
    const reconnectResult = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: winAId,
      },
    });

    expect(reconnectResult.isError).toBeFalsy();
    expect(reconnectResult.structuredContent.connection).toMatchObject({
      windowInstanceId: winAId,
      connectionRevision: 2,
      source: "inspect",
    });

    // Reconnect again with same affinity: revision increments, openRequestId changes
    const reconnect2 = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: winAId,
      },
    });

    expect(reconnect2.isError).toBeFalsy();
    expect(reconnect2.structuredContent.connection).toMatchObject({
      windowInstanceId: winAId,
      connectionRevision: 3,
      source: "inspect",
    });
    expect(reconnect2.structuredContent.connection.openRequestId).not.toBe(
      reconnectResult.structuredContent.connection.openRequestId,
    );

    // Reconnect with mismatched/stale hint: silently falls back to focused Window B
    const staleHintResult = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: randomUUID(),
      },
    });

    expect(staleHintResult.isError).toBeFalsy();
    expect(staleHintResult.structuredContent.connection).toMatchObject({
      windowInstanceId: winBId,
      connectionRevision: 4,
      source: "inspect",
    });
  });

  it("sole window reconnect always routes to sole window even with stale/mismatched affinity hint", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, { title: "Sole win test" });
    const soleWinId = created.connection.windowInstanceId;

    const deadId = randomUUID();
    const reconnectResult = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: deadId,
      },
    });

    expect(reconnectResult.isError).toBeFalsy();
    expect(reconnectResult.structuredContent.connection).toMatchObject({
      windowInstanceId: soleWinId,
      connectionRevision: 2,
    });
  });

  it("rejects artifact-window input on create_artifact and non-reconnect inspect_artifact_review", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    // create_artifact with artifact-window must fail
    const createFail = await callTool(client, "create_artifact", {
      title: "Fail create",
      kind: "plan",
      markdown: "# Test\n",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: randomUUID(),
      },
    });
    expect(createFail.isError).toBe(true);
    expect(createFail.content[0].text).toContain("INVALID_ARTIFACT_INPUT");

    // Create a valid artifact to test inspect
    const created = await createArtifact(client, fixture.workspace, { title: "Valid" });

    // non-reconnect inspect with artifact-window must fail
    const inspectFail = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: randomUUID(),
      },
    });
    expect(inspectFail.isError).toBe(true);
    expect(inspectFail.content[0].text).toContain("INVALID_ARTIFACT_INPUT");
  });

  it("reconnect returns WINDOW_SELECTION_REQUIRED when affinity is invalid and focus is ambiguous", async () => {
    const fixture = await workspaceFixture();
    // Window 1: non-focused
    const firstSnapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const firstSnapshot = JSON.parse(await readFile(firstSnapshotPath, "utf8"));
    firstSnapshot.focused = false;
    await atomicWrite(firstSnapshotPath, `${JSON.stringify(firstSnapshot, null, 2)}\n`);

    // Window 2: non-focused
    const now = Date.now();
    const secondInstanceId = randomUUID();
    await writeFile(path.join(fixture.registry, `${secondInstanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId: secondInstanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [{ path: fixture.workspace, realPath: await realpath(fixture.workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);

    // Use explicit token to create artifact on first window
    const resolved = await callTool(client, "resolve_artifact_window", {});
    const token = resolved.structuredContent.candidates[0].selectionToken;
    const created = await createArtifact(client, fixture.workspace, {
      title: "Ambiguity test",
      connection: {
        targetMode: "explicit-window",
        selectionToken: token,
      },
    });

    const connPath = path.join(created.artifactDirectory, "artifact-connection.json");
    const initialConnBytes = await readFile(connPath, "utf8");

    // Reconnect with mismatched affinity: both windows non-focused -> WINDOW_SELECTION_REQUIRED
    const ambiguousReconnect = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      intent: "reconnect",
      connection: {
        targetMode: "artifact-window",
        windowInstanceId: randomUUID(),
      },
    });

    expect(ambiguousReconnect.isError).toBe(true);
    expect(ambiguousReconnect.structuredContent).toMatchObject({
      code: "WINDOW_SELECTION_REQUIRED",
      status: "selection-required",
      retryable: true,
      expectedNextTool: "inspect_artifact_review",
      useSameArtifactHandle: true,
      candidates: expect.any(Array),
    });

    // Connection file must NOT be modified
    expect(await readFile(connPath, "utf8")).toBe(initialConnBytes);
  });
});
