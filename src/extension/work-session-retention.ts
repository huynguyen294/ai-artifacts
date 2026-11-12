import { promises as fs } from "node:fs";
import { conversationRegistryRoot, type GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { deleteSession, ensureSafeConversationRegistryRoot } from "../shared/conversation-artifact-registry";
import { artifactConversationIdSchema } from "../shared/contracts";
import { getSessionUiState } from "./artifact-ui-state";
import { DAY_IN_MS, DEFAULT_RETENTION_DAYS, normalizeRetentionDays } from "./artifact-retention";

export { DAY_IN_MS };

export type WorkSessionRetentionOptions = {
  retentionDays?: unknown;
  now?: number;
  rootOptions?: GlobalArtifactsRootOptions;
  logDiagnostic?: (message: string, error?: unknown) => void;
};

export type WorkSessionRetentionResult = {
  scannedCount: number;
  archivedCount: number;
  deletedCount: number;
  skippedCount: number;
  failedCount: number;
  deletedSessionIds: string[];
};

export function isSessionCandidateExpired(archivedAtIso: string, retentionDays: number, nowMs: number): boolean {
  const archivedAtMs = Date.parse(archivedAtIso);
  if (Number.isNaN(archivedAtMs)) return false;
  return nowMs >= archivedAtMs + retentionDays * DAY_IN_MS;
}

export async function executeWorkSessionArchiveCleanup(
  options: WorkSessionRetentionOptions = {},
): Promise<WorkSessionRetentionResult> {
  const logDiagnostic =
    options.logDiagnostic ??
    ((msg, err) => {
      if (err) console.warn(`[AI Artifacts Session Retention] ${msg}`, err);
      else console.warn(`[AI Artifacts Session Retention] ${msg}`);
    });

  const retentionDays = normalizeRetentionDays(
    options.retentionDays ?? DEFAULT_RETENTION_DAYS,
    (message) => logDiagnostic(message),
  );
  const nowMs = options.now ?? Date.now();
  const rootOptions = options.rootOptions ?? {};

  const result: WorkSessionRetentionResult = {
    scannedCount: 0,
    archivedCount: 0,
    deletedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    deletedSessionIds: [],
  };

  let registryRoot: string;
  try {
    registryRoot = await ensureSafeConversationRegistryRoot(rootOptions);
  } catch (error) {
    return result;
  }

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(registryRoot, { withFileTypes: true });
  } catch (error) {
    logDiagnostic("Could not read conversation registry directory", error);
    return result;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      continue;
    }

    const idParse = artifactConversationIdSchema.safeParse(entry.name);
    if (!idParse.success) {
      continue;
    }

    const sessionId = idParse.data;
    result.scannedCount++;

    try {
      const uiState = await getSessionUiState(sessionId, rootOptions);
      if (!uiState.archivedAt) {
        result.skippedCount++;
        continue;
      }

      result.archivedCount++;
      if (!isSessionCandidateExpired(uiState.archivedAt, retentionDays, nowMs)) {
        result.skippedCount++;
        continue;
      }

      // Revalidate before deleting
      const recheckUiState = await getSessionUiState(sessionId, rootOptions);
      if (!recheckUiState.archivedAt || !isSessionCandidateExpired(recheckUiState.archivedAt, retentionDays, nowMs)) {
        result.skippedCount++;
        continue;
      }

      try {
        const deleted = await deleteSession(sessionId, rootOptions);
        if (deleted) {
          result.deletedCount++;
          result.deletedSessionIds.push(sessionId);
        } else {
          result.skippedCount++;
        }
      } catch (delError) {
        result.skippedCount++;
        logDiagnostic(
          `Skipping cleanup of session ${sessionId}: invalid session metadata or locked directory`,
          delError,
        );
      }
    } catch (error) {
      result.failedCount++;
      logDiagnostic(`Failed to process session ${sessionId} for archive cleanup`, error);
    }
  }

  return result;
}
