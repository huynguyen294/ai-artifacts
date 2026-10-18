import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ConversationArtifactsViewState,
  ExtensionToWebviewMessage,
  ReviewState,
} from "../src/shared/contracts";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
    parse: (url: string) => {
      const parsed = new URL(url);
      return {
        scheme: parsed.protocol.replace(":", ""),
        toString: () => url,
      };
    },
  },
  RelativePattern: class {
    constructor(
      public readonly base: string,
      public readonly pattern: string,
    ) {}
  },
  workspace: {
    onDidChangeTextDocument: () => ({ dispose: vi.fn() }),
    createFileSystemWatcher: () => ({
      onDidCreate: vi.fn(),
      onDidChange: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    }),
  },
  env: {
    clipboard: {
      writeText: vi.fn(async () => undefined),
    },
    openExternal: vi.fn(async () => true),
  },
}));

import {
  ArtifactReviewProvider,
  type ArtifactStoreController,
  type ConversationArtifactProviderController,
} from "../src/extension/artifact-review-provider";

function sampleReviewState(artifactId = "artifact-current"): ReviewState {
  const now = new Date().toISOString();
  return {
    artifact: {
      schemaVersion: 6,
      kind: "implementation-plan",
      artifactId,
      title: "Sample Plan",
      createdAt: now,
      updatedAt: now,
      reviewRound: 1,
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
    },
    markdown: "# Sample Plan\n",
    blocks: [
      {
        id: "block-1",
        index: 0,
        type: "heading",
        heading: "Sample Plan",
        text: "Sample Plan",
        sourceStart: 0,
        sourceEnd: 13,
      },
    ],
    comments: {
      schemaVersion: 6,
      artifactId,
      reviewRound: 1,
      artifactSha256: "a".repeat(64),
      comments: [],
    },
    lifecycle: {
      readOnly: false,
    },
  };
}

function createFakePanel() {
  const postedMessages: ExtensionToWebviewMessage[] = [];
  let messageListener: ((rawMessage: unknown) => Promise<void>) | undefined;
  let disposeListener: (() => void) | undefined;

  const panel = {
    webview: {
      options: {},
      html: "",
      cspSource: "vscode-webview://test",
      asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
      postMessage: vi.fn(async (msg: ExtensionToWebviewMessage) => {
        postedMessages.push(msg);
        return true;
      }),
      onDidReceiveMessage: (listener: (rawMessage: unknown) => Promise<void>) => {
        messageListener = listener;
        return { dispose: vi.fn() };
      },
    },
    onDidDispose: (listener: () => void) => {
      disposeListener = listener;
      return { dispose: vi.fn() };
    },
  };

  return {
    panel: panel as any,
    postedMessages,
    sendMessage: async (msg: unknown) => {
      await messageListener?.(msg);
    },
    disposePanel: () => {
      disposeListener?.();
    },
  };
}

function createFakeStore(artifactId = "artifact-current"): ArtifactStoreController & {
  loadMock: ReturnType<typeof vi.fn>;
} {
  const loadMock = vi.fn(async () => sampleReviewState(artifactId));
  return {
    artifactDirectory: `/home/.ai-artifacts/artifacts/${artifactId}`,
    artifactId,
    load: loadMock,
    loadMock,
    addComment: vi.fn(async () => sampleReviewState(artifactId)),
    removeComment: vi.fn(async () => sampleReviewState(artifactId)),
    submitReview: vi.fn(async () => sampleReviewState(artifactId)),
  };
}

describe("ArtifactReviewProvider conversation transport (Phase 5)", () => {
  it("posts central ReviewState before conversation loading finishes on ready", async () => {
    const store = createFakeStore("artifact-current");
    let resolveConvState: ((state: ConversationArtifactsViewState) => void) | undefined;
    const convPromise = new Promise<ConversationArtifactsViewState>((resolve) => {
      resolveConvState = resolve;
    });

    const conversationService: ConversationArtifactProviderController = {
      getConversationsViewState: vi.fn(() => convPromise),
      openConversationArtifact: vi.fn(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, postedMessages, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);
    await sendMessage({ type: "ready" });

    // Central document state is already posted while conversation state is still in loading
    expect(postedMessages).toEqual([
      {
        type: "state",
        state: expect.objectContaining({
          artifact: expect.objectContaining({ artifactId: "artifact-current" }),
        }),
      },
      {
        type: "conversationArtifactsState",
        state: { status: "loading" },
      },
    ]);

    const readyConvState: ConversationArtifactsViewState = {
      status: "ready",
      skippedCount: 0,
      groups: [
        {
          artifactConversationId: "11111111-1111-4111-8111-111111111111",
          conversationName: "Thread 1",
          currentArtifactRegisteredAt: "2026-10-18T10:00:00.000Z",
          artifacts: [
            {
              artifactId: "artifact-current",
              title: "Sample Plan",
              kind: "implementation-plan",
              registeredAt: "2026-10-18T10:00:00.000Z",
              isCurrent: true,
            },
          ],
        },
      ],
    };
    resolveConvState?.(readyConvState);
    await vi.waitFor(() => {
      expect(postedMessages).toHaveLength(3);
    });

    expect(postedMessages[2]).toEqual({
      type: "conversationArtifactsState",
      state: readyConvState,
    });
    expect(store.loadMock).toHaveBeenCalledTimes(1);
  });

  it("isolates conversation errors into conversationArtifactsState without breaking the main document", async () => {
    const store = createFakeStore("artifact-current");
    const conversationService: ConversationArtifactProviderController = {
      getConversationsViewState: vi.fn(async () => {
        throw new Error("Simulated conversation registry failure");
      }),
      openConversationArtifact: vi.fn(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, postedMessages, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);
    await sendMessage({ type: "ready" });

    await vi.waitFor(() => {
      expect(postedMessages).toHaveLength(3);
    });

    expect(postedMessages[0]?.type).toBe("state");
    expect(postedMessages[2]).toEqual({
      type: "conversationArtifactsState",
      state: {
        status: "error",
        message: "Simulated conversation registry failure",
      },
    });
    expect(postedMessages.some((m) => m.type === "error")).toBe(false);
  });

  it("refreshes only conversationArtifactsState on conversationService.onDidChange without calling store.load() and cleans up on dispose", async () => {
    const store = createFakeStore("artifact-current");
    let changeHandler: (() => void | Promise<void>) | undefined;
    const disposeSubscription = vi.fn();

    const conversationService: ConversationArtifactProviderController = {
      getConversationsViewState: vi.fn(async (): Promise<ConversationArtifactsViewState> => ({
        status: "ready",
        groups: [],
        skippedCount: 0,
      })),
      openConversationArtifact: vi.fn(),
      onDidChange: vi.fn((listener) => {
        changeHandler = listener;
        return { dispose: disposeSubscription };
      }),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, postedMessages, sendMessage, disposePanel } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);
    await sendMessage({ type: "ready" });
    await vi.waitFor(() => expect(postedMessages).toHaveLength(3));

    expect(store.loadMock).toHaveBeenCalledTimes(1);

    // Trigger conversation registry change
    await changeHandler?.();
    await vi.waitFor(() => expect(postedMessages).toHaveLength(4));

    // Must NOT have called store.load() again
    expect(store.loadMock).toHaveBeenCalledTimes(1);
    expect(postedMessages[3]).toEqual({
      type: "conversationArtifactsState",
      state: {
        status: "ready",
        groups: [],
        skippedCount: 0,
      },
    });

    // Dispose panel -> subscription is disposed
    disposePanel();
    expect(disposeSubscription).toHaveBeenCalledTimes(1);
  });

  it("handles openConversationArtifact and refreshes from the service change event when target artifact is missing on disk", async () => {
    const store = createFakeStore("artifact-current");
    let changeHandler: (() => void | Promise<void>) | undefined;
    const getConversationsViewState = vi.fn(async (): Promise<ConversationArtifactsViewState> => ({
      status: "ready",
      groups: [],
      skippedCount: 1,
    }));
    const openConversationArtifact = vi
      .fn()
      .mockResolvedValueOnce({
        status: "opened",
        target: {} as any,
        shouldRefresh: false,
      })
      .mockImplementationOnce(async () => {
        await changeHandler?.();
        return {
          status: "missing",
          artifactId: "artifact-deleted",
          message: 'Artifact "artifact-deleted" is no longer available on disk.',
          shouldRefresh: true,
        };
      });

    const conversationService: ConversationArtifactProviderController = {
      getConversationsViewState,
      openConversationArtifact,
      onDidChange: vi.fn((listener) => {
        changeHandler = listener;
        return { dispose: vi.fn() };
      }),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, postedMessages, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);

    // 1. Opening an existing artifact does not trigger an extra conversation refresh
    await sendMessage({ type: "openConversationArtifact", artifactId: "artifact-other" });
    expect(openConversationArtifact).toHaveBeenCalledWith("artifact-other");
    expect(getConversationsViewState).not.toHaveBeenCalled();

    // 2. Opening a missing artifact triggers the service change event exactly once.
    await sendMessage({ type: "openConversationArtifact", artifactId: "artifact-deleted" });
    expect(openConversationArtifact).toHaveBeenCalledWith("artifact-deleted");
    expect(getConversationsViewState).toHaveBeenCalledTimes(1);
    expect(postedMessages).toEqual([
      {
        type: "conversationArtifactsState",
        state: {
          status: "ready",
          groups: [],
          skippedCount: 1,
        },
      },
    ]);
    expect(store.loadMock).not.toHaveBeenCalled();
  });
});
