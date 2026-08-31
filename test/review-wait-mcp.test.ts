import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const initialMarkdown = "# Artifact\n\nBuild the MCP review bridge.\n";
const singleWorkspaceEvidence = { kind: "single-workspace" } as const;

type TrackedRequest = { id: number; promise: Promise<any> };
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
  await rename(temporaryPath, filePath);
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

async function workspaceFixture(options: { stale?: boolean } = {}): Promise<{ workspace: string; registry: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-mcp-v5-"));
  temporaryDirectories.push(root);
  const workspace = path.join(root, "workspace");
  const registry = path.join(root, "registry");
  await Promise.all([mkdir(workspace), mkdir(registry)]);
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
  return { workspace, registry };
}

function startClient(registry: string, extraEnvironment: NodeJS.ProcessEnv = {}): TestClient {
  const script = path.resolve("dist", "integration", "codex-artifacts-review-mcp.mjs");
  const processHandle = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...extraEnvironment, CODEX_ARTIFACTS_REGISTRY_DIRECTORY: registry },
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
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    return { id, promise };
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
  expect(initialized.serverInfo.version).toBe("5.0.0");
  expect(initialized.instructions).toContain("create_artifact");
  expect(initialized.instructions).toContain("inspect_artifact_review");
  expect(initialized.instructions).toContain("Treat comments returned by a Review submission");
  expect(initialized.instructions).toContain("Do not add Review responses to the artifact");
  expect(initialized.instructions).toContain("execute the complete approved plan immediately");
  expect(initialized.instructions).toContain("Never select the latest artifact");
  client.notify("notifications/initialized");
}

async function callTool(client: TestClient, name: string, args: Record<string, unknown>): Promise<any> {
  return client.request("tools/call", { name, arguments: args });
}

function callToolTracked(client: TestClient, name: string, args: Record<string, unknown>): TrackedRequest {
  return client.requestTracked("tools/call", { name, arguments: args });
}

async function createArtifact(
  client: TestClient,
  workspace: string,
  options: { title?: string; kind?: string; markdown?: string; workspaceEvidence?: Record<string, unknown> } = {},
): Promise<Record<string, any>> {
  const result = await callTool(client, "create_artifact", {
    workspaceRoot: workspace,
    workspaceEvidence: options.workspaceEvidence ?? singleWorkspaceEvidence,
    title: options.title ?? "MCP bridge",
    kind: options.kind ?? "implementation-plan",
    markdown: options.markdown ?? initialMarkdown,
  });
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
    schemaVersion: 4,
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
  const [manifestRaw, markdown] = await Promise.all([
    readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
    readFile(path.join(artifactDirectory, "artifact.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  await atomicWrite(path.join(artifactDirectory, "review-submission.json"), `${JSON.stringify({
    schemaVersion: 4,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    reviewSessionId: manifest.reviewSessionId,
    submittedAt: new Date().toISOString(),
    decision,
    artifactSha256: sha256(markdown),
    commentsSha256: sha256(commentsRaw),
  }, null, 2)}\n`);
}

async function cancelAndRead(client: TestClient, tracked: TrackedRequest): Promise<any> {
  client.notify("notifications/cancelled", { requestId: tracked.id });
  return tracked.promise;
}

afterEach(async () => {
  for (const processHandle of processes.splice(0)) processHandle.kill();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact review MCP server v5", () => {
  it("lists only the four lifecycle tools and creates a detached schema-v4 artifact immediately", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const tools = await client.request("tools/list");
    expect(tools.tools.map((tool: any) => tool.name)).toEqual([
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact_review",
      "advance_and_wait_for_artifact",
    ]);

    const created = await createArtifact(client, fixture.workspace);
    expect(created).toMatchObject({ reviewRound: 1, kind: "implementation-plan", workspaceRoot: fixture.workspace });
    expect(created.artifactSha256).toBe(sha256(initialMarkdown));
    expect(await readdir(created.artifactDirectory)).toEqual(expect.arrayContaining([
      "artifact.json",
      "artifact.md",
      "comments.json",
    ]));
    await expect(access(path.join(created.artifactDirectory, "review-submission.json"))).rejects.toThrow();
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
    await submitDecision(created.artifactDirectory, "revise");
    const reviewed = await waiting.promise;
    expect(reviewed.structuredContent).toMatchObject({ decision: "revise", reviewRound: 1 });
    expect(reviewed.structuredContent.roundToken).toEqual(expect.any(String));

    const replacement = "# Artifact\n\nBuild the bridge with recovery behavior.\n";
    const advancing = callToolTracked(client, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: reviewed.structuredContent.roundToken,
      markdown: replacement,
    });
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
      await submitDecision(created.artifactDirectory, "approve");
      const approved = await waiting.promise;
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
    const cancelled = await cancelAndRead(client, firstWait);
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content[0].text).toContain("cancelled");
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });

    const secondWait = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
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
    const waiting = callToolTracked(client, "wait_for_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
    });
    await submitDecision(created.artifactDirectory, "approve");
    expect((await waiting.promise).structuredContent).toMatchObject({ decision: "approve", reviewRound: 1 });
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
    const secondInspection = await callTool(secondClient, "inspect_artifact_review", { artifactDirectory: created.artifactDirectory });
    expect(secondInspection.structuredContent.roundToken).toEqual(expect.any(String));
    expect(secondInspection.structuredContent.roundToken).not.toBe(firstInspection.structuredContent.roundToken);
    const advancing = callToolTracked(secondClient, "advance_and_wait_for_artifact", {
      artifactDirectory: created.artifactDirectory,
      expectedReviewRound: 1,
      roundToken: secondInspection.structuredContent.roundToken,
    });
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
    await waitForRound(created.artifactDirectory, 2);
    await submitDecision(created.artifactDirectory, "approve");
    const results = await Promise.all([first.promise, second.promise]);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.structuredContent?.decision === "approve")).toHaveLength(1);
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
    expect(await readFile(created.artifactPath, "utf8")).toBe(initialMarkdown);
    expect(JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
    const retried = await callTool(client, "advance_and_wait_for_artifact", args);
    expect(retried.content[0].text).toContain("Injected artifact update failure");
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
    await waitForRound(created.artifactDirectory, 2);
    await submitDecision(created.artifactDirectory, "save");
    expect((await advancing.promise).structuredContent.decision).toBe("save");
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toHaveLength(1);
  });

  it("requires typed workspace evidence and rejects missing or stale registrations", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const noEvidence = await callTool(client, "create_artifact", {
      workspaceRoot: fixture.workspace,
      title: "No evidence",
      kind: "plan",
      markdown: "# No evidence\n",
    });
    expect(noEvidence.content[0].text).toContain("WORKSPACE_EVIDENCE_REQUIRED");
    await expect(access(path.join(fixture.workspace, ".codex-artifacts"))).rejects.toThrow();

    const stale = await workspaceFixture({ stale: true });
    const staleClient = startClient(stale.registry);
    await initialize(staleClient);
    const staleResult = await callTool(staleClient, "create_artifact", {
      workspaceRoot: stale.workspace,
      workspaceEvidence: singleWorkspaceEvidence,
      title: "Stale",
      kind: "plan",
      markdown: "# Stale\n",
    });
    expect(staleResult.content[0].text).toContain("WORKSPACE_NOT_REGISTERED");
  });

  it("rejects inferred multi-root ownership but accepts exact user folder evidence", async () => {
    const fixture = await workspaceFixture();
    const secondWorkspace = path.join(path.dirname(fixture.workspace), "script-runner");
    await mkdir(secondWorkspace);
    const snapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    snapshot.folders.push({ path: secondWorkspace, realPath: await realpath(secondWorkspace) });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    const client = startClient(fixture.registry);
    await initialize(client);

    const ambiguous = await callTool(client, "create_artifact", {
      workspaceRoot: secondWorkspace,
      workspaceEvidence: singleWorkspaceEvidence,
      title: "Inferred",
      kind: "plan",
      markdown: "# Must ask\n",
    });
    expect(ambiguous.content[0].text).toContain("AMBIGUOUS_WORKSPACE");

    const created = await createArtifact(client, secondWorkspace, {
      title: "Explicit folder",
      workspaceEvidence: { kind: "explicit-user-folder", userText: "Hãy tạo artifact trong script-runner" },
    });
    expect(created.workspaceRoot).toBe(secondWorkspace);
  });

  it("rejects oversized Markdown and rolls back partial creation", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const oversized = await callTool(client, "create_artifact", {
      workspaceRoot: fixture.workspace,
      workspaceEvidence: singleWorkspaceEvidence,
      title: "Oversized",
      kind: "plan",
      markdown: "x".repeat(2 * 1024 * 1024 + 1),
    });
    expect(oversized.content[0].text).toContain("exceeds");

    const failingClient = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_FAIL_CREATE: "after-manifest",
    });
    await initialize(failingClient);
    const partial = await callTool(failingClient, "create_artifact", {
      workspaceRoot: fixture.workspace,
      workspaceEvidence: singleWorkspaceEvidence,
      title: "Partial",
      kind: "plan",
      markdown: "# Partial\n",
    });
    expect(partial.isError).toBe(true);
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toEqual([]);
  });

  it("rejects a linked artifact storage path without modifying its target", async () => {
    const fixture = await workspaceFixture();
    const outside = path.join(path.dirname(fixture.workspace), "outside");
    await mkdir(outside);
    await symlink(outside, path.join(fixture.workspace, ".codex-artifacts"), process.platform === "win32" ? "junction" : "dir");
    const client = startClient(fixture.registry);
    await initialize(client);
    const result = await callTool(client, "create_artifact", {
      workspaceRoot: fixture.workspace,
      workspaceEvidence: singleWorkspaceEvidence,
      title: "Unsafe",
      kind: "plan",
      markdown: "# Unsafe\n",
    });
    expect(result.content[0].text).toContain("UNSAFE_ARTIFACT_PATH");
    expect(await readdir(outside)).toEqual([]);
  });
});
