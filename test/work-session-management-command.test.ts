import { mkdir, mkdtemp, rm, writeFile, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockWarningMessage = vi.fn();
const mockInformationMessage = vi.fn();
const mockErrorMessage = vi.fn();
const mockInputBox = vi.fn();
const mockCreateQuickPick = vi.fn();
const mockClipboardWrite = vi.fn();

vi.mock("vscode", () => {
  return {
    window: {
      showWarningMessage: (...args: any[]) => mockWarningMessage(...args),
      showInformationMessage: (...args: any[]) => mockInformationMessage(...args),
      showErrorMessage: (...args: any[]) => mockErrorMessage(...args),
      showInputBox: (...args: any[]) => mockInputBox(...args),
      createQuickPick: (...args: any[]) => mockCreateQuickPick(...args),
      showTextDocument: vi.fn(),
    },
    env: {
      clipboard: {
        writeText: (text: string) => mockClipboardWrite(text),
      },
    },
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
    },
  };
});

import {
  WorkSessionManagementCoordinator,
  extractArtifactId,
  extractSessionId,
} from "../src/extension/work-session-management-command";
import { ConversationArtifactService } from "../src/extension/conversation-artifact-service";
import { createSession, readSession } from "../src/shared/conversation-artifact-registry";
import { globalArtifactsRoot, conversationDirectory } from "../src/shared/artifact-files";
import { getArtifactUiState, getSessionUiState } from "../src/extension/artifact-ui-state";

describe("WorkSessionManagementCoordinator", () => {
  let tempHome: string;
  let service: ConversationArtifactService<any>;
  let coordinator: WorkSessionManagementCoordinator;

  beforeEach(async () => {
    tempHome = await realpath(await mkdtemp(path.join(tmpdir(), "ai-artifacts-mgmt-")));
    service = new ConversationArtifactService<any>({
      uriFromFilePath: (p) => ({ fsPath: p }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome: tempHome },
    });
    coordinator = new WorkSessionManagementCoordinator({
      service,
      rootOptions: { userHome: tempHome },
    });
    mockWarningMessage.mockReset();
    mockInformationMessage.mockReset();
    mockErrorMessage.mockReset();
    mockInputBox.mockReset();
    mockCreateQuickPick.mockReset();
    mockClipboardWrite.mockReset();
  });

  afterEach(async () => {
    service.dispose();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  describe("extractId helpers", () => {
    it("extracts artifactId from various shapes", () => {
      expect(extractArtifactId("art-1")).toBe("art-1");
      expect(extractArtifactId({ artifactId: "art-2" })).toBe("art-2");
      expect(extractArtifactId({ artifact: { artifactId: "art-3" } })).toBe("art-3");
      expect(extractArtifactId(undefined)).toBeUndefined();
    });

    it("extracts sessionId from various shapes", () => {
      expect(extractSessionId("s-1")).toBe("s-1");
      expect(extractSessionId({ sessionId: "s-2" })).toBe("s-2");
      expect(extractSessionId({ session: { sessionId: "s-3" } })).toBe("s-3");
      expect(extractSessionId(null)).toBeUndefined();
    });
  });

  describe("artifact management", () => {
    const createSampleArtifact = async (artifactId: string) => {
      const artDir = path.join(globalArtifactsRoot({ userHome: tempHome }), artifactId);
      await mkdir(artDir, { recursive: true });
      await writeFile(
        path.join(artDir, "artifact.json"),
        JSON.stringify({
          schemaVersion: 6,
          kind: "spec",
          artifactId,
          title: `Title ${artifactId}`,
          createdAt: "2026-04-10T10:00:00.000Z",
          updatedAt: "2026-04-10T10:00:00.000Z",
          reviewRound: 1,
          reviewSessionId: "00000000-0000-4000-8000-000000000001",
        }),
      );
      await writeFile(path.join(artDir, "artifact.md"), "# Spec\n");
      return artDir;
    };

    it("pins and unpins an artifact", async () => {
      await createSampleArtifact("art-pin");
      await coordinator.pinArtifact("art-pin");

      let state = await getArtifactUiState("art-pin", { userHome: tempHome });
      expect(state.pinned).toBe(true);

      await coordinator.unpinArtifact("art-pin");
      state = await getArtifactUiState("art-pin", { userHome: tempHome });
      expect(state.pinned).toBe(false);
    });

    it("archives and restores an artifact", async () => {
      await createSampleArtifact("art-arc");
      await coordinator.archiveArtifact("art-arc");

      let state = await getArtifactUiState("art-arc", { userHome: tempHome });
      expect(state.archivedAt).toBeDefined();

      await coordinator.restoreArtifact("art-arc");
      state = await getArtifactUiState("art-arc", { userHome: tempHome });
      expect(state.archivedAt).toBeUndefined();
    });

    it("cancels deletion if user cancels confirmation dialog", async () => {
      await createSampleArtifact("art-del-cancel");
      mockWarningMessage.mockResolvedValueOnce(undefined);

      await coordinator.deleteArtifactPermanently("art-del-cancel");
      const state = await getArtifactUiState("art-del-cancel", { userHome: tempHome });
      expect(state).toBeDefined();
    });

    it("deletes artifact permanently when user confirms", async () => {
      const artDir = await createSampleArtifact("art-del-confirm");
      mockWarningMessage.mockResolvedValueOnce("Delete");

      await coordinator.deleteArtifactPermanently("art-del-confirm");
      await expect(readFile(path.join(artDir, "artifact.json"))).rejects.toThrow();
      expect(mockInformationMessage).toHaveBeenCalledWith("Artifact deleted permanently.");
    });

    it("copies connect prompt to clipboard", async () => {
      await createSampleArtifact("art-copy");
      await coordinator.copyArtifactConnectPrompt("art-copy");
      expect(mockClipboardWrite).toHaveBeenCalled();
      const text = mockClipboardWrite.mock.calls[0]?.[0];
      expect(text).toContain("art-copy");
    });

    it("shows error message when artifact deletion fails instead of reporting success", async () => {
      mockWarningMessage.mockResolvedValueOnce("Delete");
      await coordinator.deleteArtifactPermanently("missing-artifact-xyz");

      expect(mockErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Failed to delete artifact"));
      expect(mockInformationMessage).not.toHaveBeenCalledWith("Artifact deleted permanently.");
    });
  });

  describe("session management", () => {
    it("pins, unpins, archives, and restores a session", async () => {
      const session = await createSession({ title: "Session UI Test", userHome: tempHome });

      await coordinator.pinSession(session.sessionId);
      let state = await getSessionUiState(session.sessionId, { userHome: tempHome });
      expect(state.pinned).toBe(true);

      await coordinator.unpinSession(session.sessionId);
      state = await getSessionUiState(session.sessionId, { userHome: tempHome });
      expect(state.pinned).toBe(false);

      await coordinator.archiveSession(session.sessionId);
      state = await getSessionUiState(session.sessionId, { userHome: tempHome });
      expect(state.archivedAt).toBeDefined();

      await coordinator.restoreSession(session.sessionId);
      state = await getSessionUiState(session.sessionId, { userHome: tempHome });
      expect(state.archivedAt).toBeUndefined();
    });

    it("deletes session permanently when user confirms", async () => {
      const session = await createSession({ title: "Session Delete Test", userHome: tempHome });
      const sDir = conversationDirectory(session.sessionId, { userHome: tempHome });

      mockWarningMessage.mockResolvedValueOnce("Delete");
      await coordinator.deleteSessionPermanently(session.sessionId);

      await expect(readFile(path.join(sDir, "conversation.json"))).rejects.toThrow();
      expect(mockInformationMessage).toHaveBeenCalledWith("Session deleted permanently.");
    });

    it("copies session connect prompt to clipboard", async () => {
      const session = await createSession({ title: "Prompt Test", userHome: tempHome });
      await coordinator.copySessionConnectPrompt(session.sessionId);

      expect(mockClipboardWrite).toHaveBeenCalled();
      const text = mockClipboardWrite.mock.calls[0]?.[0];
      expect(text).toContain(session.sessionId);
    });

    it("renames a session via input box", async () => {
      const session = await createSession({ title: "Original Name", userHome: tempHome });
      mockInputBox.mockResolvedValueOnce("Renamed Session");

      await coordinator.renameSession(session.sessionId);

      const updated = await readSession(session.sessionId, { userHome: tempHome });
      expect(updated.title).toBe("Renamed Session");
    });
  });
});

