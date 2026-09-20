import { z } from "zod";

export const ARTIFACT_SCHEMA_VERSION = 6 as const;
export const ARTIFACT_CONNECTION_SCHEMA_VERSION = 1 as const;
export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const artifactKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const artifactConnectionSourceSchema = z.enum(["create", "inspect"]);
export type ArtifactConnectionSource = z.infer<typeof artifactConnectionSourceSchema>;

export const artifactConnectionSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_CONNECTION_SCHEMA_VERSION),
  windowInstanceId: z.string().uuid(),
  connectionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  openRequestId: z.string().uuid(),
  source: artifactConnectionSourceSchema,
  updatedAt: z.string().datetime(),
}).strict();

export type ArtifactConnection = z.infer<typeof artifactConnectionSchema>;

export const WINDOW_SELECTION_TTL_MS = 10 * 60 * 1000;

export class ArtifactConnectionInvalidError extends Error {
  readonly code = "ARTIFACT_CONNECTION_INVALID" as const;
  constructor(message: string) {
    super(`ARTIFACT_CONNECTION_INVALID: ${message}`);
    this.name = "ArtifactConnectionInvalidError";
  }
}

export class ArtifactConnectionWriteError extends Error {
  readonly code = "ARTIFACT_CONNECTION_WRITE_FAILED" as const;
  constructor(message: string) {
    super(`ARTIFACT_CONNECTION_WRITE_FAILED: ${message}`);
    this.name = "ArtifactConnectionWriteError";
  }
}

export class WindowSelectionRequiredError extends Error {
  readonly code = "WINDOW_SELECTION_REQUIRED" as const;
  readonly candidates?: unknown;
  constructor(message: string, candidates?: unknown) {
    super(`WINDOW_SELECTION_REQUIRED: ${message}`);
    this.name = "WindowSelectionRequiredError";
    this.candidates = candidates;
  }
}

export class WindowSelectionExpiredError extends Error {
  readonly code = "WINDOW_SELECTION_EXPIRED" as const;
  readonly candidates?: unknown;
  constructor(message: string, candidates?: unknown) {
    super(`WINDOW_SELECTION_EXPIRED: ${message}`);
    this.name = "WindowSelectionExpiredError";
    this.candidates = candidates;
  }
}

export class WindowNotFoundError extends Error {
  readonly code = "WINDOW_NOT_FOUND" as const;
  constructor(message: string) {
    super(`WINDOW_NOT_FOUND: ${message}`);
    this.name = "WindowNotFoundError";
  }
}

/**
 * @deprecated Legacy error kept for backward-compatibility during multi-package cutover.
 */
export class WindowConnectionStaleError extends Error {
  readonly code = "WINDOW_CONNECTION_STALE" as const;
  constructor(message: string) {
    super(`WINDOW_CONNECTION_STALE: ${message}`);
    this.name = "WindowConnectionStaleError";
  }
}

/**
 * @deprecated Legacy error kept for backward-compatibility during multi-package cutover.
 */
export class WindowConnectionMismatchError extends Error {
  readonly code = "WINDOW_CONNECTION_MISMATCH" as const;
  constructor(message: string) {
    super(`WINDOW_CONNECTION_MISMATCH: ${message}`);
    this.name = "WindowConnectionMismatchError";
  }
}

export const explicitWindowConnectionInputSchema = z.object({
  targetMode: z.literal("explicit-window"),
  selectionToken: z.string().uuid(),
}).strict();

export type ExplicitWindowConnectionInput = z.infer<typeof explicitWindowConnectionInputSchema>;

export const artifactWindowConnectionInputSchema = z.object({
  targetMode: z.literal("artifact-window"),
  windowInstanceId: z.string().uuid(),
}).strict();

export type ArtifactWindowConnectionInput = z.infer<typeof artifactWindowConnectionInputSchema>;

export const reconnectConnectionInputSchema = z.discriminatedUnion("targetMode", [
  artifactWindowConnectionInputSchema,
  explicitWindowConnectionInputSchema,
]);

export type ReconnectConnectionInput = z.infer<typeof reconnectConnectionInputSchema>;

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
  kind: artifactKindSchema,
  artifactId: artifactIdSchema,
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  reviewRound: z.number().int().positive(),
  reviewSessionId: z.string().uuid(),
}).strict();

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
  reviewSessionId: z.string().uuid(),
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
  sourceStart: number;
  sourceEnd: number;
  level?: number;
  language?: string;
};

export type ReviewState = {
  artifact: ArtifactManifest;
  comments: CommentsDocument;
  blocks: MarkdownBlock[];
  markdown: string;
  lifecycle: {
    readOnly: boolean;
    message?: string;
  };
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
