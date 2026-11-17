import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lock as acquireProperLock } from "proper-lockfile";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  CONVERSATION_METADATA_FILE,
  CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  artifactDirectory,
  conversationDirectory,
  conversationMetadataPath,
  workSessionLayoutPath,
  workSessionWaiterRecordPath,
  workSessionWaiterRequestPath,
  workSessionWaiterRequestsDirectory,
  workSessionWaitersDirectory,
  workSessionWaitersLockPath,
} from "../src/shared/artifact-files";
import { ARTIFACT_CONVERSATION_SCHEMA_VERSION, ARTIFACT_SCHEMA_VERSION, ConversationMigrationRequiredError } from "../src/shared/contracts";
import {
  ConversationNotFoundError,
  ConversationRegistryError,
  createSession,
  deleteSession,
  readSession,
} from "../src/shared/conversation-artifact-registry";
import {
  SessionWaiterBusyError,
  SessionWaiterIoError,
  SessionWaiterLockLostError,
  SessionWaiterNotWaitingError,
  SessionWaiterRequestExistsError,
  allocateUniqueWaiterName,
  requestWaiterInSessionInputSchema,
  sessionWaiterRecordSchema,
  waitInSessionInputSchema,
} from "../src/shared/session-waiter-contracts";
import {
  cancelSessionWaiter,
  claimSessionWaiterRequest,
  cleanupExpiredSessionWaiters,
  readActiveSessionWaiters,
  registerSessionWaiter,
  renewSessionWaiterLease,
  sendSessionWaiterRequest,
} from "../src/shared/session-waiter-store";
import { createSessionWaiterRuntime } from "../src/integration/session-waiter-runtime";

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  markdown?: string;
}): Promise<{ artifactId: string; title: string; artifactDir: string; artifactPath: string }> {
  const artifactId = options.artifactId ?? `artifact-${randomUUID().slice(0, 8)}`;
  const title = options.title ?? "Sample Artifact";
  const markdown = options.markdown ?? "# Sample\n\nBody.\n";
  const artifactDir = artifactDirectory(artifactId, { userHome: options.userHome });
  await fs.mkdir(artifactDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });

  const now = new Date().toISOString();
  const manifestPath = path.join(artifactDir, ARTIFACT_MANIFEST_FILE);
  const artifactPath = path.join(artifactDir, ARTIFACT_MARKDOWN_FILE);

  await fs.writeFile(
    manifestPath,
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
  await fs.writeFile(artifactPath, markdown, { encoding: "utf8", mode: OWNER_ONLY_FILE_MODE });
  return { artifactId, title, artifactDir, artifactPath };
}

describe("session-waiter-store", () => {
  const tempRoots: string[] = [];

  async function createFixture() {
    const userHome = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-waiter-store-"));
    tempRoots.push(userHome);
    const session = await createSession({
      userHome,
      title: "Waiter Store Session",
    });
    return { userHome, session };
  }

  afterEach(async () => {
    while (tempRoots.length > 0) {
      const dir = tempRoots.pop();
      if (dir) {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("validates schemas, rejects unknown keys, rejects invalid targets before mutation, and allocates unique names", async () => {
    expect(() =>
      waitInSessionInputSchema.parse({
        sessionId: randomUUID(),
        waitingFor: "Waiting for plan review",
        extraField: true,
      }),
    ).toThrow();
    expect(() =>
      waitInSessionInputSchema.parse({
        sessionId: randomUUID(),
        waitingFor: "   ",
      }),
    ).toThrow();
    expect(() =>
      requestWaiterInSessionInputSchema.parse({
        sessionId: randomUUID(),
        waitId: randomUUID(),
        requestMessage: "   ",
        title: "disallowed",
      }),
    ).toThrow();

    expect(allocateUniqueWaiterName(undefined, [])).toBe("Agent");
    expect(allocateUniqueWaiterName("   ", ["agent"])).toBe("Agent (2)");
    expect(allocateUniqueWaiterName("  Reviewer ", ["Reviewer", "REVIEWER (2)"])).toBe("Reviewer (3)");
    expect(allocateUniqueWaiterName("Reviewer", ["Reviewer", "Reviewer (3)"])).toBe("Reviewer (2)");

    const { userHome, session } = await createFixture();
    await expect(
      registerSessionWaiter(
        {
          sessionId: randomUUID(),
          ownerInstanceId: "owner-1",
          waitingFor: "Waiting",
        },
        { userHome },
      ),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    await expect(
      registerSessionWaiter(
        {
          sessionId: session.sessionId,
          ownerInstanceId: "owner-1",
          waitingFor: "Waiting",
          artifactId: "missing-artifact-id",
        },
        { userHome },
      ),
    ).rejects.toThrow(/ARTIFACT_NOT_FOUND/);

    expect(await pathExists(workSessionWaitersDirectory(session.sessionId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaiterRequestsDirectory(session.sessionId, { userHome }))).toBe(false);

    // Legacy v1 conversation rejection
    const legacyId = randomUUID();
    const legacyDir = conversationDirectory(legacyId, { userHome });
    await fs.mkdir(legacyDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
    await fs.writeFile(
      path.join(legacyDir, CONVERSATION_METADATA_FILE),
      JSON.stringify({
        schemaVersion: ARTIFACT_CONVERSATION_SCHEMA_VERSION,
        artifactConversationId: legacyId,
        conversationName: "Legacy",
        createdAt: new Date().toISOString(),
      }),
      "utf8",
    );
    await expect(
      registerSessionWaiter(
        {
          sessionId: legacyId,
          ownerInstanceId: "owner-1",
          waitingFor: "Waiting",
        },
        { userHome },
      ),
    ).rejects.toBeInstanceOf(ConversationMigrationRequiredError);
  });

  it("reads empty/active waiters strictly read-only without mutating files, folders, locks, or session metadata", async () => {
    const { userHome, session } = await createFixture();
    const sessionBefore = await readSession(session.sessionId, { userHome });

    const initialList = await readActiveSessionWaiters(session.sessionId, { userHome });
    expect(initialList).toEqual([]);
    expect(await pathExists(workSessionWaitersDirectory(session.sessionId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaitersLockPath(session.sessionId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionLayoutPath(session.sessionId, { userHome }))).toBe(false);
    const metaStatBefore = await fs.stat(conversationMetadataPath(session.sessionId, { userHome }));

    const artifact = await seedGlobalArtifact({ userHome, title: "Target Plan" });
    let clockMs = 1_750_000_000_000;

    const first = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-a",
        waitingFor: "  Review code  ",
      },
      { userHome, now: () => new Date(clockMs) },
    );
    expect(first.waiter.name).toBe("Agent");
    expect(first.waiter.waitingFor).toBe("Review code");
    expect(first.waiter.artifact).toBeUndefined();

    clockMs += 500;
    const second = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-b",
        waitingFor: "Review schema",
        name: "  Reviewer ",
        artifactId: artifact.artifactId,
      },
      { userHome, now: () => new Date(clockMs) },
    );
    expect(second.waitId).not.toBe(first.waitId);
    expect(second.waiter.name).toBe("Reviewer");
    expect(second.waiter.artifact?.artifactId).toBe(artifact.artifactId);
    expect(second.waiter.artifact?.title).toBe("Target Plan");

    // Non-UUID temp/unknown entries should be ignored by reader without deleting them
    const foreignFile = path.join(workSessionWaitersDirectory(session.sessionId, { userHome }), "notes.txt");
    await fs.writeFile(foreignFile, "keep-me", "utf8");

    const listed = await readActiveSessionWaiters(session.sessionId, {
      userHome,
      now: () => new Date(clockMs + 1000),
    });
    expect(listed.map((w) => w.waitId)).toEqual([first.waitId, second.waitId]);
    expect(await pathExists(foreignFile)).toBe(true);

    // Session membership/layout/updatedAt remain untouched (reference artifact was NOT auto-registered)
    const sessionAfter = await readSession(session.sessionId, { userHome });
    expect(sessionAfter.working).toEqual(sessionBefore.working);
    expect(sessionAfter.references).toEqual(sessionBefore.references);
    expect(sessionAfter.updatedAt).toBe(sessionBefore.updatedAt);
    const metaStatAfter = await fs.stat(conversationMetadataPath(session.sessionId, { userHome }));
    expect(metaStatAfter.mtimeMs).toBe(metaStatBefore.mtimeMs);
  });

  it("allocates unique names for concurrent same-name registrations and reuses freed suffixes", async () => {
    const { userHome, session } = await createFixture();

    const [reg1, reg2, reg3] = await Promise.all([
      registerSessionWaiter(
        { sessionId: session.sessionId, ownerInstanceId: "o1", waitingFor: "w1", name: "Agent" },
        { userHome },
      ),
      registerSessionWaiter(
        { sessionId: session.sessionId, ownerInstanceId: "o2", waitingFor: "w2", name: "agent" },
        { userHome },
      ),
      registerSessionWaiter(
        { sessionId: session.sessionId, ownerInstanceId: "o3", waitingFor: "w3" },
        { userHome },
      ),
    ]);

    const ids = new Set([reg1.waitId, reg2.waitId, reg3.waitId]);
    const normalizedNames = [reg1.waiter.name, reg2.waiter.name, reg3.waiter.name]
      .map((name) => name.toLowerCase())
      .sort();
    expect(ids.size).toBe(3);
    expect(normalizedNames).toEqual(["agent", "agent (2)", "agent (3)"]);

    // Cancel whichever waiter received the `(2)` suffix and confirm the next registration reuses `(2)`
    const middle = [reg1, reg2, reg3].find((item) => item.waiter.name.toLowerCase() === "agent (2)");
    expect(middle).toBeDefined();
    await cancelSessionWaiter({ sessionId: session.sessionId, waitId: middle!.waitId }, { userHome });

    const reg4 = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "o4", waitingFor: "w4", name: "AGENT" },
      { userHome },
    );
    expect(reg4.waiter.name).toBe("AGENT (2)");
  });

  it("renews lease by updating mtime only (byte-for-byte immutable body) and refuses resurrection on deletion or expiry", async () => {
    const { userHome, session } = await createFixture();
    let clockMs = 1_750_000_000_000;

    const registered = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-1",
        waitingFor: "Waiting",
      },
      {
        userHome,
        now: () => new Date(clockMs),
        timing: { leaseTtlMs: 1_000 },
      },
    );

    const recordPath = workSessionWaiterRecordPath(session.sessionId, registered.waitId, { userHome });
    const rawBodyBefore = await fs.readFile(recordPath, "utf8");
    const parsedBefore = sessionWaiterRecordSchema.parse(JSON.parse(rawBodyBefore));
    expect(parsedBefore.createdAt).toBe(new Date(clockMs).toISOString());

    clockMs += 400;
    const renewed = await renewSessionWaiterLease(
      {
        sessionId: session.sessionId,
        waitId: registered.waitId,
        ownerInstanceId: "owner-1",
      },
      {
        userHome,
        now: () => new Date(clockMs),
      },
    );
    expect(renewed.status).toBe("renewed");
    if (renewed.status === "renewed") {
      expect(Date.parse(renewed.waiter.heartbeatAt)).toBe(clockMs);
      expect(Date.parse(renewed.waiter.expiresAt)).toBe(clockMs + 1_000);
    }
    const rawBodyAfter = await fs.readFile(recordPath, "utf8");
    expect(rawBodyAfter).toBe(rawBodyBefore);

    // Advance clock past expiry -> renew rejects with lease-expired and reader excludes it
    clockMs += 1_000;
    const activeAfterExpiry = await readActiveSessionWaiters(session.sessionId, {
      userHome,
      now: () => new Date(clockMs),
    });
    expect(activeAfterExpiry).toEqual([]);

    const renewExpired = await renewSessionWaiterLease(
      {
        sessionId: session.sessionId,
        waitId: registered.waitId,
        ownerInstanceId: "owner-1",
      },
      { userHome, now: () => new Date(clockMs) },
    );
    expect(renewExpired).toEqual({ status: "cancelled", reason: "lease-expired" });

    // Deleted record is never recreated by renewSessionWaiterLease
    await fs.unlink(recordPath);
    const renewRemoved = await renewSessionWaiterLease(
      {
        sessionId: session.sessionId,
        waitId: registered.waitId,
        ownerInstanceId: "owner-1",
      },
      { userHome, now: () => new Date(clockMs - 500) },
    );
    expect(renewRemoved).toEqual({ status: "cancelled", reason: "waiter-removed" });
    expect(await pathExists(recordPath)).toBe(false);
  });

  it("enforces single-winner request sending, rejects late/duplicate requests, and cleans up expired waiters/orphans", async () => {
    const { userHome, session } = await createFixture();
    let clockMs = 1_750_000_000_000;

    const reg = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "owner-1", waitingFor: "Work" },
      { userHome, now: () => new Date(clockMs), timing: { leaseTtlMs: 1_000 } },
    );

    const [resA, resB] = await Promise.allSettled([
      sendSessionWaiterRequest(
        { sessionId: session.sessionId, waitId: reg.waitId, requestMessage: "First task" },
        { userHome, now: () => new Date(clockMs + 100) },
      ),
      sendSessionWaiterRequest(
        { sessionId: session.sessionId, waitId: reg.waitId, requestMessage: "Second task" },
        { userHome, now: () => new Date(clockMs + 100) },
      ),
    ]);

    const fulfilled = [resA, resB].filter((item) => item.status === "fulfilled");
    const rejected = [resA, resB].filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SessionWaiterRequestExistsError);

    const requestPath = workSessionWaiterRequestPath(session.sessionId, reg.waitId, { userHome });
    const storedRequest = JSON.parse(await fs.readFile(requestPath, "utf8"));
    expect(["First task", "Second task"]).toContain(storedRequest.requestMessage);

    // Expire both waiter and un-claimed request, then run cleanup
    clockMs += 1_500;
    const cleanup = await cleanupExpiredSessionWaiters(session.sessionId, {
      userHome,
      now: () => new Date(clockMs),
    });
    expect(cleanup).toEqual({
      sessionId: session.sessionId,
      removedWaiters: 1,
      removedRequests: 1,
    });
    expect(await pathExists(requestPath)).toBe(false);

    // Late request after expiration/cleanup is rejected and does not create a payload
    await expect(
      sendSessionWaiterRequest(
        { sessionId: session.sessionId, waitId: reg.waitId, requestMessage: "Too late" },
        { userHome, now: () => new Date(clockMs) },
      ),
    ).rejects.toBeInstanceOf(SessionWaiterNotWaitingError);
    expect(await pathExists(requestPath)).toBe(false);
  });

  it("handles Plan 5.3 race matrix with deterministic barriers: send rollback, claim vs unlink, heartbeat vs unlink, session deletion", async () => {
    const { userHome, session } = await createFixture();
    let clockMs = 1_750_000_000_000;

    // Race A: External waiter removal right after publishing request triggers rollback
    const regA = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "owner-a", waitingFor: "Task A" },
      { userHome, now: () => new Date(clockMs) },
    );
    const waiterPathA = workSessionWaiterRecordPath(session.sessionId, regA.waitId, { userHome });
    const requestPathA = workSessionWaiterRequestPath(session.sessionId, regA.waitId, { userHome });
    await expect(
      sendSessionWaiterRequest(
        { sessionId: session.sessionId, waitId: regA.waitId, requestMessage: "Run A" },
        {
          userHome,
          now: () => new Date(clockMs + 100),
          _testHooks: {
            afterPublishRequest: async () => {
              expect(await pathExists(requestPathA)).toBe(true);
              await fs.unlink(waiterPathA);
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(SessionWaiterNotWaitingError);
    expect(await pathExists(requestPathA)).toBe(false);

    // Race B: Claim vs direct unlink at beforeClaimUnlink barrier -> Stop wins cleanly
    const regB = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "owner-b", waitingFor: "Task B" },
      { userHome, now: () => new Date(clockMs) },
    );
    await sendSessionWaiterRequest(
      { sessionId: session.sessionId, waitId: regB.waitId, requestMessage: "Run B" },
      { userHome, now: () => new Date(clockMs + 50) },
    );
    const waiterPathB = workSessionWaiterRecordPath(session.sessionId, regB.waitId, { userHome });
    const claimB = await claimSessionWaiterRequest(
      { sessionId: session.sessionId, waitId: regB.waitId, ownerInstanceId: "owner-b" },
      {
        userHome,
        now: () => new Date(clockMs + 60),
        _testHooks: {
          beforeClaimUnlink: async () => {
            await fs.unlink(waiterPathB);
          },
        },
      },
    );
    expect(claimB).toEqual({
      status: "cancelled",
      sessionId: session.sessionId,
      waitId: regB.waitId,
      reason: "waiter-removed",
    });

    // Race C: Claim wins when unlink succeeds, removes request and keeps other waiters untouched
    const regC1 = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "owner-c1", waitingFor: "Task C1" },
      { userHome, now: () => new Date(clockMs) },
    );
    const regC2 = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "owner-c2", waitingFor: "Task C2" },
      { userHome, now: () => new Date(clockMs) },
    );
    await sendSessionWaiterRequest(
      { sessionId: session.sessionId, waitId: regC1.waitId, requestMessage: "Execute C1" },
      { userHome, now: () => new Date(clockMs + 50) },
    );
    const claimC1 = await claimSessionWaiterRequest(
      { sessionId: session.sessionId, waitId: regC1.waitId, ownerInstanceId: "owner-c1" },
      { userHome, now: () => new Date(clockMs + 70) },
    );
    expect(claimC1.status).toBe("requested");
    if (claimC1.status === "requested") {
      expect(claimC1.request.requestMessage).toBe("Execute C1");
    }
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, regC1.waitId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaiterRequestPath(session.sessionId, regC1.waitId, { userHome }))).toBe(false);
    expect(await pathExists(workSessionWaiterRecordPath(session.sessionId, regC2.waitId, { userHome }))).toBe(true);

    // Race D: Heartbeat vs external unlink right before fs.utimes -> waiter-removed, no recreation
    const waiterPathC2 = workSessionWaiterRecordPath(session.sessionId, regC2.waitId, { userHome });
    const renewC2 = await renewSessionWaiterLease(
      { sessionId: session.sessionId, waitId: regC2.waitId, ownerInstanceId: "owner-c2" },
      {
        userHome,
        now: () => new Date(clockMs + 100),
        _testHooks: {
          beforeRenewUtimes: async () => {
            await fs.unlink(waiterPathC2);
          },
        },
      },
    );
    expect(renewC2).toEqual({ status: "cancelled", reason: "waiter-removed" });
    expect(await pathExists(waiterPathC2)).toBe(false);

    // Race E: Delete session preserves global artifact and reports session-deleted without recreating dirs
    const artifact = await seedGlobalArtifact({ userHome, title: "Global Survives" });
    const regD = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-d",
        waitingFor: "Task D",
        artifactId: artifact.artifactId,
      },
      { userHome, now: () => new Date(clockMs) },
    );
    const beforeDeleteRenewBarrier = createDeferred();
    const continueDeleteRenew = createDeferred();
    const renewDuringDeletePromise = renewSessionWaiterLease(
      { sessionId: session.sessionId, waitId: regD.waitId, ownerInstanceId: "owner-d" },
      {
        userHome,
        now: () => new Date(clockMs + 200),
        _testHooks: {
          beforeRenewUtimes: async () => {
            beforeDeleteRenewBarrier.resolve();
            await continueDeleteRenew.promise;
          },
        },
      },
    );
    await beforeDeleteRenewBarrier.promise;
    await deleteSession(session.sessionId, { userHome });
    continueDeleteRenew.resolve();

    const renewDuringDelete = await renewDuringDeletePromise;
    expect(renewDuringDelete).toEqual({ status: "cancelled", reason: "session-deleted" });
    expect(await pathExists(conversationDirectory(session.sessionId, { userHome }))).toBe(false);
    expect(await pathExists(artifact.artifactPath)).toBe(true);
  });

  it("cancels exact waitId without affecting other waiters and propagates lock busy / lock compromised errors", async () => {
    const { userHome, session } = await createFixture();
    const w1 = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "o1", waitingFor: "Wait 1", name: "Coder" },
      { userHome },
    );
    const w2 = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId: "o2", waitingFor: "Wait 2", name: "Reviewer" },
      { userHome },
    );

    const cancelled = await cancelSessionWaiter(
      { sessionId: session.sessionId, waitId: w1.waitId },
      { userHome },
    );
    expect(cancelled).toEqual({
      sessionId: session.sessionId,
      waitId: w1.waitId,
      cancelled: true,
      waiterExisted: true,
      requestRemoved: false,
    });
    const remaining = await readActiveSessionWaiters(session.sessionId, { userHome });
    expect(remaining.map((w) => w.waitId)).toEqual([w2.waitId]);

    // Contention timeout -> SessionWaiterBusyError
    const convDir = conversationDirectory(session.sessionId, { userHome });
    const lockPath = workSessionWaitersLockPath(session.sessionId, { userHome });
    const releaseExternal = await acquireProperLock(convDir, {
      lockfilePath: lockPath,
      stale: 60_000,
      update: 10_000,
      realpath: true,
      retries: 0,
    });
    try {
      await expect(
        sendSessionWaiterRequest(
          { sessionId: session.sessionId, waitId: w2.waitId, requestMessage: "Blocked" },
          {
            userHome,
            timing: { lockRetries: 2, lockRetryIntervalMs: 25 },
          },
        ),
      ).rejects.toBeInstanceOf(SessionWaiterBusyError);
    } finally {
      await releaseExternal();
    }

    // Compromised lock -> SessionWaiterLockLostError without returning success
    let compromisedSeen = false;
    await expect(
      cancelSessionWaiter(
        { sessionId: session.sessionId, waitId: w2.waitId },
        {
          userHome,
          timing: { lockStaleMs: 2000, lockUpdateMs: 1000 },
          onLockCompromised: () => {
            compromisedSeen = true;
          },
          _testHooks: {
            onLockAcquired: async () => {
              await fs.rm(lockPath, { recursive: true, force: true });
              await new Promise((resolve) => setTimeout(resolve, 1150));
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(SessionWaiterLockLostError);
    expect(compromisedSeen).toBe(true);
  });

  it("distinguishes permanent registry corruption from concurrent deleteSession fs.rm races", async () => {
    const { userHome, session: corruptSession } = await createFixture();
    await fs.rm(
      path.join(conversationDirectory(corruptSession.sessionId, { userHome }), CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY),
      { recursive: true, force: true },
    );

    await expect(
      registerSessionWaiter(
        {
          sessionId: corruptSession.sessionId,
          ownerInstanceId: randomUUID(),
          waitingFor: "Should fail invalid registry",
        },
        { userHome },
      ),
    ).rejects.toBeInstanceOf(ConversationRegistryError);

    const deletingSession = await createSession({ userHome, title: "Deleting Race Session" });
    const ownerInstanceId = randomUUID();
    const reg = await registerSessionWaiter(
      {
        sessionId: deletingSession.sessionId,
        ownerInstanceId,
        waitingFor: "Race deletion check",
      },
      { userHome },
    );

    const convDir = conversationDirectory(deletingSession.sessionId, { userHome });
    await fs.rm(path.join(convDir, CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY), {
      recursive: true,
      force: true,
    });
    const finishDelete = setTimeout(() => {
      void fs.rm(convDir, { recursive: true, force: true });
    }, 15);
    try {
      const renewed = await renewSessionWaiterLease(
        { sessionId: deletingSession.sessionId, waitId: reg.waitId, ownerInstanceId },
        { userHome },
      );
      expect(renewed).toEqual({ status: "cancelled", reason: "session-deleted" });
    } finally {
      clearTimeout(finishDelete);
    }
  });

  it("passes custom rootOptions into ensureDirectSessionSubdirectory so mkdir I/O errors remain SessionWaiterIoError", async () => {
    const { userHome, session } = await createFixture();

    const mkdirSpy = vi
      .spyOn(fs, "mkdir")
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    try {
      await expect(
        registerSessionWaiter(
          {
            sessionId: session.sessionId,
            ownerInstanceId: randomUUID(),
            waitingFor: "Should surface SessionWaiterIoError",
          },
          { userHome },
        ),
      ).rejects.toBeInstanceOf(SessionWaiterIoError);
    } finally {
      mkdirSpy.mockRestore();
    }

    const ownerInstanceId = randomUUID();
    const reg = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId, waitingFor: "Ready for request" },
      { userHome },
    );
    await fs.rm(workSessionWaiterRequestsDirectory(session.sessionId, { userHome }), {
      recursive: true,
      force: true,
    });

    const reqMkdirSpy = vi
      .spyOn(fs, "mkdir")
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));
    try {
      await expect(
        sendSessionWaiterRequest(
          { sessionId: session.sessionId, waitId: reg.waitId, requestMessage: "Ping" },
          { userHome },
        ),
      ).rejects.toBeInstanceOf(SessionWaiterIoError);
    } finally {
      reqMkdirSpy.mockRestore();
    }
  });

  it("keeps committed claimed request when post-commit unlink(requestPath) fails or lock is lost", async () => {
    const { userHome, session } = await createFixture();
    const ownerInstanceId = randomUUID();
    const reg = await registerSessionWaiter(
      { sessionId: session.sessionId, ownerInstanceId, waitingFor: "Claim resilience" },
      { userHome },
    );
    await sendSessionWaiterRequest(
      { sessionId: session.sessionId, waitId: reg.waitId, requestMessage: "Important payload" },
      { userHome },
    );

    const waiterRecordPath = workSessionWaiterRecordPath(session.sessionId, reg.waitId, { userHome });
    const origUnlink = fs.unlink.bind(fs);
    const requestPath = workSessionWaiterRequestPath(session.sessionId, reg.waitId, { userHome });
    const lockPath = workSessionWaitersLockPath(session.sessionId, { userHome });
    let unlinkSpy: ReturnType<typeof vi.spyOn> | undefined;

    unlinkSpy = vi.spyOn(fs, "unlink").mockImplementation(async (targetPath) => {
      if (path.resolve(String(targetPath)) === path.resolve(requestPath)) {
        await new Promise((resolve) => setTimeout(resolve, 1150));
        throw Object.assign(new Error("simulated EPERM on request unlink"), { code: "EPERM" });
      }
      const result = await origUnlink(targetPath);
      if (path.resolve(String(targetPath)) === path.resolve(waiterRecordPath)) {
        await fs.rm(lockPath, { recursive: true, force: true });
      }
      return result;
    });

    let compromisedSeen = false;
    try {
      const claim = await claimSessionWaiterRequest(
        { sessionId: session.sessionId, waitId: reg.waitId, ownerInstanceId },
        {
          userHome,
          timing: { lockStaleMs: 2000, lockUpdateMs: 1000 },
          onLockCompromised: () => {
            compromisedSeen = true;
          },
        },
      );
      expect(compromisedSeen).toBe(true);
      expect(claim.status).toBe("requested");
      if (claim.status === "requested") {
        expect(claim.request.requestMessage).toBe("Important payload");
      }
      expect(
        await pathExists(workSessionWaiterRecordPath(session.sessionId, reg.waitId, { userHome })),
      ).toBe(false);
    } finally {
      unlinkSpy.mockRestore();
    }
  });

  it("tracks and cleans up waitInSession when shutdown aborts during in-flight registration", async () => {
    const { userHome, session } = await createFixture();
    const convDir = conversationDirectory(session.sessionId, { userHome });
    const waitersDir = workSessionWaitersDirectory(session.sessionId, { userHome });
    const lockPath = workSessionWaitersLockPath(session.sessionId, { userHome });
    await fs.mkdir(waitersDir, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });

    const releaseExternal = await acquireProperLock(convDir, {
      lockfilePath: lockPath,
      stale: 60_000,
      update: 10_000,
      realpath: true,
      retries: 0,
    });

    const runtime = createSessionWaiterRuntime({
      userHome,
      timing: { lockRetries: 20, lockRetryIntervalMs: 20 },
    });

    let waitRejected = false;
    const waitPromise = runtime
      .waitInSession({
        sessionId: session.sessionId,
        waitingFor: "Will abort during register",
      })
      .catch((error) => {
        waitRejected = true;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe("AbortError");
      });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const shutdownPromise = runtime.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 30));
    await releaseExternal();

    await Promise.all([waitPromise, shutdownPromise]);
    expect(waitRejected).toBe(true);
    expect(await readActiveSessionWaiters(session.sessionId, { userHome })).toEqual([]);
  });
});
