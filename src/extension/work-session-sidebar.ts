import * as vscode from "vscode";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { compareIsoTimestampsAsc } from "../shared/conversation-artifact-registry";
import { listSessionTypes } from "../shared/session-type-registry";
import { discoverSearchableArtifacts, type SearchableArtifact } from "./artifact-search";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import { resolveWorkSessionSupport, type WorkSessionSupportStatus } from "./work-session-support";

export const MAX_RECENT_ARTIFACTS = 20;

export type RecentTreeElement =
  | { type: "artifact"; artifact: SearchableArtifact }
  | { type: "viewAll"; totalCount: number }
  | { type: "empty" };

export class RecentArtifactsTreeDataProvider implements vscode.TreeDataProvider<RecentTreeElement>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RecentTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: ConversationArtifactService<any>,
    private readonly rootOptions: GlobalArtifactsRootOptions = {},
  ) {
    this.disposables.push(
      this.service.onDidChange((changes) => {
        if (!changes || changes.length === 0 || changes.some((c) => c.kind === "artifact")) {
          this.refresh();
        }
      }),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: RecentTreeElement): vscode.TreeItem {
    if (element.type === "empty") {
      const item = new vscode.TreeItem("Chưa có artifact nào");
      item.description = "Tạo artifact mới bằng Codex AI";
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    if (element.type === "viewAll") {
      const item = new vscode.TreeItem(`Xem tất cả (${element.totalCount.toLocaleString()} artifacts)...`);
      item.iconPath = new vscode.ThemeIcon("search");
      item.command = {
        command: "agentPlus.searchArtifact",
        title: "Search Artifact",
      };
      return item;
    }

    const { artifact } = element;
    const item = new vscode.TreeItem(artifact.title);
    item.description = artifact.kind;
    item.tooltip = `Cập nhật: ${artifact.updatedAt} · Tạo: ${artifact.createdAt} · ${artifact.artifactId}`;
    item.iconPath = new vscode.ThemeIcon("file-code");
    item.command = {
      command: "agentPlus.openArtifact",
      title: "Open Artifact",
      arguments: [vscode.Uri.file(artifact.artifactPath)],
    };
    return item;
  }

  async getChildren(element?: RecentTreeElement): Promise<RecentTreeElement[]> {
    if (element) return [];

    try {
      const discovery = await discoverSearchableArtifacts(this.rootOptions);
      const all = discovery.artifacts;

      if (all.length === 0) {
        return [{ type: "empty" }];
      }

      const sorted = [...all].sort((a, b) => {
        const diff = compareIsoTimestampsAsc(b.updatedAt, a.updatedAt);
        if (diff !== 0) return diff;
        return a.artifactId.localeCompare(b.artifactId);
      });

      const sliced = sorted.slice(0, MAX_RECENT_ARTIFACTS);
      const result: RecentTreeElement[] = sliced.map((a) => ({ type: "artifact", artifact: a }));

      if (sorted.length > MAX_RECENT_ARTIFACTS) {
        result.push({ type: "viewAll", totalCount: sorted.length });
      }

      return result;
    } catch {
      return [{ type: "empty" }];
    }
  }
}

export type SessionTreeElement =
  | { type: "unsupported"; status: WorkSessionSupportStatus }
  | { type: "migrationCandidates"; count: number }
  | {
      type: "session";
      sessionId: string;
      title: string;
      typeLabel: string;
      artifactCount: number;
      updatedAt: string;
      createdAt: string;
    }
  | { type: "empty" };

export class WorkSessionsTreeDataProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly service: ConversationArtifactService<any>,
    private readonly extensionContext?: vscode.ExtensionContext,
    private readonly rootOptions: GlobalArtifactsRootOptions = {},
  ) {
    this.disposables.push(
      this.service.onDidChange((changes) => {
        if (
          !changes ||
          changes.length === 0 ||
          changes.some(
            (c) =>
              c.kind === "metadata" ||
              c.kind === "membership" ||
              c.kind === "types" ||
              c.kind === "support",
          )
        ) {
          this.refresh();
        }
      }),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: SessionTreeElement): vscode.TreeItem {
    if (element.type === "unsupported") {
      const item = new vscode.TreeItem("Sessions yêu cầu MCP server phiên bản 12 trở lên");
      item.description = element.status.reason ?? "Cần cập nhật integration";
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = {
        command: "agentPlus.reinstallIntegration",
        title: "Reinstall Integration",
      };
      return item;
    }

    if (element.type === "migrationCandidates") {
      const item = new vscode.TreeItem(
        `Có ${element.count} conversation có thể chuyển sang Sessions...`,
      );
      item.description = "Nhấp để chuyển đổi";
      item.iconPath = new vscode.ThemeIcon("arrow-swap");
      item.command = {
        command: "agentPlus.migrateConversations",
        title: "Migrate Conversations",
      };
      return item;
    }

    if (element.type === "empty") {
      const item = new vscode.TreeItem("Chưa có session nào");
      item.description = "Tạo artifact để tự động bắt đầu session";
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    const item = new vscode.TreeItem(element.title);
    const countLabel = `${element.artifactCount} artifact${element.artifactCount !== 1 ? "s" : ""}`;
    item.description = `${element.typeLabel} · ${countLabel}`;
    item.tooltip = `Cập nhật: ${element.updatedAt} · Tạo: ${element.createdAt} · ID: ${element.sessionId}`;
    item.iconPath = new vscode.ThemeIcon("folder");
    item.command = {
      command: "agentPlus.openWorkSession",
      title: "Open Session",
      arguments: [element.sessionId],
    };
    return item;
  }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
    if (element) return [];

    const support = await resolveWorkSessionSupport(
      this.rootOptions.userHome ? { userHome: this.rootOptions.userHome } : {},
      this.extensionContext,
    );

    if (!support.supported) {
      return [{ type: "unsupported", status: support }];
    }

    try {
      const [sessions, candidateCount, types] = await Promise.all([
        this.service.listWorkSessions(),
        this.service.countCandidates(),
        listSessionTypes(this.rootOptions),
      ]);

      const typeMap = new Map<string, string>();
      for (const t of types) {
        typeMap.set(t.id, t.label);
      }

      const items: SessionTreeElement[] = [];

      if (candidateCount > 0) {
        items.push({ type: "migrationCandidates", count: candidateCount });
      }

      for (const s of sessions) {
        const typeLabel = typeMap.get(s.typeId) ?? s.typeId;
        const artifactCount = s.working.length + s.references.length + s.archived.length;
        items.push({
          type: "session",
          sessionId: s.sessionId,
          title: s.title,
          typeLabel,
          artifactCount,
          updatedAt: s.updatedAt,
          createdAt: s.createdAt,
        });
      }

      if (items.length === 0) {
        return [{ type: "empty" }];
      }

      return items;
    } catch {
      return [{ type: "empty" }];
    }
  }
}

