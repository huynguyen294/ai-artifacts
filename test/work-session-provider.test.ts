import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}));

import * as vscode from "vscode";
import { WorkSessionProvider, WorkSessionDocument } from "../src/extension/work-session-provider";
import { ConversationArtifactService } from "../src/extension/conversation-artifact-service";
import { createSession, registerArtifactInSession } from "../src/shared/conversation-artifact-registry";
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
    mockContext = {
      extensionUri: { fsPath: "/mock/extension" },
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
});
