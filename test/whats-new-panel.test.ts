import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MessageListener = (message: unknown) => unknown;
type DisposeListener = () => unknown;

interface MockWebviewPanel {
  viewType: string;
  title: string;
  viewColumn: number;
  options: unknown;
  webview: {
    options: unknown;
    html: string;
    cspSource: string;
    asWebviewUri: (uri: { fsPath: string }) => { toString: () => string };
    onDidReceiveMessage: (listener: MessageListener) => { dispose: () => void };
  };
  reveal: ReturnType<typeof vi.fn<(column?: number) => void>>;
  onDidDispose: (listener: DisposeListener) => { dispose: () => void };
  dispose: ReturnType<typeof vi.fn<() => void>>;
  _emitMessage: (message: unknown) => Promise<void>;
  _emitDispose: () => void;
  _getMessageListenerCount: () => number;
  _getDisposeListenerCount: () => number;
}

const {
  createdPanels,
  mockCreateWebviewPanel,
  mockOpenExternal,
  mockShowErrorMessage,
  mockActiveTextEditor,
} = vi.hoisted(() => {
  const panels: MockWebviewPanel[] = [];
  const activeEditorState: { current: { viewColumn?: number } | undefined } = {
    current: undefined,
  };

  const createPanel = vi.fn(
    (
      viewType: string,
      title: string,
      showOptions: number,
      options: unknown,
    ): MockWebviewPanel => {
      let messageListeners: MessageListener[] = [];
      let disposeListeners: DisposeListener[] = [];
      let disposed = false;

      const panel: MockWebviewPanel = {
        viewType,
        title,
        viewColumn: showOptions,
        options,
        webview: {
          options,
          html: "",
          cspSource: "vscode-webview://test",
          asWebviewUri: (uri) => ({
            toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}`,
          }),
          onDidReceiveMessage: (listener) => {
            messageListeners.push(listener);
            return {
              dispose: () => {
                messageListeners = messageListeners.filter((item) => item !== listener);
              },
            };
          },
        },
        reveal: vi.fn((column?: number) => {
          if (column !== undefined) {
            panel.viewColumn = column;
          }
        }),
        onDidDispose: (listener) => {
          disposeListeners.push(listener);
          return {
            dispose: () => {
              disposeListeners = disposeListeners.filter((item) => item !== listener);
            },
          };
        },
        dispose: vi.fn(() => {
          if (disposed) return;
          disposed = true;
          for (const listener of [...disposeListeners]) {
            listener();
          }
        }),
        _emitMessage: async (message) => {
          for (const listener of [...messageListeners]) {
            await listener(message);
          }
        },
        _emitDispose: () => {
          panel.dispose();
        },
        _getMessageListenerCount: () => messageListeners.length,
        _getDisposeListenerCount: () => disposeListeners.length,
      };

      panels.push(panel);
      return panel;
    },
  );

  return {
    createdPanels: panels,
    mockCreateWebviewPanel: createPanel,
    mockOpenExternal: vi.fn(async () => true),
    mockShowErrorMessage: vi.fn(async () => undefined),
    mockActiveTextEditor: activeEditorState,
  };
});

vi.mock("vscode", () => ({
  ViewColumn: { One: 1, Two: 2, Three: 3 },
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
  env: {
    openExternal: mockOpenExternal,
  },
  window: {
    get activeTextEditor() {
      return mockActiveTextEditor.current;
    },
    createWebviewPanel: mockCreateWebviewPanel,
    showErrorMessage: mockShowErrorMessage,
  },
}));

import { WhatsNewPanelController } from "../src/extension/whats-new-panel";
import { getWebviewHtml } from "../src/extension/webview-html";

describe("WhatsNewPanelController & webview HTML", () => {
  const extensionUri = { fsPath: "/mock/extension" } as any;

  beforeEach(() => {
    createdPanels.length = 0;
    mockActiveTextEditor.current = undefined;
    vi.clearAllMocks();
  });

  it("renders getWebviewHtml for whats-new with media CSP and escaped media base URI while keeping review and session strict", () => {
    const whatsNewHtml = getWebviewHtml({
      appName: "whats-new",
      extensionUri,
      webview: {
        cspSource: "vscode-webview://unit",
        asWebviewUri: (uri: { fsPath: string }) => ({
          toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}?a=1&b="quoted"<tag>'s`,
        }),
      } as any,
    });

    expect(whatsNewHtml).toContain('data-app="whats-new"');
    expect(whatsNewHtml).toContain("review.js");
    expect(whatsNewHtml).toContain("review.css");
    expect(whatsNewHtml).toContain("default-src 'none'; img-src data: vscode-webview://unit;");
    expect(whatsNewHtml).not.toContain("media-src");
    expect(whatsNewHtml).not.toContain("frame-src");
    expect(whatsNewHtml).toContain(
      'data-content-media-base-uri="vscode-resource:///mock/extension/media/whats-new?a=1&amp;b=&quot;quoted&quot;&lt;tag&gt;&#39;s"',
    );

    for (const appName of ["review", "session"] as const) {
      const otherHtml = getWebviewHtml({
        appName,
        extensionUri,
        webview: {
          cspSource: "vscode-webview://unit",
          asWebviewUri: (uri: { fsPath: string }) => ({
            toString: () => `vscode-resource://${uri.fsPath.replace(/\\/g, "/")}`,
          }),
        } as any,
      });

      expect(otherHtml).toContain(`data-app="${appName}"`);
      expect(otherHtml).toContain("default-src 'none'; img-src data:; style-src");
      expect(otherHtml).not.toContain("data-content-media-base-uri");
    }
  });

  it("does not create a Webview in constructor, creates and reuses one panel on show, recreates after close, and disposes cleanly", () => {
    const controller = new WhatsNewPanelController(extensionUri);
    expect(mockCreateWebviewPanel).not.toHaveBeenCalled();

    // First show creates panel in ViewColumn.One when no active editor
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    const firstPanel = createdPanels[0]!;
    expect(firstPanel.viewType).toBe("agentPlus.whatsNew");
    expect(firstPanel.title).toBe("What's New & Tips");
    expect(firstPanel.viewColumn).toBe(1);
    expect(firstPanel.options).toEqual({
      enableScripts: true,
      localResourceRoots: [
        { fsPath: path.join("/mock/extension", "dist", "webview") },
        { fsPath: path.join("/mock/extension", "media", "whats-new") },
      ],
    });
    expect(firstPanel.webview.html).toContain('data-app="whats-new"');
    expect(firstPanel.webview.html).toContain(
      'data-content-media-base-uri="vscode-resource:///mock/extension/media/whats-new"',
    );
    const initialHtml = firstPanel.webview.html;

    // Second show reveals existing panel without recreating or reassigning HTML
    firstPanel.viewColumn = 2;
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).toHaveBeenCalledTimes(1);
    expect(firstPanel.reveal).toHaveBeenCalledWith(2);
    expect(firstPanel.webview.html).toBe(initialHtml);

    // Closing panel clears reference & listeners; next show creates a new panel using activeTextEditor.viewColumn
    firstPanel._emitDispose();
    expect(firstPanel._getMessageListenerCount()).toBe(0);
    expect(firstPanel._getDisposeListenerCount()).toBe(0);

    mockActiveTextEditor.current = { viewColumn: 3 };
    controller.show();
    expect(mockCreateWebviewPanel).toHaveBeenCalledTimes(2);
    const secondPanel = createdPanels[1]!;
    expect(secondPanel.viewColumn).toBe(3);

    // Controller dispose closes open panel and cleans up listeners
    controller.dispose();
    expect(secondPanel.dispose).toHaveBeenCalledTimes(1);
    expect(secondPanel._getMessageListenerCount()).toBe(0);
    expect(secondPanel._getDisposeListenerCount()).toBe(0);

    // Extra dispose call is safe
    controller.dispose();
  });

  it("handles valid external links, rejects disallowed protocols, ignores review/malformed messages, and handles openExternal errors", async () => {
    const controller = new WhatsNewPanelController(extensionUri);
    controller.show();
    const panel = createdPanels[0]!;

    // 1. Valid https link opens externally
    await panel._emitMessage({ type: "openExternal", url: "https://github.com/huynguyen294/ai-artifacts" });
    expect(mockOpenExternal).toHaveBeenCalledTimes(1);
    expect(mockOpenExternal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheme: "https",
        toString: expect.any(Function),
      }),
    );
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 2. Disallowed protocols do not open externally and report concise error
    mockOpenExternal.mockClear();
    mockShowErrorMessage.mockClear();
    for (const disallowedUrl of [
      "file:///etc/passwd",
      "command:workbench.action.reloadWindow",
      "javascript:alert(1)",
    ]) {
      await panel._emitMessage({ type: "openExternal", url: disallowedUrl });
    }
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).toHaveBeenCalledTimes(3);

    // 3. Review, session, and malformed messages are ignored without actions or error popups
    mockOpenExternal.mockClear();
    mockShowErrorMessage.mockClear();
    await panel._emitMessage({ type: "ready" });
    await panel._emitMessage({ type: "submitReview", decision: "approve" });
    await panel._emitMessage({ type: "removeComment", commentId: "11111111-1111-4111-8111-111111111111" });
    await panel._emitMessage({ type: "unknown", payload: 123 });
    await panel._emitMessage(null);
    expect(mockOpenExternal).not.toHaveBeenCalled();
    expect(mockShowErrorMessage).not.toHaveBeenCalled();

    // 4. openExternal rejection or false result is handled gracefully
    mockOpenExternal.mockRejectedValueOnce(new Error("Browser launch failed"));
    await panel._emitMessage({ type: "openExternal", url: "https://example.com" });
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to open link: Browser launch failed");

    mockShowErrorMessage.mockClear();
    mockOpenExternal.mockResolvedValueOnce(false);
    await panel._emitMessage({ type: "openExternal", url: "https://example.com" });
    expect(mockShowErrorMessage).toHaveBeenCalledWith("Failed to open link: Unable to open the external link.");

    controller.dispose();
  });
});
