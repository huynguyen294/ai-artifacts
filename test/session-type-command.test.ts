import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
}));

import {
  runManageSessionTypesCommand,
  runSelectSessionTypeQuickPick,
  type SessionTypeCommandDeps,
  type SessionTypeQuickPickItem,
} from "../src/extension/session-type-command";
import { DEFAULT_SESSION_TYPE_ID } from "../src/shared/contracts";
import { createSessionType, listSessionTypes } from "../src/shared/session-type-registry";

class FakeQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  busy = false;
  value = "";
  matchOnDescription = false;
  items: readonly SessionTypeQuickPickItem[] = [];
  selectedItems: readonly SessionTypeQuickPickItem[] = [];
  itemButtonListeners: ((e: { item: SessionTypeQuickPickItem; button: any }) => any)[] = [];
  acceptListeners: (() => any)[] = [];
  hideListeners: (() => any)[] = [];
  changeValueListeners: ((val: string) => any)[] = [];

  show(): void {}
  hide(): void {
    for (const l of this.hideListeners) l();
  }
  dispose(): void {}

  onDidTriggerItemButton(listener: (e: any) => any) {
    this.itemButtonListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidAccept(listener: () => any) {
    this.acceptListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidHide(listener: () => any) {
    this.hideListeners.push(listener);
    return { dispose: () => {} };
  }

  onDidChangeValue(listener: (val: string) => any) {
    this.changeValueListeners.push(listener);
    return { dispose: () => {} };
  }

  setValue(val: string) {
    this.value = val;
    for (const l of this.changeValueListeners) l(val);
  }

  triggerButton(item: SessionTypeQuickPickItem, tooltip: string) {
    for (const l of this.itemButtonListeners) {
      l({ item, button: { tooltip } });
    }
  }

  accept(item: SessionTypeQuickPickItem) {
    this.selectedItems = [item];
    for (const l of this.acceptListeners) {
      l();
    }
  }
}

describe("runManageSessionTypesCommand", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-type-cmd-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("lists existing session types with default labeled and no trash button on default", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const deps: SessionTypeCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      showInputBox: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      rootOptions: { userHome: tempHome },
    };

    await runManageSessionTypesCommand(deps);

    expect(fakeQuickPick.items.length).toBeGreaterThanOrEqual(5); // 1 create button + 4 default types
    expect(fakeQuickPick.items[0]?.isCreateButton).toBe(true);

    const defaultItem = fakeQuickPick.items.find((i) => i.typeId === DEFAULT_SESSION_TYPE_ID);
    expect(defaultItem).toBeDefined();
    expect(defaultItem?.description).toBe("[Mặc định]");
    expect(defaultItem?.buttons?.some((b: any) => b.tooltip === "Xóa")).toBe(false);
    expect(defaultItem?.buttons?.some((b: any) => b.tooltip === "Đổi tên")).toBe(true);
  });

  it("creates a new session type via the create button", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const showInputBox = vi.fn().mockResolvedValue("Sprint Feature");
    const onDidUpdate = vi.fn();

    const deps: SessionTypeCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      showInputBox,
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      rootOptions: { userHome: tempHome },
      onDidUpdate,
    };

    await runManageSessionTypesCommand(deps);

    const createBtn = fakeQuickPick.items.find((i) => i.isCreateButton);
    fakeQuickPick.accept(createBtn!);

    await vi.waitFor(() => {
      expect(showInputBox).toHaveBeenCalled();
      expect(onDidUpdate).toHaveBeenCalled();
    });

    const types = await listSessionTypes({ userHome: tempHome });
    expect(types.some((t) => t.label === "Sprint Feature")).toBe(true);
  });

  it("renames an existing session type", async () => {
    const created = await createSessionType("Old Name", { userHome: tempHome });

    const fakeQuickPick = new FakeQuickPick();
    const showInputBox = vi.fn().mockResolvedValue("Renamed Type");
    const onDidUpdate = vi.fn();

    const deps: SessionTypeCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      showInputBox,
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      rootOptions: { userHome: tempHome },
      onDidUpdate,
    };

    await runManageSessionTypesCommand(deps);

    const targetItem = fakeQuickPick.items.find((i) => i.typeId === created.id);
    expect(targetItem).toBeDefined();

    fakeQuickPick.triggerButton(targetItem!, "Đổi tên");

    await vi.waitFor(() => {
      expect(showInputBox).toHaveBeenCalled();
      expect(onDidUpdate).toHaveBeenCalled();
    });

    const types = await listSessionTypes({ userHome: tempHome });
    expect(types.find((t) => t.id === created.id)?.label).toBe("Renamed Type");
  });

  it("deletes a custom session type when not in use", async () => {
    const created = await createSessionType("To Delete", { userHome: tempHome });

    const fakeQuickPick = new FakeQuickPick();
    const onDidUpdate = vi.fn();

    const deps: SessionTypeCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      showInputBox: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      rootOptions: { userHome: tempHome },
      onDidUpdate,
    };

    await runManageSessionTypesCommand(deps);

    const targetItem = fakeQuickPick.items.find((i) => i.typeId === created.id);
    expect(targetItem).toBeDefined();

    fakeQuickPick.triggerButton(targetItem!, "Xóa");

    await vi.waitFor(() => {
      expect(onDidUpdate).toHaveBeenCalled();
    });

    const types = await listSessionTypes({ userHome: tempHome });
    expect(types.some((t) => t.id === created.id)).toBe(false);
  });
});

describe("runSelectSessionTypeQuickPick", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-type-select-"));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("selects an existing session type", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const selectPromise = runSelectSessionTypeQuickPick({
      createQuickPick: () => fakeQuickPick as any,
      currentTypeId: "feature",
      rootOptions: { userHome: tempHome },
    });

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    const conversationItem = fakeQuickPick.items.find((i) => i.typeId === "conversation");
    expect(conversationItem).toBeDefined();

    fakeQuickPick.accept(conversationItem!);

    const result = await selectPromise;
    expect(result).toEqual({ typeId: "conversation" });
  });

  it("creates a new session type when create button is selected", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const selectPromise = runSelectSessionTypeQuickPick({
      createQuickPick: () => fakeQuickPick as any,
      rootOptions: { userHome: tempHome },
    });

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    // Simulate user typing "Sprint Task"
    fakeQuickPick.setValue("Sprint Task");
    expect(fakeQuickPick.items[0]?.isCreateButton).toBe(true);

    fakeQuickPick.accept(fakeQuickPick.items[0]!);

    const result = await selectPromise;
    expect(result?.created).toBe(true);
    expect(result?.typeId).toBeDefined();

    const types = await listSessionTypes({ userHome: tempHome });
    expect(types.some((t) => t.id === result?.typeId && t.label === "Sprint Task")).toBe(true);
  });

  it("returns undefined when cancelled/hidden without selection", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const selectPromise = runSelectSessionTypeQuickPick({
      createQuickPick: () => fakeQuickPick as any,
      rootOptions: { userHome: tempHome },
    });

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBeGreaterThan(0);
    });

    fakeQuickPick.hide();

    const result = await selectPromise;
    expect(result).toBeUndefined();
  });
});
