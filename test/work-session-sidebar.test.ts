import { mkdir, mkdtemp, rm, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class TreeItem {
    description?: string | undefined;
    iconPath?: any;
    command?: any;
    tooltip?: string | undefined;
    collapsibleState?: number | undefined;
    contextValue?: string | undefined;
    constructor(public label: string, collapsibleState?: number) {
      if (collapsibleState !== undefined) {
        this.collapsibleState = collapsibleState;
      }
    }
  }

  class EventEmitter {
    private listeners: ((e: any) => any)[] = [];
    event = (listener: (e: any) => any) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: any) {
      for (const l of this.listeners) l(data);
    }
    dispose() {}
  }

  return {
    TreeItem,
    ThemeIcon: class {
      constructor(public readonly id: string) {}
    },
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
    EventEmitter,
    Uri: {
      file: (fsPath: string) => ({ fsPath }),
    },
  };
});

import {
  RecentArtifactsTreeDataProvider,
  WorkSessionsTreeDataProvider,
} from "../src/extension/work-session-sidebar";
import { ConversationArtifactService } from "../src/extension/conversation-artifact-service";
import { createSession, registerArtifactInSession } from "../src/shared/conversation-artifact-registry";
import { createSessionType } from "../src/shared/session-type-registry";
import { conversationRegistryRoot, globalArtifactsRoot } from "../src/shared/artifact-files";

describe("WorkSession Sidebar Tree Data Providers", () => {
  let tempHome: string;
  let service: ConversationArtifactService<any>;

  beforeEach(async () => {
    tempHome = await realpath(await mkdtemp(path.join(tmpdir(), "ai-artifacts-sidebar-")));
    service = new ConversationArtifactService<any>({
      uriFromFilePath: (p) => ({ fsPath: p }),
      openArtifactReview: vi.fn(),
      rootOptions: { userHome: tempHome },
    });
  });

  afterEach(async () => {
    service.dispose();
    await rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  describe("RecentArtifactsTreeDataProvider", () => {
    it("returns empty item when no artifacts exist", async () => {
      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe("empty");

      const treeItem = provider.getTreeItem(children[0]!);
      expect(treeItem.label).toBe("No artifacts yet");
    });

    it("sorts artifacts by updatedAt descending and caps at 20 with viewAll item", async () => {
      const artifactsDir = globalArtifactsRoot({ userHome: tempHome });

      // Create 25 mock artifacts on disk
      for (let i = 1; i <= 25; i++) {
        const artId = `artifact-${String(i).padStart(2, "0")}`;
        const dir = path.join(artifactsDir, artId);
        await mkdir(dir, { recursive: true });
        const time = new Date(Date.parse("2026-04-10T10:00:00.000Z") + i * 1000).toISOString();
        await writeFile(
          path.join(dir, "artifact.json"),
          JSON.stringify({
            schemaVersion: 6,
            kind: "spec",
            artifactId: artId,
            title: `Artifact ${i}`,
            createdAt: time,
            updatedAt: time,
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), "# Content\n");
      }

      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      const children = await provider.getChildren();

      expect(children).toHaveLength(21); // 20 artifacts + 1 viewAll
      expect(children[0]?.type).toBe("artifact");
      if (children[0]?.type === "artifact") {
        expect(children[0].artifact.artifactId).toBe("artifact-25"); // latest
      }

      const last = children[20];
      expect(last?.type).toBe("viewAll");
      if (last?.type === "viewAll") {
        expect(last.totalCount).toBe(25);
        const treeItem = provider.getTreeItem(last);
        expect(treeItem.command?.command).toBe("agentPlus.searchArtifact");
      }
    });

    it("filters artifacts by kind before sorting and capping at 20", async () => {
      const artifactsDir = globalArtifactsRoot({ userHome: tempHome });

      // Create 20 specs (newer, times 6-25) and 5 plans (older, times 1-5)
      for (let i = 1; i <= 5; i++) {
        const artId = `plan-${String(i).padStart(2, "0")}`;
        const dir = path.join(artifactsDir, artId);
        await mkdir(dir, { recursive: true });
        const time = new Date(Date.parse("2026-04-10T10:00:00.000Z") + i * 1000).toISOString();
        await writeFile(
          path.join(dir, "artifact.json"),
          JSON.stringify({
            schemaVersion: 6,
            kind: "plan",
            artifactId: artId,
            title: `Plan ${i}`,
            createdAt: time,
            updatedAt: time,
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), "# Content\n");
      }

      for (let i = 6; i <= 25; i++) {
        const artId = `spec-${String(i).padStart(2, "0")}`;
        const dir = path.join(artifactsDir, artId);
        await mkdir(dir, { recursive: true });
        const time = new Date(Date.parse("2026-04-10T10:00:00.000Z") + i * 1000).toISOString();
        await writeFile(
          path.join(dir, "artifact.json"),
          JSON.stringify({
            schemaVersion: 6,
            kind: "spec",
            artifactId: artId,
            title: `Spec ${i}`,
            createdAt: time,
            updatedAt: time,
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), "# Content\n");
      }

      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });

      // With no filter, 20 newest are specs
      const unfiltered = await provider.getChildren();
      expect(unfiltered).toHaveLength(21);
      expect((unfiltered[0] as any).artifact.kind).toBe("spec");

      // Filter by "plan": even though the 5 plans are older, they must not be dropped by the cap
      provider.setKindFilter("plan");
      expect(provider.getKindFilter()).toBe("plan");

      const filtered = await provider.getChildren();
      expect(filtered).toHaveLength(5);
      expect(filtered.every((item) => item.type === "artifact" && item.artifact.kind === "plan")).toBe(true);

      // Verify label formatting
      const item0 = provider.getTreeItem(filtered[0]!);
      expect(item0.description).toBe("Plan");
    });

    it("filters by other for non-fixed custom kinds", async () => {
      const artifactsDir = globalArtifactsRoot({ userHome: tempHome });

      // Create 1 plan and 1 custom kind workaround
      const items: [string, string][] = [["art-plan", "plan"], ["art-workaround", "workaround"]];
      for (const [id, kind] of items) {
        const dir = path.join(artifactsDir, id);
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, "artifact.json"),
          JSON.stringify({
            schemaVersion: 6,
            kind,
            artifactId: id,
            title: `Title ${id}`,
            createdAt: "2026-04-10T10:00:00.000Z",
            updatedAt: "2026-04-10T10:00:00.000Z",
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), "# Content\n");
      }

      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      provider.setKindFilter("other");

      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect((children[0] as any).artifact.kind).toBe("workaround");

      const treeItem = provider.getTreeItem(children[0]!);
      expect(treeItem.description).toBe("Workaround");
    });

    it("returns emptyFilter when kind filter matches 0 artifacts", async () => {
      const artifactsDir = globalArtifactsRoot({ userHome: tempHome });
      const dir = path.join(artifactsDir, "art-1");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "artifact.json"),
        JSON.stringify({
          schemaVersion: 6,
          kind: "spec",
          artifactId: "art-1",
          title: "Spec 1",
          createdAt: "2026-04-10T10:00:00.000Z",
          updatedAt: "2026-04-10T10:00:00.000Z",
          reviewRound: 1,
          reviewSessionId: "00000000-0000-4000-8000-000000000001",
        }),
      );
      await writeFile(path.join(dir, "artifact.md"), "# Content\n");

      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      provider.setKindFilter("design");

      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe("emptyFilter");

      const treeItem = provider.getTreeItem(children[0]!);
      expect(treeItem.label).toBe("No artifacts match this filter");
    });

    it("passes kindFilter in viewAll command arguments", async () => {
      const artifactsDir = globalArtifactsRoot({ userHome: tempHome });

      for (let i = 1; i <= 22; i++) {
        const artId = `note-${String(i).padStart(2, "0")}`;
        const dir = path.join(artifactsDir, artId);
        await mkdir(dir, { recursive: true });
        const time = new Date(Date.parse("2026-04-10T10:00:00.000Z") + i * 1000).toISOString();
        await writeFile(
          path.join(dir, "artifact.json"),
          JSON.stringify({
            schemaVersion: 6,
            kind: "note",
            artifactId: artId,
            title: `Note ${i}`,
            createdAt: time,
            updatedAt: time,
            reviewRound: 1,
            reviewSessionId: "00000000-0000-4000-8000-000000000001",
          }),
        );
        await writeFile(path.join(dir, "artifact.md"), "# Content\n");
      }

      const provider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      provider.setKindFilter("note");

      const children = await provider.getChildren();
      expect(children).toHaveLength(21); // 20 + viewAll

      const viewAll = children[20]!;
      expect(viewAll.type).toBe("viewAll");

      const treeItem = provider.getTreeItem(viewAll);
      expect(treeItem.command).toEqual({
        command: "agentPlus.searchArtifact",
        title: "Search Artifact",
        arguments: [{ kindFilter: "note" }],
      });
    });
  });

  describe("WorkSessionsTreeDataProvider", () => {
    it.each([undefined, 11])("shows unsupported item for MCP version %s", async (mcpVersion) => {
      if (mcpVersion !== undefined) {
        const managedDir = path.join(tempHome, ".ai-artifacts", "managed");
        await mkdir(managedDir, { recursive: true });
        await writeFile(
          path.join(managedDir, "integration-version.json"),
          JSON.stringify({ schemaVersion: 1, mcpVersion, skills: {} }),
        );
      }
      const provider = new WorkSessionsTreeDataProvider(
        service,
        undefined,
        { userHome: tempHome },
      );
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe("unsupported");

      const item = provider.getTreeItem(children[0]!);
      expect(item.label).toContain("Sessions require MCP server version 12 or higher");
    });

    it("renders sessions and migration candidates when MCP version 12 is present", async () => {
      // Mock integration-version.json with mcpVersion 12
      const managedDir = path.join(tempHome, ".ai-artifacts", "managed");
      await mkdir(managedDir, { recursive: true });
      await writeFile(
        path.join(managedDir, "integration-version.json"),
        JSON.stringify({
          schemaVersion: 1,
          mcpVersion: 12,
          updatedAt: new Date().toISOString(),
          skills: {},
        }),
      );

      // Create a custom session type
      const customType = await createSessionType("Architecture", { userHome: tempHome });

      // Create a session v2
      const session = await createSession({
        title: "Auth Redesign",
        typeId: customType.id,
        userHome: tempHome,
      });

      // Create legacy conversation v1
      const v1ConvId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
      const v1Dir = path.join(conversationRegistryRoot({ userHome: tempHome }), v1ConvId);
      await mkdir(path.join(v1Dir, "registered-artifacts"), { recursive: true });
      await writeFile(
        path.join(v1Dir, "conversation.json"),
        JSON.stringify({
          schemaVersion: 1,
          artifactConversationId: v1ConvId,
          conversationName: "Legacy Thread",
          createdAt: "2026-04-01T10:00:00.000Z",
        }),
      );

      const provider = new WorkSessionsTreeDataProvider(
        service,
        undefined,
        { userHome: tempHome },
      );
      const children = await provider.getChildren();

      expect(children.length).toBe(2); // 1 migration candidate + 1 session
      expect(children[0]?.type).toBe("migrationCandidates");
      if (children[0]?.type === "migrationCandidates") {
        expect(children[0].count).toBe(1);
      }

      expect(children[1]?.type).toBe("session");
      if (children[1]?.type === "session") {
        expect(children[1].title).toBe("Auth Redesign");
        expect(children[1].typeLabel).toBe("Architecture");

        const treeItem = provider.getTreeItem(children[1]);
        expect(treeItem.label).toBe("Auth Redesign");
        expect(treeItem.description).toContain("Architecture · 0 artifacts");
        expect(treeItem.command?.arguments).toEqual([session.sessionId]);
      }
    });

    it("filters sessions by selectedTypeId and shows No sessions match this filter when empty", async () => {
      // Mock integration-version.json with mcpVersion 12
      const managedDir = path.join(tempHome, ".ai-artifacts", "managed");
      await mkdir(managedDir, { recursive: true });
      await writeFile(
        path.join(managedDir, "integration-version.json"),
        JSON.stringify({
          schemaVersion: 1,
          mcpVersion: 12,
          updatedAt: new Date().toISOString(),
          skills: {},
        }),
      );

      const typeA = await createSessionType("Type A", { userHome: tempHome });
      const typeB = await createSessionType("Type B", { userHome: tempHome });

      await createSession({ title: "Session A", typeId: typeA.id, userHome: tempHome });
      await createSession({ title: "Session B", typeId: typeB.id, userHome: tempHome });

      const provider = new WorkSessionsTreeDataProvider(service, undefined, { userHome: tempHome });

      // 1. Without filter -> returns both sessions
      let children = await provider.getChildren();
      let sessionItems = children.filter((c) => c.type === "session");
      expect(sessionItems).toHaveLength(2);

      // 2. Filter by Type A -> returns only Session A
      provider.setTypeFilter(typeA.id);
      expect(provider.getTypeFilter()).toBe(typeA.id);
      children = await provider.getChildren();
      sessionItems = children.filter((c) => c.type === "session");
      expect(sessionItems).toHaveLength(1);
      expect(sessionItems[0]?.type === "session" && sessionItems[0].title).toBe("Session A");

      // 3. Filter by valid type with 0 matching sessions -> returns emptyFilter
      const typeEmpty = await createSessionType("Type Empty", { userHome: tempHome });
      provider.setTypeFilter(typeEmpty.id);
      children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe("emptyFilter");
      const emptyTreeItem = provider.getTreeItem(children[0]!);
      expect(emptyTreeItem.label).toBe("No sessions match this filter");

      // 4. When selected type does not exist in registry -> automatically resets filter to undefined and returns all
      provider.setTypeFilter("deleted-type-id");
      children = await provider.getChildren();
      expect(provider.getTypeFilter()).toBeUndefined();
      sessionItems = children.filter((c) => c.type === "session");
      expect(sessionItems).toHaveLength(2);
    });

    it("selectively refreshes tree providers based on change kind", () => {
      const recentProvider = new RecentArtifactsTreeDataProvider(service, { userHome: tempHome });
      const sessionProvider = new WorkSessionsTreeDataProvider(service, undefined, { userHome: tempHome });

      const refreshRecentSpy = vi.spyOn(recentProvider, "refresh");
      const refreshSessionSpy = vi.spyOn(sessionProvider, "refresh");

      // 1. Layout change -> neither Recent nor WorkSessions should refresh
      service.notifyChanged([{ kind: "layout", sessionId: "00000000-0000-4000-8000-000000000001" }]);
      expect(refreshRecentSpy).not.toHaveBeenCalled();
      expect(refreshSessionSpy).not.toHaveBeenCalled();

      // 2. Artifact change -> Recent refreshes, WorkSessions does NOT
      service.notifyChanged([{ kind: "artifact", artifactId: "art-1" }]);
      expect(refreshRecentSpy).toHaveBeenCalledTimes(1);
      expect(refreshSessionSpy).not.toHaveBeenCalled();

      // 3. Metadata change -> WorkSessions refreshes, Recent does NOT
      service.notifyChanged([{ kind: "metadata", sessionId: "00000000-0000-4000-8000-000000000001" }]);
      expect(refreshRecentSpy).toHaveBeenCalledTimes(1);
      expect(refreshSessionSpy).toHaveBeenCalledTimes(1);

      // 4. Types change -> WorkSessions refreshes
      service.notifyChanged([{ kind: "types" }]);
      expect(refreshSessionSpy).toHaveBeenCalledTimes(2);

      // 5. Generic change (empty array) -> both refresh
      service.notifyChanged([]);
      expect(refreshRecentSpy).toHaveBeenCalledTimes(2);
      expect(refreshSessionSpy).toHaveBeenCalledTimes(3);

      recentProvider.dispose();
      sessionProvider.dispose();
    });
  });
});
