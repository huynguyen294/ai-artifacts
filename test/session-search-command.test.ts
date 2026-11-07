import { describe, expect, it, vi } from "vitest";
import {
  runSessionSearchCommand,
  type SessionSearchCommandDeps,
  type SessionSearchItem,
} from "../src/extension/session-search-command";
import type { SessionType, WorkSession } from "../src/shared/contracts";

class FakeQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  matchOnDescription = false;
  matchOnDetail = false;
  items: readonly SessionSearchItem[] = [];
  selectedItems: readonly SessionSearchItem[] = [];
  acceptListeners: (() => any)[] = [];
  hideListeners: (() => any)[] = [];
  changeValueListeners: ((val: string) => any)[] = [];

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

  onDidChangeValue(listener: (val: string) => any) {
    this.changeValueListeners.push(listener);
    return { dispose: () => {} };
  }

  filter(query: string) {
    for (const l of this.changeValueListeners) l(query);
  }

  accept(item: SessionSearchItem) {
    this.selectedItems = [item];
    for (const l of this.acceptListeners) {
      l();
    }
  }
}

describe("runSessionSearchCommand", () => {
  const sampleSessions: WorkSession[] = [
    {
      schemaVersion: 2,
      sessionId: "00000000-0000-4000-8000-000000000001",
      title: "Older Architecture Discussion",
      typeId: "architecture",
      instructions: "",
      working: [],
      references: [],
      archived: [],
      createdAt: "2026-04-01T10:00:00.000Z",
      updatedAt: "2026-04-01T12:00:00.000Z",
    },
    {
      schemaVersion: 2,
      sessionId: "00000000-0000-4000-8000-000000000002",
      title: "Kế hoạch Triển khai Sprint 10",
      typeId: "sprint",
      instructions: "",
      working: [],
      references: [],
      archived: [],
      createdAt: "2026-04-10T09:00:00.000Z",
      updatedAt: "2026-04-10T15:00:00.000Z",
    },
  ];

  const sampleTypes: SessionType[] = [
    { id: "architecture", label: "Architecture" },
    { id: "sprint", label: "Sprint Planning" },
  ];

  it("lists sessions sorted by recency with type labels and formatted details", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const openSession = vi.fn();

    const deps: SessionSearchCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      listSessions: async () => sampleSessions,
      listTypes: async () => sampleTypes,
      openSession,
    };

    void runSessionSearchCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBe(2);
    });

    expect(fakeQuickPick.matchOnDescription).toBe(false);
    expect(fakeQuickPick.matchOnDetail).toBe(false);

    // 1st item should be the newer session (Sprint 10 with updatedAt 15:00)
    expect(fakeQuickPick.items[0]?.sessionId).toBe("00000000-0000-4000-8000-000000000002");
    expect(fakeQuickPick.items[0]?.label).toBe("Kế hoạch Triển khai Sprint 10");
    expect(fakeQuickPick.items[0]?.description).toBe("Sprint Planning");
    expect(fakeQuickPick.items[0]?.detail).toContain("2026-04-10T15:00:00.000Z");
    expect(fakeQuickPick.items[0]?.alwaysShow).toBe(true);

    // 2nd item should be older
    expect(fakeQuickPick.items[1]?.sessionId).toBe("00000000-0000-4000-8000-000000000001");
    expect(fakeQuickPick.items[1]?.description).toBe("Architecture");
  });

  it("filters sessions dynamically using normalized search query (case & diacritic insensitive)", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const openSession = vi.fn();

    const deps: SessionSearchCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      listSessions: async () => sampleSessions,
      listTypes: async () => sampleTypes,
      openSession,
    };

    void runSessionSearchCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBe(2);
    });

    // Search without diacritics: "ke hoach" should match "Kế hoạch Triển khai Sprint 10"
    fakeQuickPick.filter("ke hoach");
    expect(fakeQuickPick.items.length).toBe(1);
    expect(fakeQuickPick.items[0]?.sessionId).toBe("00000000-0000-4000-8000-000000000002");

    // Clear filter
    fakeQuickPick.filter("");
    expect(fakeQuickPick.items.length).toBe(2);
  });

  it("calls openSession with the exact sessionId on accept", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const openSession = vi.fn();

    const deps: SessionSearchCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      listSessions: async () => sampleSessions,
      listTypes: async () => sampleTypes,
      openSession,
    };

    void runSessionSearchCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBe(2);
    });

    fakeQuickPick.accept(fakeQuickPick.items[0]!);

    expect(openSession).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000002");
  });

  it("does not call openSession when user cancels", async () => {
    const fakeQuickPick = new FakeQuickPick();
    const openSession = vi.fn();

    const deps: SessionSearchCommandDeps = {
      createQuickPick: () => fakeQuickPick as any,
      listSessions: async () => sampleSessions,
      listTypes: async () => sampleTypes,
      openSession,
    };

    void runSessionSearchCommand(deps);

    await vi.waitFor(() => {
      expect(fakeQuickPick.items.length).toBe(2);
    });

    fakeQuickPick.hide();

    expect(openSession).not.toHaveBeenCalled();
  });
});
