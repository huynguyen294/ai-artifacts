import { describe, expect, it, vi } from "vitest";
import {
  runArtifactKindFilterCommand,
  type ArtifactKindFilterCommandDeps,
  type ArtifactKindFilterQuickPickItem,
} from "../src/extension/artifact-kind-filter-command";
import { FIXED_ARTIFACT_KINDS, formatArtifactKindLabel } from "../src/shared/artifact-kinds";

class MockQuickPick {
  title = "";
  placeholder = "";
  matchOnDescription = false;
  items: ArtifactKindFilterQuickPickItem[] = [];
  activeItems: ArtifactKindFilterQuickPickItem[] = [];
  selectedItems: ArtifactKindFilterQuickPickItem[] = [];

  private acceptListeners: (() => void)[] = [];
  private hideListeners: (() => void)[] = [];

  onDidAccept(fn: () => void) {
    this.acceptListeners.push(fn);
  }
  onDidHide(fn: () => void) {
    this.hideListeners.push(fn);
  }

  show = vi.fn();
  hide = vi.fn(() => {
    for (const l of this.hideListeners) l();
  });
  dispose = vi.fn();

  triggerAccept(item: ArtifactKindFilterQuickPickItem) {
    this.selectedItems = [item];
    for (const l of this.acceptListeners) l();
  }

  triggerHide() {
    for (const l of this.hideListeners) l();
  }
}

describe("artifact-kind-filter-command", () => {
  it("populates QuickPick with All Types, 10 fixed kinds, and Other", async () => {
    const qp = new MockQuickPick();
    const onFilterChanged = vi.fn();

    const promise = runArtifactKindFilterCommand({
      createQuickPick: () => qp as any,
      currentKindFilter: undefined,
      onFilterChanged,
    });

    expect(qp.title).toBe("Filter Recent Artifacts by Type");
    // 1 (All) + 10 (fixed) + 1 (Other) = 12 items
    expect(qp.items).toHaveLength(12);

    expect(qp.items[0]!.label).toBe("All Types");
    expect(qp.items[0]!.description).toBe("[Current]");
    expect(qp.items[0]!.isAllTypes).toBe(true);

    for (let i = 0; i < FIXED_ARTIFACT_KINDS.length; i++) {
      const kind = FIXED_ARTIFACT_KINDS[i]!;
      const item = qp.items[i + 1]!;
      expect(item.label).toBe(formatArtifactKindLabel(kind));
      expect(item.artifactKind).toBe(kind);
      expect(item.description).toBeUndefined();
    }

    const lastItem = qp.items[11]!;
    expect(lastItem.label).toBe("Other");
    expect(lastItem.artifactKind).toBe("other");
    expect(lastItem.isOther).toBe(true);

    expect(qp.activeItems).toHaveLength(1);
    expect(qp.activeItems[0]!.isAllTypes).toBe(true);

    qp.triggerHide();
    await promise;
    expect(onFilterChanged).not.toHaveBeenCalled();
    expect(qp.dispose).toHaveBeenCalled();
  });

  it("marks fixed kind as [Current] and sets activeItem when filter is active", async () => {
    const qp = new MockQuickPick();
    const onFilterChanged = vi.fn();

    const promise = runArtifactKindFilterCommand({
      createQuickPick: () => qp as any,
      currentKindFilter: "implementation-plan",
      onFilterChanged,
    });

    const item = qp.items.find((i) => i.artifactKind === "implementation-plan");
    expect(item?.description).toBe("[Current]");
    expect(qp.activeItems[0]!.artifactKind).toBe("implementation-plan");

    // Select plan
    const planItem = qp.items.find((i) => i.artifactKind === "plan")!;
    qp.triggerAccept(planItem);

    await promise;
    expect(onFilterChanged).toHaveBeenCalledWith("plan");
    expect(qp.hide).toHaveBeenCalled();
  });

  it("handles Other selection", async () => {
    const qp = new MockQuickPick();
    const onFilterChanged = vi.fn();

    const promise = runArtifactKindFilterCommand({
      createQuickPick: () => qp as any,
      currentKindFilter: "plan",
      onFilterChanged,
    });

    const otherItem = qp.items.find((i) => i.isOther)!;
    qp.triggerAccept(otherItem);

    await promise;
    expect(onFilterChanged).toHaveBeenCalledWith("other");
  });

  it("handles All Types selection to clear filter", async () => {
    const qp = new MockQuickPick();
    const onFilterChanged = vi.fn();

    const promise = runArtifactKindFilterCommand({
      createQuickPick: () => qp as any,
      currentKindFilter: "other",
      onFilterChanged,
    });

    const allItem = qp.items.find((i) => i.isAllTypes)!;
    qp.triggerAccept(allItem);

    await promise;
    expect(onFilterChanged).toHaveBeenCalledWith(undefined);
  });
});
