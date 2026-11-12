import { fork, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { claimWhatsNewUpgradeNotification } from "../src/extension/whats-new-notification-state";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe("whats-new-notification-state", () => {
  it("silently bootstraps a fresh store, writes baseline and receipt, and stays false on reload", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-fresh-"));
    try {
      const parentDir = path.join(tempRoot, "globalStorage");
      await fs.mkdir(parentDir, { mode: 0o755 });
      const beforeParentMode = process.platform === "win32"
        ? undefined
        : (await fs.stat(parentDir)).mode & 0o777;
      const storageDir = path.join(parentDir, "whats-new-notification");

      const first = await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", true);
      expect(first).toBe(false);

      expect(await readJson(path.join(storageDir, "baseline.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
      });
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: false,
      });

      if (process.platform !== "win32") {
        expect((await fs.stat(parentDir)).mode & 0o777).toBe(beforeParentMode);
        expect((await fs.stat(storageDir)).mode & 0o077).toBe(0);
        expect((await fs.stat(path.join(storageDir, "baseline.json"))).mode & 0o077).toBe(0);
        expect((await fs.stat(path.join(storageDir, "versions", "1.2.0.json"))).mode & 0o077).toBe(0);
      }

      const repeat = await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", true);
      expect(repeat).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: false,
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("claims exactly once on upgrade to an opt-in version and persists claimed receipt before returning", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-upgrade-"));
    try {
      const storageDir = path.join(tempRoot, "whats-new-notification");
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.1.4", false)).toBe(false);

      const claimed = await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", true);
      expect(claimed).toBe(true);
      expect(await readJson(path.join(storageDir, "baseline.json"))).toEqual({
        schemaVersion: 1,
        version: "1.1.4",
      });
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: true,
      });

      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", true)).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: true,
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("records non-notifying versions immutably and refuses overwrite or catch-up later", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-observe-"));
    try {
      const storageDir = path.join(tempRoot, "whats-new-notification");
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.1.4", false)).toBe(false);

      // Observed silently with notifyEnabled = false
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", false)).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: false,
      });

      // Re-running same version with notifyEnabled = true cannot overwrite or claim
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.2.0", true)).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: false,
      });

      // Skipping ahead to 1.3.0 (silent) compares against 1.2.0; stepping back to 1.2.1 stays silent
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.3.0", false)).toBe(false);
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.2.1", true)).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.2.1.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.1",
        notificationClaimed: false,
      });

      // Next higher version 1.4.0 compares against 1.3.0
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.4.0", true)).toBe(true);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("compares version segments numerically, prevents downgrade/return re-claims, and ignores non-stable filenames", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-semver-"));
    try {
      const storageDir = path.join(tempRoot, "whats-new-notification");
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.9.0", false)).toBe(false);

      // Non-stable entries and subdirectories in versions/ do not raise highestObserved
      await fs.writeFile(path.join(storageDir, "versions", "99.0.0-alpha.1.json"), "{}", "utf8");
      await fs.writeFile(path.join(storageDir, "versions", "v99.0.0.json"), "{}", "utf8");
      await fs.writeFile(path.join(storageDir, "versions", "099.0.0.json"), "{}", "utf8");
      await fs.writeFile(path.join(storageDir, "versions", "notes.txt"), "text", "utf8");
      await fs.mkdir(path.join(storageDir, "versions", "99.0.0.json"));

      // 1.10.0 > 1.9.0 numerically
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.10.0", true)).toBe(true);

      // Downgrade to 1.9.5 stays silent and writes un-claimed receipt
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.9.5", true)).toBe(false);
      expect(await readJson(path.join(storageDir, "versions", "1.9.5.json"))).toEqual({
        schemaVersion: 1,
        version: "1.9.5",
        notificationClaimed: false,
      });

      // Returning to 1.10.0 stays silent
      expect(await claimWhatsNewUpgradeNotification(storageDir, "1.10.0", true)).toBe(false);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("rejects invalid versions before creating paths and leaves corrupt baseline unmutated", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-invalid-"));
    try {
      const neverCreatedDir = path.join(tempRoot, "never-created");
      for (const badVersion of [
        "",
        "v1.2.0",
        " 1.2.0",
        "1.2.0 ",
        "1.2",
        "1.2.3.4",
        "01.2.0",
        "1.02.0",
        "1.2.00",
        "1.2.0-beta.1",
        "1.2.0+build.4",
        "99999999999999999999.0.0",
      ]) {
        await expect(
          claimWhatsNewUpgradeNotification(neverCreatedDir, badVersion, true),
        ).rejects.toThrow();
      }
      expect(await pathExists(neverCreatedDir)).toBe(false);

      // Empty storageDirectory also throws cleanly
      await expect(claimWhatsNewUpgradeNotification("   ", "1.2.0", true)).rejects.toThrow();

      // Corrupt baseline throws without overwriting baseline.json or creating version receipts
      const corruptDir = path.join(tempRoot, "corrupt-baseline");
      await fs.mkdir(path.join(corruptDir, "versions"), { recursive: true });
      const baselinePath = path.join(corruptDir, "baseline.json");
      await fs.writeFile(baselinePath, "{not-valid-json", "utf8");

      await expect(claimWhatsNewUpgradeNotification(corruptDir, "1.2.0", true)).rejects.toThrow();
      expect(await fs.readFile(baselinePath, "utf8")).toBe("{not-valid-json");
      expect(await pathExists(path.join(corruptDir, "versions", "1.2.0.json"))).toBe(false);

      // Schema-invalid baseline also fails without overwrite
      await fs.writeFile(
        baselinePath,
        JSON.stringify({ schemaVersion: 2, version: "1.1.4" }),
        "utf8",
      );
      await expect(claimWhatsNewUpgradeNotification(corruptDir, "1.2.0", true)).rejects.toThrow();
      expect(await pathExists(path.join(corruptDir, "versions", "1.2.0.json"))).toBe(false);

      // Existing partial/0-byte receipt behaves as already handled without overwrite
      const partialDir = path.join(tempRoot, "partial-receipt");
      expect(await claimWhatsNewUpgradeNotification(partialDir, "1.1.4", false)).toBe(false);
      const partialReceiptPath = path.join(partialDir, "versions", "1.2.0.json");
      await fs.writeFile(partialReceiptPath, "", "utf8");
      expect(await claimWhatsNewUpgradeNotification(partialDir, "1.2.0", true)).toBe(false);
      expect(await fs.readFile(partialReceiptPath, "utf8")).toBe("");
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("allows only one winner under concurrent in-process callers and across two real Node processes", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ai-artifacts-wn-race-"));
    const children: ChildProcess[] = [];

    try {
      // 1. In-process Promise.all contention check
      const inProcessStorage = path.join(tempRoot, "in-process");
      expect(await claimWhatsNewUpgradeNotification(inProcessStorage, "1.1.4", false)).toBe(false);
      const inProcessResults = await Promise.all([
        claimWhatsNewUpgradeNotification(inProcessStorage, "1.2.0", true),
        claimWhatsNewUpgradeNotification(inProcessStorage, "1.2.0", true),
      ]);
      expect(inProcessResults.filter((value) => value === true)).toHaveLength(1);
      expect(inProcessResults.filter((value) => value === false)).toHaveLength(1);
      expect(await readJson(path.join(inProcessStorage, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: true,
      });

      // 2. Real two-child-process contention via temp esbuild bundle + IPC start barrier
      const multiProcStorage = path.join(tempRoot, "multi-process");
      expect(await claimWhatsNewUpgradeNotification(multiProcStorage, "1.1.4", false)).toBe(false);

      const bundledStatePath = path.join(tempRoot, "state-bundle.mjs");
      const buildResult = await esbuild.build({
        entryPoints: [path.join(repositoryRoot, "src", "extension", "whats-new-notification-state.ts")],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: bundledStatePath,
      });
      expect(buildResult.errors).toEqual([]);

      const workerScriptPath = path.join(tempRoot, "claim-worker.mjs");
      await fs.writeFile(
        workerScriptPath,
        [
          `import { pathToFileURL } from "node:url";`,
          `const [bundledPath, storageDir, version, notifyFlag] = process.argv.slice(2);`,
          `const mod = await import(pathToFileURL(bundledPath).href);`,
          `process.on("message", async (msg) => {`,
          `  if (!msg || msg.type !== "start") return;`,
          `  try {`,
          `    const claimed = await mod.claimWhatsNewUpgradeNotification(storageDir, version, notifyFlag === "true");`,
          `    process.send?.({ type: "result", claimed });`,
          `    process.exit(0);`,
          `  } catch (error) {`,
          `    process.send?.({ type: "error", message: error instanceof Error ? error.message : String(error) });`,
          `    process.exit(1);`,
          `  }`,
          `});`,
          `process.send?.({ type: "ready" });`,
        ].join("\n"),
        "utf8",
      );

      const spawnWorker = (): {
        child: ChildProcess;
        ready: Promise<void>;
        outcome: Promise<boolean>;
      } => {
        const child = fork(workerScriptPath, [bundledStatePath, multiProcStorage, "1.2.0", "true"], {
          execArgv: [],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        children.push(child);

        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += String(chunk);
        });

        let resolveReady!: () => void;
        let rejectReady!: (err: Error) => void;
        const ready = new Promise<void>((resolve, reject) => {
          resolveReady = resolve;
          rejectReady = reject;
        });

        let resolveOutcome!: (claimed: boolean) => void;
        let rejectOutcome!: (err: Error) => void;
        const outcome = new Promise<boolean>((resolve, reject) => {
          resolveOutcome = resolve;
          rejectOutcome = reject;
        });

        let settledOutcome = false;

        child.on("message", (rawMessage: unknown) => {
          const message = rawMessage as { type?: string; claimed?: unknown; message?: string };
          if (message?.type === "ready") {
            resolveReady();
            return;
          }
          if (message?.type === "result" && typeof message.claimed === "boolean") {
            settledOutcome = true;
            resolveOutcome(message.claimed);
            return;
          }
          if (message?.type === "error") {
            const err = new Error(`Child worker failed: ${message.message ?? "unknown"}`);
            rejectReady(err);
            settledOutcome = true;
            rejectOutcome(err);
          }
        });

        child.on("error", (err) => {
          rejectReady(err);
          if (!settledOutcome) {
            settledOutcome = true;
            rejectOutcome(err);
          }
        });

        child.on("exit", (code, signal) => {
          if (!settledOutcome) {
            settledOutcome = true;
            const err = new Error(
              `Child worker exited before reporting result (code=${code}, signal=${signal}, stderr=${stderr})`,
            );
            rejectReady(err);
            rejectOutcome(err);
          }
        });

        return { child, ready, outcome };
      };

      const workerA = spawnWorker();
      const workerB = spawnWorker();

      await Promise.all([workerA.ready, workerB.ready]);
      workerA.child.send({ type: "start" });
      workerB.child.send({ type: "start" });

      const outcomes = await Promise.all([workerA.outcome, workerB.outcome]);
      expect(outcomes.filter((claimed) => claimed === true)).toHaveLength(1);
      expect(outcomes.filter((claimed) => claimed === false)).toHaveLength(1);
      expect(await readJson(path.join(multiProcStorage, "versions", "1.2.0.json"))).toEqual({
        schemaVersion: 1,
        version: "1.2.0",
        notificationClaimed: true,
      });
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill();
        }
      }
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
});

