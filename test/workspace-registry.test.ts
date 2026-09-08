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
  resolveWorkspaceCandidates,
  resolveWorkspaceRootForArtifactCreation,
  workspaceEvidenceSchema,
} from "../src/shared/workspace-registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function rootFixture(): Promise<{ root: string; registry: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "codex-artifacts-registry-"));
  temporaryDirectories.push(root);
  const registry = path.join(root, "registry");
  await mkdir(registry);
  return { root, registry };
}

async function publish(
  registry: string,
  folders: string[],
  options: { focused?: boolean; expiresAt?: number; activeFile?: { path: string; workspaceRoot: string } | null } = {},
): Promise<string> {
  const now = Date.now();
  const instanceId = randomUUID();
  await publishWorkspaceSnapshot({
    schemaVersion: 2,
    instanceId,
    processId: process.pid,
    workspaceFile: null,
    focused: options.focused ?? false,
    folders: await Promise.all(folders.map(canonicalWorkspaceFolder)),
    activeFile: options.activeFile ?? null,
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(options.expiresAt ?? now + 60_000).toISOString(),
  }, registry);
  return instanceId;
}

describe("workspace registry", () => {
  it("publishes atomically and resolves only an exact canonical workspace folder", async () => {
    const fixture = await rootFixture();
    const workspace = path.join(fixture.root, "workspace");
    const nested = path.join(workspace, "nested");
    await mkdir(nested, { recursive: true });
    const instanceId = await publish(fixture.registry, [workspace]);

    expect(await resolveRegisteredWorkspaceRoot(workspace, fixture.registry)).toBe(await realpath(workspace));
    await expect(resolveRegisteredWorkspaceRoot(nested, fixture.registry)).rejects.toThrow("WORKSPACE_NOT_REGISTERED");
    expect(await readFreshWorkspaceSnapshots(fixture.registry)).toHaveLength(1);

    await removeWorkspaceSnapshot(instanceId, fixture.registry);
    expect(await readFreshWorkspaceSnapshots(fixture.registry)).toEqual([]);
  });

  it("ignores expired and malformed snapshots", async () => {
    const fixture = await rootFixture();
    const workspace = path.join(fixture.root, "workspace");
    await mkdir(workspace);
    await publish(fixture.registry, [workspace], { expiresAt: Date.now() - 1_000 });
    await writeFile(path.join(fixture.registry, "malformed.json"), "not-json", "utf8");

    expect(await readFreshWorkspaceSnapshots(fixture.registry)).toEqual([]);
    await expect(resolveRegisteredWorkspaceRoot(workspace, fixture.registry)).rejects.toThrow("WORKSPACE_NOT_REGISTERED");
  });

  it("merges fresh workspace folders published by multiple VS Code windows", async () => {
    const fixture = await rootFixture();
    const workspaces = [path.join(fixture.root, "workspace-a"), path.join(fixture.root, "workspace-b")];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    for (const workspace of workspaces) await publish(fixture.registry, [workspace]);

    expect(await readFreshWorkspaceSnapshots(fixture.registry)).toHaveLength(2);
    await expect(resolveRegisteredWorkspaceRoot(workspaces[0]!, fixture.registry)).resolves.toBe(await realpath(workspaces[0]!));
    await expect(resolveRegisteredWorkspaceRoot(workspaces[1]!, fixture.registry)).resolves.toBe(await realpath(workspaces[1]!));
  });

  it("scopes resolver candidates and creation evidence to the focused VS Code window", async () => {
    const fixture = await rootFixture();
    const focusedRoot = path.join(fixture.root, "focused-root");
    const otherRoot = path.join(fixture.root, "other-window-root");
    await Promise.all([mkdir(focusedRoot), mkdir(otherRoot)]);
    const focusedFile = path.join(focusedRoot, "AGENTS.md");
    const otherFile = path.join(otherRoot, "AGENTS.md");
    await Promise.all([writeFile(focusedFile, "# focused\n"), writeFile(otherFile, "# other\n")]);
    await publish(fixture.registry, [focusedRoot], { focused: true });
    await publish(fixture.registry, [otherRoot], { focused: false });

    const focused = await resolveWorkspaceCandidates("focused-root", fixture.registry);
    expect(focused.candidates).toEqual([{
      name: "focused-root",
      path: await realpath(focusedRoot),
      match: "exact-name",
    }]);
    expect(focused.matchMode).toBe("matched");
    const fallback = await resolveWorkspaceCandidates("other-window-root", fixture.registry);
    expect(fallback.matchMode).toBe("all-available");
    expect(fallback.candidates).toEqual([{
      name: "focused-root",
      path: await realpath(focusedRoot),
      match: "available",
    }]);
    await expect(resolveWorkspaceRootForArtifactCreation(
      focusedRoot,
      { kind: "tagged-file", filePath: focusedFile },
      fixture.registry,
    )).resolves.toBe(await realpath(focusedRoot));
    await expect(resolveWorkspaceRootForArtifactCreation(
      otherRoot,
      { kind: "tagged-file", filePath: otherFile },
      fixture.registry,
    )).rejects.toThrow("focused VS Code window");
  });

  it("orders exact path and exact name before similar matches", async () => {
    const fixture = await rootFixture();
    const workspaces = [
      path.join(fixture.root, "agent-plus"),
      path.join(fixture.root, "agent-plus-docs"),
      path.join(fixture.root, "script-runner"),
    ];
    await Promise.all(workspaces.map((workspace) => mkdir(workspace)));
    await publish(fixture.registry, workspaces, { focused: true });

    const byName = await resolveWorkspaceCandidates("agent-plus", fixture.registry);
    expect(byName.matchMode).toBe("matched");
    expect(byName.candidates.map((candidate) => [candidate.name, candidate.match])).toEqual([
      ["agent-plus", "exact-name"],
      ["agent-plus-docs", "similar-name"],
    ]);
    const bySpacedName = await resolveWorkspaceCandidates("agent plus", fixture.registry);
    expect(bySpacedName.candidates.map((candidate) => [candidate.name, candidate.match])).toEqual([
      ["agent-plus", "exact-name"],
      ["agent-plus-docs", "similar-name"],
    ]);
    const byUnderscoredName = await resolveWorkspaceCandidates("agent_plus", fixture.registry);
    expect(byUnderscoredName.candidates[0]).toMatchObject({ name: "agent-plus", match: "exact-name" });
    const byPath = await resolveWorkspaceCandidates(workspaces[0]!, fixture.registry);
    expect(byPath.candidates[0]).toMatchObject({ path: await realpath(workspaces[0]!), match: "exact-path" });
    await expect(resolveWorkspaceCandidates("a", fixture.registry)).rejects.toThrow("WORKSPACE_QUERY_INVALID");
    const noMatch = await resolveWorkspaceCandidates("missing", fixture.registry);
    expect(noMatch.matchMode).toBe("all-available");
    expect(noMatch.candidates).toEqual([
      { name: "agent-plus", path: await realpath(workspaces[0]!), match: "available" },
      { name: "agent-plus-docs", path: await realpath(workspaces[1]!), match: "available" },
      { name: "script-runner", path: await realpath(workspaces[2]!), match: "available" },
    ]);
  });

  it("returns not-found semantics only when the fresh focused registry scope is empty", async () => {
    const fixture = await rootFixture();
    const resolution = await resolveWorkspaceCandidates("agent plus", fixture.registry);
    expect(resolution).toMatchObject({ matchMode: "none", candidates: [] });
  });

  it("accepts tagged files only when they are real files inside the selected root", async () => {
    const fixture = await rootFixture();
    const workspace = path.join(fixture.root, "agent-plus");
    const outside = path.join(fixture.root, "outside");
    await Promise.all([mkdir(workspace), mkdir(outside)]);
    const taggedFile = path.join(workspace, "AGENTS.md");
    const outsideFile = path.join(outside, "AGENTS.md");
    await Promise.all([writeFile(taggedFile, "# agent-plus\n"), writeFile(outsideFile, "# outside\n")]);
    await publish(fixture.registry, [workspace], { focused: true });

    await expect(resolveWorkspaceRootForArtifactCreation(
      workspace,
      { kind: "tagged-file", filePath: taggedFile },
      fixture.registry,
    )).resolves.toBe(await realpath(workspace));
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspace,
      { kind: "tagged-file", filePath: outsideFile },
      fixture.registry,
    )).rejects.toThrow("does not belong");
    await expect(resolveWorkspaceRootForArtifactCreation(
      workspace,
      { kind: "tagged-file", filePath: workspace },
      fixture.registry,
    )).rejects.toThrow("not a file");
  });

  it("exposes exactly the two writable creation evidence variants", () => {
    expect(workspaceEvidenceSchema.safeParse({ kind: "tagged-file", filePath: "C:\\repo\\AGENTS.md" }).success).toBe(true);
    expect(workspaceEvidenceSchema.safeParse({
      kind: "resolved-workspace",
      selectionToken: randomUUID(),
    }).success).toBe(true);
    for (const kind of ["user-selected-workspace", "single-workspace", "active-file", "explicit-user-path", "explicit-user-folder", "project-marker"]) {
      expect(workspaceEvidenceSchema.safeParse({ kind }).success).toBe(false);
    }
  });

  it.skipIf(process.platform !== "win32")("matches registered Windows roots case-insensitively", async () => {
    const fixture = await rootFixture();
    const workspace = path.join(fixture.root, "workspace");
    await mkdir(workspace);
    await publish(fixture.registry, [workspace]);
    await expect(resolveRegisteredWorkspaceRoot(workspace.toUpperCase(), fixture.registry)).resolves.toBe(await realpath(workspace));
  });
});
