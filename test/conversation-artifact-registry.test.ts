import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_MANIFEST_FILE,
  conversationDirectory,
  conversationMetadataPath,
  conversationRegisteredArtifactPath,
  conversationRegisteredArtifactsDirectory,
  conversationRegistryRoot,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import {
  ConversationNotFoundError,
  ConversationRegistryError,
  cleanupStaleConversations,
  createConversationAndRegisterArtifact,
  listConversationsForArtifact,
  readConversationMetadata,
  registerArtifactInConversation,
  removeArtifactFromConversation,
  removeConversation,
} from "../src/shared/conversation-artifact-registry";

const temporaryDirectories: string[] = [];
let userHome: string;

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function createDummyArtifactManifest(artifactId: string): Promise<void> {
  const artifactDir = path.join(globalArtifactsRoot({ userHome }), artifactId);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, ARTIFACT_MANIFEST_FILE),
    JSON.stringify(
      {
        schemaVersion: 6,
        kind: "plan",
        artifactId,
        title: `Title for ${artifactId}`,
        createdAt: "2026-04-17T10:00:00.000Z",
        updatedAt: "2026-04-17T10:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "12345678-1234-4234-8234-123456789abc",
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(artifactDir, "artifact.md"), "# Dummy Markdown\n", "utf8");
}

beforeEach(async () => {
  userHome = await makeTemporaryDirectory("ai-artifacts-conv-registry-");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("ConversationArtifactRegistry", () => {
  it("creates a conversation and registers the initial artifact on disk", async () => {
    const result = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Checkout redesign",
      artifactId: "plan-checkout-001",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });

    expect(result.conversation).toEqual({
      schemaVersion: 1,
      artifactConversationId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
      conversationName: "Checkout redesign",
      createdAt: "2026-04-17T10:00:00.000Z",
    });

    const convId = result.conversation.artifactConversationId;
    expect(result.membership).toEqual({
      schemaVersion: 1,
      artifactConversationId: convId,
      artifactId: "plan-checkout-001",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });

    const onDiskMeta = await readConversationMetadata(convId, { userHome });
    expect(onDiskMeta).toEqual(result.conversation);

    const membershipRaw = JSON.parse(
      await fs.readFile(
        conversationRegisteredArtifactPath(convId, "plan-checkout-001", { userHome }),
        "utf8",
      ),
    );
    expect(membershipRaw).toEqual(result.membership);
  });

  it("fails closed when registering into an unknown or malformed conversation ID", async () => {
    await expect(
      registerArtifactInConversation({
        userHome,
        artifactConversationId: "11111111-1111-4111-8111-111111111111",
        artifactId: "plan-001",
      }),
    ).rejects.toBeInstanceOf(ConversationNotFoundError);

    await expect(
      registerArtifactInConversation({
        userHome,
        artifactConversationId: "../managed",
        artifactId: "plan-001",
      }),
    ).rejects.toThrow();

    await expect(
      registerArtifactInConversation({
        userHome,
        artifactConversationId: "11111111-1111-4111-8111-111111111111",
        artifactId: "../outside",
      }),
    ).rejects.toThrow();
  });

  it("supports idempotent re-registration that updates registeredAt and reorders conversations", async () => {
    const convA = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "11111111-1111-4111-8111-111111111111",
      conversationName: "Conversation A",
      artifactId: "shared-artifact",
      registeredAt: "2026-04-17T08:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: convA.conversation.artifactConversationId,
      artifactId: "second-artifact-in-a",
      registeredAt: "2026-04-17T08:05:00.000Z",
    });

    const convB = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "22222222-2222-4222-8222-222222222222",
      conversationName: "Conversation B",
      artifactId: "shared-artifact",
      registeredAt: "2026-04-17T09:00:00.000Z",
    });

    // Unrelated conversation C that does NOT contain shared-artifact
    await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "33333333-3333-4333-8333-333333333333",
      conversationName: "Unrelated Conversation C",
      artifactId: "other-artifact",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });

    // Initially, Conversation B is more recent for shared-artifact (09:00 > 08:00)
    const initialList = await listConversationsForArtifact("shared-artifact", { userHome });
    expect(initialList.skippedCount).toBe(0);
    expect(initialList.conversations.map((c) => c.conversation.conversationName)).toEqual([
      "Conversation B",
      "Conversation A",
    ]);
    expect(initialList.conversations[1]?.memberships.map((m) => m.artifactId)).toEqual([
      "shared-artifact",
      "second-artifact-in-a",
    ]);

    // Re-register shared-artifact in Conversation A at 11:00
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: convA.conversation.artifactConversationId,
      artifactId: "shared-artifact",
      registeredAt: "2026-04-17T11:00:00.000Z",
    });

    // Conversation A's createdAt must remain unchanged, while shared-artifact's registeredAt updates
    const updatedConvAMeta = await readConversationMetadata(
      convA.conversation.artifactConversationId,
      { userHome },
    );
    expect(updatedConvAMeta.createdAt).toBe("2026-04-17T08:00:00.000Z");

    const updatedList = await listConversationsForArtifact("shared-artifact", { userHome });
    expect(updatedList.conversations.map((c) => c.conversation.conversationName)).toEqual([
      "Conversation A",
      "Conversation B",
    ]);
    expect(updatedList.conversations[0]?.currentArtifactRegisteredAt).toBe(
      "2026-04-17T11:00:00.000Z",
    );
    // Inside Conversation A, second-artifact-in-a (08:05) is now before shared-artifact (11:00)
    expect(updatedList.conversations[0]?.memberships.map((m) => m.artifactId)).toEqual([
      "second-artifact-in-a",
      "shared-artifact",
    ]);
    expect(convB.conversation.conversationName).toBe("Conversation B");
  });

  it("handles concurrent registrations into the same conversation without lost updates", async () => {
    const { conversation } = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Concurrent Chat",
      artifactId: "artifact-00",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });
    const convId = conversation.artifactConversationId;

    const artifactIds = Array.from({ length: 12 }, (_, idx) =>
      `artifact-${String(idx + 1).padStart(2, "0")}`,
    );

    await Promise.all(
      artifactIds.map((artifactId, idx) =>
        registerArtifactInConversation({
          userHome,
          artifactConversationId: convId,
          artifactId,
          registeredAt: new Date(Date.parse("2026-04-17T10:01:00.000Z") + idx * 1000).toISOString(),
        }),
      ),
    );

    const listed = await listConversationsForArtifact("artifact-00", { userHome });
    expect(listed.skippedCount).toBe(0);
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.memberships.map((m) => m.artifactId)).toEqual([
      "artifact-00",
      ...artifactIds,
    ]);
  });

  it("isolates corrupt conversations and memberships while ignoring temp files", async () => {
    const validConv = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "11111111-1111-4111-8111-111111111111",
      conversationName: "Valid Conversation",
      artifactId: "target-artifact",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: validConv.conversation.artifactConversationId,
      artifactId: "sibling-artifact",
      registeredAt: "2026-04-17T10:05:00.000Z",
    });

    const regDir = conversationRegisteredArtifactsDirectory(
      validConv.conversation.artifactConversationId,
      { userHome },
    );

    // 1. Add a corrupt membership JSON in validConv
    await fs.writeFile(path.join(regDir, "corrupt-artifact.json"), "{ invalid json", "utf8");

    // 2. Add a membership with mismatched artifactId in validConv
    await fs.writeFile(
      path.join(regDir, "mismatch-artifact.json"),
      JSON.stringify({
        schemaVersion: 1,
        artifactConversationId: validConv.conversation.artifactConversationId,
        artifactId: "different-id",
        registeredAt: "2026-04-17T10:06:00.000Z",
      }),
      "utf8",
    );

    // 3. Add a temporary transaction file (should be silently ignored, not counted as skipped)
    await fs.writeFile(
      path.join(regDir, "sibling-artifact.json..tmp-99999999"),
      "partial write",
      "utf8",
    );

    // 4. Create a second conversation containing target-artifact but with corrupt conversation.json
    const corruptConv = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "22222222-2222-4222-8222-222222222222",
      conversationName: "Will Be Corrupt",
      artifactId: "target-artifact",
      registeredAt: "2026-04-17T11:00:00.000Z",
    });
    await fs.writeFile(
      conversationMetadataPath(corruptConv.conversation.artifactConversationId, { userHome }),
      "not-json",
      "utf8",
    );

    const listed = await listConversationsForArtifact("target-artifact", { userHome });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.conversation.conversationName).toBe("Valid Conversation");
    expect(listed.conversations[0]?.memberships.map((m) => m.artifactId)).toEqual([
      "target-artifact",
      "sibling-artifact",
    ]);
    // 2 corrupt/mismatched memberships in validConv + 1 corrupt conversation metadata = 3 skipped
    expect(listed.skippedCount).toBe(3);
  });

  it("returns empty list when conversation-registry root does not exist yet", async () => {
    const listed = await listConversationsForArtifact("non-existent-artifact", { userHome });
    expect(listed).toEqual({ conversations: [], skippedCount: 0 });
  });

  it("rejects linked conversation-registry root and linked conversation directories", async () => {
    const outside = await makeTemporaryDirectory("ai-artifacts-outside-");
    const rootLink = conversationRegistryRoot({ userHome });
    await fs.mkdir(path.dirname(rootLink), { recursive: true });
    await createDirectoryLink(outside, rootLink);

    await expect(
      createConversationAndRegisterArtifact({
        userHome,
        conversationName: "Linked Root Attack",
        artifactId: "artifact-001",
      }),
    ).rejects.toThrow(/symbolic links|junctions|regular directory/i);

    await expect(listConversationsForArtifact("artifact-001", { userHome })).rejects.toBeInstanceOf(
      ConversationRegistryError,
    );
  });

  it("skips linked conversation directories during listConversationsForArtifact", async () => {
    const outside = await makeTemporaryDirectory("ai-artifacts-outside-conv-");
    const valid = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "11111111-1111-4111-8111-111111111111",
      conversationName: "Safe Conversation",
      artifactId: "artifact-001",
    });

    const linkedConvId = "22222222-2222-4222-8222-222222222222";
    await createDirectoryLink(outside, conversationDirectory(linkedConvId, { userHome }));

    const listed = await listConversationsForArtifact("artifact-001", { userHome });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.conversation.artifactConversationId).toBe(
      valid.conversation.artifactConversationId,
    );
    expect(listed.skippedCount).toBe(1);
  });

  it("cleans up stale memberships and removes empty conversations", async () => {
    await createDummyArtifactManifest("alive-artifact");

    // Conversation 1: has alive-artifact and deleted-artifact -> should keep alive-artifact, remove deleted-artifact
    const conv1 = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "11111111-1111-4111-8111-111111111111",
      conversationName: "Mixed Conversation",
      artifactId: "alive-artifact",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: conv1.conversation.artifactConversationId,
      artifactId: "deleted-artifact-1",
      registeredAt: "2026-04-17T10:05:00.000Z",
    });

    // Conversation 2: only has deleted-artifact-2 -> should remove membership AND delete conversation directory
    const conv2 = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "22222222-2222-4222-8222-222222222222",
      conversationName: "All Expired Conversation",
      artifactId: "deleted-artifact-2",
      registeredAt: "2026-04-17T11:00:00.000Z",
    });

    const cleanupResult = await cleanupStaleConversations({ userHome });
    expect(cleanupResult).toEqual({
      scannedConversations: 2,
      removedMemberships: 2,
      removedConversations: 1,
      skippedCount: 0,
    });

    // Conversation 1 still exists with only alive-artifact
    const listedAlive = await listConversationsForArtifact("alive-artifact", { userHome });
    expect(listedAlive.conversations).toHaveLength(1);
    expect(listedAlive.conversations[0]?.memberships.map((m) => m.artifactId)).toEqual([
      "alive-artifact",
    ]);

    // Conversation 2 directory was removed completely
    await expect(
      fs.lstat(conversationDirectory(conv2.conversation.artifactConversationId, { userHome })),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cleans up memberships with malformed manifest, mismatched artifactId, or missing markdown, and removes empty conversation", async () => {
    // Artifact 1: malformed JSON in artifact.json
    const malformedDir = path.join(globalArtifactsRoot({ userHome }), "malformed-art");
    await fs.mkdir(malformedDir, { recursive: true });
    await fs.writeFile(path.join(malformedDir, ARTIFACT_MANIFEST_FILE), "{ not-json", "utf8");
    await fs.writeFile(path.join(malformedDir, "artifact.md"), "# Broken", "utf8");

    // Artifact 2: ID mismatch
    const mismatchDir = path.join(globalArtifactsRoot({ userHome }), "mismatch-art");
    await fs.mkdir(mismatchDir, { recursive: true });
    await fs.writeFile(
      path.join(mismatchDir, ARTIFACT_MANIFEST_FILE),
      JSON.stringify({
        schemaVersion: 6,
        kind: "plan",
        artifactId: "different-id",
        title: "Mismatch",
        createdAt: "2026-04-17T10:00:00.000Z",
        updatedAt: "2026-04-17T10:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "12345678-1234-4234-8234-123456789abc",
      }),
      "utf8",
    );
    await fs.writeFile(path.join(mismatchDir, "artifact.md"), "# Mismatch", "utf8");

    // Artifact 3: missing artifact.md
    const noMdDir = path.join(globalArtifactsRoot({ userHome }), "no-markdown-art");
    await fs.mkdir(noMdDir, { recursive: true });
    await fs.writeFile(
      path.join(noMdDir, ARTIFACT_MANIFEST_FILE),
      JSON.stringify({
        schemaVersion: 6,
        kind: "plan",
        artifactId: "no-markdown-art",
        title: "No Markdown",
        createdAt: "2026-04-17T10:00:00.000Z",
        updatedAt: "2026-04-17T10:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "12345678-1234-4234-8234-123456789abc",
      }),
      "utf8",
    );

    const conv = await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: "33333333-3333-4333-8333-333333333333",
      conversationName: "Malformed & Mismatched Conv",
      artifactId: "malformed-art",
      registeredAt: "2026-04-17T10:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: conv.conversation.artifactConversationId,
      artifactId: "mismatch-art",
      registeredAt: "2026-04-17T10:05:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: conv.conversation.artifactConversationId,
      artifactId: "no-markdown-art",
      registeredAt: "2026-04-17T10:10:00.000Z",
    });

    const cleanupResult = await cleanupStaleConversations({ userHome });
    expect(cleanupResult).toEqual({
      scannedConversations: 1,
      removedMemberships: 3,
      removedConversations: 1,
      skippedCount: 0,
    });

    // Entire conversation folder removed
    await expect(
      fs.lstat(conversationDirectory(conv.conversation.artifactConversationId, { userHome })),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports removeArtifactFromConversation and removeConversation helpers", async () => {
    const { conversation } = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Removable Chat",
      artifactId: "artifact-a",
    });
    const convId = conversation.artifactConversationId;

    expect(await removeArtifactFromConversation(convId, "artifact-a", { userHome })).toBe(true);
    expect(await removeArtifactFromConversation(convId, "artifact-a", { userHome })).toBe(false);

    expect(await removeConversation(convId, { userHome })).toBe(true);
    expect(await removeConversation(convId, { userHome })).toBe(false);
  });

  it("preserves the winning conversation when two createConversationAndRegisterArtifact calls race with the same ID", async () => {
    const sharedConvId = "44444444-4444-4444-8444-444444444444";

    const settled = await Promise.allSettled([
      createConversationAndRegisterArtifact({
        userHome,
        artifactConversationId: sharedConvId,
        conversationName: "Race WinnerOrLoser 1",
        artifactId: "artifact-race-1",
        registeredAt: "2026-04-17T10:00:00.000Z",
      }),
      createConversationAndRegisterArtifact({
        userHome,
        artifactConversationId: sharedConvId,
        conversationName: "Race WinnerOrLoser 2",
        artifactId: "artifact-race-2",
        registeredAt: "2026-04-17T10:00:00.000Z",
      }),
    ]);

    const fulfilled = settled.filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createConversationAndRegisterArtifact>>> =>
        r.status === "fulfilled",
    );
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(ConversationRegistryError);

    const winner = fulfilled[0]!.value;
    const onDiskMeta = await readConversationMetadata(sharedConvId, { userHome });
    expect(onDiskMeta).toEqual(winner.conversation);

    const listed = await listConversationsForArtifact(winner.membership.artifactId, { userHome });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.conversation).toEqual(winner.conversation);
  });

  it("does not delete a conversation during cleanupStaleConversations if a new membership is registered after snapshot", async () => {
    const convId = "55555555-5555-4555-8555-555555555555";
    await createConversationAndRegisterArtifact({
      userHome,
      artifactConversationId: convId,
      conversationName: "Concurrent Cleanup Conversation",
      artifactId: "stale-artifact",
      registeredAt: "2026-04-17T09:00:00.000Z",
    });

    await createDummyArtifactManifest("fresh-concurrent-artifact");

    const originalUnlink = fs.unlink.bind(fs);
    let injectedConcurrentRegistration = false;
    vi.spyOn(fs, "unlink").mockImplementation(async (targetPath) => {
      await originalUnlink(targetPath);
      if (!injectedConcurrentRegistration && String(targetPath).endsWith("stale-artifact.json")) {
        injectedConcurrentRegistration = true;
        // Simulate a concurrent registration arriving after cleanupStaleConversations unlinked the last snapshot entry
        await registerArtifactInConversation({
          userHome,
          artifactConversationId: convId,
          artifactId: "fresh-concurrent-artifact",
          registeredAt: "2026-04-17T12:00:00.000Z",
        });
      }
    });

    const cleanupResult = await cleanupStaleConversations({ userHome });
    expect(cleanupResult.removedMemberships).toBe(1);
    expect(cleanupResult.removedConversations).toBe(0);

    const listed = await listConversationsForArtifact("fresh-concurrent-artifact", { userHome });
    expect(listed.conversations).toHaveLength(1);
    expect(listed.conversations[0]?.conversation.artifactConversationId).toBe(convId);
    expect(listed.conversations[0]?.memberships.map((m) => m.artifactId)).toEqual([
      "fresh-concurrent-artifact",
    ]);
  });
});

