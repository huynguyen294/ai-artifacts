import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactManifestSchema,
  commentsDocumentSchema,
} from "../shared/contracts";
import {
  assertArtifactDirectory,
  artifactPaths,
  sameFilesystemPath,
} from "../shared/artifact-validation";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
} from "../shared/artifact-files";

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
  const temporary = `${filePath}.ai-artifacts-${process.pid}-${Date.now()}.tmp`;
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

function addedFilePaths(toolInput: unknown, fileName: string): string[] {
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
  const manifestPaths = addedFilePaths(toolInput, ARTIFACT_MANIFEST_FILE)
    .map((candidate) => path.resolve(cwd, candidate));
  const markdownPaths = addedFilePaths(toolInput, ARTIFACT_MARKDOWN_FILE)
    .map((candidate) => path.resolve(cwd, candidate));

  for (const manifestPath of new Set(manifestPaths)) {
    const artifactDirectory = path.dirname(manifestPath);
    const files = artifactPaths(artifactDirectory);
    if (!markdownPaths.some((candidate) => sameFilesystemPath(candidate, files.artifactPath))) continue;
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
    try {
      assertArtifactDirectory(manifest, artifactDirectory);
    } catch {
      continue;
    }
    if (manifest.reviewRound !== 1) continue;

    const markdown = await fs.readFile(files.artifactPath, "utf8");
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

    await createJson(files.commentsPath, commentsDocumentSchema.parse({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: stampedManifest.artifactId,
      reviewRound: stampedManifest.reviewRound,
      artifactSha256: sha256(markdown),
      comments: [],
    }));
  }
}

await main();
