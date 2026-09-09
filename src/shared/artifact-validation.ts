import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  LEGACY_ARTIFACT_SCHEMA_VERSION,
  anyArtifactManifestSchema,
  anyCommentsDocumentSchema,
  anyReviewSubmissionSchema,
  type AnyArtifactManifest,
  type AnyCommentsDocument,
  type AnyReviewSubmission,
} from "./contracts";
import {
  ARTIFACTS_DIRECTORIES,
  ARTIFACT_COLLECTION_DIRECTORY,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  COMMENTS_FILE,
  REVIEW_SUBMISSION_FILE,
} from "./artifact-files";

export function parseArtifactManifest(rawArtifact: unknown): AnyArtifactManifest {
  if (
    !rawArtifact
    || typeof rawArtifact !== "object"
    || !("schemaVersion" in rawArtifact)
    || (rawArtifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION
      && rawArtifact.schemaVersion !== LEGACY_ARTIFACT_SCHEMA_VERSION)
  ) {
    throw new Error(
      `Unsupported artifact schema version. Codex Artifacts supports versions ${LEGACY_ARTIFACT_SCHEMA_VERSION} and ${ARTIFACT_SCHEMA_VERSION}.`,
    );
  }
  return anyArtifactManifestSchema.parse(rawArtifact);
}

export function sameFilesystemPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function assertArtifactDirectory(
  artifact: AnyArtifactManifest,
  artifactDirectory: string,
): string {
  const workspaceRoot = artifact.location.workspaceRoot;
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("The artifact workspace root must be an absolute path.");
  }
  const expectedDirectories = ARTIFACTS_DIRECTORIES.map((directory) =>
    path.join(
      path.resolve(workspaceRoot),
      directory,
      ARTIFACT_COLLECTION_DIRECTORY,
      artifact.artifactId,
    ),
  );
  if (!expectedDirectories.some((expected) => sameFilesystemPath(artifactDirectory, expected))) {
    throw new Error("The artifact directory does not match its declared workspace root and id.");
  }
  return path.resolve(workspaceRoot);
}

export type ArtifactBinding = {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION | typeof LEGACY_ARTIFACT_SCHEMA_VERSION;
  artifactId: string;
  reviewRound: number;
  artifactSha256: string;
};

export type ReviewSubmissionBinding = ArtifactBinding & {
  reviewSessionId: string | undefined;
  threadId: string | undefined;
  commentsSha256: string;
};

export function parseBoundCommentsDocument(
  rawComments: unknown,
  binding: ArtifactBinding,
): AnyCommentsDocument {
  const comments = anyCommentsDocumentSchema.parse(rawComments);
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
): AnyReviewSubmission {
  const submission = anyReviewSubmissionSchema.parse(rawSubmission);
  if (
    submission.schemaVersion !== binding.schemaVersion
    || (submission.schemaVersion === ARTIFACT_SCHEMA_VERSION
      ? submission.reviewSessionId !== binding.reviewSessionId
      : submission.threadId !== binding.threadId)
    ||
    submission.artifactId !== binding.artifactId
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
} {
  return {
    manifestPath: path.join(artifactDirectory, ARTIFACT_MANIFEST_FILE),
    artifactPath: path.join(artifactDirectory, ARTIFACT_MARKDOWN_FILE),
    commentsPath: path.join(artifactDirectory, COMMENTS_FILE),
    submissionPath: path.join(artifactDirectory, REVIEW_SUBMISSION_FILE),
  };
}
