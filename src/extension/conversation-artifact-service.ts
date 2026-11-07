import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  CONVERSATION_METADATA_FILE,
  CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY,
  CONVERSATION_V1_BACKUP_FILE,
  WORK_SESSION_INSTRUCTIONS_FILE,
  WORK_SESSION_LAYOUT_FILE,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  DEFAULT_SESSION_TYPE_ID,
  artifactConversationIdSchema,
  artifactIdSchema,
  conversationArtifactGroupSchema,
  sessionTypeIdSchema,
  type ConversationArtifactGroup,
  type ConversationArtifactItem,
  type ConversationArtifactsViewState,
  type WorkSession,
  type WorkSessionArtifactRow,
  type WorkSessionDataChange,
  type WorkSessionViewData,
  type ArtifactSessionTarget,
} from "../shared/contracts";
import {
  createSession as createSessionRegistry,
  ensureSafeConversationRegistryRoot,
  listCandidatesForArtifact,
  listConversationsForArtifact,
  listMigrationCandidates,
  listSessions,
  listSessionsForArtifact,
  moveArtifactInSession as moveArtifactInSessionRegistry,
  readSession,
  registerArtifactInSession as registerArtifactInSessionRegistry,
  removeArtifactFromConversation,
  removeArtifactFromSession as removeArtifactFromSessionRegistry,
  setSessionType as setSessionTypeRegistry,
  updateSessionDetails as updateSessionDetailsRegistry,
  type MigrationCandidateEntry,
} from "../shared/conversation-artifact-registry";
import { listSessionTypes } from "../shared/session-type-registry";
import { parseArtifactManifest } from "../shared/artifact-validation";
import {
  validateArtifactReviewTarget,
  type ArtifactFileUri,
  type ArtifactReviewOpenOptions,
  type ValidatedArtifactReviewTarget,
} from "./artifact-review-open";

export const DEFAULT_CONVERSATION_WATCHER_DEBOUNCE_MS = 100;

export type ConversationRegistryWatcher<TUri = unknown> = {
  onDidCreate: (listener: (uri: TUri) => void | Promise<void>) => unknown;
  onDidChange: (listener: (uri: TUri) => void | Promise<void>) => unknown;
  onDidDelete?: (listener: (uri: TUri) => void | Promise<void>) => unknown;
  dispose?: () => void;
};

export type ConversationArtifactServiceDependencies<TUri extends ArtifactFileUri> = {
  uriFromFilePath: (filePath: string) => TUri;
  openArtifactReview: (
    artifactUri: TUri,
    options?: ArtifactReviewOpenOptions,
  ) => Promise<ValidatedArtifactReviewTarget>;
  reportError?: (message: string) => void;
  rootOptions?: GlobalArtifactsRootOptions;
  debounceMs?: number;
};

export type OpenConversationArtifactResult =
  | {
      status: "opened";
      target: ValidatedArtifactReviewTarget;
      shouldRefresh: false;
    }
  | {
      status: "missing";
      artifactId: string;
      message: string;
      shouldRefresh: true;
    }
  | {
      status: "error";
      artifactId: string;
      message: string;
      shouldRefresh: boolean;
    };

function isMissingArtifactError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("ENOENT") || message.startsWith("ARTIFACT_NOT_FOUND:");
}

export class ConversationArtifactService<TUri extends ArtifactFileUri> {
  private readonly listeners = new Set<(changes: readonly WorkSessionDataChange[]) => void | Promise<void>>();
  private readonly pendingChanges = new Map<string, WorkSessionDataChange>();
  private pendingGenericChange = false;
  private readonly rootOptions: GlobalArtifactsRootOptions;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private watcher: ConversationRegistryWatcher<TUri> | undefined;
  private disposed = false;

  constructor(private readonly dependencies: ConversationArtifactServiceDependencies<TUri>) {
    this.rootOptions = dependencies.rootOptions ?? {};
    this.debounceMs = dependencies.debounceMs ?? DEFAULT_CONVERSATION_WATCHER_DEBOUNCE_MS;
  }

  async getConversationsForArtifact(currentArtifactId: string): Promise<{
    groups: ConversationArtifactGroup[];
    skippedCount: number;
  }> {
    const parsedCurrentId = artifactIdSchema.parse(currentArtifactId);
    const rawResult = await listConversationsForArtifact(parsedCurrentId, this.rootOptions);
    const collectionRoot = globalArtifactsRoot(this.rootOptions);

    let skippedCount = rawResult.skippedCount;
    const groups: ConversationArtifactGroup[] = [];

    for (const rawGroup of rawResult.conversations) {
      const validItems: ConversationArtifactItem[] = [];

      for (const membership of rawGroup.memberships) {
        const candidateArtifactPath = path.join(collectionRoot, membership.artifactId, ARTIFACT_MARKDOWN_FILE);

        try {
          const validated = await validateArtifactReviewTarget(candidateArtifactPath, this.rootOptions);
          validItems.push({
            artifactId: membership.artifactId,
            title: validated.manifest.title,
            kind: validated.manifest.kind,
            registeredAt: membership.registeredAt,
            isCurrent: membership.artifactId === parsedCurrentId,
          });
        } catch {
          skippedCount++;
          await removeArtifactFromConversation(
            rawGroup.conversation.artifactConversationId,
            membership.artifactId,
            this.rootOptions,
          ).catch(() => undefined);
        }
      }

      if (validItems.length > 0 && validItems.some((item) => item.isCurrent)) {
        groups.push(
          conversationArtifactGroupSchema.parse({
            artifactConversationId: rawGroup.conversation.artifactConversationId,
            conversationName: rawGroup.conversation.conversationName,
            currentArtifactRegisteredAt: rawGroup.currentArtifactRegisteredAt,
            artifacts: validItems,
          }),
        );
      }
    }

    return { groups, skippedCount };
  }

  async getConversationsViewState(currentArtifactId: string): Promise<ConversationArtifactsViewState> {
    try {
      const { groups, skippedCount } = await this.getConversationsForArtifact(currentArtifactId);
      return {
        status: "ready",
        groups,
        skippedCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        message,
      };
    }
  }

  async openConversationArtifact(artifactId: string): Promise<OpenConversationArtifactResult> {
    const parsed = artifactIdSchema.safeParse(artifactId);
    if (!parsed.success) {
      const message = `Invalid artifact ID: ${String(artifactId)}`;
      this.dependencies.reportError?.(message);
      return {
        status: "error",
        artifactId: String(artifactId),
        message,
        shouldRefresh: false,
      };
    }

    const validArtifactId = parsed.data;
    const candidateArtifactPath = path.join(
      globalArtifactsRoot(this.rootOptions),
      validArtifactId,
      ARTIFACT_MARKDOWN_FILE,
    );

    try {
      const target = await this.dependencies.openArtifactReview(
        this.dependencies.uriFromFilePath(candidateArtifactPath),
        { preview: false },
      );
      return {
        status: "opened",
        target,
        shouldRefresh: false,
      };
    } catch (error) {
      if (isMissingArtifactError(error)) {
        const message = `Artifact "${validArtifactId}" is no longer available on disk.`;
        this.dependencies.reportError?.(message);
        this.notifyChanged();
        return {
          status: "missing",
          artifactId: validArtifactId,
          message,
          shouldRefresh: true,
        };
      }

      const detail = error instanceof Error ? error.message : String(error);
      const message = `Could not open artifact "${validArtifactId}": ${detail}`;
      this.dependencies.reportError?.(message);
      return {
        status: "error",
        artifactId: validArtifactId,
        message,
        shouldRefresh: false,
      };
    }
  }

  async listWorkSessions(): Promise<WorkSession[]> {
    return listSessions(this.rootOptions);
  }

  async getWorkSession(sessionId: string): Promise<WorkSession> {
    return readSession(sessionId, this.rootOptions);
  }

  async listCandidates(): Promise<MigrationCandidateEntry[]> {
    return listMigrationCandidates(this.rootOptions);
  }

  async countCandidates(): Promise<number> {
    const candidates = await this.listCandidates();
    return candidates.length;
  }

  async getArtifactSessions(artifactId: string): Promise<ArtifactSessionTarget[]> {
    const [sessions, candidates, types] = await Promise.all([
      listSessionsForArtifact(artifactId, this.rootOptions),
      listCandidatesForArtifact(artifactId, this.rootOptions),
      listSessionTypes(this.rootOptions),
    ]);

    const typeMap = new Map<string, string>();
    for (const t of types) {
      typeMap.set(t.id, t.label);
    }

    const targets: ArtifactSessionTarget[] = [];

    for (const s of sessions) {
      targets.push({
        sessionId: s.sessionId,
        title: s.title,
        version: 2,
        typeId: s.typeId,
        typeLabel: typeMap.get(s.typeId) ?? s.typeId,
      });
    }

    for (const c of candidates) {
      targets.push({
        sessionId: c.sessionId,
        title: c.title,
        version: 1,
      });
    }

    return targets;
  }

  async resolveSessionViewData(sessionId: string): Promise<WorkSessionViewData> {
    const session = await this.getWorkSession(sessionId);
    const sessionTypes = await listSessionTypes(this.rootOptions);
    const matchedType = sessionTypes.find((t) => t.id === session.typeId);
    const typeLabel = matchedType ? matchedType.label : session.typeId;

    const resolveZone = async (artifactIds: string[]): Promise<WorkSessionArtifactRow[]> => {
      const rows: WorkSessionArtifactRow[] = [];
      const collectionRoot = globalArtifactsRoot(this.rootOptions);
      for (const id of artifactIds) {
        try {
          const manifestPath = path.join(collectionRoot, id, ARTIFACT_MANIFEST_FILE);
          const rawText = await fs.readFile(manifestPath, "utf8");
          const manifest = parseArtifactManifest(JSON.parse(rawText));
          rows.push({
            artifactId: id,
            title: manifest.title,
            kind: manifest.kind,
            updatedAt: manifest.updatedAt,
          });
        } catch {
          rows.push({
            artifactId: id,
            title: id,
            kind: "spec",
            updatedAt: session.updatedAt,
            unavailable: true,
          });
        }
      }
      return rows;
    };

    const [working, references, archived] = await Promise.all([
      resolveZone(session.working),
      resolveZone(session.references),
      resolveZone(session.archived),
    ]);

    return {
      sessionId: session.sessionId,
      title: session.title,
      typeId: session.typeId,
      typeLabel,
      instructions: session.instructions,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      working,
      references,
      archived,
    };
  }

  async createSession(input: { title: string; typeId?: string; instructions?: string }): Promise<WorkSession> {
    const session = await createSessionRegistry({
      ...(this.rootOptions.userHome ? { userHome: this.rootOptions.userHome } : {}),
      title: input.title,
      typeId: input.typeId ?? DEFAULT_SESSION_TYPE_ID,
      ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
    });
    this.notifyChanged([{ kind: "metadata", sessionId: session.sessionId }]);
    return session;
  }

  async updateSessionDetails(
    sessionId: string,
    details: { title?: string; instructions?: string },
  ): Promise<WorkSession> {
    const session = await updateSessionDetailsRegistry(sessionId, details, this.rootOptions);
    const changes: WorkSessionDataChange[] = [];
    if (details.title !== undefined) {
      changes.push({ kind: "metadata", sessionId: session.sessionId });
    }
    if (details.instructions !== undefined) {
      changes.push({ kind: "instructions", sessionId: session.sessionId });
    }
    if (changes.length > 0) {
      this.notifyChanged(changes);
    }
    return session;
  }

  async setSessionType(sessionId: string, rawTypeId: string): Promise<WorkSession> {
    const typeId = sessionTypeIdSchema.parse(rawTypeId);
    const types = await listSessionTypes(this.rootOptions);
    if (!types.some((t) => t.id === typeId)) {
      throw new Error(`Session type "${typeId}" does not exist in registry.`);
    }
    const session = await setSessionTypeRegistry(sessionId, typeId, this.rootOptions);
    this.notifyChanged([{ kind: "metadata", sessionId: session.sessionId }]);
    return session;
  }

  async moveArtifactInSession(
    sessionId: string,
    artifactId: string,
    targetZone: "working" | "references" | "archived",
    targetIndex: number,
  ): Promise<WorkSession> {
    const session = await moveArtifactInSessionRegistry(
      sessionId,
      artifactId,
      targetZone,
      targetIndex,
      this.rootOptions,
    );
    this.notifyChanged([{ kind: "layout", sessionId: session.sessionId }]);
    return session;
  }

  async registerArtifactInSession(
    sessionId: string,
    artifactId: string,
  ): Promise<void> {
    await registerArtifactInSessionRegistry(sessionId, artifactId, this.rootOptions);
    this.notifyChanged([
      { kind: "membership", sessionId, artifactId },
      { kind: "artifact", artifactId },
    ]);
  }

  async removeArtifactFromSession(sessionId: string, artifactId: string): Promise<boolean> {
    const removed = await removeArtifactFromSessionRegistry(sessionId, artifactId, this.rootOptions);
    if (removed) {
      this.notifyChanged([
        { kind: "membership", sessionId, artifactId },
        { kind: "layout", sessionId },
      ]);
    }
    return removed;
  }

  onDidChange(listener: (changes: readonly WorkSessionDataChange[]) => void | Promise<void>): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  scheduleChangeNotification(changes?: readonly WorkSessionDataChange[]): void {
    if (this.disposed) return;
    if (changes && changes.length > 0) {
      for (const change of changes) {
        this.pendingChanges.set(changeKey(change), change);
      }
    } else {
      this.pendingGenericChange = true;
    }

    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.emitChange();
    }, this.debounceMs);
  }

  notifyChanged(changes?: readonly WorkSessionDataChange[]): void {
    if (this.disposed) return;
    if (changes && changes.length > 0) {
      for (const change of changes) {
        this.pendingChanges.set(changeKey(change), change);
      }
    } else {
      this.pendingGenericChange = true;
    }

    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.emitChange();
  }

  attachWatcher(watcher: ConversationRegistryWatcher<TUri>): void {
    this.watcher?.dispose?.();
    this.watcher = watcher;
    const handler = (uri: TUri) => {
      const fsPath = (uri as { fsPath?: string })?.fsPath ?? String(uri);
      const classified = classifyWatcherUri(fsPath);
      if (classified === "ignored") return;
      if (classified === "unclassified") {
        this.scheduleChangeNotification();
      } else {
        this.scheduleChangeNotification([classified]);
      }
    };
    watcher.onDidCreate(handler);
    watcher.onDidChange(handler);
    watcher.onDidDelete?.(handler);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.pendingChanges.clear();
    this.pendingGenericChange = false;
    this.watcher?.dispose?.();
    this.watcher = undefined;
    this.listeners.clear();
  }

  private emitChange(): void {
    if (this.disposed) return;
    const isGeneric = this.pendingGenericChange;
    const changes = isGeneric ? [] : Array.from(this.pendingChanges.values());
    this.pendingChanges.clear();
    this.pendingGenericChange = false;

    for (const listener of [...this.listeners]) {
      try {
        void Promise.resolve(listener(changes)).catch(() => undefined);
      } catch {
        // Ignore listener errors so one consumer never breaks others
      }
    }
  }
}

export function isTemporaryOrBackupFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (
    base === CONVERSATION_V1_BACKUP_FILE ||
    base.endsWith(".backup.json") ||
    base.endsWith(".tmp") ||
    base.includes(".tmp.") ||
    base.startsWith(".")
  ) {
    return true;
  }
  return false;
}

export function classifyWatcherUri(filePath: string): WorkSessionDataChange | "unclassified" | "ignored" {
  if (isTemporaryOrBackupFile(filePath)) {
    return "ignored";
  }

  const normalized = filePath.replace(/\\/g, "/");
  const filename = path.basename(normalized);

  if (filename === CONVERSATION_METADATA_FILE) {
    const sessionDirName = path.basename(path.dirname(normalized));
    if (artifactConversationIdSchema.safeParse(sessionDirName).success) {
      return { kind: "metadata", sessionId: sessionDirName };
    }
  }

  if (filename === WORK_SESSION_INSTRUCTIONS_FILE) {
    const sessionDirName = path.basename(path.dirname(normalized));
    if (artifactConversationIdSchema.safeParse(sessionDirName).success) {
      return { kind: "instructions", sessionId: sessionDirName };
    }
  }

  if (filename === WORK_SESSION_LAYOUT_FILE) {
    const sessionDirName = path.basename(path.dirname(normalized));
    if (artifactConversationIdSchema.safeParse(sessionDirName).success) {
      return { kind: "layout", sessionId: sessionDirName };
    }
  }

  if (normalized.includes("/" + CONVERSATION_REGISTERED_ARTIFACTS_DIRECTORY + "/")) {
    const artifactIdCandidate = path.basename(normalized, ".json");
    const parentDir = path.dirname(normalized);
    const sessionDir = path.dirname(parentDir);
    const sessionDirName = path.basename(sessionDir);
    if (
      artifactConversationIdSchema.safeParse(sessionDirName).success &&
      artifactIdSchema.safeParse(artifactIdCandidate).success
    ) {
      return { kind: "membership", sessionId: sessionDirName, artifactId: artifactIdCandidate };
    }
  }

  return "unclassified";
}

export function changeKey(change: WorkSessionDataChange): string {
  switch (change.kind) {
    case "metadata":
      return `metadata:${change.sessionId}`;
    case "instructions":
      return `instructions:${change.sessionId}`;
    case "membership":
      return `membership:${change.sessionId}:${change.artifactId}`;
    case "layout":
      return `layout:${change.sessionId}`;
    case "artifact":
      return `artifact:${change.artifactId}`;
    case "types":
      return "types";
    case "support":
      return "support";
  }
}

export type SetupConversationRegistryWatcherDependencies<
  TUri extends ArtifactFileUri,
  TWatcher extends ConversationRegistryWatcher<TUri>,
> = {
  service: ConversationArtifactService<TUri>;
  ensureConversationRegistryRoot?: () => Promise<string>;
  createWatcher: (registryRoot: string, pattern: string) => TWatcher;
  rootOptions?: GlobalArtifactsRootOptions;
};

export async function setupConversationRegistryWatcher<
  TUri extends ArtifactFileUri,
  TWatcher extends ConversationRegistryWatcher<TUri>,
>(dependencies: SetupConversationRegistryWatcherDependencies<TUri, TWatcher>): Promise<TWatcher> {
  const ensureRoot =
    dependencies.ensureConversationRegistryRoot ?? (() => ensureSafeConversationRegistryRoot(dependencies.rootOptions));
  const registryRoot = await ensureRoot();
  const watcher = dependencies.createWatcher(registryRoot, "**/*");
  dependencies.service.attachWatcher(watcher);
  return watcher;
}
