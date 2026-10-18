import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactReviewOpenCoordinator,
  type ArtifactFileUri,
  type ArtifactReviewOpenOptions,
} from "../src/extension/artifact-review-open";
import {
  ConversationArtifactService,
  setupConversationRegistryWatcher,
  type ConversationRegistryWatcher,
} from "../src/extension/conversation-artifact-service";
import {
  CONVERSATION_REGISTRY_DIRECTORY,
  conversationRegisteredArtifactPath,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import {
  createConversationAndRegisterArtifact,
  registerArtifactInConversation,
} from "../src/shared/conversation-artifact-registry";

const temporaryDirectories: string[] = [];

type TestUri = ArtifactFileUri;

class FakeConversationWatcher implements ConversationRegistryWatcher<TestUri> {
  private readonly createListeners: ((uri: TestUri) => void | Promise<void>)[] = [];
  private readonly changeListeners: ((uri: TestUri) => void | Promise<void>)[] = [];
  private readonly deleteListeners: ((uri: TestUri) => void | Promise<void>)[] = [];
  public disposed = false;

  onDidCreate(listener: (uri: TestUri) => void | Promise<void>): void {
    this.createListeners.push(listener);
  }

  onDidChange(listener: (uri: TestUri) => void | Promise<void>): void {
    this.changeListeners.push(listener);
  }

  onDidDelete(listener: (uri: TestUri) => void | Promise<void>): void {
    this.deleteListeners.push(listener);
  }

  dispose(): void {
    this.disposed = true;
  }

  fireCreate(fsPath = "/tmp/conv"): void {
    for (const listener of [...this.createListeners]) {
      void listener({ fsPath });
    }
  }

  fireChange(fsPath = "/tmp/conv"): void {
    for (const listener of [...this.changeListeners]) {
      void listener({ fsPath });
    }
  }

  fireDelete(fsPath = "/tmp/conv"): void {
    for (const listener of [...this.deleteListeners]) {
      void listener({ fsPath });
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makeUserHome(): Promise<string> {
  const userHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-conv-service-"));
  temporaryDirectories.push(userHome);
  return userHome;
}

async function writeSchemaV6Artifact(
  userHome: string,
  artifactId: string,
  options: {
    title?: string;
    kind?: string;
  } = {},
): Promise<{
  artifactDirectory: string;
  artifactPath: string;
  manifestPath: string;
}> {
  const markdown = `# ${options.title ?? artifactId}\n`;
  const artifactDirectory = path.join(globalArtifactsRoot({ userHome }), artifactId);
  const artifactPath = path.join(artifactDirectory, "artifact.md");
  const manifestPath = path.join(artifactDirectory, "artifact.json");
  const commentsPath = path.join(artifactDirectory, "comments.json");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, markdown, "utf8");
  const timestamp = new Date().toISOString();
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 6,
        kind: options.kind ?? "implementation-plan",
        artifactId,
        title: options.title ?? `Title for ${artifactId}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        reviewRound: 1,
        reviewSessionId: "11111111-1111-4111-8111-111111111111",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    commentsPath,
    `${JSON.stringify(
      {
        schemaVersion: 6,
        artifactId,
        reviewRound: 1,
        artifactSha256: sha256(markdown),
        comments: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { artifactDirectory, artifactPath, manifestPath };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ConversationArtifactService", () => {
  it("loads only conversations that currentArtifactId participates in, sorted by currentArtifactRegisteredAt desc and registeredAt asc", async () => {
    const userHome = await makeUserHome();
    await writeSchemaV6Artifact(userHome, "artifact-a", { title: "Artifact A", kind: "plan" });
    await writeSchemaV6Artifact(userHome, "artifact-b", { title: "Artifact B", kind: "implementation-plan" });
    await writeSchemaV6Artifact(userHome, "artifact-c", { title: "Artifact C", kind: "audit" });
    await writeSchemaV6Artifact(userHome, "artifact-unrelated", { title: "Unrelated", kind: "plan" });

    // Conversation 1: artifact-a registered at 10:00, artifact-b at 10:05
    const conv1 = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Older Thread",
      artifactId: "artifact-a",
      registeredAt: "2026-10-18T10:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: conv1.conversation.artifactConversationId,
      artifactId: "artifact-b",
      registeredAt: "2026-10-18T10:05:00.000Z",
    });

    // Conversation 2: artifact-c registered at 09:00, artifact-a registered at 11:00
    const conv2 = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Newer Thread For A",
      artifactId: "artifact-c",
      registeredAt: "2026-10-18T09:00:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: conv2.conversation.artifactConversationId,
      artifactId: "artifact-a",
      registeredAt: "2026-10-18T11:00:00.000Z",
    });

    // Conversation 3: does not contain artifact-a
    await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Unrelated Thread",
      artifactId: "artifact-unrelated",
      registeredAt: "2026-10-18T12:00:00.000Z",
    });

    const openWith = vi.fn(async () => undefined);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>(
      { uriFromFilePath: (fsPath) => ({ fsPath }), openWith },
      { userHome },
    );
    const service = new ConversationArtifactService<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openArtifactReview: (uri, opts) => coordinator.open(uri, opts),
      rootOptions: { userHome },
    });

    const state = await service.getConversationsViewState("artifact-a");
    expect(state).toEqual({
      status: "ready",
      skippedCount: 0,
      groups: [
        {
          artifactConversationId: conv2.conversation.artifactConversationId,
          conversationName: "Newer Thread For A",
          currentArtifactRegisteredAt: "2026-10-18T11:00:00.000Z",
          artifacts: [
            {
              artifactId: "artifact-c",
              title: "Artifact C",
              kind: "audit",
              registeredAt: "2026-10-18T09:00:00.000Z",
              isCurrent: false,
            },
            {
              artifactId: "artifact-a",
              title: "Artifact A",
              kind: "plan",
              registeredAt: "2026-10-18T11:00:00.000Z",
              isCurrent: true,
            },
          ],
        },
        {
          artifactConversationId: conv1.conversation.artifactConversationId,
          conversationName: "Older Thread",
          currentArtifactRegisteredAt: "2026-10-18T10:00:00.000Z",
          artifacts: [
            {
              artifactId: "artifact-a",
              title: "Artifact A",
              kind: "plan",
              registeredAt: "2026-10-18T10:00:00.000Z",
              isCurrent: true,
            },
            {
              artifactId: "artifact-b",
              title: "Artifact B",
              kind: "implementation-plan",
              registeredAt: "2026-10-18T10:05:00.000Z",
              isCurrent: false,
            },
          ],
        },
      ],
    });
  });

  it("skips deleted or corrupt member artifacts, increments skippedCount, and lazily removes stale membership files", async () => {
    const userHome = await makeUserHome();
    await writeSchemaV6Artifact(userHome, "artifact-current", { title: "Current Artifact" });
    const deleted = await writeSchemaV6Artifact(userHome, "artifact-deleted", { title: "Deleted Artifact" });
    const corrupt = await writeSchemaV6Artifact(userHome, "artifact-corrupt", { title: "Corrupt Artifact" });

    const conv = await createConversationAndRegisterArtifact({
      userHome,
      conversationName: "Mixed Thread",
      artifactId: "artifact-current",
      registeredAt: "2026-10-18T10:00:00.000Z",
    });
    const convId = conv.conversation.artifactConversationId;
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: convId,
      artifactId: "artifact-deleted",
      registeredAt: "2026-10-18T10:01:00.000Z",
    });
    await registerArtifactInConversation({
      userHome,
      artifactConversationId: convId,
      artifactId: "artifact-corrupt",
      registeredAt: "2026-10-18T10:02:00.000Z",
    });

    // Delete one artifact and corrupt the other's manifest
    await rm(deleted.artifactDirectory, { recursive: true, force: true });
    await writeFile(corrupt.manifestPath, "{ invalid json", "utf8");

    const service = new ConversationArtifactService<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome },
    });

    const result = await service.getConversationsForArtifact("artifact-current");
    expect(result.skippedCount).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.artifacts).toEqual([
      {
        artifactId: "artifact-current",
        title: "Current Artifact",
        kind: "implementation-plan",
        registeredAt: "2026-10-18T10:00:00.000Z",
        isCurrent: true,
      },
    ]);

    // Stale membership files should have been lazily removed
    await expect(
      access(conversationRegisteredArtifactPath(convId, "artifact-deleted", { userHome })),
    ).rejects.toThrow();
    await expect(
      access(conversationRegisteredArtifactPath(convId, "artifact-corrupt", { userHome })),
    ).rejects.toThrow();
  });

  it("returns error view state without throwing when conversation-registry root is unsafe", async () => {
    const userHome = await makeUserHome();
    const outside = path.join(userHome, "outside-registry");
    const artifactsContainer = path.dirname(globalArtifactsRoot({ userHome }));
    await mkdir(outside, { recursive: true });
    await mkdir(artifactsContainer, { recursive: true });
    await symlink(
      outside,
      path.join(artifactsContainer, CONVERSATION_REGISTRY_DIRECTORY),
      process.platform === "win32" ? "junction" : "dir",
    );

    const service = new ConversationArtifactService<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome },
    });

    const state = await service.getConversationsViewState("artifact-current");
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toContain("CONVERSATION_REGISTRY_INVALID");
    }
  });

  it("opens a valid conversation artifact in a non-preview tab, rejects invalid IDs, and triggers refresh when target is missing on disk", async () => {
    const userHome = await makeUserHome();
    const targetArtifact = await writeSchemaV6Artifact(userHome, "artifact-target", {
      title: "Target Artifact",
    });

    const openWith = vi.fn(async (_uri: TestUri, _options?: ArtifactReviewOpenOptions) => undefined);
    const reportError = vi.fn();
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>(
      { uriFromFilePath: (fsPath) => ({ fsPath }), openWith },
      { userHome },
    );
    const service = new ConversationArtifactService<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openArtifactReview: (uri, opts) => coordinator.open(uri, opts),
      reportError,
      rootOptions: { userHome },
    });

    const changeListener = vi.fn();
    service.onDidChange(changeListener);

    // 1. Valid open uses preview: false
    const opened = await service.openConversationArtifact("artifact-target");
    expect(opened.status).toBe("opened");
    expect(opened.shouldRefresh).toBe(false);
    expect(openWith).toHaveBeenCalledTimes(1);
    expect(openWith).toHaveBeenCalledWith(
      { fsPath: targetArtifact.artifactPath },
      { preview: false },
    );
    expect(changeListener).not.toHaveBeenCalled();

    // 2. Malformed / path-traversal artifactId is rejected before openWith
    const invalid = await service.openConversationArtifact("../outside");
    expect(invalid.status).toBe("error");
    expect(invalid.shouldRefresh).toBe(false);
    expect(openWith).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("Invalid artifact ID"));

    // 3. Deleted artifact on disk reports error and triggers immediate Sidebar refresh
    await rm(targetArtifact.artifactDirectory, { recursive: true, force: true });
    const missing = await service.openConversationArtifact("artifact-target");
    expect(missing).toEqual({
      status: "missing",
      artifactId: "artifact-target",
      message: 'Artifact "artifact-target" is no longer available on disk.',
      shouldRefresh: true,
    });
    expect(reportError).toHaveBeenCalledWith(
      'Artifact "artifact-target" is no longer available on disk.',
    );
    expect(changeListener).toHaveBeenCalledTimes(1);
  });

  it("debounces watcher events on conversation-registry/** and cleans up on dispose", async () => {
    vi.useFakeTimers();
    const userHome = await makeUserHome();
    const service = new ConversationArtifactService<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome },
      debounceMs: 100,
    });

    const fakeWatcher = new FakeConversationWatcher();
    const createWatcher = vi.fn((_root: string, _pattern: string) => fakeWatcher);

    await setupConversationRegistryWatcher({
      service,
      createWatcher,
      rootOptions: { userHome },
    });

    expect(createWatcher).toHaveBeenCalledTimes(1);
    expect(createWatcher.mock.calls[0]?.[1]).toBe("**/*");

    const listener = vi.fn();
    const subscription = service.onDidChange(listener);

    fakeWatcher.fireCreate();
    fakeWatcher.fireChange();
    fakeWatcher.fireDelete();

    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(99);
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(listener).toHaveBeenCalledTimes(1);

    subscription.dispose();
    fakeWatcher.fireChange();
    await vi.advanceTimersByTimeAsync(150);
    expect(listener).toHaveBeenCalledTimes(1);

    service.dispose();
    expect(fakeWatcher.disposed).toBe(true);
  });
});
