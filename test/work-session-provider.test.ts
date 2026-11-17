import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveWorkSessionSupport, mockShowInputBox, mockCreateQuickPick } = vi.hoisted(() => ({
  mockResolveWorkSessionSupport: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockCreateQuickPick: vi.fn(),
}));

vi.mock("../src/extension/work-session-support", () => ({
  resolveWorkSessionSupport: mockResolveWorkSessionSupport,
  WORK_SESSION_REQUIRED_MCP_VERSION: 12,
}));

vi.mock("vscode", () => ({
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
  Uri: {
    file: (fsPath: string) => ({
      fsPath,
      scheme: "file",
      toString: () => `file://${fsPath}`,
    }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
      scheme: "file",
      toString: () => `file://${path.join(base.fsPath, ...segments)}`,
    }),
    parse: (url: string) => {
      const parsed = new URL(url);
      return {
        scheme: parsed.protocol.replace(":", ""),
        toString: () => url,
      };
    },
  },
  env: {
    openExternal: vi.fn(async () => true),
    clipboard: {
      writeText: vi.fn(async () => {}),
    },
  },
  window: {
    showInputBox: mockShowInputBox,
    createQuickPick: mockCreateQuickPick,
  },
}));

import * as vscode from "vscode";
import { WorkSessionProvider, WorkSessionDocument } from "../src/extension/work-session-provider";
import { ConversationArtifactService } from "../src/extension/conversation-artifact-service";
import { ArtifactAutoOpenController } from "../src/extension/artifact-review-open";
import {
  createSession,
  registerArtifactInSession,
  updateSessionDetails,
} from "../src/shared/conversation-artifact-registry";
import { conversationDirectory, globalArtifactsRoot } from "../src/shared/artifact-files";
import {
  readActiveSessionWaiters,
  registerSessionWaiter,
  renewSessionWaiterLease,
} from "../src/shared/session-waiter-store";

describe("WorkSessionProvider", () => {
  let tempHome: string;
  let service: ConversationArtifactService<any>;
  let openCoordinator: any;
  let mockContext: any;
  let autoOpenController: ArtifactAutoOpenController;
  let configuredAutoOpen: boolean;

  beforeEach(async () => {
    configuredAutoOpen = true;
    autoOpenController = new ArtifactAutoOpenController(() => configuredAutoOpen);
    tempHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-prov-"));
    service = new ConversationArtifactService<any>({
      uriFromFilePath: (p) => ({ fsPath: p }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome: tempHome },
    });
    openCoordinator = {
      open: vi.fn(),
    };
    mockResolveWorkSessionSupport.mockResolvedValue({
      supported: true,
      requiredMcpVersion: 12,
      installedMcpVersion: 12,
    });
    const stateMap = new Map<string, any>();
    mockContext = {
      extensionUri: { fsPath: "/mock/extension" },
      globalState: {
        get: (key: string, defaultValue?: any) => (stateMap.has(key) ? stateMap.get(key) : defaultValue),
        update: (key: string, value: any) => {
          stateMap.set(key, value);
          return Promise.resolve();
        },
      },
    };
  });

  afterEach(async () => {
    service.dispose();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("shares temporary auto-open across panels and follows configuration changes without saving it", async () => {
    const firstSession = await createSession({ title: "First", userHome: tempHome });
    const secondSession = await createSession({ title: "Second", userHome: tempHome });
    const provider = new WorkSessionProvider(mockContext, service, openCoordinator, autoOpenController, { userHome: tempHome });
    const persist = vi.spyOn(mockContext.globalState, "update");

    const attach = async (sessionId: string) => {
      let receive!: (message: unknown) => Promise<void>;
      let dispose!: () => void;
      const post = vi.fn();
      const panel = {
        webview: {
          options: {}, html: "", cspSource: "vscode-webview://test",
          asWebviewUri: (uri: any) => uri.fsPath,
          postMessage: post,
          onDidReceiveMessage: (listener: typeof receive) => {
            receive = listener;
            return { dispose: () => {} };
          },
        },
        onDidDispose: (listener: () => void) => { dispose = listener; return { dispose: () => {} }; },
      };
      const doc = new WorkSessionDocument({ fsPath: path.join(conversationDirectory(sessionId, { userHome: tempHome }), "conversation.json") } as any, sessionId);
      await provider.resolveCustomEditor(doc, panel as any, {} as any);
      await receive({ type: "ready" });
      return { receive, dispose, post };
    };

    const first = await attach(firstSession.sessionId);
    const second = await attach(secondSession.sessionId);
    await first.receive({ type: "setArtifactAutoOpen", enabled: false });
    for (const panel of [first, second]) {
      expect(panel.post).toHaveBeenCalledWith({ type: "artifactAutoOpenState", state: { enabled: false, configuredEnabled: true } });
    }
    expect(autoOpenController.isEnabled()).toBe(false);

    configuredAutoOpen = false;
    autoOpenController.refresh();
    expect(second.post).toHaveBeenLastCalledWith({ type: "artifactAutoOpenState", state: { enabled: false, configuredEnabled: false } });
    configuredAutoOpen = true;
    autoOpenController.refresh();
    expect(autoOpenController.isEnabled()).toBe(false);

    first.dispose();
    second.dispose();
    const reopened = await attach(firstSession.sessionId);
    expect(reopened.post).toHaveBeenCalledWith({ type: "artifactAutoOpenState", state: { enabled: false, configuredEnabled: true } });
    await reopened.receive({ type: "setArtifactAutoOpen", enabled: true });
    expect(autoOpenController.isEnabled()).toBe(true);

    configuredAutoOpen = false;
    autoOpenController.refresh();
    await reopened.receive({ type: "setArtifactAutoOpen", enabled: true });
    expect(autoOpenController.isEnabled()).toBe(false);
    expect(persist).not.toHaveBeenCalled();
    reopened.dispose();

    configuredAutoOpen = true;
    const otherWindow = new ArtifactAutoOpenController(() => configuredAutoOpen);
    autoOpenController.setEnabled(false);
    expect(otherWindow.isEnabled()).toBe(true);
  });

  it("openCustomDocument validates document path and returns WorkSessionDocument", async () => {
    const session = await createSession({
      title: "Doc Test Session",
      userHome: tempHome,
    });

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const validUri = {
      fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json"),
    };

    const doc = await provider.openCustomDocument(validUri as any, {} as any, {} as any);
    expect(doc).toBeInstanceOf(WorkSessionDocument);
    expect(doc.sessionId).toBe(session.sessionId);

    // Rejects invalid filename
    const invalidFilenameUri = {
      fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "wrong.json"),
    };
    await expect(
      provider.openCustomDocument(invalidFilenameUri as any, {} as any, {} as any),
    ).rejects.toThrow("Invalid session document");

    // Rejects non-existent session
    const nonExistentUri = {
      fsPath: path.join(conversationDirectory("00000000-0000-4000-8000-000000000000", { userHome: tempHome }), "conversation.json"),
    };
    await expect(
      provider.openCustomDocument(nonExistentUri as any, {} as any, {} as any),
    ).rejects.toThrow();
  });

  it("resolveCustomEditor sets HTML and posts session state on ready", async () => {
    const session = await createSession({
      title: "UI Test Session",
      instructions: "## Custom instructions\nLine 2",
      userHome: tempHome,
    });

    // Create an artifact and register it
    const artId = "test-artifact-01";
    const artDir = path.join(globalArtifactsRoot({ userHome: tempHome }), artId);
    await mkdir(artDir, { recursive: true });
    await writeFile(
      path.join(artDir, "artifact.json"),
      JSON.stringify({
        schemaVersion: 6,
        kind: "implementation-plan",
        artifactId: artId,
        title: "Test Implementation Plan",
        createdAt: "2026-04-10T10:00:00.000Z",
        updatedAt: "2026-04-10T11:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "00000000-0000-4000-8000-000000000001",
      }),
    );
    await writeFile(path.join(artDir, "artifact.md"), "# Plan\n");

    await registerArtifactInSession(session.sessionId, artId, { userHome: tempHome });

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);

    expect(panel.webview.html).toContain('data-app="session"');

    // Simulate webview ready message
    expect(messageListener).toBeDefined();
    await messageListener!({ type: "ready" });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workSessionState",
        state: expect.objectContaining({
          status: "ready",
          data: expect.objectContaining({
            sessionId: session.sessionId,
            title: "UI Test Session",
            typeLabel: "Conversation",
            instructions: "## Custom instructions\nLine 2",
            working: expect.arrayContaining([
              expect.objectContaining({
                artifactId: artId,
                title: "Test Implementation Plan",
                kind: "implementation-plan",
              }),
            ]),
          }),
        }),
      }),
    );

    // Simulate openArtifact message
    await messageListener!({ type: "openArtifact", artifactId: artId });
    expect(openCoordinator.open).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: expect.stringContaining(artId),
      }),
    );

    // Simulate openExternal with safe URL
    await messageListener!({ type: "openExternal", url: "https://example.com" });
    expect(vscode.env.openExternal).toHaveBeenCalledWith(
      expect.objectContaining({ scheme: "https" }),
    );

    // Simulate openExternal with disallowed scheme
    await messageListener!({ type: "openExternal", url: "ftp://example.com/file" });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("not allowed in Work Session"),
      }),
    );
  });

  it("handles manager editing actions: instructions, rename, panel preference, move, reorder, remove", async () => {
    const session = await createSession({
      title: "Action Test Session",
      instructions: "Original instructions",
      userHome: tempHome,
    });

    // Create 2 artifacts
    const art1 = "art-01";
    const art2 = "art-02";
    for (const artId of [art1, art2]) {
      const artDir = path.join(globalArtifactsRoot({ userHome: tempHome }), artId);
      await mkdir(artDir, { recursive: true });
      await writeFile(
        path.join(artDir, "artifact.json"),
        JSON.stringify({
          schemaVersion: 6,
          kind: "implementation-plan",
          artifactId: artId,
          title: `Title ${artId}`,
          createdAt: "2026-04-10T10:00:00.000Z",
          updatedAt: "2026-04-10T11:00:00.000Z",
          reviewRound: 1,
          reviewSessionId: "00000000-0000-4000-8000-000000000001",
        }),
      );
      await writeFile(path.join(artDir, "artifact.md"), "# Content\n");
      await registerArtifactInSession(session.sessionId, artId, { userHome: tempHome });
    }

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);

    // 1. Panel expanded toggle
    await messageListener!({ type: "setSessionPanelExpanded", expanded: false });
    expect(mockContext.globalState.get(`workSessions.panelExpanded.${session.sessionId}`)).toBe(false);
    expect(postMessage).toHaveBeenCalledWith({ type: "sessionPanelExpanded", expanded: false });

    // 2. Save session instructions
    await messageListener!({ type: "saveSessionInstructions", instructions: "Updated markdown instructions" });
    expect(postMessage).toHaveBeenCalledWith({
      type: "sessionInstructionsSaved",
      instructions: "Updated markdown instructions",
    });
    const updated1 = await service.getWorkSession(session.sessionId);
    expect(updated1.instructions).toBe("Updated markdown instructions");

    // 3. Rename session
    mockShowInputBox.mockResolvedValueOnce("New Renamed Title");
    await messageListener!({ type: "renameSession" });
    const updated2 = await service.getWorkSession(session.sessionId);
    expect(updated2.title).toBe("New Renamed Title");

    // 4. Move artifact to references
    await messageListener!({ type: "moveArtifact", artifactId: art1, zone: "references" });
    const updated3 = await service.getWorkSession(session.sessionId);
    expect(updated3.working).toEqual([art2]);
    expect(updated3.references).toEqual([art1]);

    // 5. Moving art2 to references prepends it to the start of the zone
    await messageListener!({ type: "moveArtifact", artifactId: art2, zone: "references" });
    const updated4 = await service.getWorkSession(session.sessionId);
    expect(updated4.references).toEqual([art2, art1]);

    // Reorder art1 up
    await messageListener!({ type: "reorderArtifact", artifactId: art1, direction: "up" });
    const updated5 = await service.getWorkSession(session.sessionId);
    expect(updated5.references).toEqual([art1, art2]);

    // 6. Remove artifact
    await messageListener!({ type: "removeArtifact", artifactId: art1 });
    const updated6 = await service.getWorkSession(session.sessionId);
    expect(updated6.references).toEqual([art2]);
  });

  it("rejects mutating actions when MCP server version is unsupported", async () => {
    mockResolveWorkSessionSupport.mockResolvedValueOnce({
      supported: false,
      requiredMcpVersion: 12,
      installedMcpVersion: 11,
      reason: "MCP server version 12 or higher is required",
    });

    const session = await createSession({
      title: "Gate Test Session",
      userHome: tempHome,
    });

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);

    await messageListener!({ type: "saveSessionInstructions", instructions: "Hacked" });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "actionError",
        action: "saveSessionInstructions",
        message: expect.stringContaining("MCP server version 12 or higher is required"),
      }),
    );
  });

  it("emits workSessionSummaryPatch when metadata changes on disk externally without overwriting instructions", async () => {
    const session = await createSession({
      title: "Patch Test Session",
      instructions: "Original instructions",
      userHome: tempHome,
    });

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);
    await messageListener!({ type: "ready" });

    postMessage.mockClear();

    // External title change -> emits workSessionSummaryPatch
    await updateSessionDetails(session.sessionId, { title: "Title Only Changed" }, { userHome: tempHome });
    service.notifyChanged([{ kind: "metadata", sessionId: session.sessionId }]);

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workSessionSummaryPatch",
          summary: expect.objectContaining({ title: "Title Only Changed" }),
        }),
      );
      expect(postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "workSessionInstructionsPatch" }),
      );
    });

    // Instructions change externally -> emits workSessionInstructionsPatch for external update
    postMessage.mockClear();
    await updateSessionDetails(
      session.sessionId,
      { instructions: "Instructions Changed By AI" },
      { userHome: tempHome },
    );
    service.notifyChanged([{ kind: "metadata", sessionId: session.sessionId }]);

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "workSessionInstructionsPatch",
          instructions: "Instructions Changed By AI",
        }),
      );
    });
  });

  it("handles openSessionInstructionsFile, copySessionConnectPrompt, and addSessionArtifact", async () => {
    mockResolveWorkSessionSupport.mockResolvedValue({ supported: true });

    const session = await createSession({
      userHome: tempHome,
      title: "Actions Test Session",
    });

    const openCoordinator = {
      open: vi.fn(async () => {}),
    };

    const openTextDocument = vi.fn(async () => {});

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator as any,
      autoOpenController,
      { userHome: tempHome },
      openTextDocument,
    );

    const doc = new WorkSessionDocument(
      vscode.Uri.file(`/sessions/${session.sessionId}/conversation.json`),
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);
    await messageListener!({ type: "ready" });

    // 1. openSessionInstructionsFile
    await messageListener!({ type: "openSessionInstructionsFile" });
    expect(openTextDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fsPath: expect.stringContaining("instructions.md"),
      }),
    );

    // 2. copySessionConnectPrompt
    await messageListener!({ type: "copySessionConnectPrompt" });
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('sessionId: "' + session.sessionId + '"'),
    );
    expect(postMessage).toHaveBeenCalledWith({
      type: "sessionConnectPromptCopied",
    });
  });

  it("prepends moved artifacts to the start of working, references, and archived zones", async () => {
    const session = await createSession({
      title: "Prepend Zone Move Session",
      userHome: tempHome,
    });

    const artA = "art-01";
    const artB = "art-02";
    const artC = "art-03";
    for (const [idx, artId] of [artA, artB, artC].entries()) {
      const artDir = path.join(globalArtifactsRoot({ userHome: tempHome }), artId);
      await mkdir(artDir, { recursive: true });
      await writeFile(
        path.join(artDir, "artifact.json"),
        JSON.stringify({
          schemaVersion: 6,
          kind: "implementation-plan",
          artifactId: artId,
          title: `Title ${artId}`,
          createdAt: "2026-04-10T10:00:00.000Z",
          updatedAt: "2026-04-10T11:00:00.000Z",
          reviewRound: 1,
          reviewSessionId: "00000000-0000-4000-8000-000000000001",
        }),
      );
      await writeFile(path.join(artDir, "artifact.md"), "# Content\n");
      await registerArtifactInSession(session.sessionId, artId, {
        registeredAt: `2026-04-10T10:0${idx}:00.000Z`,
        userHome: tempHome,
      });
    }

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage: vi.fn(),
      },
      onDidDispose: () => ({ dispose: () => {} }),
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);

    await messageListener!({ type: "moveArtifact", artifactId: artA, zone: "references" });
    await messageListener!({ type: "moveArtifact", artifactId: artB, zone: "references" });
    let current = await service.getWorkSession(session.sessionId);
    expect(current.references).toEqual([artB, artA]);
    expect(current.working).toEqual([artC]);

    await messageListener!({ type: "moveArtifact", artifactId: artA, zone: "archived" });
    await messageListener!({ type: "moveArtifact", artifactId: artB, zone: "archived" });
    current = await service.getWorkSession(session.sessionId);
    expect(current.archived).toEqual([artB, artA]);
    expect(current.references).toEqual([]);

    await messageListener!({ type: "moveArtifact", artifactId: artA, zone: "working" });
    current = await service.getWorkSession(session.sessionId);
    expect(current.working).toEqual([artA, artC]);
    expect(current.archived).toEqual([artB]);
  });

  it("syncs active waiters, filters pure heartbeats, and cancels a waiter on stopSessionWaiter", async () => {
    const session = await createSession({
      title: "Waiting Room Provider Session",
      userHome: tempHome,
    });

    const artId = "waiter-art-01";
    const artDir = path.join(globalArtifactsRoot({ userHome: tempHome }), artId);
    await mkdir(artDir, { recursive: true });
    await writeFile(
      path.join(artDir, "artifact.json"),
      JSON.stringify({
        schemaVersion: 6,
        kind: "implementation-plan",
        artifactId: artId,
        title: "Phase 2 UI Plan",
        createdAt: "2026-04-10T10:00:00.000Z",
        updatedAt: "2026-04-10T11:00:00.000Z",
        reviewRound: 1,
        reviewSessionId: "00000000-0000-4000-8000-000000000001",
      }),
    );
    await writeFile(path.join(artDir, "artifact.md"), "# Plan\n");

    const reg1 = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-1",
        name: "Reviewer",
        waitingFor: "code diff review",
        artifactId: artId,
      },
      { userHome: tempHome },
    );

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
      autoOpenController,
      { userHome: tempHome },
    );

    const doc = new WorkSessionDocument(
      { fsPath: path.join(conversationDirectory(session.sessionId, { userHome: tempHome }), "conversation.json") } as any,
      session.sessionId,
    );

    let messageListener: ((msg: any) => any) | undefined;
    let disposeListener: (() => void) | undefined;
    const postMessage = vi.fn();
    const panel = {
      webview: {
        options: {},
        html: "",
        cspSource: "vscode-webview://test",
        asWebviewUri: (uri: any) => uri.fsPath ?? String(uri),
        onDidReceiveMessage: (listener: any) => {
          messageListener = listener;
          return { dispose: () => {} };
        },
        postMessage,
      },
      onDidDispose: (listener: () => void) => {
        disposeListener = listener;
        return { dispose: () => {} };
      },
    };

    await provider.resolveCustomEditor(doc, panel as any, {} as any);
    await messageListener!({ type: "ready" });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "workSessionState",
        state: expect.objectContaining({
          status: "ready",
          data: expect.objectContaining({
            waiters: [
              expect.objectContaining({
                waitId: reg1.waitId,
                name: "Reviewer",
                waitingFor: "code diff review",
                artifact: {
                  artifactId: artId,
                  title: "Phase 2 UI Plan",
                },
              }),
            ],
          }),
        }),
      }),
    );

    postMessage.mockClear();
    const resolveWaitersSpy = vi.spyOn(service, "resolveSessionWaiters");

    // Pure heartbeat shifts mtime/expiresAt only -> must NOT emit workSessionWaitersPatch
    await new Promise((resolve) => setTimeout(resolve, 20));
    await renewSessionWaiterLease(
      {
        sessionId: session.sessionId,
        waitId: reg1.waitId,
        ownerInstanceId: "owner-1",
      },
      { userHome: tempHome },
    );
    service.notifyChanged([{ kind: "waiters", sessionId: session.sessionId }]);
    await vi.waitFor(() => {
      expect(resolveWaitersSpy).toHaveBeenCalledTimes(1);
    });
    await resolveWaitersSpy.mock.results[0]?.value;
    await Promise.resolve();
    expect(postMessage).not.toHaveBeenCalled();

    // New waiter added -> emits workSessionWaitersPatch
    const reg2 = await registerSessionWaiter(
      {
        sessionId: session.sessionId,
        ownerInstanceId: "owner-2",
        name: "Coder",
        waitingFor: "final verification",
      },
      { userHome: tempHome },
    );
    service.notifyChanged([{ kind: "waiters", sessionId: session.sessionId }]);
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith({
        type: "workSessionWaitersPatch",
        waiters: expect.arrayContaining([
          expect.objectContaining({ waitId: reg1.waitId, name: "Reviewer" }),
          expect.objectContaining({ waitId: reg2.waitId, name: "Coder" }),
        ]),
      });
    });
    expect(postMessage).toHaveBeenCalledTimes(1);

    postMessage.mockClear();

    // Stop reg1 from UI -> cancels waiter on disk and emits updated workSessionWaitersPatch
    await messageListener!({ type: "stopSessionWaiter", waitId: reg1.waitId });
    const remaining = await readActiveSessionWaiters(session.sessionId, { userHome: tempHome });
    expect(remaining.map((w) => w.waitId)).toEqual([reg2.waitId]);
    expect(postMessage).toHaveBeenCalledWith({
      type: "workSessionWaitersPatch",
      waiters: [expect.objectContaining({ waitId: reg2.waitId, name: "Coder" })],
    });

    disposeListener?.();
  });
});
