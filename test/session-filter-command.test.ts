import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSessionFilterCommand,
  type SessionFilterCommandDeps,
  type SessionFilterQuickPickItem,
} from "../src/extension/session-filter-command";
import { createSessionType } from "../src/shared/session-type-registry";

class FakeQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  matchOnDescription = false;
  items: readonly SessionFilterQuickPickItem[] = [];
  selectedItems: readonly SessionFilterQuickPickItem[] = [];
  activeItems: readonly SessionFilterQuickPickItem[] = [];
  acceptListeners: (() => any)[] = [];
  hideListeners: (() => any)[] = [];

  show(): void {}
  hide(): void {
    for (const l of this.hideListeners) l();
  }
  dispose(): void {}

  onDidAccept(listener: () => any) {
    this.acceptListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidHide(listener: () => any) {
    this.hideListeners.push(listener);
    return { dispose: () => {} };
  }

  accept(item: SessionFilterQuickPickItem) {
    this.selectedItems = [item];
    for (const l of this.acceptListeners) {
      l();
    }
  }
}

describe("runSessionFilterCommand", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-filter-cmd-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("lists All Types as first item and preselects current typeId", async () => {
    const created = await createSessionType("Architecture", { userHome: tempHome });
    const fakeQuickPick = new FakeQuickPick();
    const onFilterChanged = vi.fn();

    const deps: SessionFilterCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      currentTypeId: created.id,
      rootOptions: { userHome: tempHome },
      onFilterChanged,
    };

    void runSessionFilterCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(1);
    });

    // 1st item is All Types
    expect(fakeQuickPick.items[0]?.isAllTypes).toBe(true);
    expect(fakeQuickPick.items[0]?.label).toBe("All Types");
    expect(fakeQuickPick.items[0]?.description).toBeUndefined();

    // Architecture item has [Current]
    const archItem = fakeQuickPick.items.find((i) => i.typeId === created.id);
    expect(archItem).toBeDefined();
    expect(archItem?.description).toBe("[Current]");
    expect(fakeQuickPick.activeItems[0]?.typeId).toBe(created.id);
  });

  it("selects All Types and notifies onFilterChanged with undefined", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const onFilterChanged = vi.fn();

    const deps: SessionFilterCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      currentTypeId: "conversation",
      rootOptions: { userHome: tempHome },
      onFilterChanged,
    };

    void runSessionFilterCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    const allTypesItem = fakeQuickPick.items[0]!;
    fakeQuickPick.accept(allTypesItem);

    expect(onFilterChanged).toHaveBeenCalledWith(undefined);
  });

  it("selects a specific session type and notifies onFilterChanged with typeId", async () => {
    const created = await createSessionType("Sprint", { userHome: tempHome });
    const fakeQuickPick = new FakeQuickPick();
    const onFilterChanged = vi.fn();

    const deps: SessionFilterCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      rootOptions: { userHome: tempHome },
      onFilterChanged,
    };

    void runSessionFilterCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    const sprintItem = fakeQuickPick.items.find((i) => i.typeId === created.id);
    expect(sprintItem).toBeDefined();

    fakeQuickPick.accept(sprintItem!);

    expect(onFilterChanged).toHaveBeenCalledWith(created.id);
  });

  it("does not trigger onFilterChanged when cancelled (hide without accept)", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const onFilterChanged = vi.fn();

    const deps: SessionFilterCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      rootOptions: { userHome: tempHome },
      onFilterChanged,
    };

    void runSessionFilterCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    fakeQuickPick.hide();

    expect(onFilterChanged).not.toHaveBeenCalled();
  });
});
