import path from "node:path";
import {
  ARTIFACT_MARKDOWN_FILE,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import {
  artifactIdSchema,
  conversationArtifactGroupSchema,
  type ConversationArtifactGroup,
  type ConversationArtifactItem,
  type ConversationArtifactsViewState,
} from "../shared/contracts";
import {
  ensureSafeConversationRegistryRoot,
  listConversationsForArtifact,
  removeArtifactFromConversation,
} from "../shared/conversation-artifact-registry";
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
  private readonly listeners = new Set<() => void | Promise<void>>();
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
        const candidateArtifactPath = path.join(
          collectionRoot,
          membership.artifactId,
          ARTIFACT_MARKDOWN_FILE,
        );

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

  onDidChange(listener: () => void | Promise<void>): { dispose: () => void } {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  scheduleChangeNotification(): void {
    if (this.disposed) return;
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.emitChange();
    }, this.debounceMs);
  }

  notifyChanged(): void {
    if (this.disposed) return;
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.emitChange();
  }

  attachWatcher(watcher: ConversationRegistryWatcher<TUri>): void {
    this.watcher?.dispose?.();
    this.watcher = watcher;
    const handler = () => {
      this.scheduleChangeNotification();
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
    this.watcher?.dispose?.();
    this.watcher = undefined;
    this.listeners.clear();
  }

  private emitChange(): void {
    if (this.disposed) return;
    for (const listener of [...this.listeners]) {
      try {
        void Promise.resolve(listener()).catch(() => undefined);
      } catch {
        // Ignore listener errors so one panel never breaks others
      }
    }
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
>(
  dependencies: SetupConversationRegistryWatcherDependencies<TUri, TWatcher>,
): Promise<TWatcher> {
  const ensureRoot = dependencies.ensureConversationRegistryRoot
    ?? (() => ensureSafeConversationRegistryRoot(dependencies.rootOptions));
  const registryRoot = await ensureRoot();
  const watcher = dependencies.createWatcher(registryRoot, "**/*");
  dependencies.service.attachWatcher(watcher);
  return watcher;
}
