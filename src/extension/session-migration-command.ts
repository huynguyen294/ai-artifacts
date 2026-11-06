import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import {
  migrateConversationToSession,
  type MigrationCandidateEntry,
} from "../shared/conversation-artifact-registry";

export interface SingleMigrationDeps {
  sessionId: string;
  rootOptions?: GlobalArtifactsRootOptions;
  openWorkSession: (sessionId: string) => Promise<void>;
  showErrorMessage: (message: string) => void | Thenable<unknown>;
  onDidMigrate?: () => void;
}

export async function runSingleMigration(deps: SingleMigrationDeps): Promise<boolean> {
  try {
    const result = await migrateConversationToSession(deps.sessionId, deps.rootOptions);
    deps.onDidMigrate?.();
    await deps.openWorkSession(result.session.sessionId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void deps.showErrorMessage(`Không thể chuyển đổi conversation sang Session: ${message}`);
    return false;
  }
}

export interface BulkMigrationDeps {
  listCandidates: () => Promise<MigrationCandidateEntry[]>;
  migrateCandidate: (sessionId: string) => Promise<{ status: "migrated" | "already-v2" }>;
  showWarningMessage: (message: string, ...items: string[]) => Thenable<string | undefined>;
  showInformationMessage: (message: string) => void | Thenable<unknown>;
  withProgress: (
    title: string,
    task: (progress: (update: { message?: string; increment?: number }) => void) => Promise<void>,
  ) => Promise<void>;
  onDidMigrate?: () => void;
}

export async function runBulkMigration(deps: BulkMigrationDeps): Promise<{
  succeeded: number;
  skipped: number;
  failed: number;
} | null> {
  const candidates = await deps.listCandidates();
  if (candidates.length === 0) {
    void deps.showInformationMessage("Không có conversation nào cần chuyển đổi sang Sessions.");
    return null;
  }

  const choice = await deps.showWarningMessage(
    `Có ${candidates.length} conversation có thể chuyển sang Sessions để sử dụng.`,
    "Chuyển tất cả",
    "Huỷ",
  );

  if (choice !== "Chuyển tất cả") {
    return null;
  }

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  await deps.withProgress("Đang chuyển đổi conversations sang Sessions...", async (report) => {
    const total = candidates.length;
    for (let i = 0; i < total; i++) {
      const candidate = candidates[i]!;
      report({
        message: `(${i + 1}/${total}) ${candidate.title}`,
        increment: (1 / total) * 100,
      });

      try {
        const result = await deps.migrateCandidate(candidate.sessionId);
        if (result.status === "already-v2") {
          skipped++;
        } else {
          succeeded++;
        }
      } catch {
        failed++;
      }
    }
  });

  void deps.showInformationMessage(
    `Hoàn tất chuyển đổi: ${succeeded} thành công, ${skipped} đã là Session, ${failed} thất bại.`,
  );

  deps.onDidMigrate?.();

  return { succeeded, skipped, failed };
}

