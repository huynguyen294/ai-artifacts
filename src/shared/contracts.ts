import { z } from "zod";

export const ARTIFACT_SCHEMA_VERSION = 2 as const;
export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  kind: z.literal("plan"),
  artifactId: artifactIdSchema,
  title: z.string().min(1),
  createdAt: z.string().datetime(),
  operation: z.enum(["create", "replace"]),
  replacesArtifactId: artifactIdSchema.optional(),
  location: z.object({
    workspaceRoot: z.string().min(1),
  }).strict(),
  origin: z.object({
    threadId: z.string().min(1).optional(),
    turnId: z.string().min(1).optional(),
    codexCwd: z.string().min(1).optional(),
  }).strict(),
}).strict().superRefine((manifest, context) => {
  if (manifest.operation === "replace" && !manifest.replacesArtifactId) {
    context.addIssue({
      code: "custom",
      path: ["replacesArtifactId"],
      message: "A replacement artifact must identify the artifact it replaces.",
    });
  }
  if (manifest.operation === "create" && manifest.replacesArtifactId) {
    context.addIssue({
      code: "custom",
      path: ["replacesArtifactId"],
      message: "A create artifact cannot replace another artifact.",
    });
  }
});

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
  artifactId: z.string().min(1),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  comments: z.array(reviewCommentSchema),
});

export const reviewDecisionSchema = z.enum(["revise", "approve", "save"]);

export const reviewSubmissionSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  artifactId: artifactIdSchema,
  threadId: z.string().min(1),
  submittedAt: z.string().datetime(),
  decision: reviewDecisionSchema,
  planSha256: z.string().regex(/^[a-f0-9]{64}$/),
  commentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

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
