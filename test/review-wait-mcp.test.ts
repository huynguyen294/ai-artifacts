import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const initialMarkdown = "# Artifact\n\nBuild the MCP review bridge.\n";

function reviewComment(id: string, body: string): Record<string, unknown> {
  return {
    id,
    createdAt: new Date().toISOString(),
    block: { id: "paragraph-001", type: "paragraph", heading: null },
    selection: {
      quote: "review bridge",
      start: 14,
      end: 27,
      prefix: "Build the MCP ",
      suffix: ".",
    },
    body,
  };
}

function commentsDocument(
  markdown: string,
  reviewRound: number,
  comments: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    artifactId: "artifact-mcp-001",
    reviewRound,
    artifactSha256: sha256(markdown),
    comments,
  };
}

function submission(
  decision: "revise" | "approve" | "save",
  markdown: string,
  reviewRound: number,
  commentsRaw: string,
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    artifactId: "artifact-mcp-001",
    reviewRound,
    threadId: "thread-mcp-001",
    submittedAt: new Date().toISOString(),
    decision,
    artifactSha256: sha256(markdown),
    commentsSha256: sha256(commentsRaw),
  };
}

async function artifactFixture(): Promise<{
  workspace: string;
  artifactDirectory: string;
  commentsRaw: string;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "codex-artifacts-mcp-"));
  temporaryDirectories.push(workspace);
  const artifactId = "artifact-mcp-001";
  const artifactDirectory = path.join(workspace, ".codex-artifacts", "artifacts", artifactId);
  await mkdir(artifactDirectory, { recursive: true });
  const commentsRaw = `${JSON.stringify(commentsDocument(initialMarkdown, 1, [
    reviewComment("00000000-0000-4000-8000-000000000001", "Add recovery behavior."),
  ]), null, 2)}\n`;
  const timestamp = new Date().toISOString();
  await writeFile(path.join(artifactDirectory, "artifact.json"), `${JSON.stringify({
    schemaVersion: 3,
    kind: "implementation-plan",
    artifactId,
    title: "MCP bridge",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    location: { workspaceRoot: workspace },
    origin: { codexCwd: workspace, threadId: "thread-mcp-001" },
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactDirectory, "artifact.md"), initialMarkdown, "utf8");
  await writeFile(path.join(artifactDirectory, "comments.json"), commentsRaw, "utf8");
  return { workspace, artifactDirectory, commentsRaw };
}

function startClient(environment: NodeJS.ProcessEnv = process.env): {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  notify: (method: string, params?: Record<string, unknown>) => void;
} {
  const script = path.resolve("dist", "integration", "codex-artifacts-review-mcp.mjs");
  const processHandle = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"], env: environment });
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

afterEach(async () => {
  for (const processHandle of processes.splice(0)) processHandle.kill();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact review MCP server", () => {
  it("updates the same artifact through multiple review rounds with one-time tokens", async () => {
    const fixture = await artifactFixture();
    const client = startClient();
    const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
    expect(initialized.instructions).toContain("update_artifact");
    client.notify("notifications/initialized");
    const tools = await client.request("tools/list");
    expect(tools.tools.map((tool: any) => tool.name)).toEqual([
      "wait_for_artifact_review",
      "update_artifact",
    ]);

    const waitingRound1 = client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(submission("revise", initialMarkdown, 1, fixture.commentsRaw), null, 2)}\n`,
      "utf8",
    );
    const review1 = await waitingRound1;
    expect(review1.structuredContent).toMatchObject({
      artifactId: "artifact-mcp-001",
      reviewRound: 1,
      decision: "revise",
    });
    expect(review1.structuredContent.updateToken).toEqual(expect.any(String));

    const round2Markdown = "# Artifact\n\nBuild the bridge with recovery behavior.\n";
    const update1 = await client.request("tools/call", {
      name: "update_artifact",
      arguments: {
        artifactDirectory: fixture.artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review1.structuredContent.updateToken,
        markdown: round2Markdown,
      },
    });
    expect(update1.structuredContent).toMatchObject({ artifactId: "artifact-mcp-001", reviewRound: 2 });
    expect(await readFile(path.join(fixture.artifactDirectory, "artifact.md"), "utf8")).toBe(round2Markdown);
    const round2Manifest = JSON.parse(await readFile(path.join(fixture.artifactDirectory, "artifact.json"), "utf8"));
    const round2Comments = JSON.parse(await readFile(path.join(fixture.artifactDirectory, "comments.json"), "utf8"));
    expect(round2Manifest).toMatchObject({ artifactId: "artifact-mcp-001", reviewRound: 2 });
    expect(round2Comments).toMatchObject({ reviewRound: 2, artifactSha256: sha256(round2Markdown), comments: [] });
    await expect(access(path.join(fixture.artifactDirectory, "review-submission.json"))).rejects.toThrow();
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toEqual(["artifact-mcp-001"]);
    expect((await readdir(fixture.artifactDirectory)).some((file) => (
      file.includes(".next-") || file.includes(".previous-") || file === ".artifact-update.lock"
    ))).toBe(false);

    const reused = await client.request("tools/call", {
      name: "update_artifact",
      arguments: {
        artifactDirectory: fixture.artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review1.structuredContent.updateToken,
        markdown: "# Reuse must fail\n",
      },
    });
    expect(reused.isError).toBe(true);

    const round2CommentsRaw = `${JSON.stringify(commentsDocument(round2Markdown, 2, [
      reviewComment("00000000-0000-4000-8000-000000000002", "Clarify rollback."),
    ]), null, 2)}\n`;
    await writeFile(path.join(fixture.artifactDirectory, "comments.json"), round2CommentsRaw, "utf8");
    const waitingRound2 = client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(submission("revise", round2Markdown, 2, round2CommentsRaw), null, 2)}\n`,
      "utf8",
    );
    const review2 = await waitingRound2;
    const update2 = await client.request("tools/call", {
      name: "update_artifact",
      arguments: {
        artifactDirectory: fixture.artifactDirectory,
        expectedReviewRound: 2,
        updateToken: review2.structuredContent.updateToken,
        markdown: "# Artifact\n\nFinal round.\n",
      },
    });
    expect(update2.structuredContent.reviewRound).toBe(3);
    expect(await readdir(path.join(fixture.workspace, ".codex-artifacts", "artifacts"))).toEqual(["artifact-mcp-001"]);
  });

  it("returns Just save without granting an update token", async () => {
    const fixture = await artifactFixture();
    const client = startClient();
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const waiting = client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(submission("save", initialMarkdown, 1, fixture.commentsRaw), null, 2)}\n`,
      "utf8",
    );
    const result = await waiting;
    expect(result.structuredContent).toMatchObject({ decision: "save", reviewRound: 1 });
    expect(result.structuredContent.updateToken).toBeUndefined();
  });

  it("updates an open artifact when Windows blocks rename replacement", async () => {
    const fixture = await artifactFixture();
    const client = startClient({
      ...process.env,
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_LOCK_ARTIFACT: "1",
    });
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const waiting = client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(submission("revise", initialMarkdown, 1, fixture.commentsRaw), null, 2)}\n`,
      "utf8",
    );
    const review = await waiting;
    const updatedMarkdown = "# Artifact\n\nUpdate without closing the review editor.\n";
    const update = await client.request("tools/call", {
      name: "update_artifact",
      arguments: {
        artifactDirectory: fixture.artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review.structuredContent.updateToken,
        markdown: updatedMarkdown,
      },
    });

    expect(update.isError).not.toBe(true);
    expect(update.structuredContent.reviewRound).toBe(2);
    expect(await readFile(path.join(fixture.artifactDirectory, "artifact.md"), "utf8")).toBe(updatedMarkdown);
    expect((await readdir(fixture.artifactDirectory)).some((file) => (
      file.includes(".next-") || file.includes(".previous-") || file === ".artifact-update.lock"
    ))).toBe(false);
  });

  it("rolls back all files when a review-round transaction fails", async () => {
    const fixture = await artifactFixture();
    const client = startClient({ ...process.env, NODE_ENV: "test", CODEX_ARTIFACTS_TEST_FAIL_UPDATE: "after-backup" });
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const waiting = client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const submissionRaw = `${JSON.stringify(submission("revise", initialMarkdown, 1, fixture.commentsRaw), null, 2)}\n`;
    await writeFile(path.join(fixture.artifactDirectory, "review-submission.json"), submissionRaw, "utf8");
    const review = await waiting;
    const update = await client.request("tools/call", {
      name: "update_artifact",
      arguments: {
        artifactDirectory: fixture.artifactDirectory,
        expectedReviewRound: 1,
        updateToken: review.structuredContent.updateToken,
        markdown: "# Must roll back\n",
      },
    });
    expect(update.isError).toBe(true);
    expect(await readFile(path.join(fixture.artifactDirectory, "artifact.md"), "utf8")).toBe(initialMarkdown);
    expect(JSON.parse(await readFile(path.join(fixture.artifactDirectory, "artifact.json"), "utf8"))).toMatchObject({ reviewRound: 1 });
    expect(await readFile(path.join(fixture.artifactDirectory, "comments.json"), "utf8")).toBe(fixture.commentsRaw);
    expect(await readFile(path.join(fixture.artifactDirectory, "review-submission.json"), "utf8")).toBe(submissionRaw);
    expect((await readdir(fixture.artifactDirectory)).some((file) => (
      file.includes(".next-") || file.includes(".previous-") || file === ".artifact-update.lock"
    ))).toBe(false);
  });

  it("rejects invalid current comments even when the submission hash matches", async () => {
    const fixture = await artifactFixture();
    const invalidCommentsRaw = `${JSON.stringify({
      ...commentsDocument(initialMarkdown, 1, []),
      artifactId: "another-artifact",
    }, null, 2)}\n`;
    await writeFile(path.join(fixture.artifactDirectory, "comments.json"), invalidCommentsRaw, "utf8");
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(submission("approve", initialMarkdown, 1, invalidCommentsRaw), null, 2)}\n`,
      "utf8",
    );
    const client = startClient();
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const result = await client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects an artifact outside its declared workspace root", async () => {
    const fixture = await artifactFixture();
    const manifestPath = path.join(fixture.artifactDirectory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.location.workspaceRoot = path.join(fixture.workspace, "another-root");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const client = startClient();
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const result = await client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    expect(result.isError).toBe(true);
  });
});
