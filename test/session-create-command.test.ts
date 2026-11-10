import { describe, expect, it, vi } from "vitest";

const { mockShowWarningMessage, mockShowInputBox, mockShowErrorMessage, mockExecuteCommand } = vi.hoisted(() => ({
  mockShowWarningMessage: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockShowErrorMessage: vi.fn(),
  mockExecuteCommand: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: {
    showWarningMessage: mockShowWarningMessage,
    showInputBox: mockShowInputBox,
    showErrorMessage: mockShowErrorMessage,
  },
  commands: {
    executeCommand: mockExecuteCommand,
  },
}));

import { runCreateSessionCommand } from "../src/extension/session-create-command";

describe("session-create-command", () => {
  it("shows warning and aborts when work session is unsupported", async () => {
    mockShowWarningMessage.mockClear();
    mockShowInputBox.mockClear();

    const service = {
      createSession: vi.fn(),
    } as any;

    const context = {} as any;

    // mock unsupported
    const result = await runCreateSessionCommand({
      service,
      context,
      showInputBox: mockShowInputBox,
      rootOptions: { userHome: "/nonexistent" },
    });

    expect(result).toBeUndefined();
    expect(service.createSession).not.toHaveBeenCalled();
  });

  it("prompts for title, creates session with default type, and opens manager", async () => {
    mockShowInputBox.mockResolvedValueOnce("New Feature Session");
    const openWorkSession = vi.fn(async () => {});
    const createSession = vi.fn(async ({ title }: { title: string }) => ({
      sessionId: "new-session-uuid-1234",
      title,
      typeId: "conversation",
    }));

    const service = { createSession } as any;
    const context = {} as any;

    const result = await runCreateSessionCommand({
      service,
      context,
      showInputBox: mockShowInputBox,
      openWorkSession,
      resolveSupport: vi.fn().mockResolvedValue({ supported: true }),
    });

    expect(mockShowInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Add Session",
        prompt: "Enter a title for the new session",
      }),
    );
    expect(createSession).toHaveBeenCalledWith({ title: "New Feature Session" });
    expect(openWorkSession).toHaveBeenCalledWith("new-session-uuid-1234");
    expect(result).toBe("new-session-uuid-1234");
  });

  it("validates input: rejects blank titles and overlong titles", async () => {
    let capturedValidate: ((val: string) => string | undefined) | undefined;
    mockShowInputBox.mockImplementationOnce(async (options: any) => {
      capturedValidate = options.validateInput;
      return undefined; // user cancels
    });

    const service = { createSession: vi.fn() } as any;

    const result = await runCreateSessionCommand({
      service,
      context: {} as any,
      showInputBox: mockShowInputBox,
      resolveSupport: vi.fn().mockResolvedValue({ supported: true }),
    });

    expect(result).toBeUndefined();
    expect(capturedValidate).toBeDefined();
    expect(capturedValidate!("")).toBe("Session title must not be blank.");
    expect(capturedValidate!("   ")).toBe("Session title must not be blank.");
    expect(capturedValidate!("a".repeat(201))).toBe("Session title must be at most 200 characters.");
    expect(capturedValidate!("Valid Title")).toBeUndefined();
  });

  it("preserves created session and warns user if openWorkSession fails", async () => {
    mockShowInputBox.mockResolvedValueOnce("Resilient Session");
    mockShowErrorMessage.mockClear();
    const openWorkSession = vi.fn().mockRejectedValue(new Error("Editor crashed"));
    const createSession = vi.fn(async ({ title }: { title: string }) => ({
      sessionId: "session-preserved-5678",
      title,
      typeId: "conversation",
    }));

    const result = await runCreateSessionCommand({
      service: { createSession } as any,
      context: {} as any,
      showInputBox: mockShowInputBox,
      openWorkSession,
      resolveSupport: vi.fn().mockResolvedValue({ supported: true }),
    });

    expect(createSession).toHaveBeenCalledWith({ title: "Resilient Session" });
    expect(openWorkSession).toHaveBeenCalledWith("session-preserved-5678");
    expect(mockShowErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Session "Resilient Session" was created (session-preserved-5678), but failed to open: Editor crashed'),
    );
    expect(result).toBe("session-preserved-5678");
  });
});
