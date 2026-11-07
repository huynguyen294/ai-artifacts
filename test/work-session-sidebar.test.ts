import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    tempHome = await mkdtemp(path.join(tmpdir(), "ai-artifacts-sidebar-"));
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
      expect(treeItem.label).toBe("Chưa có artifact nào");
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
  });

  describe("WorkSessionsTreeDataProvider", () => {
    it("shows unsupported item when MCP manifest is missing or version < 12", async () => {
      const provider = new WorkSessionsTreeDataProvider(
        service,
        undefined,
        { userHome: tempHome },
      );
      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.type).toBe("unsupported");

      const item = provider.getTreeItem(children[0]!);
      expect(item.label).toContain("Sessions yêu cầu MCP server phiên bản 12 trở lên");
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
