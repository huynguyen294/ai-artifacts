import path from "node:path";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactManifestSchema,
  commentsDocumentSchema,
  reviewSubmissionSchema,
  type ArtifactManifest,
  type CommentsDocument,
  type ReviewSubmission,
} from "./contracts";
import {
  ARTIFACTS_DIRECTORY,
  ARTIFACT_COLLECTION_DIRECTORY,
  ARTIFACT_MANIFEST_FILE,
  ARTIFACT_MARKDOWN_FILE,
  COMMENTS_FILE,
  REVIEW_SUBMISSION_FILE,
} from "./artifact-files";

export function parseArtifactManifest(rawArtifact: unknown): ArtifactManifest {
  if (
    !rawArtifact
    || typeof rawArtifact !== "object"
    || !("schemaVersion" in rawArtifact)
    || rawArtifact.schemaVersion !== ARTIFACT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Unsupported artifact schema version. Codex Artifacts requires version ${ARTIFACT_SCHEMA_VERSION}.`,
    );
  }
  return artifactManifestSchema.parse(rawArtifact);
}

export function sameFilesystemPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function assertArtifactDirectory(
  artifact: ArtifactManifest,
  artifactDirectory: string,
): string {
  const workspaceRoot = artifact.location.workspaceRoot;
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error("The artifact workspace root must be an absolute path.");
  }
  const expectedDirectory = path.join(
    path.resolve(workspaceRoot),
    ARTIFACTS_DIRECTORY,
    ARTIFACT_COLLECTION_DIRECTORY,
    artifact.artifactId,
  );
  if (!sameFilesystemPath(artifactDirectory, expectedDirectory)) {
    throw new Error("The artifact directory does not match its declared workspace root and id.");
  }
  return path.resolve(workspaceRoot);
}

export type ArtifactBinding = {
  artifactId: string;
  reviewRound: number;
  artifactSha256: string;
};

export type ReviewSubmissionBinding = ArtifactBinding & {
  threadId: string | undefined;
  commentsSha256: string;
};

export function parseBoundCommentsDocument(
  rawComments: unknown,
  binding: ArtifactBinding,
): CommentsDocument {
  const comments = commentsDocumentSchema.parse(rawComments);
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
    submission.artifactId !== binding.artifactId
    || submission.reviewRound !== binding.reviewRound
    || submission.threadId !== binding.threadId
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
