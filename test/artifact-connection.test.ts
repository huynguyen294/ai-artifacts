import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_CONNECTION_SCHEMA_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  ArtifactConnectionInvalidError,
  ArtifactConnectionWriteError,
  WindowConnectionMismatchError,
  WindowConnectionStaleError,
  WORKSPACE_SELECTION_TTL_MS,
  artifactManifestSchema,
  commentsDocumentSchema,
  reviewSubmissionSchema,
  type ArtifactConnection,
} from "../src/shared/contracts";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_COLLECTION_DIRECTORY,
  ARTIFACT_CONNECTION_FILE,
  ARTIFACT_CONNECTION_LOCK_FILE,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  COMMENTS_FILE,
  OWNER_ONLY_FILE_MODE,
  REVIEW_SUBMISSION_FILE,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import {
  commitArtifactConnectionRequest,
  readArtifactConnection,
  readArtifactConnectionRoute,
  resolveArtifactConnectionTarget,
  validateArtifactConnectionParent,
  withArtifactConnectionLock,
} from "../src/shared/artifact-connection";
import {
  ensureSafeGlobalArtifactDirectory,
  ensureSafeGlobalArtifactsRoot,
  ensureSafeManagedArtifactFile,
  sameFilesystemPath,
} from "../src/shared/artifact-validation";
import type {
  WorkspaceRegistrySnapshot,
  WorkspaceWindowSelectionGrant,
} from "../src/shared/workspace-registry";

const temporaryDirectories: string[] = [];
let userHome: string;

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await fs.symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

beforeEach(async () => {
  const tmp = await makeTemporaryDirectory("agent-plus-conn-home-");
  userHome = await fs.realpath(tmp);
  process.env.CODEX_ARTIFACTS_TEST_USER_HOME = userHome;
});

afterEach(async () => {
  delete process.env.CODEX_ARTIFACTS_TEST_USER_HOME;
  delete process.env.CODEX_ARTIFACTS_TEST_FAIL_CONNECTION_WRITE;
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

describe("internal artifact-connection module", () => {
  const windowA = "11111111-1111-4111-8111-111111111111";
  const windowB = "22222222-2222-4222-8222-222222222222";
  const artifactId = "artifact-001";

  async function createValidArtifactDir(): Promise<{
    artifactDir: string;
    markdownSha: string;
    commentsSha: string;
  }> {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const artifactDir = path.join(collectionRoot, artifactId);
    await fs.mkdir(artifactDir, { recursive: true });
    await ensureSafeGlobalArtifactDirectory(artifactId, artifactDir, { userHome });

    const markdownContent = "# Test Plan\nSome markdown content.\n";
    const markdownSha = sha256(markdownContent);
    const manifest = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId,
      title: "Test Plan",
      kind: "plan",
      reviewRound: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      location: {
        workspaceRoot: path.join(userHome, "project-a"),
      },
      reviewSessionId: randomUUID(),
    };
    const commentsDoc = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId,
      reviewRound: 1,
      artifactSha256: markdownSha,
      comments: [],
      updatedAt: new Date().toISOString(),
    };
    const commentsContent = JSON.stringify(commentsDoc, null, 2);
    const commentsSha = sha256(commentsContent);

    await fs.writeFile(path.join(artifactDir, ARTIFACT_MANIFEST_FILE), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(artifactDir, ARTIFACT_MARKDOWN_FILE), markdownContent);
    await fs.writeFile(path.join(artifactDir, COMMENTS_FILE), commentsContent);

    return { artifactDir, markdownSha, commentsSha };
  }

  it("reads null when artifact-connection.json is missing on existing v5 artifact", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const connection = await readArtifactConnection(artifactDir);
    expect(connection).toBeNull();
  });

  it("commits connection starting at revision 1 and generates unique openRequestId", async () => {
    const { artifactDir } = await createValidArtifactDir();

    const commit1 = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });

    expect(commit1.schemaVersion).toBe(ARTIFACT_CONNECTION_SCHEMA_VERSION);
    expect(commit1.windowInstanceId).toBe(windowA);
    expect(commit1.connectionRevision).toBe(1);
    expect(commit1.source).toBe("create");
    expect(commit1.openRequestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    const read1 = await readArtifactConnection(artifactDir);
    expect(read1).toEqual(commit1);

    const commit2 = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowB,
      source: "inspect",
    });

    expect(commit2.connectionRevision).toBe(2);
    expect(commit2.windowInstanceId).toBe(windowB);
    expect(commit2.source).toBe("inspect");
    expect(commit2.openRequestId).not.toBe(commit1.openRequestId);

    const read2 = await readArtifactConnection(artifactDir);
    expect(read2).toEqual(commit2);
  });

  it("ensures connection revision increases monotonically under concurrent commits", async () => {
    const { artifactDir } = await createValidArtifactDir();

    const numCommits = 8;
    const results = await Promise.all(
      Array.from({ length: numCommits }, (_, i) =>
        commitArtifactConnectionRequest(artifactDir, {
          windowInstanceId: i % 2 === 0 ? windowA : windowB,
          source: "inspect",
        })
      )
    );

    const revisions = results.map((r) => r.connectionRevision).sort((a, b) => a - b);
    expect(revisions).toEqual(Array.from({ length: numCommits }, (_, i) => i + 1));

    const finalConn = await readArtifactConnection(artifactDir);
    expect(finalConn?.connectionRevision).toBe(numCommits);
  });

  it("leaves core artifact files, bytes and hashes completely unchanged after connection writes", async () => {
    const { artifactDir, markdownSha, commentsSha } = await createValidArtifactDir();

    const manifestBefore = await fs.readFile(path.join(artifactDir, ARTIFACT_MANIFEST_FILE), "utf8");
    const markdownBefore = await fs.readFile(path.join(artifactDir, ARTIFACT_MARKDOWN_FILE), "utf8");
    const commentsBefore = await fs.readFile(path.join(artifactDir, COMMENTS_FILE), "utf8");

    await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });

    await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowB,
      source: "inspect",
    });

    const manifestAfter = await fs.readFile(path.join(artifactDir, ARTIFACT_MANIFEST_FILE), "utf8");
    const markdownAfter = await fs.readFile(path.join(artifactDir, ARTIFACT_MARKDOWN_FILE), "utf8");
    const commentsAfter = await fs.readFile(path.join(artifactDir, COMMENTS_FILE), "utf8");

    expect(manifestAfter).toBe(manifestBefore);
    expect(markdownAfter).toBe(markdownBefore);
    expect(commentsAfter).toBe(commentsBefore);
    expect(sha256(markdownAfter)).toBe(markdownSha);
    expect(sha256(commentsAfter)).toBe(commentsSha);
  });

  it("fails explicitly when artifact-connection.json is malformed and does not silently reset state", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    await fs.writeFile(connPath, "{ corrupt json ... invalid", "utf8");

    await expect(readArtifactConnection(artifactDir)).rejects.toThrow();

    // Commit should also fail rather than silently overwriting corrupt state without knowing revision
    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      })
    ).rejects.toThrow();

    // Confirm corrupt file was not overwritten
    const content = await fs.readFile(connPath, "utf8");
    expect(content).toBe("{ corrupt json ... invalid");
  });

  it("rejects invalid windowInstanceId and invalid openRequestId", async () => {
    const { artifactDir } = await createValidArtifactDir();

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: "invalid-window-id",
        source: "create",
      })
    ).rejects.toThrow();

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
        openRequestId: "invalid-request-id",
      })
    ).rejects.toThrow();
  });

  it("applies OWNER_ONLY_FILE_MODE to lock file while held and to connection file on commit", async () => {
    const { artifactDir } = await createValidArtifactDir();

    let lockMode: number | null = null;
    await withArtifactConnectionLock(artifactDir, async () => {
      const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
      const stat = await fs.stat(lockPath);
      lockMode = stat.mode & 0o777;
    });

    const committed = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(committed.connectionRevision).toBe(1);

    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    const connStat = await fs.stat(connPath);

    if (process.platform !== "win32") {
      expect(lockMode).toBe(OWNER_ONLY_FILE_MODE);
      expect(connStat.mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
    } else {
      expect(lockMode).not.toBeNull();
      expect(connStat.isFile()).toBe(true);
    }
  });

  it("rejects linked/symlinked connection file", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const outside = await makeTemporaryDirectory("agent-plus-outside-");

    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    await createDirectoryLink(outside, connPath);

    await expect(readArtifactConnection(artifactDir)).rejects.toThrow();

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      })
    ).rejects.toThrow();
  });

  it("rejects linked/symlinked lock file", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const outside = await makeTemporaryDirectory("agent-plus-outside-");

    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await createDirectoryLink(outside, lockPath);

    await expect(withArtifactConnectionLock(artifactDir, async () => {})).rejects.toThrow();

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      })
    ).rejects.toThrow();
  });

  it("rejects linked staging target file directly through commit path and preserves external target", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const firstConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(firstConn.connectionRevision).toBe(1);
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    const originalBytes = await fs.readFile(connPath, "utf8");

    const outside = await makeTemporaryDirectory("agent-plus-outside-");
    const sentinelPath = path.join(outside, "sentinel.txt");
    const sentinelContent = "sentinel-bytes-do-not-overwrite";
    await fs.writeFile(sentinelPath, sentinelContent, "utf8");

    const stagingFileName = `${ARTIFACT_CONNECTION_FILE}.tmp-deterministic-linked`;
    const stagingLinkPath = path.join(artifactDir, stagingFileName);
    await createDirectoryLink(outside, stagingLinkPath);

    const entriesBefore = await fs.readdir(artifactDir);

    const failedCommit = commitArtifactConnectionRequest(
      artifactDir,
      {
        windowInstanceId: windowB,
        source: "inspect",
      },
      { testOnlyStagingFileName: stagingFileName },
    );
    await expect(failedCommit).rejects.toBeInstanceOf(ArtifactConnectionInvalidError);
    await expect(failedCommit).rejects.toThrow(/UNSAFE_ARTIFACT_PATH/);

    // Prior connection raw bytes, revision và window binding giữ nguyên
    const connAfter = await readArtifactConnection(artifactDir);
    expect(connAfter?.connectionRevision).toBe(1);
    expect(connAfter?.windowInstanceId).toBe(windowA);
    expect(await fs.readFile(connPath, "utf8")).toBe(originalBytes);

    // Linked staging entry vẫn tồn tại và vẫn resolve đến cùng outside target
    const linkStat = await fs.lstat(stagingLinkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await fs.realpath(stagingLinkPath)).toBe(await fs.realpath(outside));

    // Sentinel giữ nguyên exact bytes
    expect(await fs.readFile(sentinelPath, "utf8")).toBe(sentinelContent);

    // Tập directory entries trước/sau hoàn toàn bằng nhau (không phát sinh staging sibling)
    const entriesAfter = await fs.readdir(artifactDir);
    expect(entriesAfter.sort()).toEqual(entriesBefore.sort());

    // Lock file đã được giải phóng
    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("validates testOnlyStagingFileName rejects absolute paths, separators, invalid patterns and non-test env", async () => {
    const { artifactDir } = await createValidArtifactDir();

    // 1. Reject absolute path
    await expect(
      commitArtifactConnectionRequest(
        artifactDir,
        { windowInstanceId: windowA, source: "create" },
        { testOnlyStagingFileName: path.resolve(artifactDir, "artifact-connection.json.tmp-abs") },
      ),
    ).rejects.toThrow(ArtifactConnectionInvalidError);

    // 2. Reject path traversal / separator
    await expect(
      commitArtifactConnectionRequest(
        artifactDir,
        { windowInstanceId: windowA, source: "create" },
        { testOnlyStagingFileName: "../artifact-connection.json.tmp-traversal" },
      ),
    ).rejects.toThrow(ArtifactConnectionInvalidError);

    // 3. Reject invalid pattern
    await expect(
      commitArtifactConnectionRequest(
        artifactDir,
        { windowInstanceId: windowA, source: "create" },
        { testOnlyStagingFileName: "malicious-staging-name.json" },
      ),
    ).rejects.toThrow(ArtifactConnectionInvalidError);

    // 4. Reject outside test environment
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.VITEST;
      process.env.NODE_ENV = "production";
      await expect(
        commitArtifactConnectionRequest(
          artifactDir,
          { windowInstanceId: windowA, source: "create" },
          { testOnlyStagingFileName: "artifact-connection.json.tmp-valid" },
        ),
      ).rejects.toThrow("testOnlyStagingFileName is only permitted in test environments.");
    } finally {
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("cleans up an owned partial staging file when the write operation fails during commit", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const firstConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(firstConn.connectionRevision).toBe(1);
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    const originalBytes = await fs.readFile(connPath, "utf8");

    const stagingFileName = `${ARTIFACT_CONNECTION_FILE}.tmp-partial-write-failure`;
    const stagingFilePath = path.join(artifactDir, stagingFileName);
    process.env.CODEX_ARTIFACTS_TEST_FAIL_CONNECTION_WRITE = "temp-write";

    const failedCommit = commitArtifactConnectionRequest(
      artifactDir,
      {
        windowInstanceId: windowB,
        source: "inspect",
      },
      { testOnlyStagingFileName: stagingFileName },
    );
    await expect(failedCommit).rejects.toBeInstanceOf(ArtifactConnectionWriteError);
    await expect(failedCommit).rejects.toThrow(/EIO: i\/o error writing connection staging file/);

    const connAfter = await readArtifactConnection(artifactDir);
    expect(connAfter?.connectionRevision).toBe(1);
    expect(connAfter?.windowInstanceId).toBe(windowA);
    expect(await fs.readFile(connPath, "utf8")).toBe(originalBytes);

    const files = await fs.readdir(artifactDir);
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([]);
    await expect(fs.access(stagingFilePath)).rejects.toThrow();

    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("retries transient rename failure and succeeds when lock clears within retry limit", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const firstConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(firstConn.connectionRevision).toBe(1);

    const originalRename = fs.rename.bind(fs);
    let renameAttempts = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      if (typeof oldPath === "string" && oldPath.includes(ARTIFACT_CONNECTION_FILE)) {
        renameAttempts++;
        if (renameAttempts <= 2) {
          const error = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
          throw error;
        }
      }
      return originalRename(oldPath, newPath);
    });

    const secondConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowB,
      source: "inspect",
    });

    expect(renameAttempts).toBe(3);
    expect(secondConn.connectionRevision).toBe(2);
    expect(secondConn.windowInstanceId).toBe(windowB);
    renameSpy.mockRestore();

    const files = await fs.readdir(artifactDir);
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([]);

    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("cleans up temporary staging file and preserves prior revision when rename exhausts all retries", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const firstConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(firstConn.connectionRevision).toBe(1);
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    const originalBytes = await fs.readFile(connPath, "utf8");

    const originalRename = fs.rename.bind(fs);
    let renameAttempts = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      if (typeof oldPath === "string" && oldPath.includes(ARTIFACT_CONNECTION_FILE)) {
        renameAttempts++;
        const error = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        throw error;
      }
      return originalRename(oldPath, newPath);
    });

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowB,
        source: "inspect",
      }),
    ).rejects.toThrow(ArtifactConnectionWriteError);

    expect(renameAttempts).toBe(5);
    renameSpy.mockRestore();

    const connAfter = await readArtifactConnection(artifactDir);
    expect(connAfter?.connectionRevision).toBe(1);
    expect(connAfter?.windowInstanceId).toBe(windowA);
    expect(await fs.readFile(connPath, "utf8")).toBe(originalBytes);

    const files = await fs.readdir(artifactDir);
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([]);

    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("does not retry non-transient rename failure and cleans up staging file immediately", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const firstConn = await commitArtifactConnectionRequest(artifactDir, {
      windowInstanceId: windowA,
      source: "create",
    });
    expect(firstConn.connectionRevision).toBe(1);
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    const originalBytes = await fs.readFile(connPath, "utf8");

    const originalRename = fs.rename.bind(fs);
    let renameAttempts = 0;
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      if (typeof oldPath === "string" && oldPath.includes(ARTIFACT_CONNECTION_FILE)) {
        renameAttempts++;
        const error = Object.assign(new Error("EIO: non-transient i/o error"), { code: "EIO" });
        throw error;
      }
      return originalRename(oldPath, newPath);
    });

    await expect(
      commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowB,
        source: "inspect",
      }),
    ).rejects.toThrow(ArtifactConnectionWriteError);

    expect(renameAttempts).toBe(1);
    renameSpy.mockRestore();

    const connAfter = await readArtifactConnection(artifactDir);
    expect(connAfter?.connectionRevision).toBe(1);
    expect(connAfter?.windowInstanceId).toBe(windowA);
    expect(await fs.readFile(connPath, "utf8")).toBe(originalBytes);

    const files = await fs.readdir(artifactDir);
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([]);

    const lockPath = path.join(artifactDir, ARTIFACT_CONNECTION_LOCK_FILE);
    await expect(fs.access(lockPath)).rejects.toThrow();
  });

  it("retries transient empty read boundedly before failing", async () => {
    const { artifactDir } = await createValidArtifactDir();
    const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
    await fs.writeFile(connPath, "", "utf8");

    await expect(
      readArtifactConnection(artifactDir, { boundedRetry: true })
    ).rejects.toThrow("ARTIFACT_CONNECTION_INVALID: artifact-connection.json is empty.");
  });

  describe("resolveArtifactConnectionTarget", () => {
    let workspaceA: string;
    let workspaceB: string;
    const now = Date.now();

    beforeEach(() => {
      workspaceA = path.join(userHome, "project-a");
      workspaceB = path.join(userHome, "project-b");
    });

    function mockSnapshots(): WorkspaceRegistrySnapshot[] {
      return [
        {
          schemaVersion: 2,
          instanceId: windowA,
          processId: 1001,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
        {
          schemaVersion: 2,
          instanceId: windowB,
          processId: 1002,
          workspaceFile: null,
          focused: false,
          folders: [{ path: workspaceB, realPath: workspaceB }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
      ];
    }

    it("resolves target with source 'token' when valid selection grant is provided", async () => {
      const grant: WorkspaceWindowSelectionGrant = {
        query: "project-a",
        candidateId: "cand-1",
        workspaceRoot: workspaceA,
        windowInstanceId: windowA,
        snapshotIdentity: `${windowA}:1`,
        expiresAt: now + 60_000,
      };

      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        selectionGrant: grant,
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowA,
          workspaceRoot: workspaceA,
        },
        source: "token",
      });
    });

    it("accepts a selection grant only before its exact expiry boundary", async () => {
      const grant: WorkspaceWindowSelectionGrant = {
        query: "project-a",
        candidateId: "cand-1",
        workspaceRoot: workspaceA,
        windowInstanceId: windowA,
        snapshotIdentity: `${windowA}:1`,
        expiresAt: now + 1,
      };

      await expect(resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        selectionGrant: grant,
        registrySnapshots: mockSnapshots(),
        now,
      })).resolves.toMatchObject({ status: "matched", source: "token" });

      await expect(resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        selectionGrant: { ...grant, expiresAt: now },
        registrySnapshots: mockSnapshots(),
        now,
      })).resolves.toMatchObject({
        status: "not-found",
        message: "The selection grant has expired.",
      });

      await expect(resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        selectionGrant: { ...grant, expiresAt: now - 1 },
        registrySnapshots: mockSnapshots(),
        now,
      })).resolves.toMatchObject({
        status: "not-found",
        message: "The selection grant has expired.",
      });
    });

    it("rejects selection grant when workspaceRoot mismatches", async () => {
      const grant: WorkspaceWindowSelectionGrant = {
        query: "project-b",
        candidateId: "cand-2",
        workspaceRoot: workspaceB,
        windowInstanceId: windowB,
        snapshotIdentity: `${windowB}:1`,
        expiresAt: now + 60_000,
      };

      await expect(
        resolveArtifactConnectionTarget({
          workspaceRoot: workspaceA,
          selectionGrant: grant,
          registrySnapshots: mockSnapshots(),
        })
      ).rejects.toThrow(WindowConnectionMismatchError);
    });

    it("resolves target with source 'existing-connection' when window remains fresh", async () => {
      const { artifactDir } = await createValidArtifactDir();
      await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      });

      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        artifactDirectory: artifactDir,
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowA,
          workspaceRoot: workspaceA,
        },
        source: "existing-connection",
      });
    });

    it("falls back to fresh window matching when existing connection window is closed/stale", async () => {
      const { artifactDir } = await createValidArtifactDir();
      const staleWindowId = "99999999-9999-4999-8999-999999999999";
      await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: staleWindowId,
        source: "create",
      });

      // windowA is open with workspaceA, staleWindowId is gone
      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        artifactDirectory: artifactDir,
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowA,
          workspaceRoot: workspaceA,
        },
        source: "single-window",
      });
    });

    it("resolves target with source 'hint' when valid hint is provided", async () => {
      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceB,
        connectionHint: { windowInstanceId: windowB },
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowB,
          workspaceRoot: workspaceB,
        },
        source: "hint",
      });
    });

    it("resolves target automatically with source 'single-window' when workspaceRoot matches uniquely", async () => {
      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowA,
          workspaceRoot: workspaceA,
        },
        source: "single-window",
      });
    });

    it("returns 'selection-required' with grouped windows when multiple windows open the same workspace", async () => {
      const multiWindowSnapshots: WorkspaceRegistrySnapshot[] = [
        {
          schemaVersion: 2,
          instanceId: windowA,
          processId: 1001,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
        {
          schemaVersion: 2,
          instanceId: windowB,
          processId: 1002,
          workspaceFile: null,
          focused: false,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
      ];

      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        registrySnapshots: multiWindowSnapshots,
      });

      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        expect(result.windows).toHaveLength(2);
        expect(result.candidates).toHaveLength(2);
        expect(result.windows.map((w) => w.windowInstanceId)).toEqual([windowA, windowB]);
        expect(result.candidates[0]?.selectionToken).toBeDefined();
        expect(result.candidates[1]?.selectionToken).toBeDefined();
      }
    });

    it("rebinds from live A to live B when explicit hint B is provided even if A is still fresh", async () => {
      const { artifactDir } = await createValidArtifactDir();
      await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      });

      // Both windowA and windowB have workspaceA open
      const snapshots: WorkspaceRegistrySnapshot[] = [
        {
          schemaVersion: 2,
          instanceId: windowA,
          processId: 1001,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
        {
          schemaVersion: 2,
          instanceId: windowB,
          processId: 1002,
          workspaceFile: null,
          focused: false,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
      ];

      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        artifactDirectory: artifactDir,
        connectionHint: { windowInstanceId: windowB },
        registrySnapshots: snapshots,
      });

      expect(result).toEqual({
        status: "matched",
        targetWindow: {
          windowInstanceId: windowB,
          workspaceRoot: workspaceA,
        },
        source: "hint",
      });
    });

    it("fails with WindowConnectionStaleError when hint B is stale without falling back to existing A", async () => {
      const { artifactDir } = await createValidArtifactDir();
      await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      });

      // Only windowA is open
      const snapshots: WorkspaceRegistrySnapshot[] = [
        {
          schemaVersion: 2,
          instanceId: windowA,
          processId: 1001,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
      ];

      await expect(
        resolveArtifactConnectionTarget({
          workspaceRoot: workspaceA,
          artifactDirectory: artifactDir,
          connectionHint: { windowInstanceId: windowB },
          registrySnapshots: snapshots,
        }),
      ).rejects.toThrow(WindowConnectionStaleError);
    });

    it("fails with WindowConnectionMismatchError when hint B does not have manifest workspace open", async () => {
      const { artifactDir } = await createValidArtifactDir();
      await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "create",
      });

      await expect(
        resolveArtifactConnectionTarget({
          workspaceRoot: workspaceA,
          artifactDirectory: artifactDir,
          connectionHint: { windowInstanceId: windowB },
          registrySnapshots: mockSnapshots(), // in mockSnapshots, windowB only has workspaceB
        }),
      ).rejects.toThrow(WindowConnectionMismatchError);
    });

    it("uses shared WORKSPACE_SELECTION_TTL_MS for candidate expiresAt in selection-required result", async () => {
      const multiWindowSnapshots: WorkspaceRegistrySnapshot[] = [
        {
          schemaVersion: 2,
          instanceId: windowA,
          processId: 1001,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
        {
          schemaVersion: 2,
          instanceId: windowB,
          processId: 1002,
          workspaceFile: null,
          focused: false,
          folders: [{ path: workspaceA, realPath: workspaceA }],
          activeFile: null,
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 45_000).toISOString(),
        },
      ];

      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: workspaceA,
        registrySnapshots: multiWindowSnapshots,
        now,
      });

      expect(result.status).toBe("selection-required");
      if (result.status === "selection-required") {
        const expectedExpiresAt = new Date(now + WORKSPACE_SELECTION_TTL_MS).toISOString();
        expect(result.candidates[0]?.expiresAt).toBe(expectedExpiresAt);
        expect(result.candidates[1]?.expiresAt).toBe(expectedExpiresAt);
      }
    });

    it("returns 'not-found' when no active window has the workspace open", async () => {
      const unknownWorkspace = path.join(userHome, "unknown-project");
      const result = await resolveArtifactConnectionTarget({
        workspaceRoot: unknownWorkspace,
        registrySnapshots: mockSnapshots(),
      });

      expect(result).toEqual({
        status: "not-found",
        workspaceRoot: unknownWorkspace,
        message: "No active VS Code window was found for this workspace.",
      });
    });
  });

  describe("boundary protection and parent validation", () => {
    it("rejects commitArtifactConnectionRequest on path outside global collection root", async () => {
      const outsideDir = path.join(userHome, "outside-folder");
      await fs.mkdir(outsideDir, { recursive: true });

      await expect(commitArtifactConnectionRequest(outsideDir, {
        windowInstanceId: windowA,
        source: "create",
      })).rejects.toThrow();
    });

    it("rejects readArtifactConnection with ARTIFACT_CONNECTION_INVALID on malformed file", async () => {
      const { artifactDir } = await createValidArtifactDir();
      await fs.writeFile(path.join(artifactDir, ARTIFACT_CONNECTION_FILE), "not-json\n", "utf8");

      await expect(readArtifactConnection(artifactDir, { boundedRetry: false }))
        .rejects.toThrow(ArtifactConnectionInvalidError);
    });

    it("validateArtifactConnectionParent rejects missing, malformed, unsupported schema or mismatched manifest", async () => {
      const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
      const badDir = path.join(collectionRoot, "artifact-bad");
      await fs.mkdir(badDir, { recursive: true });

      // 1. Missing manifest
      await expect(validateArtifactConnectionParent(badDir)).rejects.toThrow(ArtifactConnectionInvalidError);

      // 2. Malformed JSON manifest
      const manifestPath = path.join(badDir, ARTIFACT_MANIFEST_FILE);
      await fs.writeFile(manifestPath, "bad json", "utf8");
      await expect(validateArtifactConnectionParent(badDir)).rejects.toThrow(ArtifactConnectionInvalidError);

      // 3. Unsupported schemaVersion
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: 4,
        artifactId: "artifact-bad",
        title: "Bad",
        kind: "plan",
        reviewRound: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        location: { workspaceRoot: userHome },
        reviewSessionId: randomUUID(),
      }), "utf8");
      await expect(validateArtifactConnectionParent(badDir)).rejects.toThrow(ArtifactConnectionInvalidError);

      // 4. Artifact ID mismatch
      await fs.writeFile(manifestPath, JSON.stringify({
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        artifactId: "different-id",
        title: "Mismatch",
        kind: "plan",
        reviewRound: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        location: { workspaceRoot: userHome },
        reviewSessionId: randomUUID(),
      }), "utf8");
      await expect(validateArtifactConnectionParent(badDir)).rejects.toThrow(ArtifactConnectionInvalidError);
    });

    it("retries transient manifest absence and malformed reads before validating the parent", async () => {
      const { artifactDir } = await createValidArtifactDir();
      const readFileSpy = vi.spyOn(fs, "readFile")
        .mockRejectedValueOnce(Object.assign(new Error("manifest temporarily missing"), { code: "ENOENT" }))
        .mockResolvedValueOnce("{ incomplete json");

      await expect(validateArtifactConnectionParent(artifactDir)).resolves.toMatchObject({
        artifactId,
        artifactDirectory: artifactDir,
        workspaceRoot: path.join(userHome, "project-a"),
      });
      expect(readFileSpy).toHaveBeenCalledTimes(3);
    });

    it("allows loading and reconnecting connection-less v5 artifact", async () => {
      const { artifactDir } = await createValidArtifactDir();
      // No artifact-connection.json exists yet
      const read = await readArtifactConnection(artifactDir, { allowMissing: true });
      expect(read).toBeNull();

      // Commit should successfully create connection revision 1
      const created = await commitArtifactConnectionRequest(artifactDir, {
        windowInstanceId: windowA,
        source: "inspect",
      });
      expect(created.connectionRevision).toBe(1);
    });

    describe("readArtifactConnectionRoute safe routing read", () => {
      it("reads valid connection file even when artifact manifest is absent or invalid", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const connection = await commitArtifactConnectionRequest(artifactDir, {
          windowInstanceId: windowA,
          source: "create",
        });

        // Corrupt artifact.json manifest completely
        await fs.writeFile(path.join(artifactDir, ARTIFACT_MANIFEST_FILE), "{ corrupted json", "utf8");

        // readArtifactConnection fails because of manifest validation
        await expect(readArtifactConnection(artifactDir)).rejects.toThrow(ArtifactConnectionInvalidError);

        // readArtifactConnectionRoute succeeds without manifest validation
        const route = await readArtifactConnectionRoute(artifactDir);
        expect(route).toEqual(connection);
      });

      it("returns null when connection file is missing and allowMissing is true", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const route = await readArtifactConnectionRoute(artifactDir, { allowMissing: true });
        expect(route).toBeNull();
      });

      it("rejects an artifact directory outside the canonical collection root", async () => {
        const outsideDir = path.join(userHome, "outside-collection", "artifact-001");
        await fs.mkdir(outsideDir, { recursive: true });
        await expect(readArtifactConnectionRoute(outsideDir)).rejects.toThrow("collection root");
      });

      it("rejects a symlinked directory or symlinked connection file", async () => {
        const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
        const realDir = path.join(userHome, "real-artifact-001");
        await fs.mkdir(realDir, { recursive: true });
        const linkDir = path.join(collectionRoot, "symlink-artifact-001");
        await createDirectoryLink(realDir, linkDir);

        await expect(readArtifactConnectionRoute(linkDir)).rejects.toThrow("symbolic links");

        const { artifactDir } = await createValidArtifactDir();
        const outsideTarget = path.join(userHome, "outside-conn.json");
        await fs.writeFile(outsideTarget, "{}", "utf8");
        const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
        await fs.unlink(connPath).catch(() => {});
        await createDirectoryLink(outsideTarget, connPath);

        await expect(readArtifactConnectionRoute(artifactDir)).rejects.toThrow();
      });

      it("recovers transient empty read through bounded retry", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const connection = await commitArtifactConnectionRequest(artifactDir, {
          windowInstanceId: windowA,
          source: "create",
        });

        const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
        const originalContent = await fs.readFile(connPath, "utf8");

        const readFileSpy = vi.spyOn(fs, "readFile")
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce(originalContent);

        const route = await readArtifactConnectionRoute(artifactDir, { boundedRetry: true });
        expect(route).toEqual(connection);
        expect(readFileSpy).toHaveBeenCalledTimes(2);
      });

      it("P1.2: recovers from transient ENOENT on readFile through bounded retry", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const connection = await commitArtifactConnectionRequest(artifactDir, {
          windowInstanceId: windowA,
          source: "create",
        });

        const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
        const originalContent = await fs.readFile(connPath, "utf8");

        const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        const readFileSpy = vi.spyOn(fs, "readFile")
          .mockRejectedValueOnce(enoent)
          .mockResolvedValueOnce(originalContent);

        const route = await readArtifactConnectionRoute(artifactDir, { boundedRetry: true });
        expect(route).toEqual(connection);
        expect(readFileSpy).toHaveBeenCalledTimes(2);
      });

      it("P1.2: returns null after exhausting bounded retry when ENOENT persists and allowMissing is true", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(enoent);

        const route = await readArtifactConnectionRoute(artifactDir, { allowMissing: true, boundedRetry: true });
        expect(route).toBeNull();
        expect(readFileSpy).toHaveBeenCalledTimes(5);
      });

      it("P1.2: throws ENOENT after exhausting bounded retry when allowMissing is false", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(enoent);

        await expect(readArtifactConnectionRoute(artifactDir, { allowMissing: false, boundedRetry: true }))
          .rejects.toThrow("ENOENT");
        expect(readFileSpy).toHaveBeenCalledTimes(5);
      });

      it("P1.2: boundedRetry: false performs only a single attempt without retry", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
        const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(enoent);

        const route = await readArtifactConnectionRoute(artifactDir, { allowMissing: true, boundedRetry: false });
        expect(route).toBeNull();
        expect(readFileSpy).toHaveBeenCalledTimes(1);
      });

      it("P1.2: recovers from transient ENOENT on artifact directory lstat through bounded retry", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const connection = await commitArtifactConnectionRequest(artifactDir, {
          windowInstanceId: windowA,
          source: "create",
        });

        let lstatAttempt = 0;
        const originalLstat = fs.lstat.bind(fs);
        const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });

        vi.spyOn(fs, "lstat").mockImplementation(async (targetPath, options) => {
          if (sameFilesystemPath(String(targetPath), artifactDir)) {
            lstatAttempt++;
            if (lstatAttempt === 1) {
              throw enoent;
            }
          }
          return originalLstat(targetPath, options);
        });

        const route = await readArtifactConnectionRoute(artifactDir, { boundedRetry: true });
        expect(route).toEqual(connection);
        expect(lstatAttempt).toBe(2);
      });

      it("P2.3: rejects when artifact directory is replaced with a symlink between retry attempts", async () => {
        const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
        const artifactId = "retry-symlink-artifact";
        const realDir = path.join(collectionRoot, artifactId);
        await fs.mkdir(realDir, { recursive: true });

        const outsideDir = path.join(userHome, "outside-replacement");
        await fs.mkdir(outsideDir, { recursive: true });
        const sentinelPath = path.join(outsideDir, "sentinel.txt");
        await fs.writeFile(sentinelPath, "sentinel-untouched", "utf8");

        const connPath = path.join(realDir, ARTIFACT_CONNECTION_FILE);
        await fs.writeFile(connPath, "", "utf8");

        let attemptCount = 0;
        const originalReadFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
          if (String(filePath).endsWith(ARTIFACT_CONNECTION_FILE)) {
            attemptCount++;
            if (attemptCount === 1) {
              await fs.rm(realDir, { recursive: true, force: true });
              await createDirectoryLink(outsideDir, realDir);
              return "";
            }
          }
          return originalReadFile(filePath, options);
        });

        await expect(readArtifactConnectionRoute(realDir, { boundedRetry: true }))
          .rejects.toThrow("symbolic links");

        expect(await fs.readFile(sentinelPath, "utf8")).toBe("sentinel-untouched");
      });

      it("P2.3: rejects when connection file is replaced with a symlink between retry attempts", async () => {
        const { artifactDir } = await createValidArtifactDir();
        const connPath = path.join(artifactDir, ARTIFACT_CONNECTION_FILE);
        await fs.writeFile(connPath, "", "utf8");

        const outsideTarget = path.join(userHome, "outside-conn.json");
        await fs.writeFile(outsideTarget, JSON.stringify({
          schemaVersion: 1,
          windowInstanceId: windowA,
          connectionRevision: 1,
          openRequestId: randomUUID(),
          updatedAt: new Date().toISOString(),
          source: "create",
        }), "utf8");

        let attemptCount = 0;
        const originalReadFile = fs.readFile.bind(fs);
        vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
          if (String(filePath).endsWith(ARTIFACT_CONNECTION_FILE)) {
            attemptCount++;
            if (attemptCount === 1) {
              await fs.unlink(connPath);
              await createDirectoryLink(outsideTarget, connPath);
              return "";
            }
          }
          return originalReadFile(filePath, options);
        });

        await expect(readArtifactConnectionRoute(artifactDir, { boundedRetry: true }))
          .rejects.toThrow();
      });
    });
  });
});
