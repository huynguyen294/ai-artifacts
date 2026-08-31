import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const initialMarkdown = "# Artifact\n\nBuild the MCP review bridge.\n";
const singleWorkspaceEvidence = { kind: "single-workspace" } as const;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

async function workspaceFixture(options: { stale?: boolean } = {}): Promise<{
  workspace: string;
  registry: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-mcp-v4-"));
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

function startClient(registry: string, extraEnvironment: NodeJS.ProcessEnv = {}): {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  notify: (method: string, params?: Record<string, unknown>) => void;
} {
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
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
  };
}

async function initialize(client: ReturnType<typeof startClient>): Promise<void> {
  const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
  expect(initialized.instructions).toContain("update_and_wait_for_artifact");
  expect(initialized.instructions).toContain("typed workspace evidence");
  expect(initialized.instructions).toContain("immediately preceding comment round");
  expect(initialized.instructions).toContain("implement the approved plan immediately");
  client.notify("notifications/initialized");
}

async function createdArtifactDirectory(workspace: string): Promise<string> {
  const collection = path.join(workspace, ".codex-artifacts", "artifacts");
  return waitUntil(async () => {
    try {
      const entries = await readdir(collection);
      if (entries.length !== 1) return undefined;
      const artifactDirectory = path.join(collection, entries[0]!);
      await Promise.all([
        access(path.join(artifactDirectory, "artifact.json")),
        access(path.join(artifactDirectory, "artifact.md")),
        access(path.join(artifactDirectory, "comments.json")),
      ]);
      return artifactDirectory;
    } catch {
      return undefined;
    }
  });
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
        return manifest.reviewRound === reviewRound && comments.reviewRound === reviewRound
          ? manifest
          : undefined;
      }
    } catch {
      return undefined;
    }
  });
}

async function submitDecision(
  artifactDirectory: string,
  decision: "revise" | "approve" | "save",
): Promise<void> {
  const [manifestRaw, markdown] = await Promise.all([
    readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
    readFile(path.join(artifactDirectory, "artifact.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const comments = {
    schemaVersion: 4,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    artifactSha256: sha256(markdown),
    comments: decision === "revise" ? [{
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      block: { id: "paragraph-001", type: "paragraph", heading: null },
      selection: { quote: "review bridge", start: 14, end: 27, prefix: "Build the MCP ", suffix: "." },
      body: "Add recovery behavior.",
    }] : [],
  };
  const commentsRaw = `${JSON.stringify(comments, null, 2)}\n`;
  await writeFile(path.join(artifactDirectory, "comments.json"), commentsRaw, "utf8");
  await writeFile(path.join(artifactDirectory, "review-submission.json"), `${JSON.stringify({
    schemaVersion: 4,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    reviewSessionId: manifest.reviewSessionId,
    submittedAt: new Date().toISOString(),
    decision,
    artifactSha256: sha256(markdown),
    commentsSha256: sha256(commentsRaw),
  }, null, 2)}\n`, "utf8");
}

async function rewriteReviewedState(
  artifactDirectory: string,
  target: "artifact" | "comments",
): Promise<void> {
  const artifactPath = path.join(artifactDirectory, "artifact.md");
  const commentsPath = path.join(artifactDirectory, "comments.json");
  const submissionPath = path.join(artifactDirectory, "review-submission.json");
  let markdown = await readFile(artifactPath, "utf8");
  const comments = JSON.parse(await readFile(commentsPath, "utf8"));
  const submission = JSON.parse(await readFile(submissionPath, "utf8"));

  if (target === "artifact") {
    markdown = `${markdown}\nTampered after review.\n`;
    await writeFile(artifactPath, markdown, "utf8");
    comments.artifactSha256 = sha256(markdown);
  } else {
    comments.comments[0].body = "Feedback changed after review.";
  }

  const commentsRaw = `${JSON.stringify(comments, null, 2)}\n`;
  await writeFile(commentsPath, commentsRaw, "utf8");
  submission.artifactSha256 = sha256(markdown);
  submission.commentsSha256 = sha256(commentsRaw);
  await writeFile(submissionPath, `${JSON.stringify(submission, null, 2)}\n`, "utf8");
}

afterEach(async () => {
  for (const processHandle of processes.splice(0)) processHandle.kill();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact review MCP server v4", () => {
  it("creates and updates one artifact while keeping both review waits in the originating tool calls", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const tools = await client.request("tools/list");
    expect(tools.tools.map((tool: any) => tool.name)).toEqual([
      "create_and_wait_for_artifact",
      "update_and_wait_for_artifact",
    ]);

    const creating = client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "MCP bridge",
        kind: "implementation-plan",
        markdown: initialMarkdown,
      },
    });
    const artifactDirectory = await createdArtifactDirectory(fixture.workspace);
    const round1Manifest = await waitForRound(artifactDirectory, 1);
    expect(round1Manifest).toMatchObject({ schemaVersion: 4, reviewRound: 1 });
    expect(round1Manifest.reviewSessionId).toEqual(expect.any(String));
    await submitDecision(artifactDirectory, "revise");
    const review1 = await creating;
    expect(review1.structuredContent).toMatchObject({
      decision: "revise",
      kind: "implementation-plan",
      reviewRound: 1,
    });
    expect(review1.structuredContent.updateToken).toEqual(expect.any(String));

    const updatedMarkdown = "# Artifact\n\nBuild the bridge with recovery behavior.\n";
    const updating = client.request("tools/call", {
      name: "update_and_wait_for_artifact",
      arguments: {
        artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review1.structuredContent.updateToken,
        markdown: updatedMarkdown,
      },
    });
    const round2Manifest = await waitForRound(artifactDirectory, 2);
    expect(round2Manifest.reviewSessionId).toBe(round1Manifest.reviewSessionId);
    expect(await readFile(path.join(artifactDirectory, "artifact.md"), "utf8")).toBe(updatedMarkdown);
    await expect(access(path.join(artifactDirectory, "review-submission.json"))).rejects.toThrow();
    await submitDecision(artifactDirectory, "approve");
    const approved = await updating;
    expect(approved.structuredContent).toMatchObject({
      decision: "approve",
      kind: "implementation-plan",
      reviewRound: 2,
    });
    expect(approved.structuredContent.updateToken).toBeUndefined();
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toHaveLength(1);
    expect((await readdir(artifactDirectory)).some((file) => (
      file.includes(".next-") || file.includes(".previous-") || file === ".artifact-update.lock"
    ))).toBe(false);

    const reused = await client.request("tools/call", {
      name: "update_and_wait_for_artifact",
      arguments: {
        artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review1.structuredContent.updateToken,
        markdown: "# Reuse must fail\n",
      },
    });
    expect(reused.isError).toBe(true);
  });

  it("requires typed workspace evidence before creating storage", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const result = await client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        title: "No evidence",
        kind: "plan",
        markdown: "# No evidence\n",
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("WORKSPACE_EVIDENCE_REQUIRED");
    await expect(access(path.join(fixture.workspace, ".codex-artifacts"))).rejects.toThrow();
  });

  it("rejects inferred roots in multi-root workspaces and accepts an explicitly named folder", async () => {
    const fixture = await workspaceFixture();
    const scriptRunner = path.join(path.dirname(fixture.workspace), "script-runner");
    await mkdir(scriptRunner);
    const snapshotPath = path.join(fixture.registry, (await readdir(fixture.registry))[0]!);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    snapshot.folders.push({ path: scriptRunner, realPath: await realpath(scriptRunner) });
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    const client = startClient(fixture.registry);
    await initialize(client);
    const ambiguous = await client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: scriptRunner,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Inferred from package.json",
        kind: "plan",
        markdown: "# Must ask first\n",
      },
    });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0].text).toContain("AMBIGUOUS_WORKSPACE");
    await expect(access(path.join(scriptRunner, ".codex-artifacts"))).rejects.toThrow();

    const creating = client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: scriptRunner,
        workspaceEvidence: {
          kind: "explicit-user-folder",
          userText: "Hãy tạo artifact trong script-runner",
        },
        title: "Explicit script-runner plan",
        kind: "plan",
        markdown: "# Explicit workspace\n",
      },
    });
    await createdArtifactDirectory(scriptRunner);
    client.notify("notifications/cancelled", { requestId: 3 });
    const cancelled = await creating;
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content[0].text).toContain("cancelled");
  });

  it("rejects workspaces that are missing from or stale in the VS Code registry", async () => {
    const missing = await workspaceFixture();
    const emptyRegistry = path.join(path.dirname(missing.registry), "empty-registry");
    await mkdir(emptyRegistry);
    const missingClient = startClient(emptyRegistry);
    await initialize(missingClient);
    const missingResult = await missingClient.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: { workspaceRoot: missing.workspace, workspaceEvidence: singleWorkspaceEvidence, title: "Missing", kind: "plan", markdown: "# Missing\n" },
    });
    expect(missingResult.isError).toBe(true);
    expect(missingResult.content[0].text).toContain("WORKSPACE_NOT_REGISTERED");

    const stale = await workspaceFixture({ stale: true });
    const staleClient = startClient(stale.registry);
    await initialize(staleClient);
    const staleResult = await staleClient.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: { workspaceRoot: stale.workspace, workspaceEvidence: singleWorkspaceEvidence, title: "Stale", kind: "plan", markdown: "# Stale\n" },
    });
    expect(staleResult.isError).toBe(true);
    expect(staleResult.content[0].text).toContain("WORKSPACE_NOT_REGISTERED");
  });

  it("rejects oversized Markdown before creation and rolls back a partial create", async () => {
    const fixture = await workspaceFixture();
    const normalClient = startClient(fixture.registry);
    await initialize(normalClient);
    const oversized = await normalClient.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Oversized",
        kind: "plan",
        markdown: "x".repeat(2 * 1024 * 1024 + 1),
      },
    });
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0].text).toContain("exceeds");

    const failingClient = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_FAIL_CREATE: "after-manifest",
    });
    await initialize(failingClient);
    const partial = await failingClient.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Partial",
        kind: "plan",
        markdown: "# Partial\n",
      },
    });
    expect(partial.isError).toBe(true);
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toEqual([]);
  });

  it("rejects a linked artifact storage path without modifying its target", async () => {
    const fixture = await workspaceFixture();
    const outside = path.join(path.dirname(fixture.workspace), "outside");
    await mkdir(outside);
    await symlink(
      outside,
      path.join(fixture.workspace, ".codex-artifacts"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const client = startClient(fixture.registry);
    await initialize(client);
    const result = await client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Unsafe",
        kind: "plan",
        markdown: "# Unsafe\n",
      },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("UNSAFE_ARTIFACT_PATH");
    expect(await readdir(outside)).toEqual([]);
  });

  it("keeps a created artifact intact when its waiting tool call is cancelled", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const creating = client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Cancelled",
        kind: "plan",
        markdown: "# Cancelled\n",
      },
    });
    const artifactDirectory = await createdArtifactDirectory(fixture.workspace);
    client.notify("notifications/cancelled", { requestId: 2 });
    const cancelled = await creating;
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content[0].text).toContain("cancelled");
    expect(await readdir(artifactDirectory)).toEqual(expect.arrayContaining([
      "artifact.json",
      "artifact.md",
      "comments.json",
    ]));
  });

  it("allows only one concurrent update call to commit a review round", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);
    const creating = client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Concurrent update",
        kind: "implementation-plan",
        markdown: initialMarkdown,
      },
    });
    const artifactDirectory = await createdArtifactDirectory(fixture.workspace);
    await submitDecision(artifactDirectory, "revise");
    const review = await creating;
    const argumentsForUpdate = {
      artifactDirectory,
      expectedReviewRound: 1,
      updateToken: review.structuredContent.updateToken,
      markdown: "# Updated once\n",
    };
    const first = client.request("tools/call", { name: "update_and_wait_for_artifact", arguments: argumentsForUpdate });
    const second = client.request("tools/call", { name: "update_and_wait_for_artifact", arguments: argumentsForUpdate });
    await waitForRound(artifactDirectory, 2);
    await submitDecision(artifactDirectory, "approve");
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.structuredContent?.decision === "approve")).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 2 });
  });

  it.each(["artifact", "comments"] as const)(
    "rejects an update token when reviewed %s content changes",
    async (target) => {
      const fixture = await workspaceFixture();
      const client = startClient(fixture.registry);
      await initialize(client);
      const creating = client.request("tools/call", {
        name: "create_and_wait_for_artifact",
        arguments: {
          workspaceRoot: fixture.workspace,
          workspaceEvidence: singleWorkspaceEvidence,
          title: `Tampered ${target}`,
          kind: "implementation-plan",
          markdown: initialMarkdown,
        },
      });
      const artifactDirectory = await createdArtifactDirectory(fixture.workspace);
      await submitDecision(artifactDirectory, "revise");
      const review = await creating;
      await rewriteReviewedState(artifactDirectory, target);

      const result = await client.request("tools/call", {
        name: "update_and_wait_for_artifact",
        arguments: {
          artifactDirectory,
          expectedReviewRound: 1,
          updateToken: review.structuredContent.updateToken,
          markdown: "# Update must be rejected\n",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("no longer matches the reviewed content");
      expect(JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({
        reviewRound: 1,
      });
    },
  );

  it("rolls back a failed update without creating a replacement artifact", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_FAIL_UPDATE: "after-backup",
    });
    await initialize(client);
    const creating = client.request("tools/call", {
      name: "create_and_wait_for_artifact",
      arguments: {
        workspaceRoot: fixture.workspace,
        workspaceEvidence: singleWorkspaceEvidence,
        title: "Rollback",
        kind: "implementation-plan",
        markdown: initialMarkdown,
      },
    });
    const artifactDirectory = await createdArtifactDirectory(fixture.workspace);
    await submitDecision(artifactDirectory, "revise");
    const review = await creating;
    const failed = await client.request("tools/call", {
      name: "update_and_wait_for_artifact",
      arguments: {
        artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review.structuredContent.updateToken,
        markdown: "# Must roll back\n",
      },
    });
    expect(failed.isError).toBe(true);
    expect(await readFile(path.join(artifactDirectory, "artifact.md"), "utf8")).toBe(initialMarkdown);
    expect(JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toHaveLength(1);
  });
});
