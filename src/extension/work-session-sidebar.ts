import * as vscode from "vscode";
import { formatArtifactKindLabel, isFixedArtifactKind } from "../shared/artifact-kinds";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { compareIsoTimestampsAsc } from "../shared/conversation-artifact-registry";
import { listSessionTypes } from "../shared/session-type-registry";
import { compareArtifactsByRecency, discoverSearchableArtifacts, type SearchableArtifact } from "./artifact-search";
import { getSessionUiState } from "./artifact-ui-state";
import type { ConversationArtifactService } from "./conversation-artifact-service";
import { resolveWorkSessionSupport, type WorkSessionSupportStatus } from "./work-session-support";

export const MAX_RECENT_ARTIFACTS = 20;

export type RecentTreeElement =
  | { type: "artifact"; artifact: SearchableArtifact; isPinned?: boolean }
  | { type: "viewAll"; totalCount: number; kindFilter?: string | undefined }
  | { type: "empty" }
  | { type: "emptyFilter" };

export class RecentArtifactsTreeDataProvider implements vscode.TreeDataProvider<RecentTreeElement>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RecentTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];
  private kindFilter: string | undefined = undefined;

  constructor(
    private readonly service: ConversationArtifactService<any>,
    private readonly rootOptions: GlobalArtifactsRootOptions = {},
  ) {
    this.disposables.push(
      this.service.onDidChange((changes) => {
        if (
          !changes ||
          changes.length === 0 ||
          changes.some((c) => c.kind === "artifact" || c.kind === "artifactUiState")
        ) {
          this.refresh();
        }
      }),
    );
  }

  getKindFilter(): string | undefined {
    return this.kindFilter;
  }

  setKindFilter(kind: string | undefined): void {
    this.kindFilter = kind;
    this.refresh();
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
      const item = new vscode.TreeItem("No artifacts yet");
      item.description = "Create an artifact with your AI assistant";
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    if (element.type === "emptyFilter") {
      const item = new vscode.TreeItem("No artifacts match this filter");
      item.iconPath = new vscode.ThemeIcon("filter");
      return item;
    }

    if (element.type === "viewAll") {
      const item = new vscode.TreeItem(`View all (${element.totalCount.toLocaleString()} artifacts)...`);
      item.iconPath = new vscode.ThemeIcon("search");
      item.command = {
        command: "agentPlus.searchArtifact",
        title: "Search Artifact",
        arguments: element.kindFilter ? [{ kindFilter: element.kindFilter }] : [],
      };
      return item;
    }

    const { artifact, isPinned } = element;
    const item = new vscode.TreeItem(artifact.title);
    const kindLabel = formatArtifactKindLabel(artifact.kind);
    item.description = isPinned ? `(Pinned) · ${kindLabel}` : kindLabel;
    item.tooltip = `${artifact.title}\nType: ${kindLabel}\nUpdated: ${artifact.updatedAt} · Created: ${artifact.createdAt} · ${artifact.artifactId}`;
    item.iconPath = isPinned ? new vscode.ThemeIcon("pin") : new vscode.ThemeIcon("file-code");
    item.contextValue = isPinned ? "artifact.pinned" : "artifact";
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

      const active = all.filter((a) => !a.isArchived);

      if (active.length === 0) {
        return [{ type: "empty" }];
      }

      let filtered = active;
      if (this.kindFilter === "other") {
        filtered = active.filter((artifact) => !isFixedArtifactKind(artifact.kind));
      } else if (this.kindFilter) {
        filtered = active.filter((artifact) => artifact.kind === this.kindFilter);
      }

      if (filtered.length === 0) {
        return [{ type: "emptyFilter" }];
      }

      const sorted = [...filtered].sort(compareArtifactsByRecency);

      const sliced = sorted.slice(0, MAX_RECENT_ARTIFACTS);
      const result: RecentTreeElement[] = sliced.map((artifact) => ({
        type: "artifact",
        artifact,
        isPinned: Boolean(artifact.isPinned),
      }));

      if (sorted.length > MAX_RECENT_ARTIFACTS) {
        result.push({ type: "viewAll", totalCount: sorted.length, kindFilter: this.kindFilter });
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
      isPinned?: boolean;
    }
  | { type: "empty" }
  | { type: "emptyFilter" };

export class WorkSessionsTreeDataProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly disposables: vscode.Disposable[] = [];
  private selectedTypeId: string | undefined = undefined;

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
              c.kind === "support" ||
              c.kind === "sessionUiState",
          )
        ) {
          this.refresh();
        }
      }),
    );
  }

  getTypeFilter(): string | undefined {
    return this.selectedTypeId;
  }

  setTypeFilter(typeId: string | undefined): void {
    this.selectedTypeId = typeId;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: SessionTreeElement): vscode.TreeItem {
    if (element.type === "emptyFilter") {
      const item = new vscode.TreeItem("No sessions match this filter");
      item.iconPath = new vscode.ThemeIcon("filter");
      return item;
    }

    if (element.type === "unsupported") {
      const item = new vscode.TreeItem("Sessions require MCP server version 12 or higher");
      item.description = element.status.reason ?? "Integration update required";
      item.iconPath = new vscode.ThemeIcon("warning");
      item.command = {
        command: "agentPlus.installer",
        title: "Open AI Artifacts Installer",
      };
      return item;
    }

    if (element.type === "migrationCandidates") {
      const item = new vscode.TreeItem(
        `Migrate ${element.count} legacy conversation${element.count !== 1 ? "s" : ""} to Sessions...`,
      );
      item.description = "Click to migrate";
      item.iconPath = new vscode.ThemeIcon("arrow-swap");
      item.command = {
        command: "agentPlus.migrateConversations",
        title: "Migrate Conversations",
      };
      return item;
    }

    if (element.type === "empty") {
      const item = new vscode.TreeItem("No sessions yet");
      item.description = "Create an artifact to start a session";
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }

    const item = new vscode.TreeItem(element.title);
    const countLabel = `${element.artifactCount} artifact${element.artifactCount !== 1 ? "s" : ""}`;
    item.description = element.isPinned ? `(Pinned) · ${element.typeLabel} · ${countLabel}` : `${element.typeLabel} · ${countLabel}`;
    item.tooltip = `${element.title}\nType: ${element.typeLabel}\nUpdated: ${element.updatedAt} · Created: ${element.createdAt} · ID: ${element.sessionId}`;
    item.iconPath = element.isPinned ? new vscode.ThemeIcon("pin") : new vscode.ThemeIcon("folder");
    item.contextValue = element.isPinned ? "session.pinned" : "session";
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

      if (this.selectedTypeId) {
        const typeStillExists = types.some((t) => t.id === this.selectedTypeId);
        if (!typeStillExists) {
          this.selectedTypeId = undefined;
        }
      }

      const withUiState = await Promise.all(
        sessions.map(async (s) => {
          const uiState = await getSessionUiState(s.sessionId, this.rootOptions).catch((err) => {
            console.warn(`[WorkSessions] Failed to read UI state for ${s.sessionId}:`, err);
            return undefined;
          });
          return { session: s, uiState };
        }),
      );

      const active = withUiState.filter(({ uiState }) => !uiState?.archivedAt);

      const filteredSessions = this.selectedTypeId
        ? active.filter(({ session }) => session.typeId === this.selectedTypeId)
        : active;

      const items: SessionTreeElement[] = [];

      if (candidateCount > 0) {
        items.push({ type: "migrationCandidates", count: candidateCount });
      }

      const sorted = [...filteredSessions].sort((a, b) => {
        const pinA = Boolean(a.uiState?.pinned);
        const pinB = Boolean(b.uiState?.pinned);
        if (pinA !== pinB) return pinA ? -1 : 1;
        const diff = compareIsoTimestampsAsc(b.session.updatedAt, a.session.updatedAt);
        if (diff !== 0) return diff;
        return a.session.sessionId.localeCompare(b.session.sessionId);
      });

      for (const { session: s, uiState } of sorted) {
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
          isPinned: Boolean(uiState?.pinned),
        });
      }

      if (filteredSessions.length === 0) {
        if (active.length > 0) {
          items.push({ type: "emptyFilter" });
        } else if (items.length === 0) {
          items.push({ type: "empty" });
        }
      }

      return items;
    } catch {
      return [{ type: "empty" }];
    }
  }
}

