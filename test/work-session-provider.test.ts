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
  },
  window: {
    showInputBox: mockShowInputBox,
    createQuickPick: mockCreateQuickPick,
  },
}));

import * as vscode from "vscode";
import { WorkSessionProvider, WorkSessionDocument } from "../src/extension/work-session-provider";
import { ConversationArtifactService } from "../src/extension/conversation-artifact-service";
import {
  createSession,
  registerArtifactInSession,
  updateSessionDetails,
} from "../src/shared/conversation-artifact-registry";
import { conversationDirectory, globalArtifactsRoot } from "../src/shared/artifact-files";

describe("WorkSessionProvider", () => {
  let tempHome: string;
  let service: ConversationArtifactService<any>;
  let openCoordinator: any;
  let mockContext: any;

  beforeEach(async () => {
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

  it("openCustomDocument validates document path and returns WorkSessionDocument", async () => {
    const session = await createSession({
      title: "Doc Test Session",
      userHome: tempHome,
    });

    const provider = new WorkSessionProvider(
      mockContext,
      service,
      openCoordinator,
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

    // 5. Reorder artifact in references (already single item, stays same)
    await messageListener!({ type: "moveArtifact", artifactId: art2, zone: "references" });
    const updated4 = await service.getWorkSession(session.sessionId);
    expect(updated4.references).toEqual([art1, art2]);

    // Reorder art2 up
    await messageListener!({ type: "reorderArtifact", artifactId: art2, direction: "up" });
    const updated5 = await service.getWorkSession(session.sessionId);
    expect(updated5.references).toEqual([art2, art1]);

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
    });

    // Instructions change externally -> summary patch may fire, but no instructions-clobbering message is emitted
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
          type: "workSessionSummaryPatch",
        }),
      );
    });
  });
});
