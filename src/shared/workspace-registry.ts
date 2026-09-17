import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  GlobalArtifactsRootOptions,
  OWNER_ONLY_FILE_MODE,
  managedAssetsRoot,
  managedWorkspaceRegistryDirectory,
} from "./artifact-files";
import {
  enforceOwnerOnlyDirectory,
  enforceOwnerOnlyFile,
  sameFilesystemPath,
} from "./artifact-validation";

export const WORKSPACE_REGISTRY_SCHEMA_VERSION = 2 as const;
export const WORKSPACE_REGISTRY_HEARTBEAT_MS = 15_000;
export const WORKSPACE_REGISTRY_TTL_MS = 45_000;

export const workspaceRegistrySnapshotSchema = z.object({
  schemaVersion: z.literal(WORKSPACE_REGISTRY_SCHEMA_VERSION),
  instanceId: z.string().uuid(),
  processId: z.number().int().positive(),
  workspaceFile: z.string().nullable(),
  focused: z.boolean(),
  folders: z.array(z.object({
    path: z.string().min(1),
    realPath: z.string().min(1),
  }).strict()),
  activeFile: z.object({
    path: z.string().min(1),
    workspaceRoot: z.string().min(1),
  }).strict().nullable(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export type WorkspaceRegistrySnapshot = z.infer<typeof workspaceRegistrySnapshotSchema>;

export const workspaceEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tagged-file"),
    filePath: z.string().min(1),
  }).strict(),
  z.object({
    kind: z.literal("resolved-workspace"),
    selectionToken: z.string().uuid(),
  }).strict(),
]);

export type WorkspaceEvidence = z.infer<typeof workspaceEvidenceSchema>;

export const workspaceCandidateMatchSchema = z.enum([
  "exact-path",
  "exact-name",
  "similar-name",
  "single-folder",
  "available",
]);
export type WorkspaceCandidateMatch = z.infer<typeof workspaceCandidateMatchSchema>;

export const resolvedFolderCandidateSchema = z.object({
  candidateId: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  match: workspaceCandidateMatchSchema,
  selectionToken: z.string().uuid(),
  expiresAt: z.string().datetime(),
}).strict();
export type ResolvedFolderCandidate = z.infer<typeof resolvedFolderCandidateSchema>;

export const resolvedWindowGroupSchema = z.object({
  windowInstanceId: z.string().uuid(),
  focused: z.boolean(),
  snapshotUpdatedAt: z.string().datetime(),
  workspaceFile: z.string().nullable(),
  activeFile: z.object({
    path: z.string().min(1),
    workspaceRoot: z.string().min(1),
  }).strict().nullable(),
  folders: z.array(resolvedFolderCandidateSchema),
}).strict();
export type ResolvedWindowGroup = z.infer<typeof resolvedWindowGroupSchema>;

export const workspaceWindowSelectionGrantSchema = z.object({
  query: z.string(),
  candidateId: z.string().min(1),
  workspaceRoot: z.string().min(1),
  windowInstanceId: z.string().uuid(),
  snapshotIdentity: z.string().min(1),
  expiresAt: z.number().int().positive(),
}).strict();
export type WorkspaceWindowSelectionGrant = z.infer<typeof workspaceWindowSelectionGrantSchema>;

export function workspaceCandidateId(windowInstanceId: string, workspaceRoot: string): string {
  const canonical = path.resolve(workspaceRoot);
  const normalizedPath = process.platform === "win32" ? canonical.toLowerCase() : canonical;
  return createHash("sha256").update(`${windowInstanceId}:${normalizedPath}`).digest("hex").slice(0, 16);
}

export function snapshotIdentity(snapshot: { instanceId: string; updatedAt: string }): string {
  return `${snapshot.instanceId}:${snapshot.updatedAt}`;
}

export type WorkspaceCandidateMatchMode = "matched" | "all-available" | "none";

export type WorkspaceCandidate = {
  candidateId: string;
  name: string;
  path: string;
  match: WorkspaceCandidateMatch;
};

export type WorkspaceCandidateWindow = {
  windowInstanceId: string;
  focused: boolean;
  snapshotUpdatedAt: string;
  workspaceFile: string | null;
  activeFile: {
    path: string;
    workspaceRoot: string;
  } | null;
  snapshotIdentity: string;
  folders: WorkspaceCandidate[];
};

export type WorkspaceCandidateResolution = {
  query: string;
  contextKey?: string;
  matchMode: WorkspaceCandidateMatchMode;
  windows: WorkspaceCandidateWindow[];
  candidates: WorkspaceCandidate[];
};

/**
 * @deprecated Use managedAssetsRoot() from "./artifact-files" instead.
 */
export function aiArtifactsDataDirectory(options?: GlobalArtifactsRootOptions): string {
  return managedAssetsRoot(options);
}

/**
 * @deprecated Use managedAssetsRoot() from "./artifact-files" instead.
 */
export function codexArtifactsDataDirectory(options?: GlobalArtifactsRootOptions): string {
  return aiArtifactsDataDirectory(options);
}

export function workspaceRegistryDirectory(options?: GlobalArtifactsRootOptions): string {
  const override = process.env.CODEX_ARTIFACTS_REGISTRY_DIRECTORY?.trim();
  return override ? path.resolve(override) : managedWorkspaceRegistryDirectory(options);
}

export function createWorkspaceInstanceId(): string {
  return randomUUID();
}

function snapshotPath(instanceId: string, directory = workspaceRegistryDirectory()): string {
  return path.join(directory, `${instanceId}.json`);
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  await enforceOwnerOnlyDirectory(directory);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: OWNER_ONLY_FILE_MODE });
  await enforceOwnerOnlyFile(temporaryPath);
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY" && code !== "EXDEV") throw error;
    await fs.copyFile(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
  await enforceOwnerOnlyFile(filePath);
}

export async function publishWorkspaceSnapshot(
  snapshot: WorkspaceRegistrySnapshot,
  directory = workspaceRegistryDirectory(),
): Promise<void> {
  const validated = workspaceRegistrySnapshotSchema.parse(snapshot);
  await atomicWrite(snapshotPath(validated.instanceId, directory), `${JSON.stringify(validated, null, 2)}\n`);
}

export async function removeWorkspaceSnapshot(
  instanceId: string,
  directory = workspaceRegistryDirectory(),
): Promise<void> {
  await fs.rm(snapshotPath(instanceId, directory), { force: true });
}

export async function canonicalWorkspaceFolder(folderPath: string): Promise<{ path: string; realPath: string }> {
  if (!path.isAbsolute(folderPath)) throw new Error("Workspace folder paths must be absolute.");
  const resolved = path.resolve(folderPath);
  return { path: resolved, realPath: await fs.realpath(resolved) };
}

export async function readFreshWorkspaceSnapshots(
  directory = workspaceRegistryDirectory(),
  now = Date.now(),
): Promise<WorkspaceRegistrySnapshot[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    throw error;
  }
  const snapshots = await Promise.all(entries
    .filter((entry) => entry.endsWith(".json"))
    .map(async (entry): Promise<WorkspaceRegistrySnapshot | undefined> => {
      try {
        const parsed = workspaceRegistrySnapshotSchema.parse(JSON.parse(
          await fs.readFile(path.join(directory, entry), "utf8"),
        ));
        return Date.parse(parsed.expiresAt) > now ? parsed : undefined;
      } catch {
        return undefined;
      }
    }));
  return snapshots.filter((snapshot): snapshot is WorkspaceRegistrySnapshot => Boolean(snapshot));
}

export async function resolveRegisteredWorkspaceRoot(
  requestedRoot: string,
  directory = workspaceRegistryDirectory(),
  now = Date.now(),
): Promise<string> {
  if (!path.isAbsolute(requestedRoot)) {
    throw new Error("WORKSPACE_NOT_REGISTERED: workspaceRoot must be an absolute path.");
  }
  let requestedRealPath: string;
  try {
    requestedRealPath = await fs.realpath(path.resolve(requestedRoot));
  } catch {
    throw new Error("WORKSPACE_NOT_REGISTERED: the requested workspace folder does not exist.");
  }
  const snapshots = await readFreshWorkspaceSnapshots(directory, now);
  for (const snapshot of snapshots) {
    const match = snapshot.folders.find((folder) => (
      sameFilesystemPath(folder.path, requestedRoot)
      && sameFilesystemPath(folder.realPath, requestedRealPath)
    ));
    if (match) return requestedRealPath;
  }
  throw new Error(
    "WORKSPACE_NOT_REGISTERED: open or add the target folder in VS Code, then retry after Codex Artifacts refreshes its workspace registry.",
  );
}

function uniqueRegisteredFolders(snapshots: readonly WorkspaceRegistrySnapshot[]): Array<{
  path: string;
  realPath: string;
}> {
  const unique = new Map<string, { path: string; realPath: string }>();
  for (const snapshot of snapshots) {
    for (const folder of snapshot.folders) {
      const key = process.platform === "win32" ? folder.realPath.toLowerCase() : folder.realPath;
      unique.set(key, folder);
    }
  }
  return [...unique.values()];
}

function workspaceSnapshotScopeKey(snapshot: WorkspaceRegistrySnapshot): string {
  return JSON.stringify({
    workspaceFile: snapshot.workspaceFile ? searchPathText(snapshot.workspaceFile) : null,
    folders: snapshot.folders
      .map((folder) => searchPathText(folder.realPath))
      .sort((left, right) => left.localeCompare(right)),
  });
}

function selectSingleWorkspaceScope(
  snapshots: readonly WorkspaceRegistrySnapshot[],
): WorkspaceRegistrySnapshot[] {
  const focusedSnapshots = snapshots.filter((snapshot) => snapshot.focused);
  const candidates = focusedSnapshots.length > 0 ? focusedSnapshots : snapshots;
  const scopes = new Map<string, WorkspaceRegistrySnapshot[]>();
  for (const snapshot of candidates) {
    const key = workspaceSnapshotScopeKey(snapshot);
    const scope = scopes.get(key);
    if (scope) scope.push(snapshot);
    else scopes.set(key, [snapshot]);
  }
  if (scopes.size > 1) {
    throw new Error(
      "WORKSPACE_CONTEXT_AMBIGUOUS: the registry does not identify one unique VS Code workspace context; focus the intended VS Code window and retry.",
    );
  }
  return scopes.values().next().value ?? [];
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function searchPathText(value: string): string {
  return value.trim().replaceAll("\\", "/").toLocaleLowerCase();
}

function searchTerms(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s._/\\-]+/g, " ")
    .trim();
}

function workspaceContextKey(
  snapshots: readonly WorkspaceRegistrySnapshot[],
  folders: readonly { realPath: string }[],
): string {
  const snapshot = snapshots[0];
  return snapshot
    ? workspaceSnapshotScopeKey(snapshot)
    : JSON.stringify({
      workspaceFile: null,
      folders: folders
        .map((folder) => searchPathText(folder.realPath))
        .sort((left, right) => left.localeCompare(right)),
    });
}

export async function resolveWorkspaceCandidates(
  rawQuery: string,
  directory = workspaceRegistryDirectory(),
  now = Date.now(),
): Promise<WorkspaceCandidateResolution> {
  const query = rawQuery.trim();
  if (query.length < 2 || query.length > 500) {
    throw new Error("WORKSPACE_QUERY_INVALID: query must contain 2 to 500 characters.");
  }
  const snapshots = await readFreshWorkspaceSnapshots(directory, now);
  if (snapshots.length === 0) {
    return {
      query,
      matchMode: "none",
      windows: [],
      candidates: [],
    };
  }

  const normalizedQuery = searchTerms(query);
  const absoluteQuery = path.isAbsolute(query);
  const rank: Record<WorkspaceCandidateMatch, number> = {
    "exact-path": 0,
    "exact-name": 1,
    "similar-name": 2,
    "single-folder": 3,
    available: 4,
  };

  type ScoredCandidate = {
    snapshot: WorkspaceRegistrySnapshot;
    candidate: WorkspaceCandidate;
  };

  const matchedItems: ScoredCandidate[] = [];
  let totalFolders = 0;
  let singleSnapshot: WorkspaceRegistrySnapshot | undefined;
  let singleFolder: { path: string; realPath: string } | undefined;

  for (const snapshot of snapshots) {
    totalFolders += snapshot.folders.length;
    if (snapshot.folders.length === 1 && totalFolders === 1) {
      singleSnapshot = snapshot;
      singleFolder = snapshot.folders[0];
    }
    for (const folder of snapshot.folders) {
      const name = path.basename(folder.path) || path.basename(folder.realPath);
      const normalizedName = searchTerms(name);
      const normalizedPath = searchTerms(folder.realPath);
      let match: Exclude<WorkspaceCandidateMatch, "available" | "single-folder"> | undefined;
      if (absoluteQuery && (
        sameFilesystemPath(folder.path, query)
        || sameFilesystemPath(folder.realPath, query)
      )) {
        match = "exact-path";
      } else if (normalizedName === normalizedQuery) {
        match = "exact-name";
      } else if (normalizedName.includes(normalizedQuery) || normalizedPath.includes(normalizedQuery)) {
        match = "similar-name";
      }
      if (match) {
        matchedItems.push({
          snapshot,
          candidate: {
            candidateId: workspaceCandidateId(snapshot.instanceId, folder.realPath),
            name,
            path: folder.realPath,
            match,
          },
        });
      }
    }
  }

  if (totalFolders === 0) {
    return {
      query,
      matchMode: "none",
      windows: [],
      candidates: [],
    };
  }

  if (matchedItems.length > 0) {
    matchedItems.sort((left, right) => (
      rank[left.candidate.match] - rank[right.candidate.match]
      || left.candidate.name.localeCompare(right.candidate.name)
      || left.candidate.path.localeCompare(right.candidate.path)
    ));
    const topMatches = matchedItems.slice(0, 10);
    const windowMap = new Map<string, WorkspaceCandidateWindow>();
    for (const item of topMatches) {
      let win = windowMap.get(item.snapshot.instanceId);
      if (!win) {
        win = {
          windowInstanceId: item.snapshot.instanceId,
          focused: item.snapshot.focused,
          snapshotUpdatedAt: item.snapshot.updatedAt,
          workspaceFile: item.snapshot.workspaceFile,
          activeFile: item.snapshot.activeFile,
          snapshotIdentity: snapshotIdentity(item.snapshot),
          folders: [],
        };
        windowMap.set(item.snapshot.instanceId, win);
      }
      win.folders.push(item.candidate);
    }
    return {
      query,
      matchMode: "matched",
      windows: [...windowMap.values()],
      candidates: topMatches.map((item) => item.candidate),
    };
  }

  if (totalFolders === 1 && singleSnapshot && singleFolder) {
    const name = path.basename(singleFolder.path) || path.basename(singleFolder.realPath);
    const candidate: WorkspaceCandidate = {
      candidateId: workspaceCandidateId(singleSnapshot.instanceId, singleFolder.realPath),
      name,
      path: singleFolder.realPath,
      match: "single-folder",
    };
    return {
      query,
      matchMode: "matched",
      windows: [{
        windowInstanceId: singleSnapshot.instanceId,
        focused: singleSnapshot.focused,
        snapshotUpdatedAt: singleSnapshot.updatedAt,
        workspaceFile: singleSnapshot.workspaceFile,
        activeFile: singleSnapshot.activeFile,
        snapshotIdentity: snapshotIdentity(singleSnapshot),
        folders: [candidate],
      }],
      candidates: [candidate],
    };
  }

  // All available fallback across all windows with registered folders
  const windows: WorkspaceCandidateWindow[] = snapshots
    .filter((s) => s.folders.length > 0)
    .map((s) => {
      const folders: WorkspaceCandidate[] = s.folders.map((f) => ({
        candidateId: workspaceCandidateId(s.instanceId, f.realPath),
        name: path.basename(f.path) || path.basename(f.realPath),
        path: f.realPath,
        match: "available" as const,
      })).sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
      return {
        windowInstanceId: s.instanceId,
        focused: s.focused,
        snapshotUpdatedAt: s.updatedAt,
        workspaceFile: s.workspaceFile,
        activeFile: s.activeFile,
        snapshotIdentity: snapshotIdentity(s),
        folders,
      };
    })
    .sort((left, right) => (
      (right.focused ? 1 : 0) - (left.focused ? 1 : 0)
      || Date.parse(right.snapshotUpdatedAt) - Date.parse(left.snapshotUpdatedAt)
    ));

  return {
    query,
    matchMode: "all-available",
    windows,
    candidates: windows.flatMap((w) => w.folders),
  };
}

export async function resolveWorkspaceRootForArtifactCreation(
  requestedRoot: string,
  evidence: WorkspaceEvidence,
  directory = workspaceRegistryDirectory(),
  now = Date.now(),
): Promise<string> {
  const registeredRoot = await resolveRegisteredWorkspaceRoot(requestedRoot, directory, now);
  const snapshots = await readFreshWorkspaceSnapshots(directory, now);
  const focusedSnapshots = snapshots.filter((snapshot) => snapshot.focused);

  if (evidence.kind === "tagged-file") {
    const folders = snapshots.flatMap((s) => s.folders);
    if (!folders.some((folder) => sameFilesystemPath(folder.realPath, registeredRoot))) {
      throw new Error(
        "WORKSPACE_EVIDENCE_MISMATCH: the requested workspace is not registered by any active VS Code window.",
      );
    }
    if (!path.isAbsolute(evidence.filePath)) {
      throw new Error("WORKSPACE_EVIDENCE_MISMATCH: a tagged file path must be absolute.");
    }
    let evidenceRealPath: string;
    try {
      const stat = await fs.stat(path.resolve(evidence.filePath));
      if (!stat.isFile()) throw new Error("not a file");
      evidenceRealPath = await fs.realpath(path.resolve(evidence.filePath));
    } catch {
      throw new Error("WORKSPACE_EVIDENCE_MISMATCH: the tagged file does not exist or is not a file.");
    }
    if (!isPathInside(registeredRoot, evidenceRealPath)) {
      throw new Error("WORKSPACE_EVIDENCE_MISMATCH: the tagged file does not belong to the requested workspace.");
    }
    return registeredRoot;
  }

  // The MCP owns selection-token validation and binds windowInstanceId + canonical workspaceRoot.
  // This shared boundary confirms that the selected root belongs to registered fresh snapshots.
  return registeredRoot;
}
