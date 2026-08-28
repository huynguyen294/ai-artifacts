import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];
const planMarkdown = "# Plan\n\nBuild the MCP review bridge.\n";

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

function commentsDocument(comments: Record<string, unknown>[]): Record<string, unknown> {
  return {
    schemaVersion: 2,
    artifactId: "plan-mcp-001",
    planSha256: sha256(planMarkdown),
    comments,
  };
}

async function artifactFixture(): Promise<{
  artifactDirectory: string;
  submission: Record<string, unknown>;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "codex-artifacts-mcp-"));
  temporaryDirectories.push(workspace);
  const artifactId = "plan-mcp-001";
  const artifactDirectory = path.join(workspace, ".codex-artifacts", "plans", artifactId);
  await mkdir(artifactDirectory, { recursive: true });
  const comments = `${JSON.stringify(commentsDocument([
    reviewComment("00000000-0000-4000-8000-000000000001", "Add recovery behavior."),
  ]), null, 2)}\n`;
  await writeFile(path.join(artifactDirectory, "artifact.json"), `${JSON.stringify({
    schemaVersion: 2,
    kind: "plan",
    artifactId,
    title: "MCP bridge",
    createdAt: new Date().toISOString(),
    operation: "create",
    location: { workspaceRoot: workspace },
    origin: { codexCwd: path.dirname(workspace), threadId: "thread-mcp-001" },
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(artifactDirectory, "plan.md"), planMarkdown, "utf8");
  await writeFile(path.join(artifactDirectory, "comments.json"), comments, "utf8");
  return {
    artifactDirectory,
    submission: {
      schemaVersion: 2,
      artifactId,
      threadId: "thread-mcp-001",
      submittedAt: new Date().toISOString(),
      decision: "revise",
      planSha256: sha256(planMarkdown),
      commentsSha256: sha256(comments),
    },
  };
}

function startClient(): {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  notify: (method: string, params?: Record<string, unknown>) => void;
} {
  const script = path.resolve("dist", "integration", "codex-artifacts-review-mcp.mjs");
  const processHandle = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "pipe"] });
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

describe("review wait MCP server", () => {
  it("advertises the waiting tool and returns a submitted revision to the same thread", async () => {
    const fixture = await artifactFixture();
    const client = startClient();
    const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
    expect(initialized.serverInfo.name).toBe("codex-artifacts");
    expect(initialized.instructions).toContain("save");
    client.notify("notifications/initialized");
    const tools = await client.request("tools/list");
    expect(tools.tools[0]).toMatchObject({ name: "wait_for_plan_review" });
    expect(tools.tools[0].description).toContain("save");

    const waiting = client.request("tools/call", {
      name: "wait_for_plan_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(fixture.submission, null, 2)}\n`,
      "utf8",
    );

    const result = await waiting;
    expect(result.structuredContent).toMatchObject({
      artifactId: "plan-mcp-001",
      workspaceRoot: path.dirname(path.dirname(path.dirname(fixture.artifactDirectory))),
      threadId: "thread-mcp-001",
      decision: "revise",
    });
    expect(result.isError).not.toBe(true);
  });

  it("accepts comments added during the review wait lifecycle and handles save decision", async () => {
    const fixture = await artifactFixture();
    const client = startClient();
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    client.notify("notifications/initialized");

    const waiting = client.request("tools/call", {
      name: "wait_for_plan_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const updatedComments = `${JSON.stringify(commentsDocument([
      reviewComment("00000000-0000-4000-8000-000000000001", "Add recovery behavior."),
      reviewComment("00000000-0000-4000-8000-000000000002", "Second comment added during review."),
    ]), null, 2)}\n`;
    await writeFile(path.join(fixture.artifactDirectory, "comments.json"), updatedComments, "utf8");

    const saveSubmission = {
      schemaVersion: 2,
      artifactId: "plan-mcp-001",
      threadId: "thread-mcp-001",
      submittedAt: new Date().toISOString(),
      decision: "save",
      planSha256: sha256(planMarkdown),
      commentsSha256: sha256(updatedComments),
    };
    await writeFile(
      path.join(fixture.artifactDirectory, "review-submission.json"),
      `${JSON.stringify(saveSubmission, null, 2)}\n`,
      "utf8",
    );

    const result = await waiting;
    expect(result.structuredContent).toMatchObject({
      artifactId: "plan-mcp-001",
      threadId: "thread-mcp-001",
      decision: "save",
    });
    expect(result.isError).not.toBe(true);
  });

  it("rejects comments that become invalid while waiting even when the submission hash matches", async () => {
    const invalidDocuments: Record<string, unknown>[] = [
      { ...commentsDocument([]), schemaVersion: 1 },
      { ...commentsDocument([]), artifactId: "another-artifact" },
      commentsDocument([{ id: "not-a-valid-comment" }]),
    ];

    for (const invalidDocument of invalidDocuments) {
      const fixture = await artifactFixture();
      const client = startClient();
      await client.request("initialize", { protocolVersion: "2025-06-18" });
      client.notify("notifications/initialized");

      const waiting = client.request("tools/call", {
        name: "wait_for_plan_review",
        arguments: { artifactDirectory: fixture.artifactDirectory },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const invalidCommentsRaw = `${JSON.stringify(invalidDocument, null, 2)}\n`;
      await writeFile(path.join(fixture.artifactDirectory, "comments.json"), invalidCommentsRaw, "utf8");
      await writeFile(
        path.join(fixture.artifactDirectory, "review-submission.json"),
        `${JSON.stringify({
          ...fixture.submission,
          decision: "approve",
          commentsSha256: sha256(invalidCommentsRaw),
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await waiting;
      expect(result.isError).toBe(true);
    }
  });

  it("rejects an artifact directory outside its declared workspace root", async () => {
    const fixture = await artifactFixture();
    const manifestPath = path.join(fixture.artifactDirectory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.location.workspaceRoot = path.join(path.dirname(manifest.location.workspaceRoot), "another-root");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const client = startClient();
    await client.request("initialize", { protocolVersion: "2025-06-18" });
    const result = await client.request("tools/call", {
      name: "wait_for_plan_review",
      arguments: { artifactDirectory: fixture.artifactDirectory },
    });
    expect(result.isError).toBe(true);
  });
});
