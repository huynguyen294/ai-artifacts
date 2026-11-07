import { z } from "zod";

export const ARTIFACT_SCHEMA_VERSION = 6 as const;
export const ARTIFACT_CONNECTION_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_CONVERSATION_SCHEMA_VERSION = 1 as const;
export const WORK_SESSION_SCHEMA_VERSION = 2 as const;
export const WORK_SESSION_LAYOUT_SCHEMA_VERSION = 1 as const;
export const SESSION_TYPES_SCHEMA_VERSION = 1 as const;
export const DEFAULT_SESSION_TYPE_ID = "conversation" as const;
export const INTEGRATION_VERSION_SCHEMA_VERSION = 1 as const;
export const MCP_VERSION = 12 as const;
export const SKILL_VERSION = 4 as const;
export const ARTIFACT_ROOT_BLOCK_ID = "__artifact_root__" as const;
export const ARTIFACT_ROOT_BLOCK_TYPE = "artifact" as const;
export const ARTIFACT_ROOT_TEXT = "Applies to the entire artifact" as const;
export const artifactIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const artifactKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const artifactConversationIdSchema = z.string().uuid();
export const installedSkillVersionsSchema = z
  .object({
    agents: z.number().int().positive().optional(),
    claude: z.number().int().positive().optional(),
  })
  .strict();
export const integrationVersionManifestSchema = z
  .object({
    schemaVersion: z.literal(INTEGRATION_VERSION_SCHEMA_VERSION),
    mcpVersion: z.number().int().positive().optional(),
    skills: installedSkillVersionsSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();
export type InstalledSkillVersions = z.infer<typeof installedSkillVersionsSchema>;
export type IntegrationVersionManifest = z.infer<typeof integrationVersionManifestSchema>;
export const conversationNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, {
    message: "conversationName must not be blank.",
  });

export const artifactConnectionSourceSchema = z.enum(["create", "inspect"]);
export type ArtifactConnectionSource = z.infer<typeof artifactConnectionSourceSchema>;

export const artifactConnectionSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_CONNECTION_SCHEMA_VERSION),
    windowInstanceId: z.string().uuid(),
    connectionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    openRequestId: z.string().uuid(),
    source: artifactConnectionSourceSchema,
    updatedAt: z.string().datetime(),
  })
  .strict();

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

export const explicitWindowConnectionInputSchema = z
  .object({
    targetMode: z.literal("explicit-window"),
    selectionToken: z.string().uuid(),
  })
  .strict();

export type ExplicitWindowConnectionInput = z.infer<typeof explicitWindowConnectionInputSchema>;

export const artifactWindowConnectionInputSchema = z
  .object({
    targetMode: z.literal("artifact-window"),
    windowInstanceId: z.string().uuid(),
  })
  .strict();

export type ArtifactWindowConnectionInput = z.infer<typeof artifactWindowConnectionInputSchema>;

export const reconnectConnectionInputSchema = z.discriminatedUnion("targetMode", [
  artifactWindowConnectionInputSchema,
  explicitWindowConnectionInputSchema,
]);

export type ReconnectConnectionInput = z.infer<typeof reconnectConnectionInputSchema>;

export const artifactManifestSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
    kind: artifactKindSchema,
    artifactId: artifactIdSchema,
    title: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    reviewRound: z.number().int().positive(),
    reviewSessionId: z.string().uuid(),
  })
  .strict();

export const markdownBlockTypeSchema = z.enum(["heading", "paragraph", "list-item", "quote", "code", "table-cell"]);

const reviewCommentBaseShape = {
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
};

const markdownCommentBlockIdSchema = z
  .string()
  .min(1)
  .refine((value) => value !== ARTIFACT_ROOT_BLOCK_ID, {
    message: "The artifact root block ID is reserved for artifact-wide comments.",
  });

const markdownReviewCommentSchema = z.object({
  ...reviewCommentBaseShape,
  block: z.object({
    id: markdownCommentBlockIdSchema,
    type: markdownBlockTypeSchema,
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

const artifactReviewCommentSchema = z.object({
  ...reviewCommentBaseShape,
  block: z.object({
    id: z.literal(ARTIFACT_ROOT_BLOCK_ID),
    type: z.literal(ARTIFACT_ROOT_BLOCK_TYPE),
    heading: z.null(),
  }),
  selection: z.object({
    quote: z.literal(ARTIFACT_ROOT_TEXT),
    start: z.literal(0),
    end: z.literal(ARTIFACT_ROOT_TEXT.length),
    prefix: z.literal(""),
    suffix: z.literal(""),
  }),
  body: z.string().min(1),
});

export const reviewCommentSchema = z.union([markdownReviewCommentSchema, artifactReviewCommentSchema]);

export const commentsDocumentSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
    artifactId: artifactIdSchema,
    reviewRound: z.number().int().positive(),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    comments: z.array(reviewCommentSchema),
  })
  .strict();

export const reviewDecisionSchema = z.enum(["revise", "approve", "save"]);

export const reviewSubmissionSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_SCHEMA_VERSION),
    artifactId: artifactIdSchema,
    reviewRound: z.number().int().positive(),
    reviewSessionId: z.string().uuid(),
    submittedAt: z.string().datetime(),
    decision: reviewDecisionSchema,
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    commentsSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export type CommentsDocument = z.infer<typeof commentsDocumentSchema>;
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;
export type ReviewSubmission = z.infer<typeof reviewSubmissionSchema>;
export type MarkdownBlockType = z.infer<typeof markdownBlockTypeSchema>;

export type MarkdownBlock = {
  id: string;
  index: number;
  type: MarkdownBlockType;
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

export const artifactConversationMetadataSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_CONVERSATION_SCHEMA_VERSION),
    artifactConversationId: artifactConversationIdSchema,
    conversationName: conversationNameSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type ArtifactConversationMetadata = z.infer<typeof artifactConversationMetadataSchema>;

export const artifactConversationMembershipSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_CONVERSATION_SCHEMA_VERSION),
    artifactConversationId: artifactConversationIdSchema,
    artifactId: artifactIdSchema,
    registeredAt: z.string().datetime(),
  })
  .strict();

export type ArtifactConversationMembership = z.infer<typeof artifactConversationMembershipSchema>;

export const sessionTitleSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, {
    message: "Session title must not be blank.",
  });

export const sessionTypeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value.trim().length > 0, {
    message: "Session typeId must not be blank.",
  });

export const sessionInstructionsSchema = z.string();

export const workSessionMetadataSchema = z
  .object({
    schemaVersion: z.literal(WORK_SESSION_SCHEMA_VERSION),
    sessionId: artifactConversationIdSchema,
    title: sessionTitleSchema,
    typeId: sessionTypeIdSchema,
    instructions: sessionInstructionsSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type WorkSessionMetadata = z.infer<typeof workSessionMetadataSchema>;

export const workSessionLayoutSchema = z
  .object({
    schemaVersion: z.literal(WORK_SESSION_LAYOUT_SCHEMA_VERSION),
    working: z.array(artifactIdSchema),
    references: z.array(artifactIdSchema),
    archived: z.array(artifactIdSchema),
  })
  .strict();

export type WorkSessionLayout = z.infer<typeof workSessionLayoutSchema>;

export type WorkSession = WorkSessionMetadata & {
  working: string[];
  references: string[];
  archived: string[];
  updatedAt: string;
};

export const sessionTypeSchema = z
  .object({
    id: sessionTypeIdSchema,
    label: z
      .string()
      .min(1)
      .max(100)
      .refine((val) => val.trim().length > 0, {
        message: "Session type label must not be blank.",
      }),
  })
  .strict();

export type SessionType = z.infer<typeof sessionTypeSchema>;

export const sessionTypesDocumentSchema = z
  .object({
    schemaVersion: z.literal(SESSION_TYPES_SCHEMA_VERSION),
    types: z.array(sessionTypeSchema),
  })
  .strict();

export type SessionTypesDocument = z.infer<typeof sessionTypesDocumentSchema>;

export class ConversationMigrationRequiredError extends Error {
  readonly code = "CONVERSATION_MIGRATION_REQUIRED" as const;
  readonly artifactConversationId: string;
  constructor(artifactConversationId: string) {
    super(
      `CONVERSATION_MIGRATION_REQUIRED: Conversation ${artifactConversationId} must be migrated to a Session before it can be used.`,
    );
    this.name = "ConversationMigrationRequiredError";
    this.artifactConversationId = artifactConversationId;
  }
}

export const artifactConversationInputSchema = z
  .object({
    artifactConversationId: artifactConversationIdSchema.optional(),
    conversationName: conversationNameSchema.optional(),
  })
  .strict();

export type ArtifactConversationInput = z.infer<typeof artifactConversationInputSchema>;

export const conversationArtifactItemSchema = z
  .object({
    artifactId: artifactIdSchema,
    title: z.string().min(1).max(200),
    kind: artifactKindSchema,
    registeredAt: z.string().datetime(),
    isCurrent: z.boolean(),
  })
  .strict();

export type ConversationArtifactItem = z.infer<typeof conversationArtifactItemSchema>;

export const conversationArtifactGroupSchema = z
  .object({
    artifactConversationId: artifactConversationIdSchema,
    conversationName: conversationNameSchema,
    currentArtifactRegisteredAt: z.string().datetime(),
    artifacts: z.array(conversationArtifactItemSchema),
  })
  .strict();

export type ConversationArtifactGroup = z.infer<typeof conversationArtifactGroupSchema>;

export const conversationArtifactsViewStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("loading") }).strict(),
  z
    .object({
      status: z.literal("ready"),
      groups: z.array(conversationArtifactGroupSchema),
      skippedCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      status: z.literal("error"),
      message: z.string().min(1),
    })
    .strict(),
]);

export type ConversationArtifactsViewState = z.infer<typeof conversationArtifactsViewStateSchema>;

export const artifactSessionTargetSchema = z
  .object({
    sessionId: artifactConversationIdSchema,
    title: z.string().min(1),
    version: z.union([z.literal(1), z.literal(2)]),
    typeId: sessionTypeIdSchema.optional(),
    typeLabel: z.string().optional(),
  })
  .strict();

export type ArtifactSessionTarget = z.infer<typeof artifactSessionTargetSchema>;

export const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  commentDraftSchema.extend({ type: z.literal("addComment") }),
  z.object({ type: z.literal("removeComment"), commentId: z.string().uuid() }),
  z.object({ type: z.literal("submitReview"), decision: reviewDecisionSchema }),
  z
    .object({
      type: z.literal("copyArtifactConnectPrompt"),
      mode: z.enum(["new", "join"]).optional(),
      sessionId: artifactConversationIdSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("openExternal"), url: z.string().url() }),
  z.object({ type: z.literal("openConversationArtifact"), artifactId: artifactIdSchema }).strict(),
  z.object({ type: z.literal("openArtifactSessions") }).strict(),
  z.object({ type: z.literal("migrateSelectedConversation"), sessionId: artifactConversationIdSchema }).strict(),
  z.object({ type: z.literal("ready") }),
]);

export type CommentDraft = z.infer<typeof commentDraftSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;

export type SendStatus = "idle" | "submitting" | "submitted" | "error";

export type ExtensionToWebviewMessage =
  | { type: "state"; state: ReviewState }
  | {
      type: "artifactSessionsState";
      supported: boolean;
      sessions: ArtifactSessionTarget[];
    }
  | { type: "sendState"; status: SendStatus; message?: string; retryable?: boolean }
  | { type: "artifactConnectPromptCopied" }
  | { type: "error"; message: string };

export const workSessionArtifactRowSchema = z
  .object({
    artifactId: artifactIdSchema,
    title: z.string().min(1),
    kind: artifactKindSchema,
    updatedAt: z.string().datetime(),
    unavailable: z.boolean().optional(),
  })
  .strict();
export type WorkSessionArtifactRow = z.infer<typeof workSessionArtifactRowSchema>;

export const workSessionViewDataSchema = z
  .object({
    sessionId: artifactConversationIdSchema,
    title: sessionTitleSchema,
    typeId: sessionTypeIdSchema,
    typeLabel: z.string().min(1),
    instructions: sessionInstructionsSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    working: z.array(workSessionArtifactRowSchema),
    references: z.array(workSessionArtifactRowSchema),
    archived: z.array(workSessionArtifactRowSchema),
  })
  .strict();
export type WorkSessionViewData = z.infer<typeof workSessionViewDataSchema>;

export type WorkSessionDataChange =
  | { kind: "metadata"; sessionId: string }
  | { kind: "membership"; sessionId: string; artifactId: string }
  | { kind: "layout"; sessionId: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "types" }
  | { kind: "support" };

export type WorkSessionSummary = {
  title: string;
  typeId: string;
  typeLabel: string;
  updatedAt: string;
};

export const sessionWebviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("openArtifact"), artifactId: artifactIdSchema }).strict(),
  z.object({ type: z.literal("openExternal"), url: z.string().url() }).strict(),
  z.object({ type: z.literal("renameSession") }).strict(),
  z.object({ type: z.literal("saveSessionInstructions"), instructions: sessionInstructionsSchema }).strict(),
  z.object({ type: z.literal("selectSessionType") }).strict(),
  z
    .object({
      type: z.literal("moveArtifact"),
      artifactId: artifactIdSchema,
      zone: z.enum(["working", "references", "archived"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("reorderArtifact"),
      artifactId: artifactIdSchema,
      direction: z.enum(["up", "down"]),
    })
    .strict(),
  z.object({ type: z.literal("removeArtifact"), artifactId: artifactIdSchema }).strict(),
  z.object({ type: z.literal("setSessionPanelExpanded"), expanded: z.boolean() }).strict(),
]);
export type SessionWebviewToExtensionMessage = z.infer<typeof sessionWebviewToExtensionMessageSchema>;

export type SessionExtensionToWebviewMessage =
  | {
      type: "workSessionState";
      state: { status: "ready"; data: WorkSessionViewData } | { status: "error"; message: string };
      panelExpanded?: boolean;
    }
  | {
      type: "workSessionSummaryPatch";
      summary: WorkSessionSummary;
    }
  | {
      type: "workSessionArtifactsPatch";
      working: WorkSessionArtifactRow[];
      references: WorkSessionArtifactRow[];
      archived: WorkSessionArtifactRow[];
      updatedAt: string;
    }
  | {
      type: "sessionInstructionsSaved";
      instructions: string;
    }
  | {
      type: "sessionPanelExpanded";
      expanded: boolean;
    }
  | {
      type: "actionError";
      action: string;
      message: string;
    }
  | { type: "error"; message: string };
