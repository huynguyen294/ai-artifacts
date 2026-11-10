import { describe, expect, it, vi } from "vitest";

const { mockShowInformationMessage, mockShowErrorMessage } = vi.hoisted(() => ({
  mockShowInformationMessage: vi.fn(),
  mockShowErrorMessage: vi.fn(),
}));

vi.mock("vscode", () => ({
  window: {
    showInformationMessage: mockShowInformationMessage,
    showErrorMessage: mockShowErrorMessage,
    createQuickPick: vi.fn(),
  },
}));

import { runAddArtifactToSessionQuickPick } from "../src/extension/session-artifact-add-command";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { globalArtifactsRoot, ARTIFACT_MANIFEST_FILE } from "../src/shared/artifact-files";

describe("session-artifact-add-command", () => {
  it("informs user and returns undefined when no candidate artifacts exist", async () => {
    mockShowInformationMessage.mockClear();
    const tempHome = await realpath(await mkdtemp(path.join(tmpdir(), "add-art-test-")));
    try {
      const result = await runAddArtifactToSessionQuickPick({
        sessionId: "sess-1",
        sessionArtifacts: new Set(),
        rootOptions: { userHome: tempHome },
      });

      expect(result).toBeUndefined();
      expect(mockShowInformationMessage).toHaveBeenCalledWith("No other artifacts available to add to this session.");
    } finally {
      await rm(tempHome, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("filters out artifacts already in session and returns selected artifactId", async () => {
    const tempHome = await realpath(await mkdtemp(path.join(tmpdir(), "add-art-test-")));
    try {
      const root = globalArtifactsRoot({ userHome: tempHome });

      // Create two artifacts: art-1 and art-2
      for (const id of ["art-1", "art-2"]) {
        const dir = path.join(root, id);
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, ARTIFACT_MANIFEST_FILE),
          JSON.stringify({
            schemaVersion: 6,
            kind: "spec",
            artifactId: id,
            title: `Title ${id}`,
            createdAt: "2026-04-10T10:00:00.000Z",
            updatedAt: "2026-04-10T11:00:00.000Z",
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), `# ${id}\n`);
      }

      let acceptListener: (() => void) | undefined;
      let hideListener: (() => void) | undefined;
      const quickPick = {
        title: "",
        placeholder: "",
        matchOnDescription: false,
        matchOnDetail: false,
        items: [] as any[],
        selectedItems: [] as any[],
        onDidChangeValue: vi.fn(),
        onDidAccept: (fn: any) => {
          acceptListener = fn;
        },
        onDidHide: (fn: any) => {
          hideListener = fn;
        },
        show: vi.fn(),
        dispose: vi.fn(),
      };

      const promise = runAddArtifactToSessionQuickPick({
        sessionId: "sess-1",
        sessionArtifacts: new Set(["art-1"]), // art-1 already in session!
        rootOptions: { userHome: tempHome },
        createQuickPick: () => {
          setTimeout(() => {
            // Candidates should only contain art-2
            expect(quickPick.items).toHaveLength(1);
            expect(quickPick.items[0].artifactId).toBe("art-2");
            expect(quickPick.items[0].label).toBe("Title art-2");
            expect(quickPick.items[0].description).toBe("Spec");

            // Select art-2 and accept
            quickPick.selectedItems = [quickPick.items[0]];
            acceptListener!();
          }, 0);
          return quickPick as any;
        },
      });

      const selected = await promise;
      expect(selected).toBe("art-2");
      expect(quickPick.dispose).toHaveBeenCalled();
    } finally {
      await rm(tempHome, { recursive: true, force: true }).catch(() => {});
    }
  });
});
