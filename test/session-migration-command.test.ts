import { describe, expect, it, vi } from "vitest";
import {
  runBulkMigration,
  runSingleMigration,
} from "../src/extension/session-migration-command";

describe("session-migration-command", () => {
  describe("runSingleMigration", () => {
    it("reports error when migration fails", async () => {
      const showErrorMessage = vi.fn();
      const openWorkSession = vi.fn();
      const onDidMigrate = vi.fn();

      const success = await runSingleMigration({
        sessionId: "00000000-0000-4000-8000-000000000000",
        openWorkSession,
        showErrorMessage,
        onDidMigrate,
      });

      expect(success).toBe(false);
      expect(showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to migrate conversation to Session"),
      );
      expect(openWorkSession).not.toHaveBeenCalled();
      expect(onDidMigrate).not.toHaveBeenCalled();
    });
  });

  describe("runBulkMigration", () => {
    it("returns null with notice when candidates list is empty", async () => {
      const showInformationMessage = vi.fn();
      const showWarningMessage = vi.fn();

      const result = await runBulkMigration({
        listCandidates: async () => [],
        migrateCandidate: vi.fn(),
        showWarningMessage,
        showInformationMessage,
        withProgress: vi.fn(),
      });

      expect(result).toBeNull();
      expect(showInformationMessage).toHaveBeenCalledWith(
        "No conversations need migration to Sessions.",
      );
      expect(showWarningMessage).not.toHaveBeenCalled();
    });

    it("cancels without mutating when user does not confirm", async () => {
      const showWarningMessage = vi.fn(async () => "Cancel");
      const migrateCandidate = vi.fn();

      const result = await runBulkMigration({
        listCandidates: async () => [
          { sessionId: "11111111-1111-4111-8111-111111111111", title: "Conv 1", createdAt: "", artifactCount: 1 },
        ],
        migrateCandidate,
        showWarningMessage,
        showInformationMessage: vi.fn(),
        withProgress: vi.fn(),
      });

      expect(result).toBeNull();
      expect(showWarningMessage).toHaveBeenCalled();
      expect(migrateCandidate).not.toHaveBeenCalled();
    });

    it("runs migration sequentially with progress and reports counts on confirm", async () => {
      const candidates = [
        { sessionId: "11111111-1111-4111-8111-111111111111", title: "Conv 1", createdAt: "", artifactCount: 1 },
        { sessionId: "22222222-2222-4222-8222-222222222222", title: "Conv 2", createdAt: "", artifactCount: 2 },
        { sessionId: "33333333-3333-4333-8333-333333333333", title: "Conv 3", createdAt: "", artifactCount: 3 },
      ];

      const migrateCandidate = vi.fn(async (id: string) => {
        if (id === "11111111-1111-4111-8111-111111111111") return { status: "migrated" as const };
        if (id === "22222222-2222-4222-8222-222222222222") return { status: "already-v2" as const };
        throw new Error("Disk error");
      });

      const showWarningMessage = vi.fn(async () => "Migrate All");
      const showInformationMessage = vi.fn();
      const onDidMigrate = vi.fn();

      const progressReports: any[] = [];
      const withProgress = vi.fn(async (_title: string, task: (p: any) => Promise<void>) => {
        await task((update: any) => progressReports.push(update));
      });

      const result = await runBulkMigration({
        listCandidates: async () => candidates,
        migrateCandidate,
        showWarningMessage,
        showInformationMessage,
        withProgress,
        onDidMigrate,
      });

      expect(result).toEqual({ succeeded: 1, skipped: 1, failed: 1 });
      expect(migrateCandidate).toHaveBeenCalledTimes(3);
      expect(progressReports).toHaveLength(3);
      expect(showInformationMessage).toHaveBeenCalledWith(
        "Migration completed: 1 succeeded, 1 already a Session, 1 failed.",
      );
      expect(onDidMigrate).toHaveBeenCalledTimes(1);
    });
  });
});

