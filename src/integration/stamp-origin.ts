import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactIdSchema,
  artifactManifestSchema,
  commentsDocumentSchema,
} from "../shared/contracts";
import {
  assertArtifactDirectory,
  sameFilesystemPath,
} from "../shared/artifact-validation";

type HookInput = {
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  tool_input?: unknown;
  toolInput?: unknown;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function stdinJson(): Promise<HookInput> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const parsed: unknown = JSON.parse(input);
  return parsed && typeof parsed === "object" ? parsed as HookInput : {};
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.codex-artifacts-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rename(temporary, filePath);
        return;
      } catch (error) {
        const code = errorCode(error);
        if (attempt < 2 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        if (code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "EXDEV") {
          await fs.copyFile(temporary, filePath);
          return;
        }
        throw error;
      }
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

async function createJson(filePath: string, value: unknown): Promise<void> {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
}

function collectStrings(value: unknown, result: string[]): void {
  if (typeof value === "string") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, result);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, result);
  }
}

function addedFilePaths(toolInput: unknown, fileName: "artifact.json" | "plan.md"): string[] {
  const strings: string[] = [];
  collectStrings(toolInput, strings);
  const escapedName = fileName.replace(".", "\\.");
  const pattern = new RegExp(`\\*\\*\\* Add File:\\s*(.+?${escapedName})`, "gi");
  const result = new Set<string>();
  for (const value of strings) {
    for (const match of value.matchAll(pattern)) {
      const candidate = match[1]?.trim();
      if (candidate) result.add(candidate);
    }
  }
  return [...result];
}

async function validReplacementDirectory(
  oldDirectory: string,
  oldId: string,
  workspaceRoot: string,
): Promise<boolean> {
  try {
    const oldManifest = artifactManifestSchema.parse(JSON.parse(
      await fs.readFile(path.join(oldDirectory, "artifact.json"), "utf8"),
    ));
    return oldManifest.artifactId === oldId
      && sameFilesystemPath(assertArtifactDirectory(oldManifest, oldDirectory), workspaceRoot);
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const input = await stdinJson();
  if (
    typeof input.session_id !== "string"
    || !input.session_id
    || typeof input.cwd !== "string"
    || !input.cwd
  ) return;

  const sessionId = input.session_id;
  const cwd = input.cwd;
  const toolInput = input.tool_input ?? input.toolInput ?? {};
  const artifactPaths = addedFilePaths(toolInput, "artifact.json")
    .map((candidate) => path.resolve(cwd, candidate));
  const planPaths = addedFilePaths(toolInput, "plan.md")
    .map((candidate) => path.resolve(cwd, candidate));

  for (const manifestPath of new Set(artifactPaths)) {
    const artifactDirectory = path.dirname(manifestPath);
    const planPath = path.join(artifactDirectory, "plan.md");
    if (!planPaths.some((candidate) => sameFilesystemPath(candidate, planPath))) continue;
    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }

    const parsedManifest = artifactManifestSchema.safeParse(rawManifest);
    if (!parsedManifest.success) continue;
    const manifest = parsedManifest.data;
    if (manifest.origin.threadId) continue;
    let workspaceRoot: string;
    try {
      workspaceRoot = assertArtifactDirectory(manifest, artifactDirectory);
    } catch {
      continue;
    }
    const plansRoot = path.resolve(workspaceRoot, ".codex-artifacts", "plans");
    let replacement: { oldDirectory: string; oldId: string } | undefined;
    if (manifest.operation === "replace" && manifest.replacesArtifactId) {
      const oldId = manifest.replacesArtifactId;
      if (!artifactIdSchema.safeParse(oldId).success || oldId === manifest.artifactId) continue;
      const oldDirectory = path.resolve(plansRoot, oldId);
      if (!sameFilesystemPath(path.dirname(oldDirectory), plansRoot)) continue;
      if (!await validReplacementDirectory(oldDirectory, oldId, workspaceRoot)) continue;
      replacement = { oldDirectory, oldId };
    }

    const plan = await fs.readFile(planPath, "utf8");
    const stampedManifest = artifactManifestSchema.parse({
      ...manifest,
      origin: {
        ...manifest.origin,
        threadId: sessionId,
        ...(typeof input.turn_id === "string" && input.turn_id ? { turnId: input.turn_id } : {}),
        codexCwd: cwd,
      },
    });
    await atomicJson(manifestPath, stampedManifest);

    const commentsPath = path.join(artifactDirectory, "comments.json");
    await createJson(commentsPath, commentsDocumentSchema.parse({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: stampedManifest.artifactId,
      planSha256: sha256(plan),
      comments: [],
    }));

    if (replacement) {
      const trashRoot = path.resolve(workspaceRoot, ".codex-artifacts", ".trash");
      await fs.mkdir(trashRoot, { recursive: true });
      try {
        await fs.rename(
          replacement.oldDirectory,
          path.join(trashRoot, `${replacement.oldId}-${Date.now()}`),
        );
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}

await main();
