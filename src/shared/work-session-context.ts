import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SESSION_TYPE_ID,
  artifactConversationIdSchema,
  sessionContextSchema,
  type SessionCatalog,
  type SessionCatalogItem,
  type SessionContext,
} from "./contracts";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  artifactCollectionRoot,
  workSessionInstructionsPath,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  assertGlobalArtifactDirectory,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
} from "./artifact-validation";
import { readSession } from "./conversation-artifact-registry";
import { listSessionTypes } from "./session-type-registry";
import { extractMarkdownDescription } from "./markdown-description";

export type ResolveSessionContextOptions = GlobalArtifactsRootOptions;

/**
 * Resolves full context for a Work Session including session metadata,
 * resolved type label, instructions text and path, and catalog items
 * across working, references, and archived zones.
 *
 * For unavailable or invalid artifacts, emits `{ artifactId, unavailable: true }`
 * without failing the entire catalog resolution.
 */
export async function resolveWorkSessionContext(
  sessionId: string,
  options: ResolveSessionContextOptions = {},
): Promise<SessionContext> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const session = await readSession(validatedSessionId, options);
  const types = await listSessionTypes({ ...options, seedIfMissing: false });
  const matchedType = types.find((t) => t.id === session.typeId);
  const typeLabel =
    matchedType?.label ?? (session.typeId === DEFAULT_SESSION_TYPE_ID ? "Conversation" : session.typeId);
  const instructionsPath = workSessionInstructionsPath(validatedSessionId, options);
  const collectionRoot = artifactCollectionRoot(options);

  async function resolveCatalogItem(artifactId: string): Promise<SessionCatalogItem> {
    try {
      const artifactDirectory = path.join(collectionRoot, artifactId);
      assertGlobalArtifactDirectory(artifactId, artifactDirectory, options);

      const dirStat = await fs.lstat(artifactDirectory);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
        throw new Error("Artifact path must be a regular directory, not a symlink.");
      }

      const canonicalDir = await fs.realpath(artifactDirectory);
      const manifestPath = await ensureSafeManagedArtifactFile(
        canonicalDir,
        path.join(canonicalDir, ARTIFACT_MANIFEST_FILE),
      );
      const manifestRaw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const manifest = parseArtifactManifest(manifestRaw);

      if (manifest.artifactId !== artifactId) {
        throw new Error("Artifact manifest ID does not match directory ID.");
      }

      const artifactPath = await ensureSafeManagedArtifactFile(
        canonicalDir,
        path.join(canonicalDir, ARTIFACT_MARKDOWN_FILE),
      );
      const markdown = await fs.readFile(artifactPath, "utf8");
      const description = extractMarkdownDescription(markdown);

      return {
        artifactId,
        title: manifest.title,
        kind: manifest.kind,
        description,
        artifactDirectory: canonicalDir,
        artifactPath,
        updatedAt: manifest.updatedAt,
      };
    } catch {
      return {
        artifactId,
        unavailable: true,
      };
    }
  }

  const resolveZone = (artifactIds: string[]): Promise<SessionCatalogItem[]> => {
    return Promise.all(artifactIds.map((id) => resolveCatalogItem(id)));
  };

  const [working, references, archived] = await Promise.all([
    resolveZone(session.working),
    resolveZone(session.references),
    resolveZone(session.archived),
  ]);

  const catalog: SessionCatalog = {
    working,
    references,
    archived,
  };

  const context: SessionContext = {
    sessionId: session.sessionId,
    title: session.title,
    typeId: session.typeId,
    typeLabel,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    instructions: session.instructions,
    instructionsPath,
    catalog,
  };

  return sessionContextSchema.parse(context);
}
