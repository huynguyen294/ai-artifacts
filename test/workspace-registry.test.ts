import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalWorkspaceFolder,
  publishWorkspaceSnapshot,
  readFreshWorkspaceSnapshots,
  removeWorkspaceSnapshot,
  resolveRegisteredWorkspaceRoot,
  resolveWorkspaceRootForArtifactCreation,
  workspaceEvidenceSchema,
} from "../src/shared/workspace-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("workspace registry", () => {
  it("publishes atomically and resolves only an exact canonical workspace folder", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspace = path.join(root, "workspace");
    const nested = path.join(workspace, "nested");
    await mkdir(nested, { recursive: true });
    const instanceId = randomUUID();
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [await canonicalWorkspaceFolder(workspace)],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, registry);

    expect(await resolveRegisteredWorkspaceRoot(workspace, registry, now)).toBe(await realpath(workspace));
    await expect(resolveRegisteredWorkspaceRoot(nested, registry, now)).rejects.toThrow("WORKSPACE_NOT_REGISTERED");
    expect(await readFreshWorkspaceSnapshots(registry, now)).toHaveLength(1);

    await removeWorkspaceSnapshot(instanceId, registry);
    expect(await readFreshWorkspaceSnapshots(registry, now)).toEqual([]);
  });

  it("ignores expired and malformed snapshots", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspace = path.join(root, "workspace");
    await mkdir(workspace, { recursive: true });
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId: randomUUID(),
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [await canonicalWorkspaceFolder(workspace)],
      activeFile: null,
      updatedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now - 1).toISOString(),
    }, registry);

    expect(await readFreshWorkspaceSnapshots(registry, now)).toEqual([]);
    await expect(resolveRegisteredWorkspaceRoot(workspace, registry, now)).rejects.toThrow("WORKSPACE_NOT_REGISTERED");
  });

  it("merges fresh workspace folders published by multiple VS Code windows", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspaces = [path.join(root, "workspace-a"), path.join(root, "workspace-b")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    const now = Date.now();
    for (const workspace of workspaces) {
      const instanceId = randomUUID();
      await publishWorkspaceSnapshot({
        schemaVersion: 2,
        instanceId,
        processId: process.pid,
        workspaceFile: null,
        focused: false,
        folders: [await canonicalWorkspaceFolder(workspace)],
        activeFile: null,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      }, registry);
    }

    expect(await readFreshWorkspaceSnapshots(registry, now)).toHaveLength(2);
    await expect(resolveRegisteredWorkspaceRoot(workspaces[0]!, registry, now)).resolves.toBe(await realpath(workspaces[0]!));
    await expect(resolveRegisteredWorkspaceRoot(workspaces[1]!, registry, now)).resolves.toBe(await realpath(workspaces[1]!));
  });

  it("scopes create evidence to the focused VS Code window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspaces = [path.join(root, "focused-root"), path.join(root, "other-window-root")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    const now = Date.now();
    for (let index = 0; index < workspaces.length; index += 1) {
      await publishWorkspaceSnapshot({
        schemaVersion: 2,
        instanceId: randomUUID(),
        processId: process.pid,
        workspaceFile: null,
        focused: index === 0,
        folders: [await canonicalWorkspaceFolder(workspaces[index]!)],
        activeFile: null,
        updatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60_000).toISOString(),
      }, registry);
    }

    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[0]!,
      { kind: "single-workspace" },
      registry,
      now,
    )).resolves.toBe(await realpath(workspaces[0]!));
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "explicit-user-folder", userText: "other-window-root" },
      registry,
      now,
    )).rejects.toThrow("focused VS Code window");
  });

  it.skipIf(process.platform !== "win32")("matches registered Windows roots case-insensitively", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId: randomUUID(),
      processId: process.pid,
      workspaceFile: null,
      focused: false,
      folders: [await canonicalWorkspaceFolder(workspace)],
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, registry);

    await expect(resolveRegisteredWorkspaceRoot(workspace.toUpperCase(), registry, now)).resolves.toBe(await realpath(workspace));
  });

  it("fails closed for single-workspace evidence when multiple roots are registered", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspaces = [path.join(root, "agent-plus"), path.join(root, "script-runner")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId: randomUUID(),
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders: await Promise.all(workspaces.map(canonicalWorkspaceFolder)),
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, registry);

    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "single-workspace" },
      registry,
      now,
    )).rejects.toThrow("AMBIGUOUS_WORKSPACE");
  });

  it("accepts only an active file published by the focused VS Code window", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspaces = [path.join(root, "agent-plus"), path.join(root, "script-runner")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    const activeFile = path.join(workspaces[1]!, "package.json");
    await writeFile(activeFile, "{}\n", "utf8");
    const folders = await Promise.all(workspaces.map(canonicalWorkspaceFolder));
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId: randomUUID(),
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders,
      activeFile: { path: activeFile, workspaceRoot: folders[1]!.realPath },
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, registry);

    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "active-file", filePath: activeFile },
      registry,
      now,
    )).resolves.toBe(folders[1]!.realPath);
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[0]!,
      { kind: "active-file", filePath: activeFile },
      registry,
      now,
    )).rejects.toThrow("WORKSPACE_EVIDENCE_MISMATCH");
  });

  it("accepts explicit user evidence but rejects project-marker inference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
    temporaryDirectories.push(root);
    const registry = path.join(root, "registry");
    const workspaces = [path.join(root, "agent-plus"), path.join(root, "script-runner")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    const marker = path.join(workspaces[1]!, "package.json");
    await writeFile(marker, "{}\n", "utf8");
    const now = Date.now();
    await publishWorkspaceSnapshot({
      schemaVersion: 2,
      instanceId: randomUUID(),
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders: await Promise.all(workspaces.map(canonicalWorkspaceFolder)),
      activeFile: null,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, registry);

    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "explicit-user-folder", userText: "Hãy tạo plan trong script-runner" },
      registry,
      now,
    )).resolves.toBe(await realpath(workspaces[1]!));
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "explicit-user-path", path: marker, userText: "Hãy dùng @package.json này" },
      registry,
      now,
    )).resolves.toBe(await realpath(workspaces[1]!));
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "explicit-user-path", path: marker, userText: "Hãy tạo một example plan" },
      registry,
      now,
    )).rejects.toThrow("does not mention the supplied path");
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspaces[1]!,
      { kind: "explicit-user-folder", userText: "Hãy tạo một example plan" },
      registry,
      now,
    )).rejects.toThrow("WORKSPACE_EVIDENCE_MISMATCH");
    expect(workspaceEvidenceSchema.safeParse({ kind: "project-marker", path: marker }).success).toBe(false);
  });
});
