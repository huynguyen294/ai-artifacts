import { describe, expect, it, vi } from "vitest";
import type {
  ArtifactQuickPickItem,
  ArtifactSearchCommandDeps,
  ArtifactSearchQuickPick,
} from "../src/extension/artifact-search-command";
import {
  runArtifactSearchCommand,
  toQuickPickItem,
  updateQuickPickState,
} from "../src/extension/artifact-search-command";
import type { SearchableArtifact } from "../src/extension/artifact-search";

function makeArtifact(overrides: Partial<SearchableArtifact> = {}): SearchableArtifact {
  return {
    artifactDirectory: "/path/to/art-1",
    artifactPath: "/path/to/art-1/artifact.md",
    artifactId: "art-1",
    title: "Test Artifact",
    normalizedTitle: "test artifact",
    kind: "plan",
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-20T11:00:00Z",
    reviewRound: 2,
    ...overrides,
  };
}

class MockQuickPick implements ArtifactSearchQuickPick {
  title: string | undefined = undefined;
  placeholder: string | undefined = undefined;
  busy = false;
  enabled = true;
  value = "";
  items: readonly ArtifactQuickPickItem[] = [];
  selectedItems: readonly ArtifactQuickPickItem[] = [];

  isShown = false;
  isHidden = false;
  isDisposed = false;

  private changeValueListeners: ((val: string) => void)[] = [];
  private acceptListeners: (() => void)[] = [];
  private hideListeners: (() => void)[] = [];

  show(): void {
    this.isShown = true;
  }

  hide(): void {
    this.isHidden = true;
    this.fireHide();
  }

  dispose(): void {
    this.isDisposed = true;
  }

  onDidChangeValue(listener: (value: string) => any) {
    this.changeValueListeners.push(listener);
    return {
      dispose: () => {
        this.changeValueListeners = this.changeValueListeners.filter((l) => l !== listener);
      },
    };
  }

  onDidAccept(listener: () => any) {
    this.acceptListeners.push(listener);
    return {
      dispose: () => {
        this.acceptListeners = this.acceptListeners.filter((l) => l !== listener);
      },
    };
  }

  onDidHide(listener: () => any) {
    this.hideListeners.push(listener);
    return {
      dispose: () => {
        this.hideListeners = this.hideListeners.filter((l) => l !== listener);
      },
    };
  }

  simulateChangeValue(newValue: string): void {
    this.value = newValue;
    for (const listener of [...this.changeValueListeners]) {
      listener(newValue);
    }
  }

  simulateAccept(selected?: ArtifactQuickPickItem): void {
    if (selected) {
      this.selectedItems = [selected];
    }
    for (const listener of [...this.acceptListeners]) {
      listener();
    }
  }

  fireHide(): void {
    for (const listener of [...this.hideListeners]) {
      listener();
    }
  }
}

describe("artifact-search-command", () => {
  describe("toQuickPickItem", () => {
    it("maps searchable artifact metadata to Quick Pick item structure", () => {
      const art = makeArtifact({
        artifactId: "plan-42",
        title: "Kế hoạch triển khai",
        kind: "implementation-plan",
        reviewRound: 3,
        createdAt: "2026-09-19T00:00:00Z",
        updatedAt: "2026-09-20T00:00:00Z",
      });

      const item = toQuickPickItem(art);

      expect(item.label).toBe("Kế hoạch triển khai");
      expect(item.description).toBe("implementation-plan · Round 3");
      expect(item.detail).toBe("Updated 2026-09-20T00:00:00Z · Created 2026-09-19T00:00:00Z · plan-42");
      expect(item.alwaysShow).toBe(true);
      expect(item.artifact).toBe(art);
    });
  });

  describe("updateQuickPickState", () => {
    it("handles empty collection state", () => {
      const qp = new MockQuickPick();
      updateQuickPickState(qp, [], "");

      expect(qp.items).toHaveLength(0);
      expect(qp.title).toBe("AI Artifacts: Search Artifact (0 artifacts)");
      expect(qp.placeholder).toContain("No artifacts found");
    });

    it("handles zero matches for query", () => {
      const qp = new MockQuickPick();
      const artifacts = [makeArtifact({ title: "Frontend Design", normalizedTitle: "frontend design" })];
      updateQuickPickState(qp, artifacts, "backend");

      expect(qp.items).toHaveLength(0);
      expect(qp.title).toBe("AI Artifacts: Search Artifact (0 matches)");
      expect(qp.placeholder).toContain("No artifacts match current title query");
    });

    it("handles bounded matches count", () => {
      const qp = new MockQuickPick();
      const artifacts = [
        makeArtifact({ title: "Doc Alpha", normalizedTitle: "doc alpha" }),
        makeArtifact({ title: "Doc Beta", normalizedTitle: "doc beta" }),
      ];
      updateQuickPickState(qp, artifacts, "doc");

      expect(qp.items).toHaveLength(2);
      expect(qp.title).toBe("AI Artifacts: Search Artifact (2)");
      expect(qp.placeholder).toBe("Search artifacts by title...");
    });

    it("handles over-the-cap (>1000 items) matches", () => {
      const qp = new MockQuickPick();
      const artifacts: SearchableArtifact[] = [];
      for (let i = 0; i < 1005; i++) {
        artifacts.push(
          makeArtifact({
            artifactId: `art-${i}`,
            title: `Plan ${i}`,
            normalizedTitle: `plan ${i}`,
          }),
        );
      }

      updateQuickPickState(qp, artifacts, "plan");

      expect(qp.items).toHaveLength(1000);
      expect(qp.title).toBe("AI Artifacts: Search Artifact (Showing 1,000 of 1,005)");
      expect(qp.placeholder).toContain("Type more to narrow results");
    });
  });

  describe("runArtifactSearchCommand", () => {
    it("opens Quick Pick immediately, marks busy, and populates items on discovery", async () => {
      const qp = new MockQuickPick();
      const artifacts = [
        makeArtifact({ artifactId: "1", title: "Kế hoạch 1", normalizedTitle: "ke hoach 1" }),
        makeArtifact({ artifactId: "2", title: "Kế hoạch 2", normalizedTitle: "ke hoach 2" }),
      ];

      const discoverArtifacts = vi.fn().mockResolvedValue({
        artifacts,
        skippedCount: 0,
      });
      const openArtifact = vi.fn();
      const showErrorMessage = vi.fn();

      const commandPromise = runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts,
        openArtifact,
        showErrorMessage,
      });

      expect(qp.isShown).toBe(true);
      expect(qp.busy).toBe(true);

      await commandPromise;

      expect(discoverArtifacts).toHaveBeenCalledTimes(1);
      expect(qp.busy).toBe(false);
      expect(qp.items).toHaveLength(2);
      expect(qp.title).toBe("AI Artifacts: Search Artifact (2)");
    });

    it("filters in-memory items on value change without re-calling discovery", async () => {
      const qp = new MockQuickPick();
      const artifacts = [
        makeArtifact({ artifactId: "1", title: "Lập kế hoạch", normalizedTitle: "lap ke hoach" }),
        makeArtifact({ artifactId: "2", title: "Tổng kết dự án", normalizedTitle: "tong ket du an" }),
      ];

      const discoverArtifacts = vi.fn().mockResolvedValue({
        artifacts,
        skippedCount: 0,
      });

      await runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts,
        openArtifact: vi.fn(),
        showErrorMessage: vi.fn(),
      });

      expect(qp.items).toHaveLength(2);

      // Typing query
      qp.simulateChangeValue("ke hoach");

      expect(discoverArtifacts).toHaveBeenCalledTimes(1); // Not called again!
      expect(qp.items).toHaveLength(1);
      expect(qp.items[0]!.artifact.artifactId).toBe("1");
    });

    it("handles accept: disables UI, hides Quick Pick, and calls openArtifact with selected path", async () => {
      const qp = new MockQuickPick();
      const targetArtifact = makeArtifact({
        artifactId: "target",
        artifactPath: "/safe/path/target/artifact.md",
        title: "Selected One",
      });

      const openArtifact = vi.fn().mockResolvedValue(undefined);

      await runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts: vi.fn().mockResolvedValue({
          artifacts: [targetArtifact],
          skippedCount: 0,
        }),
        openArtifact,
        showErrorMessage: vi.fn(),
      });

      const selectedItem = qp.items[0]!;
      qp.simulateAccept(selectedItem);

      expect(qp.busy).toBe(true);
      expect(qp.enabled).toBe(false);
      expect(qp.isHidden).toBe(true);
      expect(openArtifact).toHaveBeenCalledWith("/safe/path/target/artifact.md");
    });

    it("surfaces error via showErrorMessage if openArtifact throws", async () => {
      const qp = new MockQuickPick();
      const targetArtifact = makeArtifact({
        artifactId: "deleted-target",
        artifactPath: "/path/deleted/artifact.md",
      });

      const openArtifact = vi.fn().mockRejectedValue(new Error("File not found or deleted"));
      const showErrorMessage = vi.fn();

      await runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts: vi.fn().mockResolvedValue({
          artifacts: [targetArtifact],
          skippedCount: 0,
        }),
        openArtifact,
        showErrorMessage,
      });

      qp.simulateAccept(qp.items[0]!);
      await vi.waitFor(() => {
        expect(showErrorMessage).toHaveBeenCalledWith("File not found or deleted");
      });
    });

    it("surfaces error via showErrorMessage if discovery throws", async () => {
      const qp = new MockQuickPick();
      const showErrorMessage = vi.fn();

      await runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts: vi.fn().mockRejectedValue(new Error("Collection root unreadable")),
        openArtifact: vi.fn(),
        showErrorMessage,
      });

      expect(qp.isDisposed).toBe(true);
      expect(showErrorMessage).toHaveBeenCalledWith("Collection root unreadable");
    });

    it("aborts cleanly if user closes Quick Pick before discovery completes", async () => {
      const qp = new MockQuickPick();
      let resolveDiscovery!: (val: any) => void;
      const discoveryPromise = new Promise((resolve) => {
        resolveDiscovery = resolve;
      });

      const commandPromise = runArtifactSearchCommand({
        createQuickPick: () => qp,
        discoverArtifacts: () => discoveryPromise as any,
        openArtifact: vi.fn(),
        showErrorMessage: vi.fn(),
      });

      // User cancels / closes Quick Pick before discovery finishes
      qp.hide();

      // Discovery finishes later
      resolveDiscovery({
        artifacts: [makeArtifact()],
        skippedCount: 0,
      });

      await commandPromise;

      // QuickPick was disposed, no items populated
      expect(qp.isDisposed).toBe(true);
      expect(qp.items).toHaveLength(0);
    });
  });

  describe("package contribution", () => {
    it("declares agentPlus.searchArtifact command and activationEvent in package.json", async () => {
      const { readFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const packageJson = JSON.parse(
        await readFile(path.resolve(import.meta.dirname, "../package.json"), "utf8"),
      );

      expect(packageJson.activationEvents).toContain("onCommand:agentPlus.searchArtifact");
      const command = packageJson.contributes.commands.find(
        (cmd: any) => cmd.command === "agentPlus.searchArtifact",
      );
      expect(command).toEqual({
        command: "agentPlus.searchArtifact",
        title: "AI Artifacts: Search Artifact",
      });
    });
  });
});
