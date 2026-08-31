import { z } from "zod";

export const LEGACY_ARTIFACT_SCHEMA_VERSION = 3 as const;
export const ARTIFACT_SCHEMA_VERSION = 4 as const;
export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const artifactKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

const artifactManifestBaseSchema = z.object({
  kind: artifactKindSchema,
  artifactId: artifactIdSchema,
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reviewRound: z.number().int().positive(),
  location: z.object({
    workspaceRoot: z.string().min(1),
  }).strict(),
});

export const artifactManifestSchema = artifactManifestBaseSchema.extend({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  reviewSessionId: z.string().uuid(),
}).strict();

export const legacyArtifactManifestSchema = artifactManifestBaseSchema.extend({
  schemaVersion: z.literal(LEGACY_ARTIFACT_SCHEMA_VERSION),
  origin: z.object({
    threadId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    codexCwd: z.string().min(1).optional(),
  }).strict(),
}).strict();

export const anyArtifactManifestSchema = z.union([
  artifactManifestSchema,
  legacyArtifactManifestSchema,
]);

export const reviewCommentSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  block: z.object({
    id: z.string().min(1),
    type: z.enum(["heading", "paragraph", "list-item", "quote", "code", "table-cell"]),
    heading: z.string().nullable(),
  }),
  selection: z.object({
    quote: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    prefix: z.string(),
    suffix: z.string(),
  }),
  body: z.string().min(1),
});

const commentsDocumentBaseSchema = z.object({
  artifactId: artifactIdSchema,
  reviewRound: z.number().int().positive(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  comments: z.array(reviewCommentSchema),
});

export const commentsDocumentSchema = commentsDocumentBaseSchema.extend({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
}).strict();

export const legacyCommentsDocumentSchema = commentsDocumentBaseSchema.extend({
  schemaVersion: z.literal(LEGACY_ARTIFACT_SCHEMA_VERSION),
}).strict();

export const anyCommentsDocumentSchema = z.union([
  commentsDocumentSchema,
  legacyCommentsDocumentSchema,
]);

export const reviewDecisionSchema = z.enum(["revise", "approve", "save"]);

const reviewSubmissionBaseSchema = z.object({
  artifactId: artifactIdSchema,
  reviewRound: z.number().int().positive(),
  submittedAt: z.string().datetime(),
  decision: reviewDecisionSchema,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  commentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const reviewSubmissionSchema = reviewSubmissionBaseSchema.extend({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  reviewSessionId: z.string().uuid(),
}).strict();

export const legacyReviewSubmissionSchema = reviewSubmissionBaseSchema.extend({
  schemaVersion: z.literal(LEGACY_ARTIFACT_SCHEMA_VERSION),
  threadId: z.string().min(1),
}).strict();

export const anyReviewSubmissionSchema = z.union([
  reviewSubmissionSchema,
  legacyReviewSubmissionSchema,
]);

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type LegacyArtifactManifest = z.infer<typeof legacyArtifactManifestSchema>;
export type AnyArtifactManifest = z.infer<typeof anyArtifactManifestSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type CommentsDocument = z.infer<typeof commentsDocumentSchema>;
export type LegacyCommentsDocument = z.infer<typeof legacyCommentsDocumentSchema>;
export type AnyCommentsDocument = z.infer<typeof anyCommentsDocumentSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;
export type LegacyReviewSubmission = z.infer<typeof legacyReviewSubmissionSchema>;
export type AnyReviewSubmission = z.infer<typeof anyReviewSubmissionSchema>;

export type MarkdownBlock = {
  id: string;
  index: number;
  type: ReviewComment["block"]["type"];
  text: string;
  heading: string | null;
  sourceStart: number;
  sourceEnd: number;
  level?: number;
  language?: string;
};

export type ReviewState = {
  artifact: AnyArtifactManifest;
  comments: AnyCommentsDocument;
  blocks: MarkdownBlock[];
  markdown: string;
  lifecycle: {
    readOnly: boolean;
    message?: string;
  };
  submission?: AnyReviewSubmission;
};

export const commentDraftSchema = z.object({
  blockId: z.string().min(1),
  selection: z.object({
    quote: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
  body: z.string().min(1),
});

export const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  commentDraftSchema.extend({ type: z.literal("addComment") }),
  z.object({ type: z.literal("removeComment"), commentId: z.string().uuid() }),
  z.object({ type: z.literal("submitReview"), decision: reviewDecisionSchema }),
  z.object({ type: z.literal("openExternal"), url: z.string().url() }),
  z.object({ type: z.literal("ready") }),
]);

export type CommentDraft = z.infer<typeof commentDraftSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;

export type SendStatus = "idle" | "submitting" | "submitted" | "error";

export type ExtensionToWebviewMessage =
  | { type: "state"; state: ReviewState }
  | { type: "sendState"; status: SendStatus; message?: string; retryable?: boolean }
  | { type: "error"; message: string };
