import { z } from "zod";

export const ARTIFACT_SCHEMA_VERSION = 3 as const;
export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const artifactKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  kind: artifactKindSchema,
  artifactId: artifactIdSchema,
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reviewRound: z.number().int().positive(),
  location: z.object({
    workspaceRoot: z.string().min(1),
  }).strict(),
  origin: z.object({
    threadId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    codexCwd: z.string().min(1).optional(),
  }).strict(),
}).strict();

export const reviewCommentSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  block: z.object({
    id: z.string().min(1),
    type: z.enum(["heading", "paragraph", "list-item", "quote", "code"]),
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

export const commentsDocumentSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: artifactIdSchema,
  reviewRound: z.number().int().positive(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  comments: z.array(reviewCommentSchema),
}).strict();

export const reviewDecisionSchema = z.enum(["revise", "approve", "save"]);

export const reviewSubmissionSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: artifactIdSchema,
  reviewRound: z.number().int().positive(),
  threadId: z.string().min(1),
  submittedAt: z.string().datetime(),
  decision: reviewDecisionSchema,
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  commentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type CommentsDocument = z.infer<typeof commentsDocumentSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;

export type MarkdownBlock = {
  id: string;
  index: number;
  type: ReviewComment["block"]["type"];
  text: string;
  heading: string | null;
  level?: number;
  language?: string;
};

export type ReviewState = {
  artifact: ArtifactManifest;
  comments: CommentsDocument;
  blocks: MarkdownBlock[];
  markdown: string;
  submission?: ReviewSubmission;
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
  z.object({ type: z.literal("ready") }),
]);

export type CommentDraft = z.infer<typeof commentDraftSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;

export type SendStatus = "idle" | "submitting" | "submitted" | "error";

export type ExtensionToWebviewMessage =
  | { type: "state"; state: ReviewState }
  | { type: "sendState"; status: SendStatus; message?: string; retryable?: boolean }
  | { type: "error"; message: string };
