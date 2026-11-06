import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactSessionTarget,
  ExtensionToWebviewMessage,
  ReviewState,
} from "../src/shared/contracts";

const {
  executeCommandMock,
  showInformationMessageMock,
  showErrorMessageMock,
  showQuickPickMock,
  writeTextMock,
  openExternalMock,
  mockResolveWorkSessionSupport,
  mockRunSingleMigration,
} = vi.hoisted(() => ({
  executeCommandMock: vi.fn(async () => undefined),
  showInformationMessageMock: vi.fn(),
  showErrorMessageMock: vi.fn(),
  showQuickPickMock: vi.fn(),
  writeTextMock: vi.fn(async () => undefined),
  openExternalMock: vi.fn(async () => true),
  mockResolveWorkSessionSupport: vi.fn<
    () => Promise<{
      supported: boolean;
      requiredMcpVersion: number;
      installedMcpVersion?: number;
      reason?: string;
    }>
  >(async () => ({
    supported: true,
    requiredMcpVersion: 12,
    installedMcpVersion: 12,
  })),
  mockRunSingleMigration: vi.fn(async (deps: any) => {
    deps.onDidMigrate?.();
    await deps.openWorkSession(deps.sessionId);
    return true;
  }),
}));

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
  commands: {
    executeCommand: executeCommandMock,
  },
  window: {
    showInformationMessage: showInformationMessageMock,
    showErrorMessage: showErrorMessageMock,
    showQuickPick: showQuickPickMock,
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
      writeText: writeTextMock,
    },
    openExternal: openExternalMock,
  },
}));

vi.mock("../src/extension/work-session-support", () => ({
  WORK_SESSION_REQUIRED_MCP_VERSION: 12,
  resolveWorkSessionSupport: () => mockResolveWorkSessionSupport(),
}));

vi.mock("../src/extension/session-migration-command", () => ({
  runSingleMigration: (deps: any) => mockRunSingleMigration(deps),
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

describe("ArtifactReviewProvider sessions transport (Chặng 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveWorkSessionSupport.mockResolvedValue({
      supported: true,
      requiredMcpVersion: 12,
      installedMcpVersion: 12,
    });
  });

  it("posts central ReviewState and artifactSessionsState on ready", async () => {
    const store = createFakeStore("artifact-current");
    const sampleSessions: ArtifactSessionTarget[] = [
      {
        sessionId: "sess-1",
        title: "Session 1",
        version: 2,
        typeId: "feature",
        typeLabel: "Feature",
      },
    ];

    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => sampleSessions),
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
      expect(postedMessages).toHaveLength(2);
    });

    expect(postedMessages[0]).toEqual({
      type: "state",
      state: expect.objectContaining({
        artifact: expect.objectContaining({ artifactId: "artifact-current" }),
      }),
    });

    expect(postedMessages[1]).toEqual({
      type: "artifactSessionsState",
      supported: true,
      sessions: sampleSessions,
    });
    expect(store.loadMock).toHaveBeenCalledTimes(1);
  });

  it("posts artifactSessionsState with supported: false when MCP < 12", async () => {
    mockResolveWorkSessionSupport.mockResolvedValueOnce({
      supported: false,
      requiredMcpVersion: 12,
      installedMcpVersion: 11,
      reason: "MCP version 11 < 12",
    });

    const store = createFakeStore("artifact-current");
    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => []),
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
      expect(postedMessages).toHaveLength(2);
    });

    expect(postedMessages[1]).toEqual({
      type: "artifactSessionsState",
      supported: false,
      sessions: [],
    });
  });

  it("refreshes only artifactSessionsState on conversationService.onDidChange without calling store.load() and cleans up on dispose", async () => {
    const store = createFakeStore("artifact-current");
    let changeHandler: (() => void | Promise<void>) | undefined;
    const disposeSubscription = vi.fn();

    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => []),
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
    await vi.waitFor(() => expect(postedMessages).toHaveLength(2));

    expect(store.loadMock).toHaveBeenCalledTimes(1);

    // Trigger change event
    await changeHandler?.();
    await vi.waitFor(() => expect(postedMessages).toHaveLength(3));

    // Must NOT call store.load() again
    expect(store.loadMock).toHaveBeenCalledTimes(1);
    expect(postedMessages[2]).toEqual({
      type: "artifactSessionsState",
      supported: true,
      sessions: [],
    });

    disposePanel();
    expect(disposeSubscription).toHaveBeenCalledTimes(1);
  });

  it("handles openArtifactSessions for single v2 session", async () => {
    const store = createFakeStore("artifact-current");
    const sampleSessions: ArtifactSessionTarget[] = [
      {
        sessionId: "sess-v2",
        title: "Session v2",
        version: 2,
        typeId: "feature",
        typeLabel: "Feature",
      },
    ];

    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => sampleSessions),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);
    await sendMessage({ type: "openArtifactSessions" });

    expect(executeCommandMock).toHaveBeenCalledWith("agentPlus.openWorkSession", "sess-v2");
  });

  it("handles openArtifactSessions for single v1 session with migration confirmation", async () => {
    const store = createFakeStore("artifact-current");
    const sampleSessions: ArtifactSessionTarget[] = [
      {
        sessionId: "conv-v1",
        title: "Legacy Conversation",
        version: 1,
      },
    ];

    showInformationMessageMock.mockResolvedValueOnce("Chuyển đổi");

    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => sampleSessions),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);
    await sendMessage({ type: "openArtifactSessions" });

    expect(showInformationMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('Legacy Conversation'),
      "Chuyển đổi",
      "Huỷ",
    );
    expect(mockRunSingleMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "conv-v1",
      }),
    );
  });

  it("handles copyArtifactConnectPrompt with mode=join and mode=new", async () => {
    const store = createFakeStore("artifact-current");
    const validTargetSession: ArtifactSessionTarget = {
      sessionId: "00000000-0000-4000-8000-000000000001",
      title: "Target Session",
      version: 2,
    };
    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => [validTargetSession]),
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

    // 1. Join mode with valid session
    await sendMessage({
      type: "copyArtifactConnectPrompt",
      mode: "join",
      sessionId: "00000000-0000-4000-8000-000000000001",
    });
    expect(writeTextMock).toHaveBeenLastCalledWith(
      expect.stringContaining("00000000-0000-4000-8000-000000000001"),
    );
    expect(postedMessages).toContainEqual({ type: "artifactConnectPromptCopied" });

    // 2. Join mode with invalid session (not in artifact sessions) -> rejected by host
    await sendMessage({
      type: "copyArtifactConnectPrompt",
      mode: "join",
      sessionId: "00000000-0000-4000-8000-000000000099",
    });
    expect(showErrorMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("00000000-0000-4000-8000-000000000099"),
    );

    // 3. New mode
    await sendMessage({
      type: "copyArtifactConnectPrompt",
      mode: "new",
    });
    expect(writeTextMock).toHaveBeenLastCalledWith(
      expect.stringContaining("Do not pass any existing artifactConversationId"),
    );
  });

  it("handles migrateSelectedConversation only when candidate is v1 and MCP >= 12", async () => {
    const store = createFakeStore("artifact-current");
    const candidateSession: ArtifactSessionTarget = {
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Candidate Conv",
      version: 1,
    };
    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: vi.fn(async () => [candidateSession]),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    };

    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      conversationService,
      () => store,
    );

    const { panel, sendMessage } = createFakePanel();
    const document = {
      uri: {
        fsPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
        toString: () => "file:///home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      },
    } as any;

    await provider.resolveCustomTextEditor(document, panel);

    // 1. Valid migration
    await sendMessage({
      type: "migrateSelectedConversation",
      sessionId: "00000000-0000-4000-8000-000000000002",
    });
    expect(mockRunSingleMigration).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "00000000-0000-4000-8000-000000000002" }),
    );

    // 2. Invalid migration (session not v1) -> rejected by host
    await sendMessage({
      type: "migrateSelectedConversation",
      sessionId: "00000000-0000-4000-8000-000000000099",
    });
    expect(showErrorMessageMock).toHaveBeenCalledWith(
      expect.stringContaining("00000000-0000-4000-8000-000000000099"),
    );
  });
});
