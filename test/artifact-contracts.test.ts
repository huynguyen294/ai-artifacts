import { describe, expect, it } from "vitest";
import * as contracts from "../src/shared/contracts";
import {
  ARTIFACT_SCHEMA_VERSION,
  artifactManifestSchema,
  commentsDocumentSchema,
  reviewSubmissionSchema,
  type ReviewState,
} from "../src/shared/contracts";
import {
  parseArtifactManifest,
  parseBoundCommentsDocument,
  parseBoundReviewSubmission,
} from "../src/shared/artifact-validation";

const artifactSha256 = "a".repeat(64);
const commentsSha256 = "b".repeat(64);
const reviewSessionId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-15T08:00:00.000Z";

function manifest(schemaVersion: number = ARTIFACT_SCHEMA_VERSION): Record<string, unknown> {
  return {
    schemaVersion,
    kind: "implementation-plan",
    artifactId: "artifact-001",
    title: "Global artifact storage",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    location: { workspaceRoot: "D:\\workspace\\target-project" },
    reviewSessionId,
  };
}

function comments(schemaVersion: number = ARTIFACT_SCHEMA_VERSION): Record<string, unknown> {
  return {
    schemaVersion,
    artifactId: "artifact-001",
    reviewRound: 1,
    artifactSha256,
    comments: [],
  };
}

function submission(schemaVersion: number = ARTIFACT_SCHEMA_VERSION): Record<string, unknown> {
  return {
    schemaVersion,
    artifactId: "artifact-001",
    reviewRound: 1,
    reviewSessionId,
    submittedAt: timestamp,
    decision: "approve",
    artifactSha256,
    commentsSha256,
  };
}

describe("artifact schema v5 contract", () => {
  it("locks the writable artifact schema to version 5", () => {
    expect(ARTIFACT_SCHEMA_VERSION).toBe(5);
    expect(artifactManifestSchema.parse(manifest())).toMatchObject({
      schemaVersion: 5,
      artifactId: "artifact-001",
      location: { workspaceRoot: "D:\\workspace\\target-project" },
      reviewSessionId,
    });
  });

  it.each([3, 4])("rejects schema-v%s manifests", (schemaVersion) => {
    expect(() => parseArtifactManifest(manifest(schemaVersion)))
      .toThrow("Unsupported artifact schema version. AI Artifacts supports version 5.");
  });

  it("keeps workspaceRoot as manifest metadata without a storage-path field", () => {
    const parsed = parseArtifactManifest(manifest());
    expect(parsed.location).toEqual({ workspaceRoot: "D:\\workspace\\target-project" });
    expect(parsed.location).not.toHaveProperty("artifactDirectory");
    expect(parsed).not.toHaveProperty("origin");
  });

  it("exposes no legacy runtime schemas or union parsers", () => {
    expect(contracts).not.toHaveProperty("LEGACY_ARTIFACT_SCHEMA_VERSION");
    expect(contracts).not.toHaveProperty("legacyArtifactManifestSchema");
    expect(contracts).not.toHaveProperty("legacyCommentsDocumentSchema");
    expect(contracts).not.toHaveProperty("legacyReviewSubmissionSchema");
    expect(contracts).not.toHaveProperty("anyArtifactManifestSchema");
    expect(contracts).not.toHaveProperty("anyCommentsDocumentSchema");
    expect(contracts).not.toHaveProperty("anyReviewSubmissionSchema");
  });

  it("parses comments only when their v5 artifact binding matches", () => {
    expect(parseBoundCommentsDocument(comments(), {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: "artifact-001",
      reviewRound: 1,
      artifactSha256,
    })).toEqual(comments());

    expect(() => parseBoundCommentsDocument({ ...comments(), artifactId: "artifact-002" }, {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: "artifact-001",
      reviewRound: 1,
      artifactSha256,
    })).toThrow("comments.json does not belong to this artifact");
    expect(() => commentsDocumentSchema.parse(comments(4))).toThrow();
  });

  it("binds submissions to the v5 review session, round, artifact, and hashes", () => {
    const binding = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: "artifact-001",
      reviewRound: 1,
      reviewSessionId,
      artifactSha256,
      commentsSha256,
    } as const;
    expect(parseBoundReviewSubmission(submission(), binding)).toEqual(submission());
    expect(() => parseBoundReviewSubmission({
      ...submission(),
      reviewSessionId: "22222222-2222-4222-8222-222222222222",
    }, binding)).toThrow("does not belong to this artifact lifecycle");
    expect(() => reviewSubmissionSchema.parse(submission(4))).toThrow();
  });

  it("defines ReviewState with v5-only artifact, comments, and submission data", () => {
    const state: ReviewState = {
      artifact: artifactManifestSchema.parse(manifest()),
      comments: commentsDocumentSchema.parse(comments()),
      blocks: [],
      markdown: "# Global artifact storage\n",
      lifecycle: { readOnly: false },
      submission: reviewSubmissionSchema.parse(submission()),
    };
    expect(state.artifact.schemaVersion).toBe(5);
    expect(state.comments.schemaVersion).toBe(5);
    expect(state.submission?.reviewSessionId).toBe(reviewSessionId);
  });
});
