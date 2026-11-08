import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import {
  conversationRegistryRoot,
  globalArtifactsRoot,
  sessionTypesFilePath,
  OWNER_ONLY_FILE_MODE,
} from "../src/shared/artifact-files";
import {
  createSession,
} from "../src/shared/conversation-artifact-registry";
import { ARTIFACT_SCHEMA_VERSION, MCP_VERSION } from "../src/shared/contracts";

const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];

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
  await writeFile(temporaryPath, value, {
    encoding: "utf8",
    mode: OWNER_ONLY_FILE_MODE,
  });
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

async function workspaceFixture(): Promise<{
  workspace: string;
  registry: string;
  userHome: string;
  globalRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "ai-artifacts-mcp-join-"));
  temporaryDirectories.push(root);
  const workspace = path.join(root, "workspace");
  const registry = path.join(root, "registry");
  const userHome = path.join(root, "home");
  await Promise.all([mkdir(workspace), mkdir(registry), mkdir(userHome)]);
  const now = Date.now();
  const instanceId = randomUUID();
  await writeFile(
    path.join(registry, `${instanceId}.json`),
    `${JSON.stringify({
      schemaVersion: 2,
      instanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders: [{ path: workspace, realPath: await realpath(workspace) }],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
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
    const sent = new Promise<void>((resolve) => {
      markSent = resolve;
    });
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
  expect(initialized.serverInfo.version).toBe(String(MCP_VERSION));
  client.notify("notifications/initialized");
}

async function callTool(client: TestClient, name: string, args: Record<string, unknown>): Promise<any> {
  return client.request("tools/call", { name, arguments: args });
}

async function createArtifact(
  client: TestClient,
  workspace: string,
  overrides: Record<string, unknown> = {},
): Promise<any> {
  const result = await callTool(client, "create_artifact", {
    title: "Test Artifact",
    kind: "spec",
    markdown: "# Title\n\nContent for testing.\n",
    ...overrides,
  });
  return result.structuredContent;
}

function comment(body: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    block: { id: "paragraph-001", type: "paragraph", heading: null },
    selection: { quote: "Content for testing", start: 10, end: 29, prefix: "Title\n\n", suffix: "." },
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
  const [manifestRaw, markdown] = await Promise.all([
    readFile(path.join(artifactDirectory, "artifact.json"), "utf8"),
    readFile(path.join(artifactDirectory, "artifact.md"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const submissionRaw = `${JSON.stringify({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: manifest.artifactId,
    reviewRound: manifest.reviewRound,
    reviewSessionId: manifest.reviewSessionId,
    submittedAt: new Date().toISOString(),
    decision,
    artifactSha256: sha256(markdown),
    commentsSha256: sha256(commentsRaw),
  }, null, 2)}\n`;
  await atomicWrite(path.join(artifactDirectory, "review-submission.json"), submissionRaw);
}

describe("join_session MCP tool & proceed directives", () => {
  afterEach(async () => {
    for (const processHandle of processes) {
      processHandle.kill();
    }
    processes.length = 0;
    for (const temporaryDirectory of temporaryDirectories) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
    temporaryDirectories.length = 0;
  });
  it("tools/list exposes 6 tools including join_session with exact schema", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const toolsResponse = await client.request("tools/list");
    const toolNames = toolsResponse.tools.map((t: any) => t.name);
    expect(toolNames).toEqual([
      "resolve_artifact_window",
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact_review",
      "join_session",
      "advance_and_wait_for_artifact",
    ]);

    const joinTool = toolsResponse.tools.find((t: any) => t.name === "join_session");
    expect(joinTool).toBeDefined();
    expect(joinTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(joinTool.inputSchema.required).toEqual(["sessionId"]);
    expect(joinTool.inputSchema.additionalProperties).toBe(false);
    expect(joinTool.inputSchema.properties.sessionId.type).toBe("string");
    expect(joinTool.inputSchema.properties.sessionId.format).toBe("uuid");
    expect(joinTool.inputSchema.properties.artifactId.type).toBe("string");
  });

  it("join_session({ sessionId }) returns { session } read-only, without touching waiters or seeding session-types.json", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    // Create a session in isolated home
    const session = await createSession({
      userHome: fixture.userHome,
      title: "Isolated Test Session",
    });

    // Verify session-types.json does NOT exist initially
    const typesPath = sessionTypesFilePath({ userHome: fixture.userHome });
    await expect(access(typesPath)).rejects.toThrow();

    // Call join_session with only sessionId
    const result = await callTool(client, "join_session", {
      sessionId: session.sessionId,
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty("session");
    expect(result.structuredContent.session.sessionId).toBe(session.sessionId);
    expect(result.structuredContent.session.title).toBe("Isolated Test Session");
    expect(result.structuredContent.session.typeLabel).toBe("Conversation");
    expect(result.structuredContent.session.catalog).toMatchObject({
      working: [],
      references: [],
      archived: [],
    });
    // Join-only must NOT have inspection or roundToken
    expect(result.structuredContent.inspection).toBeUndefined();
    expect(result.structuredContent.roundToken).toBeUndefined();

    // Verify text content is strict JSON matching structuredContent
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);

    // Verify session-types.json was NOT seeded by join_session
    await expect(access(typesPath)).rejects.toThrow();
  });

  it("join_session without artifactId rejects inspect options (takeover, expectedReviewRound, intent, connection)", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const session = await createSession({
      userHome: fixture.userHome,
      title: "Test Session",
    });

    const result = await callTool(client, "join_session", {
      sessionId: session.sessionId,
      takeover: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Inspect options (takeover, expectedReviewRound, intent, connection) require artifactId.");
  });

  it("join_session fails with CONVERSATION_NOT_FOUND when sessionId does not exist, with expectedNextTool join_session", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const nonExistentSessionId = randomUUID();
    const result = await callTool(client, "join_session", {
      sessionId: nonExistentSessionId,
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
      retryable: false,
      expectedNextTool: "join_session",
    });
  });

  it("join_session({ sessionId, artifactId }) returns { session, inspection } and updates membership", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    // Create session
    const session = await createSession({
      userHome: fixture.userHome,
      title: "Multi-artifact Session",
    });

    // Create artifact
    const artifact = await createArtifact(client, fixture.workspace, {
      title: "Spec for Join",
      kind: "spec",
      markdown: "# Spec\n\nTesting join with artifact.\n",
    });

    // Call join_session with both sessionId and artifactId
    const joinResult = await callTool(client, "join_session", {
      sessionId: session.sessionId,
      artifactId: artifact.artifactId,
    });

    expect(joinResult.isError).toBeFalsy();
    expect(joinResult.structuredContent.session).toBeDefined();
    expect(joinResult.structuredContent.session.sessionId).toBe(session.sessionId);
    expect(joinResult.structuredContent.session.catalog.working.length).toBe(1);
    expect(joinResult.structuredContent.session.catalog.working[0].artifactId).toBe(artifact.artifactId);

    // Inspection handle shape
    const inspection = joinResult.structuredContent.inspection;
    expect(inspection).toBeDefined();
    expect(inspection.artifactId).toBe(artifact.artifactId);
    expect(inspection.artifactConversationId).toBe(session.sessionId);
    expect(inspection.manifest.title).toBe("Spec for Join");
    expect(inspection.manifest.kind).toBe("spec");
    expect(inspection.markdown).toBe("# Spec\n\nTesting join with artifact.\n");
    expect(inspection.comments).toBeDefined();
  });

  it("wait_for_artifact_review returns approved nextAction for non-plan kinds (idea, checklist, workaround)", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    for (const kind of ["idea", "checklist", "workaround"]) {
      const created = await createArtifact(client, fixture.workspace, {
        title: `Test ${kind}`,
        kind,
        markdown: `# ${kind}\n\nContent for testing.\n`,
      });

      await submitDecision(created.artifactDirectory, "approve", ["LGTM"]);

      const waitResult = await callTool(client, "wait_for_artifact_review", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
      });

      expect(waitResult.isError, waitResult.content?.[0]?.text).toBeFalsy();
      expect(waitResult.structuredContent.decision).toBe("approve");
      expect(waitResult.structuredContent.kind).toBe(kind);
      expect(waitResult.structuredContent.nextAction).toMatchObject({
        type: "approved",
        instruction:
          "The user has approved this artifact. Acknowledge the approval and conclude the review. Do not automatically implement code or start another review round.",
      });
      expect(waitResult.structuredContent.roundToken).toBeUndefined();
    }
  });

  it("join_session validates takeover must be a boolean", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const session = await createSession({
      userHome: fixture.userHome,
      title: "Test Session",
    });

    const artifact = await createArtifact(client, fixture.workspace, {
      title: "Test Artifact",
      kind: "spec",
      markdown: "# Title\n\nContent.\n",
    });

    const result = await callTool(client, "join_session", {
      sessionId: session.sessionId,
      artifactId: artifact.artifactId,
      takeover: "true",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("INVALID_ARTIFACT_INPUT: takeover must be a boolean.");
  });

  it("join_session rejects connection when intent is not reconnect", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const session = await createSession({
      userHome: fixture.userHome,
      title: "Test Session",
    });

    const artifact = await createArtifact(client, fixture.workspace, {
      title: "Test Artifact",
      kind: "spec",
      markdown: "# Title\n\nContent.\n",
    });

    const result = await callTool(client, "join_session", {
      sessionId: session.sessionId,
      artifactId: artifact.artifactId,
      connection: { targetMode: "explicit-window", selectionToken: randomUUID() },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "INVALID_ARTIFACT_INPUT: connection is only supported when intent is reconnect.",
    );
  });

  it("create_artifact and inspect_artifact_review return session: SessionContext matching active session ID, or session: null when standalone", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    // 1. Standalone create and inspect (no conversationName, no artifactConversationId)
    const standaloneCreated = await callTool(client, "create_artifact", {
      title: "Standalone Contract Artifact",
      kind: "spec",
      markdown: "# Standalone Contract\n\nVerifying wire result.\n",
    });

    expect(standaloneCreated.isError).toBeFalsy();
    expect(standaloneCreated.structuredContent.session).toBeNull();
    expect(standaloneCreated.structuredContent.artifactConversationId).toBeUndefined();
    expect(standaloneCreated.structuredContent.conversationName).toBeUndefined();

    const standaloneInspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: standaloneCreated.structuredContent.artifactDirectory,
    });

    expect(standaloneInspected.isError).toBeFalsy();
    expect(standaloneInspected.structuredContent.session).toBeNull();
    expect(standaloneInspected.structuredContent.artifactConversationId).toBeUndefined();
    expect(standaloneInspected.structuredContent.conversationName).toBeUndefined();

    // 2. Named Session create and inspect
    const sessionCreated = await callTool(client, "create_artifact", {
      title: "Contract Artifact In Session",
      kind: "spec",
      markdown: "# Contract\n\nVerifying wire result.\n",
      conversationName: "Contract Session Thread",
    });

    expect(sessionCreated.isError).toBeFalsy();
    expect(sessionCreated.structuredContent.session).toBeDefined();
    expect(sessionCreated.structuredContent.session.sessionId).toBe(sessionCreated.structuredContent.artifactConversationId);
    expect(sessionCreated.structuredContent.session.catalog.working[0].artifactId).toBe(sessionCreated.structuredContent.artifactId);

    const sessionInspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: sessionCreated.structuredContent.artifactDirectory,
      artifactConversationId: sessionCreated.structuredContent.artifactConversationId,
    });

    expect(sessionInspected.isError).toBeFalsy();
    expect(sessionInspected.structuredContent.session).toBeDefined();
    expect(sessionInspected.structuredContent.session.sessionId).toBe(sessionCreated.structuredContent.artifactConversationId);
  });

  it("inspect_artifact_review and join_session do not replay execution directive from past approved snapshot", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, {
      title: "Approved Plan",
      kind: "plan",
      markdown: "# Plan\n\nCompleted plan.\n",
    });

    await submitDecision(created.artifactDirectory, "approve", ["Plan is good"]);

    // Inspect
    const inspected = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
    });
    expect(inspected.isError).toBeFalsy();
    expect(inspected.structuredContent.nextAction).toBeUndefined();

    // Join
    const session = await createSession({
      userHome: fixture.userHome,
      title: "Session For Plan",
    });
    const joined = await callTool(client, "join_session", {
      sessionId: session.sessionId,
      artifactId: created.artifactId,
    });
    expect(joined.isError).toBeFalsy();
    expect(joined.structuredContent.inspection.nextAction).toBeUndefined();
  });

  it("join_session rejects conversation v1 with CONVERSATION_MIGRATION_REQUIRED before mutation, with expectedNextTool join_session", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const v1Id = randomUUID();
    const v1Dir = path.join(fixture.userHome, ".ai-artifacts", "conversation-registry", v1Id);
    await mkdir(v1Dir, { recursive: true });
    await writeFile(
      path.join(v1Dir, "conversation.json"),
      JSON.stringify({
        schemaVersion: 1,
        conversationId: v1Id,
        title: "Legacy v1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        artifacts: [],
      }),
      "utf8",
    );

    // Join-only
    const joinOnlyResult = await callTool(client, "join_session", {
      sessionId: v1Id,
    });
    expect(joinOnlyResult.isError).toBe(true);
    expect(joinOnlyResult.structuredContent).toMatchObject({
      code: "CONVERSATION_MIGRATION_REQUIRED",
      expectedNextTool: "join_session",
    });

    // Join with artifact
    const artifact = await createArtifact(client, fixture.workspace, {
      title: "Art",
      kind: "note",
      markdown: "# Note\n",
    });
    const joinArtResult = await callTool(client, "join_session", {
      sessionId: v1Id,
      artifactId: artifact.artifactId,
    });
    expect(joinArtResult.isError).toBe(true);
    expect(joinArtResult.structuredContent).toMatchObject({
      code: "CONVERSATION_MIGRATION_REQUIRED",
      expectedNextTool: "join_session",
    });
  });

  it("permits standalone create when session-types.json is corrupted, but rolls back session creation", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    // Corrupt session-types.json
    const typesPath = sessionTypesFilePath({ userHome: fixture.userHome });
    await mkdir(path.dirname(typesPath), { recursive: true });
    await writeFile(typesPath, "{ invalid json", "utf8");

    // 1. Standalone create does NOT touch session-types.json, so it succeeds
    const standaloneResult = await callTool(client, "create_artifact", {
      title: "Standalone Immune To Corrupted Types",
      kind: "spec",
      markdown: "# Standalone Spec\n",
    });
    expect(standaloneResult.isError).toBeFalsy();
    expect(standaloneResult.structuredContent.session).toBeNull();

    // 1b. Standalone inspect also does NOT touch session-types.json, so it succeeds and returns session: null
    const standaloneInspect = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: standaloneResult.structuredContent.artifactDirectory,
    });
    expect(standaloneInspect.isError).toBeFalsy();
    expect(standaloneInspect.structuredContent.session).toBeNull();

    // 2. Named session creation attempts to resolve session context/types, so it fails and rolls back
    const sessionResult = await callTool(client, "create_artifact", {
      title: "Will Rollback",
      kind: "spec",
      markdown: "# Spec\n",
      conversationName: "Will Rollback Thread",
    });

    expect(sessionResult.isError).toBe(true);

    // Verify session directory was rolled back / deleted (only standalone artifact remains)
    const convDir = conversationRegistryRoot({ userHome: fixture.userHome });
    const convEntries = await readdir(convDir).catch(() => []);
    expect(convEntries).toEqual([]);
  });

  it("advance_and_wait_for_artifact returns approved nextAction when round 2 is approved on non-plan kind", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    const created = await createArtifact(client, fixture.workspace, {
      title: "Spec Advance",
      kind: "spec",
      markdown: "# Round 1\n",
    });

    // Request chat update to get a round token
    const inspectResult = await callTool(client, "inspect_artifact_review", {
      artifactDirectory: created.artifactDirectory,
      takeover: true,
      expectedReviewRound: 1,
      intent: "explicit-chat-update",
    });
    expect(inspectResult.isError).toBeFalsy();
    const roundToken = inspectResult.structuredContent.roundToken;
    expect(roundToken).toBeDefined();

    // Advance and wait
    const advanceTracked = client.requestTracked("tools/call", {
      name: "advance_and_wait_for_artifact",
      arguments: {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
        roundToken,
        markdown: "# Round 2\n",
      },
    });
    await advanceTracked.sent;

    // Wait until round 2 files exist and lock clears
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Submit approve for round 2
    const manifest = JSON.parse(await readFile(path.join(created.artifactDirectory, "artifact.json"), "utf8"));
    expect(manifest.reviewRound).toBe(2);

    const comments = {
      schemaVersion: 6,
      artifactId: manifest.artifactId,
      reviewRound: 2,
      artifactSha256: sha256("# Round 2\n"),
      comments: [comment("Looks good in round 2")],
    };
    const commentsRaw = JSON.stringify(comments, null, 2);
    const submission = {
      schemaVersion: 6,
      artifactId: manifest.artifactId,
      reviewRound: 2,
      reviewSessionId: manifest.reviewSessionId,
      submittedAt: new Date().toISOString(),
      decision: "approve",
      artifactSha256: sha256("# Round 2\n"),
      commentsSha256: sha256(commentsRaw),
    };
    await atomicWrite(path.join(created.artifactDirectory, "comments.json"), commentsRaw);
    await atomicWrite(
      path.join(created.artifactDirectory, "review-submission.json"),
      JSON.stringify(submission, null, 2),
    );

    const advanceResult = await advanceTracked.promise;
    expect(advanceResult.isError, advanceResult.content?.[0]?.text).toBeFalsy();
    expect(advanceResult.structuredContent.decision).toBe("approve");
    expect(advanceResult.structuredContent.reviewRound).toBe(2);
    expect(advanceResult.structuredContent.nextAction).toMatchObject({
      type: "approved",
      instruction: expect.stringContaining("Acknowledge the approval and conclude the review"),
    });
  });

  it("wait_for_artifact_review returns execute-approved-plan nextAction for plan kinds (plan, implementation-plan)", async () => {
    const fixture = await workspaceFixture();
    const client = startClient(fixture.registry);
    await initialize(client);

    for (const kind of ["plan", "implementation-plan"]) {
      const created = await createArtifact(client, fixture.workspace, {
        title: `Test ${kind}`,
        kind,
        markdown: `# ${kind}\n\nContent for testing.\n`,
      });

      await submitDecision(created.artifactDirectory, "approve", ["Approved for implementation"]);

      const waitResult = await callTool(client, "wait_for_artifact_review", {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
      });

      expect(waitResult.isError, waitResult.content?.[0]?.text).toBeFalsy();
      expect(waitResult.structuredContent.decision).toBe("approve");
      expect(waitResult.structuredContent.kind).toBe(kind);
      expect(waitResult.structuredContent.nextAction).toMatchObject({
        type: "execute-approved-plan",
        instruction: expect.stringContaining("Execute the approved plan immediately in this same turn"),
      });
      expect(waitResult.structuredContent.roundToken).toBeUndefined();
    }
  });
});
