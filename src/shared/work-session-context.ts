import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SESSION_TYPE_ID,
  artifactConversationIdSchema,
  sessionContextSchema,
  sessionHandleSchema,
  type SessionCatalog,
  type SessionCatalogItem,
  type SessionContext,
  type SessionHandle,
  type SessionType,
} from "./contracts";
import {
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  artifactCollectionRoot,
  conversationDirectory,
  workSessionInstructionsPath,
  workSessionLayoutPath,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";
import {
  ensureSafeGlobalArtifactDirectory,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
} from "./artifact-validation";
import { readSession, readSessionSummary, type WorkSessionSummary } from "./conversation-artifact-registry";
import { listSessionTypes } from "./session-type-registry";
import { extractMarkdownDescription } from "./markdown-description";

export type ResolveSessionContextOptions = GlobalArtifactsRootOptions;

function buildSessionHandleFields(
  session: WorkSessionSummary,
  types: SessionType[],
  options: GlobalArtifactsRootOptions,
): SessionHandle {
  const matchedType = types.find((t) => t.id === session.typeId);
  const typeLabel =
    matchedType?.label ?? (session.typeId === DEFAULT_SESSION_TYPE_ID ? "Conversation" : session.typeId);
  return {
    sessionId: session.sessionId,
    title: session.title,
    typeId: session.typeId,
    typeLabel,
    sessionDirectory: conversationDirectory(session.sessionId, options),
    instructionsPath: workSessionInstructionsPath(session.sessionId, options),
    layoutPath: workSessionLayoutPath(session.sessionId, options),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/**
 * Resolves lightweight Session identity and file paths without reading instructions.md
 * or scanning/reading catalog artifacts.
 */
export async function resolveWorkSessionHandle(
  sessionId: string,
  options: ResolveSessionContextOptions = {},
): Promise<SessionHandle> {
  const validatedSessionId = artifactConversationIdSchema.parse(sessionId);
  const [summary, types] = await Promise.all([
    readSessionSummary(validatedSessionId, options),
    listSessionTypes({ ...options, seedIfMissing: false }),
  ]);
  return sessionHandleSchema.parse(buildSessionHandleFields(summary, types, options));
}

/**
 * Resolves full context for a Work Session including session metadata,
 * resolved type label, instructions text and paths, and catalog items
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
  const [session, types] = await Promise.all([
    readSession(validatedSessionId, options),
    listSessionTypes({ ...options, seedIfMissing: false }),
  ]);
  const handle = buildSessionHandleFields(session, types, options);
  const collectionRoot = artifactCollectionRoot(options);

  async function resolveCatalogItem(artifactId: string): Promise<SessionCatalogItem> {
    try {
      const candidateDir = path.join(collectionRoot, artifactId);
      const canonicalDir = await ensureSafeGlobalArtifactDirectory(artifactId, candidateDir, options);
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
    ...handle,
    instructions: session.instructions,
    catalog,
  };

  return sessionContextSchema.parse(context);
}
