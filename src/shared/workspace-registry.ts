import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { sameFilesystemPath } from "./artifact-validation";

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

export type WorkspaceCandidateMatch = "exact-path" | "exact-name" | "similar-name" | "available";

export type WorkspaceCandidateMatchMode = "matched" | "all-available" | "none";

export type WorkspaceCandidate = {
  name: string;
  path: string;
  match: WorkspaceCandidateMatch;
};

export type WorkspaceCandidateResolution = {
  query: string;
  contextKey: string;
  matchMode: WorkspaceCandidateMatchMode;
  candidates: WorkspaceCandidate[];
};

export function codexArtifactsDataDirectory(): string {
  const codexDirectory = process.env.CODEX_HOME?.trim()
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
  return path.join(codexDirectory, "codex-artifacts");
}

export function workspaceRegistryDirectory(): string {
  const override = process.env.CODEX_ARTIFACTS_REGISTRY_DIRECTORY?.trim();
  return override ? path.resolve(override) : path.join(codexArtifactsDataDirectory(), "workspaces");
}

export function createWorkspaceInstanceId(): string {
  return randomUUID();
}

function snapshotPath(instanceId: string, directory = workspaceRegistryDirectory()): string {
  return path.join(directory, `${instanceId}.json`);
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY" && code !== "EXDEV") throw error;
    await fs.copyFile(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
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

function workspaceContextKey(folders: readonly { realPath: string }[]): string {
  return JSON.stringify(folders
    .map((folder) => searchPathText(folder.realPath))
    .sort((left, right) => left.localeCompare(right)));
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
  const focusedSnapshots = snapshots.filter((snapshot) => snapshot.focused);
  const relevantSnapshots = focusedSnapshots.length > 0 ? focusedSnapshots : snapshots;
  const folders = uniqueRegisteredFolders(relevantSnapshots);
  const normalizedQuery = searchTerms(query);
  const absoluteQuery = path.isAbsolute(query);
  const rank: Record<WorkspaceCandidateMatch, number> = {
    "exact-path": 0,
    "exact-name": 1,
    "similar-name": 2,
    available: 3,
  };
  const matchedCandidates = folders.flatMap((folder): WorkspaceCandidate[] => {
    const name = path.basename(folder.path) || path.basename(folder.realPath);
    const normalizedName = searchTerms(name);
    const normalizedPath = searchTerms(folder.realPath);
    let match: Exclude<WorkspaceCandidateMatch, "available"> | undefined;
    if (absoluteQuery && (
      sameFilesystemPath(folder.path, query)
      || sameFilesystemPath(folder.realPath, query)
    )) match = "exact-path";
    else if (normalizedName === normalizedQuery) match = "exact-name";
    else if (normalizedName.includes(normalizedQuery) || normalizedPath.includes(normalizedQuery)) {
      match = "similar-name";
    }
    return match ? [{ name, path: folder.realPath, match }] : [];
  }).sort((left, right) => (
    rank[left.match] - rank[right.match]
    || left.name.localeCompare(right.name)
    || left.path.localeCompare(right.path)
  )).slice(0, 10);
  const candidates = matchedCandidates.length > 0
    ? matchedCandidates
    : folders.map((folder): WorkspaceCandidate => ({
      name: path.basename(folder.path) || path.basename(folder.realPath),
      path: folder.realPath,
      match: "available",
    })).sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  return {
    query,
    contextKey: workspaceContextKey(folders),
    matchMode: matchedCandidates.length > 0 ? "matched" : folders.length > 0 ? "all-available" : "none",
    candidates,
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
  const relevantSnapshots = focusedSnapshots.length > 0 ? focusedSnapshots : snapshots;
  const folders = uniqueRegisteredFolders(relevantSnapshots);
  if (!folders.some((folder) => sameFilesystemPath(folder.realPath, registeredRoot))) {
    throw new Error(
      "WORKSPACE_EVIDENCE_MISMATCH: the requested workspace is not registered by the focused VS Code window.",
    );
  }

  if (evidence.kind === "tagged-file") {
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

  // The MCP owns selection-token validation. This shared boundary still
  // revalidates that the selected root belongs to the current registry scope.
  return registeredRoot;
}
