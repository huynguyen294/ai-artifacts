import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_COLLECTION_DIRECTORY,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  COMMENTS_FILE,
  MANAGED_ASSETS_DIRECTORY,
  MANAGED_MCP_SCRIPT_FILE,
  MANAGED_RUNTIME_DIRECTORY,
  MANAGED_WORKSPACES_DIRECTORY,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  REVIEW_SUBMISSION_FILE,
  aiArtifactsRoot,
  artifactCollectionRoot,
  globalArtifactsRoot,
  managedAssetsRoot,
  managedMcpScriptPath,
  managedRuntimeDirectory,
  managedWorkspaceRegistryDirectory,
} from "../src/shared/artifact-files";
import {
  assertGlobalArtifactDirectory,
  assertManagedArtifactFilePath,
  ensureSafeGlobalArtifactDirectory,
  ensureSafeGlobalArtifactsRoot,
  ensureSafeManagedArtifactFile,
} from "../src/shared/artifact-validation";

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

beforeEach(async () => {
  userHome = await makeTemporaryDirectory("agent-plus-global-home-");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("global artifact path foundation", () => {
  it("resolves the global collection root from an explicit absolute home", () => {
    expect(globalArtifactsRoot({ userHome })).toBe(
      path.join(userHome, ARTIFACTS_DIRECTORY, ARTIFACT_COLLECTION_DIRECTORY),
    );
    expect(() => globalArtifactsRoot({ userHome: "relative-home" })).toThrow("must be an absolute path");
  });

  it("resolves canonical product root and managed asset paths", () => {
    const root = aiArtifactsRoot({ userHome });
    const collection = artifactCollectionRoot({ userHome });
    const managed = managedAssetsRoot({ userHome });
    const runtime = managedRuntimeDirectory({ userHome });
    const mcpScript = managedMcpScriptPath({ userHome });
    const workspaces = managedWorkspaceRegistryDirectory({ userHome });

    expect(root).toBe(path.join(userHome, ARTIFACTS_DIRECTORY));
    expect(collection).toBe(path.join(root, ARTIFACT_COLLECTION_DIRECTORY));
    expect(managed).toBe(path.join(root, MANAGED_ASSETS_DIRECTORY));
    expect(runtime).toBe(path.join(managed, MANAGED_RUNTIME_DIRECTORY));
    expect(mcpScript).toBe(path.join(runtime, MANAGED_MCP_SCRIPT_FILE));
    expect(workspaces).toBe(path.join(managed, MANAGED_WORKSPACES_DIRECTORY));

    // Artifacts collection and managed assets are siblings, never nested
    expect(path.dirname(collection)).toBe(root);
    expect(path.dirname(managed)).toBe(root);
    expect(collection).not.toBe(managed);

    // Relative user home rejection
    expect(() => aiArtifactsRoot({ userHome: "relative" })).toThrow("must be an absolute path");
    expect(() => managedAssetsRoot({ userHome: "relative" })).toThrow("must be an absolute path");
    expect(() => managedRuntimeDirectory({ userHome: "relative" })).toThrow("must be an absolute path");
    expect(() => managedMcpScriptPath({ userHome: "relative" })).toThrow("must be an absolute path");
    expect(() => managedWorkspaceRegistryDirectory({ userHome: "relative" })).toThrow("must be an absolute path");
  });

  it("uses the explicit test seam without reading the real user home", () => {
    vi.spyOn(os, "homedir").mockImplementation(() => {
      throw new Error("real home must not be read");
    });
    expect(globalArtifactsRoot({ userHome })).toContain(userHome);
    expect(aiArtifactsRoot({ userHome })).toContain(userHome);
    expect(managedAssetsRoot({ userHome })).toContain(userHome);
  });

  it("uses os.homedir for the production resolver without touching that home in tests", () => {
    vi.spyOn(os, "homedir").mockReturnValue(userHome);
    expect(globalArtifactsRoot()).toBe(
      path.join(userHome, ARTIFACTS_DIRECTORY, ARTIFACT_COLLECTION_DIRECTORY),
    );
    expect(aiArtifactsRoot()).toBe(path.join(userHome, ARTIFACTS_DIRECTORY));
    expect(managedAssetsRoot()).toBe(path.join(userHome, ARTIFACTS_DIRECTORY, MANAGED_ASSETS_DIRECTORY));
  });

  it("creates and canonicalizes a missing owner-only collection root", async () => {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    expect(collectionRoot).toBe(await fs.realpath(globalArtifactsRoot({ userHome })));
    expect((await fs.lstat(collectionRoot)).isDirectory()).toBe(true);

    if (process.platform !== "win32") {
      expect((await fs.stat(path.dirname(collectionRoot))).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
      expect((await fs.stat(collectionRoot)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
    }
  });

  it.skipIf(process.platform === "win32")("tightens broad existing directory permissions on POSIX", async () => {
    const artifactsRoot = path.join(userHome, ARTIFACTS_DIRECTORY);
    const collectionRoot = globalArtifactsRoot({ userHome });
    await fs.mkdir(collectionRoot, { recursive: true, mode: 0o777 });
    await fs.chmod(artifactsRoot, 0o777);
    await fs.chmod(collectionRoot, 0o777);

    await ensureSafeGlobalArtifactsRoot({ userHome });

    expect((await fs.stat(artifactsRoot)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
    expect((await fs.stat(collectionRoot)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
  });

  it.each(["artifact-root", "collection-root"])("rejects a linked %s", async (linkedSegment) => {
    const outside = await makeTemporaryDirectory("agent-plus-global-outside-");
    if (linkedSegment === "artifact-root") {
      await createDirectoryLink(outside, path.join(userHome, ARTIFACTS_DIRECTORY));
    } else {
      const artifactsRoot = path.join(userHome, ARTIFACTS_DIRECTORY);
      await fs.mkdir(artifactsRoot);
      await createDirectoryLink(outside, path.join(artifactsRoot, ARTIFACT_COLLECTION_DIRECTORY));
    }

    await expect(ensureSafeGlobalArtifactsRoot({ userHome })).rejects.toThrow("symbolic links and junctions");
  });

  it("accepts only an absolute direct child whose basename matches the artifact id", () => {
    const collectionRoot = globalArtifactsRoot({ userHome });
    const valid = path.join(collectionRoot, "artifact-001");
    expect(assertGlobalArtifactDirectory("artifact-001", valid, { userHome })).toBe(valid);

    expect(() => assertGlobalArtifactDirectory("artifact-001", "artifact-001", { userHome }))
      .toThrow("must be an absolute path");
    expect(() => assertGlobalArtifactDirectory(
      "artifact-001",
      path.join(collectionRoot, "nested", "artifact-001"),
      { userHome },
    )).toThrow("direct child");
    expect(() => assertGlobalArtifactDirectory(
      "artifact-001",
      path.join(userHome, "outside", "artifact-001"),
      { userHome },
    )).toThrow("direct child");
    expect(() => assertGlobalArtifactDirectory(
      "artifact-001",
      path.join(`${collectionRoot}-evil`, "artifact-001"),
      { userHome },
    )).toThrow("direct child");
    expect(() => assertGlobalArtifactDirectory("artifact-001", path.join(collectionRoot, "artifact-002"), { userHome }))
      .toThrow("does not match");
    expect(() => assertGlobalArtifactDirectory("../escape", valid, { userHome })).toThrow();
  });

  it("uses the host OS path-case semantics while keeping artifact ids exact", () => {
    const differentlyCasedRoot = globalArtifactsRoot({ userHome }).toUpperCase();
    const candidate = path.join(differentlyCasedRoot, "artifact-001");
    if (process.platform === "win32") {
      expect(assertGlobalArtifactDirectory("artifact-001", candidate, { userHome })).toBe(path.resolve(candidate));
    } else {
      expect(() => assertGlobalArtifactDirectory("artifact-001", candidate, { userHome })).toThrow("direct child");
    }
    const exactRootCandidate = path.join(globalArtifactsRoot({ userHome }), "artifact-001");
    expect(() => assertGlobalArtifactDirectory("ARTIFACT-001", exactRootCandidate, { userHome }))
      .toThrow("does not match");
  });

  it("canonicalizes an existing artifact directory and tightens its POSIX mode", async () => {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const artifactDirectory = path.join(collectionRoot, "artifact-001");
    await fs.mkdir(artifactDirectory, { mode: 0o777 });
    if (process.platform !== "win32") await fs.chmod(artifactDirectory, 0o777);

    expect(await ensureSafeGlobalArtifactDirectory("artifact-001", artifactDirectory, { userHome }))
      .toBe(await fs.realpath(artifactDirectory));
    if (process.platform !== "win32") {
      expect((await fs.stat(artifactDirectory)).mode & 0o777).toBe(OWNER_ONLY_DIRECTORY_MODE);
    }
  });

  it("rejects an artifact directory replaced by a link after lexical validation", async () => {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const artifactDirectory = path.join(collectionRoot, "artifact-001");
    assertGlobalArtifactDirectory("artifact-001", artifactDirectory, { userHome });
    const outside = await makeTemporaryDirectory("agent-plus-global-artifact-outside-");
    await createDirectoryLink(outside, artifactDirectory);

    await expect(ensureSafeGlobalArtifactDirectory("artifact-001", artifactDirectory, { userHome }))
      .rejects.toThrow("symbolic links and junctions");
  });

  it("accepts lifecycle, lock, staging, and backup files only as direct children", () => {
    const artifactDirectory = path.join(globalArtifactsRoot({ userHome }), "artifact-001");
    const acceptedNames = [
      ARTIFACT_MANIFEST_FILE,
      ARTIFACT_MARKDOWN_FILE,
      COMMENTS_FILE,
      REVIEW_SUBMISSION_FILE,
      ARTIFACT_UPDATE_LOCK_FILE,
      `${ARTIFACT_MANIFEST_FILE}.tmp-123`,
      `${ARTIFACT_MARKDOWN_FILE}.next-transaction-1`,
      `${COMMENTS_FILE}.previous-transaction-1`,
    ];
    for (const fileName of acceptedNames) {
      const filePath = path.join(artifactDirectory, fileName);
      expect(assertManagedArtifactFilePath(artifactDirectory, filePath)).toBe(filePath);
    }

    expect(() => assertManagedArtifactFilePath(artifactDirectory, path.join(artifactDirectory, "other.json")))
      .toThrow("not a recognized");
    expect(() => assertManagedArtifactFilePath(
      artifactDirectory,
      path.join(artifactDirectory, `${ARTIFACT_MANIFEST_FILE}.evil.next-1`),
    )).toThrow("not a recognized");
    expect(() => assertManagedArtifactFilePath(
      artifactDirectory,
      path.join(artifactDirectory, `${ARTIFACT_MANIFEST_FILE}.tmp-`),
    )).toThrow("not a recognized");
    expect(() => assertManagedArtifactFilePath(
      artifactDirectory,
      path.join(artifactDirectory, "nested", ARTIFACT_MANIFEST_FILE),
    )).toThrow("direct children");
    expect(() => assertManagedArtifactFilePath(
      artifactDirectory,
      path.join(`${artifactDirectory}-evil`, ARTIFACT_MANIFEST_FILE),
    ))
      .toThrow();
  });

  it.each([
    ARTIFACT_MANIFEST_FILE,
    ARTIFACT_MARKDOWN_FILE,
    COMMENTS_FILE,
    REVIEW_SUBMISSION_FILE,
    ARTIFACT_UPDATE_LOCK_FILE,
    `${REVIEW_SUBMISSION_FILE}.tmp-process-1`,
    `${ARTIFACT_MARKDOWN_FILE}.next-transaction-1`,
    `${COMMENTS_FILE}.previous-transaction-1`,
  ])("rejects a linked managed target before access: %s", async (fileName) => {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const artifactDirectory = path.join(collectionRoot, "artifact-001");
    await fs.mkdir(artifactDirectory);
    const outside = await makeTemporaryDirectory("agent-plus-global-file-outside-");
    const filePath = path.join(artifactDirectory, fileName);
    await createDirectoryLink(outside, filePath);

    await expect(ensureSafeManagedArtifactFile(artifactDirectory, filePath)).rejects.toThrow("symbolic links");
  });

  it("tightens broad managed-file permissions and permits an explicitly missing transaction target", async () => {
    const collectionRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const artifactDirectory = path.join(collectionRoot, "artifact-001");
    await fs.mkdir(artifactDirectory);
    const manifestPath = path.join(artifactDirectory, ARTIFACT_MANIFEST_FILE);
    await fs.writeFile(manifestPath, "{}", { mode: 0o666 });
    if (process.platform !== "win32") await fs.chmod(manifestPath, 0o666);

    expect(await ensureSafeManagedArtifactFile(artifactDirectory, manifestPath)).toBe(manifestPath);
    if (process.platform !== "win32") {
      expect((await fs.stat(manifestPath)).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
    }

    const missingStagingPath = path.join(artifactDirectory, `${ARTIFACT_MANIFEST_FILE}.next-new`);
    expect(await ensureSafeManagedArtifactFile(artifactDirectory, missingStagingPath, { allowMissing: true }))
      .toBe(missingStagingPath);
    await expect(fs.access(missingStagingPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps independently injected homes isolated", async () => {
    const secondHome = await makeTemporaryDirectory("agent-plus-global-home-second-");
    const firstRoot = await ensureSafeGlobalArtifactsRoot({ userHome });
    const secondRoot = await ensureSafeGlobalArtifactsRoot({ userHome: secondHome });
    expect(firstRoot).not.toBe(secondRoot);
    expect(firstRoot.startsWith(userHome)).toBe(true);
    expect(secondRoot.startsWith(secondHome)).toBe(true);
  });
});
