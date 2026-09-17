import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ARTIFACT_CONNECTION_SCHEMA_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  artifactConnectionSchema,
  artifactIdSchema,
  artifactManifestSchema,
  commentsDocumentSchema,
  reviewSubmissionSchema,
  type ArtifactConnection,
  type ArtifactManifest,
  type CommentsDocument,
  type ReviewSubmission,
} from "./contracts";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_CONNECTION_FILE,
  ARTIFACT_CONNECTION_LOCK_FILE,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  COMMENTS_FILE,
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  REVIEW_SUBMISSION_FILE,
  globalArtifactsRoot,
  type GlobalArtifactsRootOptions,
} from "./artifact-files";

const MANAGED_ARTIFACT_FILES = new Set([
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  COMMENTS_FILE,
  REVIEW_SUBMISSION_FILE,
  ARTIFACT_UPDATE_LOCK_FILE,
  ARTIFACT_CONNECTION_FILE,
  ARTIFACT_CONNECTION_LOCK_FILE,
]);
const TRANSACTION_FILE_SUFFIX = /^\.(?:tmp|next|previous)-[a-zA-Z0-9_-]+$/;

type SafeManagedFileOptions = {
  allowMissing?: boolean;
};

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isManagedArtifactFileName(fileName: string): boolean {
  if (MANAGED_ARTIFACT_FILES.has(fileName)) return true;
  return [...MANAGED_ARTIFACT_FILES].some((baseName) => {
    if (!fileName.startsWith(`${baseName}.`)) return false;
    return TRANSACTION_FILE_SUFFIX.test(fileName.slice(baseName.length));
  });
}

async function assertDirectoryEntry(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink()) {
    throw new Error("UNSAFE_ARTIFACT_PATH: symbolic links and junctions are not allowed in global artifact storage.");
  }
  if (!stat.isDirectory()) {
    throw new Error("UNSAFE_ARTIFACT_PATH: global artifact storage components must be directories.");
  }
}

export async function enforceOwnerOnlyDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  await fs.chmod(directory, OWNER_ONLY_DIRECTORY_MODE);
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error("UNSAFE_ARTIFACT_PERMISSIONS: managed artifact directories must be owner-only.");
  }
}

export async function ensureManagedDirectory(directory: string): Promise<void> {
  try {
    await assertDirectoryEntry(directory);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    try {
      await fs.mkdir(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
    } catch (mkdirError) {
      if (errorCode(mkdirError) !== "EEXIST") throw mkdirError;
    }
    await assertDirectoryEntry(directory);
  }
  await enforceOwnerOnlyDirectory(directory);
}

export async function enforceOwnerOnlyFile(filePath: string): Promise<void> {
  if (process.platform === "win32") return;
  await fs.chmod(filePath, OWNER_ONLY_FILE_MODE);
  const stat = await fs.lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error("UNSAFE_ARTIFACT_PERMISSIONS: managed artifact files must be owner-only.");
  }
}

export function parseArtifactManifest(rawArtifact: unknown): ArtifactManifest {
  if (
    !rawArtifact
    || typeof rawArtifact !== "object"
    || !("schemaVersion" in rawArtifact)
    || rawArtifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Unsupported artifact schema version. AI Artifacts supports version ${ARTIFACT_SCHEMA_VERSION}.`,
    );
  }
  return artifactManifestSchema.parse(rawArtifact);
}

export function parseArtifactConnection(rawConnection: unknown): ArtifactConnection {
  if (
    !rawConnection
    || typeof rawConnection !== "object"
    || !("schemaVersion" in rawConnection)
    || rawConnection.schemaVersion !== ARTIFACT_CONNECTION_SCHEMA_VERSION
  ) {
    throw new Error(
      `Unsupported artifact connection schema version. AI Artifacts supports version ${ARTIFACT_CONNECTION_SCHEMA_VERSION}.`,
    );
  }
  return artifactConnectionSchema.parse(rawConnection);
}

export function sameFilesystemPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function assertGlobalArtifactDirectory(
  artifactId: string,
  artifactDirectory: string,
  options: GlobalArtifactsRootOptions = {},
): string {
  const validatedArtifactId = artifactIdSchema.parse(artifactId);
  if (!path.isAbsolute(artifactDirectory)) {
    throw new Error("The global artifact directory must be an absolute path.");
  }

  const resolvedDirectory = path.resolve(artifactDirectory);
  const collectionRoot = globalArtifactsRoot(options);
  if (!sameFilesystemPath(path.dirname(resolvedDirectory), collectionRoot)) {
    throw new Error("The global artifact directory must be a direct child of the collection root.");
  }
  if (path.basename(resolvedDirectory) !== validatedArtifactId) {
    throw new Error("The global artifact directory basename does not match its artifact id.");
  }
  return resolvedDirectory;
}

export async function ensureSafeGlobalArtifactsRoot(
  options: GlobalArtifactsRootOptions = {},
): Promise<string> {
  const collectionRoot = globalArtifactsRoot(options);
  const artifactsRoot = path.dirname(collectionRoot);
  const userHome = path.dirname(artifactsRoot);

  const homeStat = await fs.lstat(userHome);
  if (!homeStat.isDirectory()) {
    throw new Error("UNSAFE_ARTIFACT_PATH: the artifact user home must be a directory.");
  }

  await ensureManagedDirectory(path.join(userHome, ARTIFACTS_DIRECTORY));
  await ensureManagedDirectory(collectionRoot);

  const [canonicalHome, canonicalCollectionRoot] = await Promise.all([
    fs.realpath(userHome),
    fs.realpath(collectionRoot),
  ]);
  const relative = path.relative(canonicalHome, canonicalCollectionRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("UNSAFE_ARTIFACT_PATH: the global artifact root escapes the user home.");
  }
  return canonicalCollectionRoot;
}

export async function ensureSafeGlobalArtifactDirectory(
  artifactId: string,
  artifactDirectory: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<string> {
  const resolvedDirectory = assertGlobalArtifactDirectory(artifactId, artifactDirectory, options);
  const canonicalCollectionRoot = await ensureSafeGlobalArtifactsRoot(options);
  await assertDirectoryEntry(resolvedDirectory);
  await enforceOwnerOnlyDirectory(resolvedDirectory);
  const canonicalDirectory = await fs.realpath(resolvedDirectory);
  if (
    !sameFilesystemPath(path.dirname(canonicalDirectory), canonicalCollectionRoot)
    || path.basename(canonicalDirectory) !== artifactId
  ) {
    throw new Error("UNSAFE_ARTIFACT_PATH: the artifact directory escapes the global collection root.");
  }
  return canonicalDirectory;
}

export type SafeGlobalArtifactHandle = {
  artifactId: string;
  artifactDirectory: string;
  files: ReturnType<typeof artifactPaths>;
};

export async function ensureSafeGlobalArtifactHandle(
  artifactPath: string,
  options: GlobalArtifactsRootOptions = {},
  expectedArtifactId?: string,
): Promise<SafeGlobalArtifactHandle> {
  if (!path.isAbsolute(artifactPath)) {
    throw new Error("The artifact handle must be an absolute path to artifact.md.");
  }

  const candidateDirectory = path.dirname(artifactPath);
  const artifactId = expectedArtifactId ?? path.basename(candidateDirectory);
  const artifactDirectory = await ensureSafeGlobalArtifactDirectory(
    artifactId,
    candidateDirectory,
    options,
  );
  const files = artifactPaths(artifactDirectory);
  if (!sameFilesystemPath(artifactPath, files.artifactPath)) {
    throw new Error("The artifact handle must point to artifact.md in the global artifact directory.");
  }
  return { artifactId, artifactDirectory, files };
}

export function assertManagedArtifactFilePath(
  artifactDirectory: string,
  filePath: string,
): string {
  if (!path.isAbsolute(artifactDirectory) || !path.isAbsolute(filePath)) {
    throw new Error("Managed artifact paths must be absolute.");
  }
  const resolvedArtifactDirectory = path.resolve(artifactDirectory);
  const resolvedFilePath = path.resolve(filePath);
  if (!sameFilesystemPath(path.dirname(resolvedFilePath), resolvedArtifactDirectory)) {
    throw new Error("Managed artifact files must be direct children of the artifact directory.");
  }
  if (!isManagedArtifactFileName(path.basename(resolvedFilePath))) {
    throw new Error("The path is not a recognized artifact lifecycle or transaction file.");
  }
  return resolvedFilePath;
}

export async function ensureSafeManagedArtifactFile(
  artifactDirectory: string,
  filePath: string,
  options: SafeManagedFileOptions = {},
): Promise<string> {
  const resolvedFilePath = assertManagedArtifactFilePath(artifactDirectory, filePath);
  try {
    const stat = await fs.lstat(resolvedFilePath);
    if (stat.isSymbolicLink()) {
      throw new Error("UNSAFE_ARTIFACT_PATH: symbolic links are not allowed for managed artifact files.");
    }
    if (!stat.isFile()) {
      throw new Error("UNSAFE_ARTIFACT_PATH: managed artifact paths must be regular files.");
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT" && options.allowMissing === true) return resolvedFilePath;
    throw error;
  }
  await enforceOwnerOnlyFile(resolvedFilePath);
  return resolvedFilePath;
}

export type ArtifactBinding = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  artifactId: string;
  reviewRound: number;
  artifactSha256: string;
};

export type ReviewSubmissionBinding = ArtifactBinding & {
  reviewSessionId: string;
  commentsSha256: string;
};

export function parseBoundCommentsDocument(
  rawComments: unknown,
  binding: ArtifactBinding,
): CommentsDocument {
  const comments = commentsDocumentSchema.parse(rawComments);
  if (comments.schemaVersion !== binding.schemaVersion) {
    throw new Error("comments.json uses a different artifact schema version.");
  }
  if (comments.artifactId !== binding.artifactId) {
    throw new Error("comments.json does not belong to this artifact.");
  }
  if (comments.reviewRound !== binding.reviewRound) {
    throw new Error("comments.json does not belong to the current artifact review round.");
  }
  if (comments.artifactSha256 !== binding.artifactSha256) {
    throw new Error("artifact.md changed outside the artifact review update protocol.");
  }
  return comments;
}

export function parseBoundReviewSubmission(
  rawSubmission: unknown,
  binding: ReviewSubmissionBinding,
): ReviewSubmission {
  const submission = reviewSubmissionSchema.parse(rawSubmission);
  if (
    submission.schemaVersion !== binding.schemaVersion
    || submission.reviewSessionId !== binding.reviewSessionId
    || submission.artifactId !== binding.artifactId
    || submission.reviewRound !== binding.reviewRound
  ) {
    throw new Error("review-submission.json does not belong to this artifact lifecycle.");
  }
  if (
    submission.artifactSha256 !== binding.artifactSha256
    || submission.commentsSha256 !== binding.commentsSha256
  ) {
    throw new Error("The plan or comments changed after this review was submitted.");
  }
  return submission;
}

export function artifactPaths(artifactDirectory: string): {
  manifestPath: string;
  artifactPath: string;
  commentsPath: string;
  submissionPath: string;
  connectionPath: string;
} {
  return {
    manifestPath: path.join(artifactDirectory, ARTIFACT_MANIFEST_FILE),
    artifactPath: path.join(artifactDirectory, ARTIFACT_MARKDOWN_FILE),
    commentsPath: path.join(artifactDirectory, COMMENTS_FILE),
    submissionPath: path.join(artifactDirectory, REVIEW_SUBMISSION_FILE),
    connectionPath: path.join(artifactDirectory, ARTIFACT_CONNECTION_FILE),
  };
}
