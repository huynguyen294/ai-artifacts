import { z } from "zod";
import { artifactConversationIdSchema, artifactIdSchema } from "./contracts";

export const SESSION_WAITER_SCHEMA_VERSION = 1 as const;
export const SESSION_WAITER_DEFAULT_NAME = "Agent" as const;

export const SESSION_WAITER_HEARTBEAT_INTERVAL_MS = 10_000;
export const SESSION_WAITER_LEASE_TTL_MS = 60_000;
export const SESSION_WAITER_POLL_INTERVAL_MS = 1_000;

export const SESSION_WAITER_LOCK_STALE_MS = 60_000;
export const SESSION_WAITER_LOCK_UPDATE_MS = 10_000;
export const SESSION_WAITER_LOCK_RETRIES = 50;
export const SESSION_WAITER_LOCK_RETRY_INTERVAL_MS = 100;

export const SESSION_WAITER_NAME_MAX_LENGTH = 120;
export const SESSION_WAITER_STORED_NAME_MAX_LENGTH = 200;

export const sessionWaitIdSchema = z.string().uuid();

export const sessionWaiterOwnerInstanceIdSchema = z.string().trim().min(1).max(128);

export const waitInSessionInputSchema = z
  .object({
    sessionId: artifactConversationIdSchema,
    waitingFor: z.string().trim().min(1, "waitingFor must not be empty."),
    name: z.string().trim().max(SESSION_WAITER_NAME_MAX_LENGTH).optional(),
    artifactId: artifactIdSchema.optional(),
  })
  .strict();

export type WaitInSessionInput = z.infer<typeof waitInSessionInputSchema>;

export const requestWaiterInSessionInputSchema = z
  .object({
    sessionId: artifactConversationIdSchema,
    waitId: sessionWaitIdSchema,
    requestMessage: z.string().trim().min(1, "requestMessage must not be empty."),
    artifactId: artifactIdSchema.optional(),
  })
  .strict();

export type RequestWaiterInSessionInput = z.infer<typeof requestWaiterInSessionInputSchema>;

export const sessionWaitArtifactReferenceSchema = z
  .object({
    artifactId: artifactIdSchema,
    title: z.string().min(1).max(200),
    artifactPath: z.string().min(1),
    artifactDirectory: z.string().min(1),
  })
  .strict();

export type SessionWaitArtifactReference = z.infer<typeof sessionWaitArtifactReferenceSchema>;

export const sessionWaiterRecordSchema = z
  .object({
    schemaVersion: z.literal(SESSION_WAITER_SCHEMA_VERSION),
    waitId: sessionWaitIdSchema,
    ownerInstanceId: sessionWaiterOwnerInstanceIdSchema,
    name: z.string().trim().min(1).max(SESSION_WAITER_STORED_NAME_MAX_LENGTH),
    waitingFor: z.string().trim().min(1),
    createdAt: z.string().datetime(),
    leaseTtlMs: z.number().int().positive(),
    artifact: sessionWaitArtifactReferenceSchema.optional(),
  })
  .strict();

export type SessionWaiterRecord = z.infer<typeof sessionWaiterRecordSchema>;

export const sessionWaiterSnapshotSchema = sessionWaiterRecordSchema
  .extend({
    heartbeatAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type SessionWaiterSnapshot = z.infer<typeof sessionWaiterSnapshotSchema>;

export const sessionWaiterRequestSchema = z
  .object({
    schemaVersion: z.literal(SESSION_WAITER_SCHEMA_VERSION),
    waitId: sessionWaitIdSchema,
    requestMessage: z.string().trim().min(1),
    createdAt: z.string().datetime(),
    artifact: sessionWaitArtifactReferenceSchema.optional(),
  })
  .strict();

export type SessionWaiterRequest = z.infer<typeof sessionWaiterRequestSchema>;

export const sessionWaitCancelReasonSchema = z.enum([
  "waiter-removed",
  "lease-expired",
  "session-deleted",
]);

export type SessionWaitCancelReason = z.infer<typeof sessionWaitCancelReasonSchema>;

export const sessionWaitResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("requested"),
      sessionId: artifactConversationIdSchema,
      waitId: sessionWaitIdSchema,
      waiter: sessionWaiterSnapshotSchema,
      request: sessionWaiterRequestSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("cancelled"),
      sessionId: artifactConversationIdSchema,
      waitId: sessionWaitIdSchema,
      reason: sessionWaitCancelReasonSchema,
    })
    .strict(),
]);

export type SessionWaitResult = z.infer<typeof sessionWaitResultSchema>;

export const sessionWaitRequestSentSchema = z
  .object({
    status: z.literal("sent"),
    sessionId: artifactConversationIdSchema,
    waitId: sessionWaitIdSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type SessionWaitRequestSent = z.infer<typeof sessionWaitRequestSentSchema>;

export type SessionWaiterErrorDetails = {
  sessionId?: string | undefined;
  waitId?: string | undefined;
};

export class SessionWaiterNotWaitingError extends Error {
  readonly code = "SESSION_WAITER_NOT_WAITING" as const;
  readonly sessionId?: string | undefined;
  readonly waitId?: string | undefined;

  constructor(message: string, details: SessionWaiterErrorDetails = {}) {
    super(`SESSION_WAITER_NOT_WAITING: ${message}`);
    this.name = "SessionWaiterNotWaitingError";
    this.sessionId = details.sessionId;
    this.waitId = details.waitId;
  }
}

export class SessionWaiterRequestExistsError extends Error {
  readonly code = "SESSION_WAITER_REQUEST_EXISTS" as const;
  readonly sessionId?: string | undefined;
  readonly waitId?: string | undefined;

  constructor(message: string, details: SessionWaiterErrorDetails = {}) {
    super(`SESSION_WAITER_REQUEST_EXISTS: ${message}`);
    this.name = "SessionWaiterRequestExistsError";
    this.sessionId = details.sessionId;
    this.waitId = details.waitId;
  }
}

export class SessionWaiterBusyError extends Error {
  readonly code = "SESSION_WAITER_BUSY" as const;
  readonly sessionId?: string | undefined;
  readonly waitId?: string | undefined;

  constructor(message: string, details: SessionWaiterErrorDetails = {}) {
    super(`SESSION_WAITER_BUSY: ${message}`);
    this.name = "SessionWaiterBusyError";
    this.sessionId = details.sessionId;
    this.waitId = details.waitId;
  }
}

export class SessionWaiterLockLostError extends Error {
  readonly code = "SESSION_WAITER_LOCK_LOST" as const;
  readonly sessionId?: string | undefined;
  readonly waitId?: string | undefined;

  constructor(message: string, details: SessionWaiterErrorDetails = {}) {
    super(`SESSION_WAITER_LOCK_LOST: ${message}`);
    this.name = "SessionWaiterLockLostError";
    this.sessionId = details.sessionId;
    this.waitId = details.waitId;
  }
}

export class SessionWaiterIoError extends Error {
  readonly code = "SESSION_WAITER_IO_ERROR" as const;
  readonly sessionId?: string | undefined;
  readonly waitId?: string | undefined;

  constructor(message: string, details: SessionWaiterErrorDetails = {}) {
    super(`SESSION_WAITER_IO_ERROR: ${message}`);
    this.name = "SessionWaiterIoError";
    this.sessionId = details.sessionId;
    this.waitId = details.waitId;
  }
}

/**
 * Allocates the first case-insensitively unique display name for a new Session waiter.
 */
export function allocateUniqueWaiterName(
  requestedName: string | undefined,
  existingNames: Iterable<string>,
): string {
  const trimmed = (requestedName ?? "").trim();
  const baseName = trimmed.length > 0 ? trimmed : SESSION_WAITER_DEFAULT_NAME;
  const occupied = new Set<string>();
  for (const name of existingNames) {
    const normalized = name.trim().toLowerCase();
    if (normalized.length > 0) {
      occupied.add(normalized);
    }
  }

  if (!occupied.has(baseName.toLowerCase())) {
    return baseName;
  }

  for (let suffix = 2; ; suffix++) {
    const candidate = `${baseName} (${suffix})`;
    if (!occupied.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}
