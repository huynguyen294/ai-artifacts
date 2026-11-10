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
    void deps.showErrorMessage(`Failed to migrate conversation to Session: ${message}`);
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
    void deps.showInformationMessage("No conversations need migration to Sessions.");
    return null;
  }

  const choice = await deps.showWarningMessage(
    `There are ${candidates.length} conversations that can be migrated to Sessions.`,
    "Migrate All",
    "Cancel",
  );

  if (choice !== "Migrate All") {
    return null;
  }

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  await deps.withProgress("Migrating conversations to Sessions...", async (report) => {
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
    `Migration completed: ${succeeded} succeeded, ${skipped} already a Session, ${failed} failed.`,
  );

  deps.onDidMigrate?.();

  return { succeeded, skipped, failed };
}

