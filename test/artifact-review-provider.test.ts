import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactSessionTarget,
  ExtensionToWebviewMessage,
  ReviewState,
  WorkSession,
} from "../src/shared/contracts";

const {
  executeCommandMock,
  showInformationMessageMock,
  showWarningMessageMock,
  showErrorMessageMock,
  showQuickPickMock,
  showInputBoxMock,
  writeTextMock,
  openExternalMock,
  mockResolveWorkSessionSupport,
  mockRunSingleMigration,
  mockValidateArtifactReviewTarget,
  mockRemoveConversation,
} = vi.hoisted(() => ({
  executeCommandMock: vi.fn(async () => undefined),
  showInformationMessageMock: vi.fn(),
  showWarningMessageMock: vi.fn(),
  showErrorMessageMock: vi.fn(),
  showQuickPickMock: vi.fn(),
  showInputBoxMock: vi.fn<(_options?: any) => Promise<string | undefined>>(async () => undefined),
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
  mockValidateArtifactReviewTarget: vi.fn<(_targetPath: string, _options?: any) => Promise<any>>(),
  mockRemoveConversation: vi.fn<(_sessionId?: string, _options?: any) => Promise<boolean>>(async () => true),
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
    showWarningMessage: showWarningMessageMock,
    showErrorMessage: showErrorMessageMock,
    showQuickPick: showQuickPickMock,
    showInputBox: showInputBoxMock,
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

vi.mock("../src/extension/artifact-review-open", () => ({
  validateArtifactReviewTarget: (targetPath: string, options?: any) =>
    mockValidateArtifactReviewTarget(targetPath, options),
}));

vi.mock("../src/shared/conversation-artifact-registry", () => ({
  removeConversation: (sessionId: string, options?: any) =>
    mockRemoveConversation(sessionId, options),
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

function createSampleWorkSession(sessionId: string, title: string): WorkSession {
  return {
    schemaVersion: 2,
    sessionId,
    title,
    typeId: "conversation",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:00.000Z",
    instructions: "",
    working: [],
    references: [],
    archived: [],
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
    mockValidateArtifactReviewTarget.mockResolvedValue({
      artifactId: "artifact-current",
      artifactPath: "/home/.ai-artifacts/artifacts/artifact-current/artifact.md",
      artifactDirectory: "/home/.ai-artifacts/artifacts/artifact-current",
      manifest: {
        schemaVersion: 6,
        kind: "implementation-plan",
        artifactId: "artifact-current",
        title: "Current Artifact Title",
        createdAt: "2026-11-08T00:00:00.000Z",
        updatedAt: "2026-11-08T00:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "00000000-0000-4000-8000-000000000001",
      },
    });
    mockRemoveConversation.mockResolvedValue(true);
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

    showInformationMessageMock.mockResolvedValueOnce("Migrate");

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
      "Migrate",
      "Cancel",
    );
    expect(mockRunSingleMigration).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "conv-v1",
      }),
    );
  });

  it("handles copyArtifactConnectPrompt with exact canonical 2-line prompt without dialog", async () => {
    const store = createFakeStore("artifact-current");
    const provider = new ArtifactReviewProvider(
      { extensionUri: { fsPath: "/ext" } } as any,
      undefined,
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

    await sendMessage({
      type: "copyArtifactConnectPrompt",
    });

    expect(writeTextMock).toHaveBeenLastCalledWith(
      "Inspect this exact AI Artifact:\n"
      + 'artifactDirectory: "/home/.ai-artifacts/artifacts/artifact-current"',
    );
    expect(postedMessages).toContainEqual({ type: "artifactConnectPromptCopied" });
  });

  describe("startWorkSession", () => {
    it("creates work session, registers artifact, opens session, and copies prompt", async () => {
      const store = createFakeStore("artifact-current");
      const createdSession = createSampleWorkSession(
        "00000000-0000-4000-8000-000000000001",
        "New Feature Session",
      );
      const createSessionMock = vi.fn(async () => createdSession);
      const registerArtifactInSessionMock = vi.fn(async () => undefined);

      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: createSessionMock,
        registerArtifactInSession: registerArtifactInSessionMock,
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      };

      showInputBoxMock.mockResolvedValueOnce("New Feature Session");

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

      await sendMessage({ type: "startWorkSession" });

      expect(showInputBoxMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Start a work session",
          prompt: "Enter a name for the new work session",
          placeHolder: "Work session name",
          value: "Current Artifact Title",
        }),
      );
      expect(createSessionMock).toHaveBeenCalledWith({ title: "New Feature Session" });
      expect(registerArtifactInSessionMock).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        "artifact-current",
      );
      expect(executeCommandMock).toHaveBeenCalledWith(
        "agentPlus.openWorkSession",
        "00000000-0000-4000-8000-000000000001",
      );
      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining('sessionId: "00000000-0000-4000-8000-000000000001"'),
      );
      expect(showInformationMessageMock).toHaveBeenCalledWith(
        "Work session created. Connect prompt copied. Paste it into your AI chat to connect.",
      );
    });

    it("returns early when user cancels input box", async () => {
      const store = createFakeStore("artifact-current");
      const createSessionMock = vi.fn();
      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: createSessionMock,
        registerArtifactInSession: vi.fn(),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      };

      showInputBoxMock.mockResolvedValueOnce(undefined);

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
      await sendMessage({ type: "startWorkSession" });

      expect(createSessionMock).not.toHaveBeenCalled();
    });

    it("rolls back created session when registration fails", async () => {
      const store = createFakeStore("artifact-current");
      const createdSession = createSampleWorkSession(
        "00000000-0000-4000-8000-000000000002",
        "Failing Registration Session",
      );
      const createSessionMock = vi.fn(async () => createdSession);
      const registerArtifactInSessionMock = vi.fn(async () => {
        throw new Error("Disk write failed");
      });

      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: createSessionMock,
        registerArtifactInSession: registerArtifactInSessionMock,
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      };

      showInputBoxMock.mockResolvedValueOnce("Failing Registration Session");

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
      await sendMessage({ type: "startWorkSession" });

      expect(mockRemoveConversation).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002", expect.anything());
      expect(showErrorMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("Failed to register artifact in session: Disk write failed"),
      );
    });

    it("retains session and shows warning if open fails after commit", async () => {
      const store = createFakeStore("artifact-current");
      const createdSession = createSampleWorkSession(
        "00000000-0000-4000-8000-000000000003",
        "Session Open Fail",
      );

      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: vi.fn(async () => createdSession),
        registerArtifactInSession: vi.fn(async () => undefined),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      };

      showInputBoxMock.mockResolvedValueOnce("Session Open Fail");
      executeCommandMock.mockRejectedValueOnce(new Error("Editor crashed"));

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
      await sendMessage({ type: "startWorkSession" });

      expect(mockRemoveConversation).not.toHaveBeenCalled();
      expect(showWarningMessageMock).toHaveBeenCalledWith(
        "Work session created and Connect prompt copied, but the session could not be opened. Paste the prompt into your AI chat to connect.",
      );
    });

    it("retains session and shows warning if copy fails after commit", async () => {
      const store = createFakeStore("artifact-current");
      const createdSession = createSampleWorkSession(
        "00000000-0000-4000-8000-000000000004",
        "Session Copy Fail",
      );

      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: vi.fn(async () => createdSession),
        registerArtifactInSession: vi.fn(async () => undefined),
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      };

      showInputBoxMock.mockResolvedValueOnce("Session Copy Fail");
      writeTextMock.mockRejectedValueOnce(new Error("Clipboard unavailable"));

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
      await sendMessage({ type: "startWorkSession" });

      expect(mockRemoveConversation).not.toHaveBeenCalled();
      expect(showWarningMessageMock).toHaveBeenCalledWith(
        "Work session created, but the Connect prompt could not be copied. Open the session and use Connect to try again.",
      );
    });

    it("shows error and prevents creation if artifact target on disk is invalid", async () => {
      const store = createFakeStore("artifact-current");
      mockValidateArtifactReviewTarget.mockRejectedValueOnce(new Error("File not found"));

      const conversationService: ConversationArtifactProviderController = {
        getArtifactSessions: vi.fn(async () => []),
        createSession: vi.fn(),
        registerArtifactInSession: vi.fn(),
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
      await sendMessage({ type: "startWorkSession" });

      expect(showErrorMessageMock).toHaveBeenCalledWith(
        'Artifact "artifact-current" is no longer valid or has been removed.',
      );
      expect(showInputBoxMock).not.toHaveBeenCalled();
    });
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

  it("selectively refreshes session targets only on relevant changes", async () => {
    const store = createFakeStore("artifact-current");
    let changeListener: ((changes?: any[]) => void) | undefined;

    const getArtifactSessionsMock = vi.fn(async () => []);
    const conversationService: ConversationArtifactProviderController = {
      getArtifactSessions: getArtifactSessionsMock,
      onDidChange: vi.fn((listener) => {
        changeListener = listener;
        return { dispose: vi.fn() };
      }),
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
    await sendMessage({ type: "ready" });
    expect(getArtifactSessionsMock).toHaveBeenCalledTimes(1);

    expect(changeListener).toBeDefined();

    // 1. Layout change -> should NOT trigger refreshSessions
    changeListener!([{ kind: "layout", sessionId: "sess-1" }]);
    expect(getArtifactSessionsMock).toHaveBeenCalledTimes(1);

    // 2. Membership of a different artifact -> should NOT trigger refreshSessions
    changeListener!([{ kind: "membership", sessionId: "sess-1", artifactId: "unrelated-artifact" }]);
    expect(getArtifactSessionsMock).toHaveBeenCalledTimes(1);

    // 3. Artifact manifest change -> should NOT trigger refreshSessions
    changeListener!([{ kind: "artifact", artifactId: "artifact-current" }]);
    expect(getArtifactSessionsMock).toHaveBeenCalledTimes(1);

    // 4. Membership of current artifact -> SHOULD trigger refreshSessions
    changeListener!([{ kind: "membership", sessionId: "sess-1", artifactId: "artifact-current" }]);
    await vi.waitFor(() => {
      expect(getArtifactSessionsMock).toHaveBeenCalledTimes(2);
    });

    // 5. Types change -> SHOULD trigger refreshSessions
    changeListener!([{ kind: "types" }]);
    await vi.waitFor(() => {
      expect(getArtifactSessionsMock).toHaveBeenCalledTimes(3);
    });
  });
});
