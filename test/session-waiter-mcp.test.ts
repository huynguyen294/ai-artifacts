import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  artifactDirectory,
  conversationDirectory,
  workSessionWaiterRecordPath,
  workSessionWaiterRequestPath,
  workSessionWaitersDirectory,
} from "../src/shared/artifact-files";
import { ARTIFACT_SCHEMA_VERSION } from "../src/shared/contracts";
import { createSession, deleteSession } from "../src/shared/conversation-artifact-registry";
import {
  cancelSessionWaiter,
  cleanupExpiredSessionWaiters,
  readActiveSessionWaiters,
} from "../src/shared/session-waiter-store";

const MCP_BUNDLE_PATH = path.resolve(
  __dirname,
  "..",
  "dist",
  "integration",
  "codex-artifacts-review-mcp.mjs",
);

type PendingResponse = {
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
};

type McpTestClient = {
  child: ChildProcessWithoutNullStreams;
  stderrLines: string[];
  waitForStderrMatch: (pattern: RegExp, timeoutMs?: number) => Promise<RegExpMatchArray>;
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  callToolTracked: (
    name: string,
    args: Record<string, unknown>,
  ) => { id: number; sent: Promise<void>; promise: Promise<any> };
  notify: (method: string, params?: Record<string, unknown>) => void;
  waitForExit: (timeoutMs?: number) => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  close: () => Promise<void>;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function seedGlobalArtifact(options: {
  userHome: string;
  artifactId?: string;
  title?: string;
}): Promise<{ artifactId: string; title: string; artifactDir: string; artifactPath: string }> {
  const artifactId = options.artifactId ?? `artifact-${randomUUID().slice(0, 8)}`;
  const title = options.title ?? "Standalone Global Artifact";
  const artifactDir = artifactDirectory(artifactId, { userHome: options.userHome });
  await fs.mkdir(artifactDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });

  const now = new Date().toISOString();
  const artifactPath = path.join(artifactDir, ARTIFACT_MARKDOWN_FILE);
  await fs.writeFile(
    path.join(artifactDir, ARTIFACT_MANIFEST_FILE),
    `${JSON.stringify(
      {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        kind: "spec",
        artifactId,
        title,
        createdAt: now,
        updatedAt: now,
        reviewRound: 1,
        reviewSessionId: randomUUID(),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: OWNER_ONLY_FILE_MODE },
  );
  await fs.writeFile(artifactPath, "# Spec\n\nContent.\n", {
    encoding: "utf8",
    mode: OWNER_ONLY_FILE_MODE,
  });

  return { artifactId, title, artifactDir, artifactPath };
}

describe("session-waiter MCP multi-process integration", () => {
  const activeClients: McpTestClient[] = [];
  const tempRoots: string[] = [];

  async function createIsolatedHome(prefix = "ai-artifacts-mcp-waiter-"): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
  }

  function spawnMcpClient(options: {
    userHome: string;
    scriptPath?: string;
    cwd?: string;
    extraEnv?: Record<string, string>;
  }): McpTestClient {
    const child = spawn(process.execPath, [options.scriptPath ?? MCP_BUNDLE_PATH], {
      cwd: options.cwd ?? os.tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        CODEX_ARTIFACTS_TEST_USER_HOME: options.userHome,
        CODEX_ARTIFACTS_TEST_WAIT_READY: "1",
        ...(options.extraEnv ?? {}),
      },
    });

    const pendingRequests = new Map<number, PendingResponse>();
    const stderrLines: string[] = [];
    const stderrListeners = new Set<(line: string) => void>();
    let nextId = 1;

    const stdoutLines = createInterface({ input: child.stdout });
    stdoutLines.on("line", (line) => {
      if (!line.trim()) {
        return;
      }
      const message = JSON.parse(line);
      if (message.id !== undefined) {
        const waiter = pendingRequests.get(message.id);
        if (waiter) {
          pendingRequests.delete(message.id);
          if (message.error) {
            waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
          } else {
            waiter.resolve(message.result);
          }
        }
      }
    });

    const stderrRl = createInterface({ input: child.stderr });
    stderrRl.on("line", (line) => {
      stderrLines.push(line);
      for (const listener of stderrListeners) {
        listener(line);
      }
    });

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, signal) => {
          stdoutLines.close();
          stderrRl.close();
          for (const [, waiter] of pendingRequests) {
            waiter.reject(new Error(`MCP process exited before responding (code=${code}, signal=${signal}).`));
          }
          pendingRequests.clear();
          resolve({ code, signal });
        });
      },
    );

    const waitForStderrMatch = (pattern: RegExp, timeoutMs = 8_000): Promise<RegExpMatchArray> => {
      for (const existing of stderrLines) {
        const match = pattern.exec(existing);
        if (match) {
          return Promise.resolve(match);
        }
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          stderrListeners.delete(onLine);
          reject(
            new Error(
              `Timed out waiting for stderr pattern ${pattern}. Saw:\n${stderrLines.join("\n")}`,
            ),
          );
        }, timeoutMs);
        const onLine = (line: string): void => {
          const match = pattern.exec(line);
          if (match) {
            clearTimeout(timer);
            stderrListeners.delete(onLine);
            resolve(match);
          }
        };
        stderrListeners.add(onLine);
      });
    };

    const callToolTracked = (name: string, args: Record<string, unknown>) => {
      const id = nextId++;
      let resolveSent!: () => void;
      const sent = new Promise<void>((resolve) => {
        resolveSent = resolve;
      });
      const promise = new Promise<any>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        const payload = `${JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        })}\n`;
        child.stdin.write(payload, () => resolveSent());
      });
      return { id, sent, promise };
    };

    const request = (method: string, params?: Record<string, unknown>) => {
      const id = nextId++;
      return new Promise<any>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            ...(params ? { params } : {}),
          })}\n`,
        );
      });
    };

    const notify = (method: string, params?: Record<string, unknown>) => {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method,
          ...(params ? { params } : {}),
        })}\n`,
      );
    };

    const waitForExit = (timeoutMs = 8_000) =>
      Promise.race([
        exitPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for MCP child exit.")), timeoutMs),
        ),
      ]);

    const close = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end();
        const raced = await Promise.race([
          exitPromise.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_500)),
        ]);
        if (!raced && child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exitPromise;
        }
      }
    };

    const client: McpTestClient = {
      child,
      stderrLines,
      waitForStderrMatch,
      request,
      callToolTracked,
      notify,
      waitForExit,
      close,
    };
    activeClients.push(client);
    return client;
  }

  async function initialize(client: McpTestClient) {
    return client.request("initialize", {
      protocolVersion: "2025-06-18",
      clientInfo: { name: "session-waiter-test", version: "1.0.0" },
    });
  }

  afterEach(async () => {
    while (activeClients.length > 0) {
      const client = activeClients.pop();
      await client?.close();
    }
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("exposes wait_in_session and request_waiter_in_session with exact annotations and rejects unknown keys or invalid targets without artifact recovery hints", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Contract Session" });
    const client = spawnMcpClient({ userHome });
    await initialize(client);

    const catalog = await client.request("tools/list");
    const waitTool = catalog.tools.find((t: any) => t.name === "wait_in_session");
    const requestTool = catalog.tools.find((t: any) => t.name === "request_waiter_in_session");

    expect(waitTool).toMatchObject({
      name: "wait_in_session",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        required: ["sessionId", "waitingFor"],
        additionalProperties: false,
      },
    });
    expect(requestTool).toMatchObject({
      name: "request_waiter_in_session",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      inputSchema: {
        required: ["sessionId", "waitId", "requestMessage"],
        additionalProperties: false,
      },
    });

    const extraKeyRes = await client.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Waiting",
      unexpectedFlag: true,
    }).promise;
    expect(extraKeyRes.isError).toBe(true);
    expect(extraKeyRes.structuredContent.code).toBe("INVALID_ARTIFACT_INPUT");
    expect(extraKeyRes.structuredContent.expectedNextTool).toBeUndefined();
    expect(extraKeyRes.structuredContent.reuseRoundToken).toBeUndefined();

    const missingArtifactRes = await client.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Waiting",
      artifactId: "non-existent-artifact",
    }).promise;
    expect(missingArtifactRes.isError).toBe(true);
    expect(missingArtifactRes.structuredContent.code).toBe("ARTIFACT_NOT_FOUND");
    expect(missingArtifactRes.structuredContent.useSameArtifactHandle).toBeUndefined();

    const missingSessionRes = await client.callToolTracked("request_waiter_in_session", {
      sessionId: randomUUID(),
      waitId: randomUUID(),
      requestMessage: "Hello",
    }).promise;
    expect(missingSessionRes.isError).toBe(true);
    expect(missingSessionRes.structuredContent.code).toBe("CONVERSATION_NOT_FOUND");
    expect(missingSessionRes.structuredContent.expectedNextTool).toBeUndefined();
  });

  it("runs concurrent two-process waiters and third-process targeted routing cleanly (Tests 1 & 2)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Multi-Process Session" });
    const artifact = await seedGlobalArtifact({ userHome, title: "Target Plan" });

    const clientA = spawnMcpClient({ userHome });
    const clientB = spawnMcpClient({ userHome });
    const clientSender = spawnMcpClient({ userHome });
    await Promise.all([initialize(clientA), initialize(clientB), initialize(clientSender)]);

    const waitA = clientA.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      name: "Reviewer",
      waitingFor: "Code handoff",
    });
    const waitB = clientB.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      name: "reviewer",
      waitingFor: "Follow-up task",
    });

    const readyPattern = new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i");
    const [readyA, readyB] = await Promise.all([
      clientA.waitForStderrMatch(readyPattern),
      clientB.waitForStderrMatch(readyPattern),
    ]);
    const waitIdA = readyA[1]!;
    const waitIdB = readyB[1]!;
    expect(waitIdA).not.toBe(waitIdB);

    const activeWaiters = await readActiveSessionWaiters(session.sessionId, { userHome });
    expect(activeWaiters).toHaveLength(2);
    expect(activeWaiters.map((w) => w.name.toLowerCase()).sort()).toEqual(["reviewer", "reviewer (2)"]);
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitIdA, { userHome }))).toBe(true);
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitIdB, { userHome }))).toBe(true);

    // Send targeted request to Waiter A with optional artifact reference while B keeps waiting
    const sentA = await clientSender.callToolTracked("request_waiter_in_session", {
      sessionId: session.sessionId,
      waitId: waitIdA,
      requestMessage: "Please review Phase 1 diff",
      artifactId: artifact.artifactId,
    }).promise;
    expect(sentA.isError).not.toBe(true);
    expect(sentA.structuredContent).toMatchObject({
      status: "sent",
      sessionId: session.sessionId,
      waitId: waitIdA,
    });

    const resultA = await waitA.promise;
    expect(resultA.isError).not.toBe(true);
    expect(resultA.structuredContent).toMatchObject({
      status: "requested",
      sessionId: session.sessionId,
      waitId: waitIdA,
      request: {
        waitId: waitIdA,
        requestMessage: "Please review Phase 1 diff",
        artifact: {
          artifactId: artifact.artifactId,
          title: "Target Plan",
          artifactPath: artifact.artifactPath,
        },
      },
    });
    expect(JSON.parse(resultA.content[0].text)).toEqual(resultA.structuredContent);

    // Waiter B is still active until requested
    const remaining = await readActiveSessionWaiters(session.sessionId, { userHome });
    expect(remaining.map((w) => w.waitId)).toEqual([waitIdB]);

    const sentB = await clientSender.callToolTracked("request_waiter_in_session", {
      sessionId: session.sessionId,
      waitId: waitIdB,
      requestMessage: "Finish verification",
    }).promise;
    expect(sentB.structuredContent.status).toBe("sent");

    const resultB = await waitB.promise;
    expect(resultB.structuredContent).toMatchObject({
      status: "requested",
      sessionId: session.sessionId,
      waitId: waitIdB,
      request: {
        requestMessage: "Finish verification",
      },
    });
    expect(await readActiveSessionWaiters(session.sessionId, { userHome })).toEqual([]);
  });

  it("enforces single-winner when two independent sender processes race on one active waiter (Test 3)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Race Sender Session" });

    const waiterClient = spawnMcpClient({ userHome });
    const sender1 = spawnMcpClient({ userHome });
    const sender2 = spawnMcpClient({ userHome });
    await Promise.all([initialize(waiterClient), initialize(sender1), initialize(sender2)]);

    const waitCall = waiterClient.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Single request",
    });
    const ready = await waiterClient.waitForStderrMatch(
      new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i"),
    );
    const waitId = ready[1]!;

    const [res1, res2] = await Promise.all([
      sender1.callToolTracked("request_waiter_in_session", {
        sessionId: session.sessionId,
        waitId,
        requestMessage: "Message from sender 1",
      }).promise,
      sender2.callToolTracked("request_waiter_in_session", {
        sessionId: session.sessionId,
        waitId,
        requestMessage: "Message from sender 2",
      }).promise,
    ]);

    const results = [res1, res2];
    const successes = results.filter((res) => res.isError !== true);
    const errors = results.filter((res) => res.isError === true);
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(successes[0].structuredContent.status).toBe("sent");
    expect(["SESSION_WAITER_REQUEST_EXISTS", "SESSION_WAITER_NOT_WAITING"]).toContain(
      errors[0].structuredContent.code,
    );

    const waitResult = await waitCall.promise;
    expect(waitResult.structuredContent.status).toBe("requested");
    expect(["Message from sender 1", "Message from sender 2"]).toContain(
      waitResult.structuredContent.request.requestMessage,
    );
  });

  it("cleans up on simulated notifications/cancelled without affecting sibling waiter (Test 4)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Protocol Cancel Session" });

    const clientA = spawnMcpClient({ userHome });
    const clientB = spawnMcpClient({ userHome });
    const sender = spawnMcpClient({ userHome });
    await Promise.all([initialize(clientA), initialize(clientB), initialize(sender)]);

    const waitA = clientA.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      name: "AgentA",
      waitingFor: "Cancel test",
    });
    const waitB = clientB.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      name: "AgentB",
      waitingFor: "Sibling stays alive",
    });

    const pattern = new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i");
    const [readyA, readyB] = await Promise.all([
      clientA.waitForStderrMatch(pattern),
      clientB.waitForStderrMatch(pattern),
    ]);
    const waitIdA = readyA[1]!;
    const waitIdB = readyB[1]!;

    // Simulated MCP transport cancellation targeting Waiter A
    clientA.notify("notifications/cancelled", { requestId: waitA.id });
    const cancelledResA = await waitA.promise;
    expect(cancelledResA.isError).toBe(true);
    expect(cancelledResA.structuredContent.code).toBe("REQUEST_CANCELLED");

    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitIdA, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitIdB, { userHome }))).toBe(true);

    // Sibling B remains healthy and receives request normally
    await sender.callToolTracked("request_waiter_in_session", {
      sessionId: session.sessionId,
      waitId: waitIdB,
      requestMessage: "Still waiting cleanly",
    }).promise;
    const resB = await waitB.promise;
    expect(resB.structuredContent.status).toBe("requested");
    expect(resB.structuredContent.request.requestMessage).toBe("Still waiting cleanly");
  });

  it("handles external Stop helper and direct record deletion cleanly without heartbeat resurrection (Test 5)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "External Stop Session" });

    const client1 = spawnMcpClient({
      userHome,
      extraEnv: {
        CODEX_ARTIFACTS_TEST_WAITER_HEARTBEAT_MS: "50",
        CODEX_ARTIFACTS_TEST_WAITER_POLL_MS: "100",
      },
    });
    const client2 = spawnMcpClient({
      userHome,
      extraEnv: {
        CODEX_ARTIFACTS_TEST_WAITER_HEARTBEAT_MS: "40",
        CODEX_ARTIFACTS_TEST_WAITER_POLL_MS: "80",
      },
    });
    await Promise.all([initialize(client1), initialize(client2)]);

    const pattern = new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i");

    // 5a: Shared cancelSessionWaiter helper
    const wait1 = client1.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Cancel via helper",
    });
    const ready1 = await client1.waitForStderrMatch(pattern);
    const waitId1 = ready1[1]!;

    await cancelSessionWaiter({ sessionId: session.sessionId, waitId: waitId1 }, { userHome });
    const res1 = await wait1.promise;
    expect(res1.isError).not.toBe(true);
    expect(res1.structuredContent).toEqual({
      status: "cancelled",
      sessionId: session.sessionId,
      waitId: waitId1,
      reason: "waiter-removed",
    });

    // 5b: Direct record unlink -> heartbeat never recreates record
    const wait2 = client2.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Direct record unlink",
    });
    const ready2 = await client2.waitForStderrMatch(pattern);
    const waitId2 = ready2[1]!;
    const recordPath2 = workSessionWaiterRecordPath(session.sessionId, waitId2, { userHome });

    await new Promise((resolve) => setTimeout(resolve, 90));
    await fs.unlink(recordPath2);
    const res2 = await wait2.promise;
    expect(res2.isError).not.toBe(true);
    expect(res2.structuredContent).toEqual({
      status: "cancelled",
      sessionId: session.sessionId,
      waitId: waitId2,
      reason: "waiter-removed",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await pathExists(recordPath2)).toBe(false);
  });

  it("drops and cleans up expired waiter after owner SIGKILL using simulated short test lease TTL (Test 6)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Crash Expiry Session" });

    // Simulated short lease timing via test-only env override (does not claim waiting full production 60s TTL).
    const crashClient = spawnMcpClient({
      userHome,
      extraEnv: {
        CODEX_ARTIFACTS_TEST_WAITER_LEASE_TTL_MS: "220",
        CODEX_ARTIFACTS_TEST_WAITER_HEARTBEAT_MS: "5000",
        CODEX_ARTIFACTS_TEST_WAITER_POLL_MS: "100",
      },
    });
    const sender = spawnMcpClient({ userHome });
    await Promise.all([initialize(crashClient), initialize(sender)]);

    const crashWait = crashClient.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Before SIGKILL",
    });
    crashWait.promise.catch(() => undefined);
    const ready = await crashClient.waitForStderrMatch(
      new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i"),
    );
    const killedWaitId = ready[1]!;
    const killedRecordPath = workSessionWaiterRecordPath(session.sessionId, killedWaitId, { userHome });

    // Kill immediately so finally cleanup never executes
    crashClient.child.kill("SIGKILL");
    await crashClient.waitForExit();
    await expect(crashWait.promise).rejects.toThrow(/exited before responding/i);
    expect(await pathExists(killedRecordPath)).toBe(true);

    // Wait past simulated 220ms leaseTtlMs
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await readActiveSessionWaiters(session.sessionId, { userHome })).toEqual([]);

    const sendLate = await sender.callToolTracked("request_waiter_in_session", {
      sessionId: session.sessionId,
      waitId: killedWaitId,
      requestMessage: "Dead waiter",
    }).promise;
    expect(sendLate.isError).toBe(true);
    expect(sendLate.structuredContent.code).toBe("SESSION_WAITER_NOT_WAITING");
    const waiterErrLines = sendLate.content[0].text.split("\n");
    const waiterErrMetaRaw = waiterErrLines.at(-1)!;
    const waiterErrMsg = waiterErrLines.slice(0, -1).join("\n");
    expect(waiterErrMsg).toContain("SESSION_WAITER_NOT_WAITING");
    expect(JSON.parse(waiterErrMetaRaw)).toEqual({
      code: "SESSION_WAITER_NOT_WAITING",
      sessionId: session.sessionId,
      waitId: killedWaitId,
    });
    expect(await pathExists(workSessionWaiterRequestPath(session.sessionId, killedWaitId, { userHome }))).toBe(
      false,
    );

    const cleanup = await cleanupExpiredSessionWaiters(session.sessionId, { userHome });
    expect(cleanup.removedWaiters).toBe(1);
    expect(await pathExists(killedRecordPath)).toBe(false);
  });

  it("completes with session-deleted when active Session is deleted without recreating dirs or deleting global artifacts (Test 7)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "Session Delete Test" });
    const artifact = await seedGlobalArtifact({ userHome, title: "Preserved Global Artifact" });

    const client = spawnMcpClient({
      userHome,
      extraEnv: {
        CODEX_ARTIFACTS_TEST_WAITER_POLL_MS: "50",
        CODEX_ARTIFACTS_TEST_WAITER_HEARTBEAT_MS: "40",
      },
    });
    await initialize(client);

    const waitCall = client.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Session delete check",
      artifactId: artifact.artifactId,
    });
    const ready = await client.waitForStderrMatch(
      new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i"),
    );
    const waitId = ready[1]!;

    await deleteSession(session.sessionId, { userHome });
    const res = await waitCall.promise;
    expect(res.isError).not.toBe(true);
    expect(res.structuredContent).toEqual({
      status: "cancelled",
      sessionId: session.sessionId,
      waitId,
      reason: "session-deleted",
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await pathExists(conversationDirectory(session.sessionId, { userHome }))).toBe(false);
    expect(await pathExists(artifact.artifactPath)).toBe(true);
  });

  it("cleans up waiter record on normal STDIN EOF exit without orphaned record (Test 8)", async () => {
    const userHome = await createIsolatedHome();
    const session = await createSession({ userHome, title: "STDIN EOF Cleanup Session" });

    const client = spawnMcpClient({ userHome });
    await initialize(client);

    const waitCall = client.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      waitingFor: "Wait until stdin EOF",
    });
    // Prevent unhandled rejection when exit clears pending map before exit completes
    waitCall.promise.catch(() => undefined);

    const ready = await client.waitForStderrMatch(
      new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i"),
    );
    const waitId = ready[1]!;
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitId, { userHome }))).toBe(true);

    client.child.stdin.end();
    const exitInfo = await client.waitForExit();
    expect(exitInfo.code).toBe(0);
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, waitId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaitersDirectory(session.sessionId, { userHome }))).toBe(true);
    expect(await readActiveSessionWaiters(session.sessionId, { userHome })).toEqual([]);
  });

  it("runs as a standalone copied .mjs bundle in an isolated directory with no node_modules (Test 9)", async () => {
    const userHome = await createIsolatedHome("ai-artifacts-standalone-home-");
    const standaloneDir = await createIsolatedHome("ai-artifacts-standalone-bin-");
    const copiedBundlePath = path.join(standaloneDir, "codex-artifacts-review-mcp.mjs");
    await fs.copyFile(MCP_BUNDLE_PATH, copiedBundlePath);

    // Ensure no node_modules folder is beside or above the isolated bundle directory
    expect(await pathExists(path.join(standaloneDir, "node_modules"))).toBe(false);
    expect(await pathExists(path.join(path.dirname(standaloneDir), "node_modules"))).toBe(false);

    const session = await createSession({ userHome, title: "Standalone Bundle Session" });

    const waiterClient = spawnMcpClient({
      userHome,
      scriptPath: copiedBundlePath,
      cwd: standaloneDir,
    });
    const senderClient = spawnMcpClient({
      userHome,
      scriptPath: copiedBundlePath,
      cwd: standaloneDir,
    });
    await Promise.all([initialize(waiterClient), initialize(senderClient)]);

    const catalog = await waiterClient.request("tools/list");
    expect(catalog.tools).toHaveLength(9);
    expect(catalog.tools.map((tool: any) => tool.name)).toContain("wait_in_session");
    expect(catalog.tools.map((tool: any) => tool.name)).toContain("request_waiter_in_session");

    const waitCall = waiterClient.callToolTracked("wait_in_session", {
      sessionId: session.sessionId,
      name: "StandaloneAgent",
      waitingFor: "Standalone verification",
    });
    const ready = await waiterClient.waitForStderrMatch(
      new RegExp(`^SESSION_WAITER_READY:${session.sessionId}:([0-9a-f-]+)$`, "i"),
    );
    const waitId = ready[1]!;

    const sent = await senderClient.callToolTracked("request_waiter_in_session", {
      sessionId: session.sessionId,
      waitId,
      requestMessage: "Executed from standalone copied bundle",
    }).promise;
    expect(sent.structuredContent.status).toBe("sent");

    const received = await waitCall.promise;
    expect(received.structuredContent).toMatchObject({
      status: "requested",
      sessionId: session.sessionId,
      waitId,
      request: {
        requestMessage: "Executed from standalone copied bundle",
      },
    });
  });
});
