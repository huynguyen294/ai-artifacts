import { watch as watchFs, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { ConversationNotFoundError } from "../shared/conversation-artifact-registry";
import {
  SESSION_WAITER_HEARTBEAT_INTERVAL_MS,
  SESSION_WAITER_POLL_INTERVAL_MS,
  SessionWaitRequestSent,
  SessionWaitResult,
  SessionWaiterIoError,
  SessionWaiterLockLostError,
  SessionWaiterNotWaitingError,
  WaitInSessionInput,
  RequestWaiterInSessionInput,
  waitInSessionInputSchema,
  requestWaiterInSessionInputSchema,
} from "../shared/session-waiter-contracts";
import {
  type RegisterSessionWaiterResult,
  type SessionWaiterStoreOptions,
  type SessionWaiterTimingOptions,
  cancelSessionWaiter,
  claimSessionWaiterRequest,
  isWorkSessionDeleted,
  registerSessionWaiter,
  renewSessionWaiterLease,
  sendSessionWaiterRequest,
} from "../shared/session-waiter-store";

export type SessionWaiterRuntimeOptions = GlobalArtifactsRootOptions & {
  getRootOptions?: () => GlobalArtifactsRootOptions;
  ownerInstanceId?: string;
  timing?: SessionWaiterTimingOptions;
  now?: () => Date;
  onReady?: (event: { sessionId: string; waitId: string }) => void;
};

export type SessionWaitInSessionCallOptions = {
  signal?: AbortSignal;
};

export type SessionWaiterRuntime = {
  readonly ownerInstanceId: string;
  waitInSession: (
    input: WaitInSessionInput,
    options?: SessionWaitInSessionCallOptions,
  ) => Promise<SessionWaitResult>;
  requestWaiterInSession: (
    input: RequestWaiterInSessionInput,
  ) => Promise<SessionWaitRequestSent>;
  shutdown: () => Promise<void>;
};

function createAbortError(message = "Session wait was cancelled."): Error {
  return Object.assign(new Error(message), { name: "AbortError" });
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function matchesWaitIdFilename(filename: string | Buffer | null, waitId: string): boolean {
  if (filename == null) {
    return true;
  }
  return String(filename).toLowerCase() === `${waitId}.json`.toLowerCase();
}

/**
 * Creates a per-process Session Waiters runtime coordinating registration, watchers, polling,
 * mtime heartbeats, atomic request claim, and transport cancellation cleanup.
 */
export function createSessionWaiterRuntime(
  runtimeOptions: SessionWaiterRuntimeOptions = {},
): SessionWaiterRuntime {
  const ownerInstanceId = runtimeOptions.ownerInstanceId ?? randomUUID();
  const activeWaits = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();

  const resolveRootOptions = (): GlobalArtifactsRootOptions => {
    if (runtimeOptions.getRootOptions) {
      return runtimeOptions.getRootOptions();
    }
    return runtimeOptions.userHome !== undefined
      ? { userHome: runtimeOptions.userHome }
      : {};
  };

  const buildBaseStoreOptions = (
    onLockCompromised?: (error: Error) => void,
  ): SessionWaiterStoreOptions => ({
    ...resolveRootOptions(),
    ...(runtimeOptions.timing ? { timing: runtimeOptions.timing } : {}),
    ...(runtimeOptions.now ? { now: runtimeOptions.now } : {}),
    ...(onLockCompromised ? { onLockCompromised } : {}),
  });

  async function waitInSession(
    rawInput: WaitInSessionInput,
    callOptions: SessionWaitInSessionCallOptions = {},
  ): Promise<SessionWaitResult> {
    if (callOptions.signal?.aborted) {
      throw createAbortError();
    }

    const input = waitInSessionInputSchema.parse(rawInput);
    const waitController = new AbortController();
    const compromisedState: { error: Error | null } = { error: null };

    const forwardExternalAbort = (): void => {
      waitController.abort(callOptions.signal?.reason);
    };
    if (callOptions.signal) {
      callOptions.signal.addEventListener("abort", forwardExternalAbort, { once: true });
      if (callOptions.signal.aborted) {
        waitController.abort(callOptions.signal.reason);
      }
    }

    const waitStoreOptions = buildBaseStoreOptions((err) => {
      compromisedState.error = err;
      waitController.abort(err);
    });

    if (waitController.signal.aborted) {
      callOptions.signal?.removeEventListener("abort", forwardExternalAbort);
      throw compromisedState.error
        ? new SessionWaiterLockLostError(compromisedState.error.message, {
            sessionId: input.sessionId,
          })
        : createAbortError();
    }

    const waitId = randomUUID();
    let resolveDone!: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    activeWaits.set(waitId, {
      controller: waitController,
      done: donePromise,
    });

    const heartbeatIntervalMs =
      runtimeOptions.timing?.heartbeatIntervalMs ?? SESSION_WAITER_HEARTBEAT_INTERVAL_MS;
    const pollIntervalMs =
      runtimeOptions.timing?.pollIntervalMs ?? SESSION_WAITER_POLL_INTERVAL_MS;

    let waitersWatcher: FSWatcher | undefined;
    let requestsWatcher: FSWatcher | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let inFlightDrain: Promise<void> | null = null;
    let resultOutcome: SessionWaitResult | null = null;
    let registeredWaiter: RegisterSessionWaiterResult | null = null;
    let registrationError: unknown = null;

    try {
      let registered: RegisterSessionWaiterResult;
      try {
        registered = await registerSessionWaiter(
          {
            sessionId: input.sessionId,
            waitId,
            ownerInstanceId,
            waitingFor: input.waitingFor,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
          },
          waitStoreOptions,
        );
        registeredWaiter = registered;
      } catch (error) {
        registrationError = error;
        throw error;
      }

      if (waitController.signal.aborted) {
        const compromisedError = compromisedState.error;
        if (!compromisedError) {
          throw createAbortError();
        }
        if (await isWorkSessionDeleted(registered.sessionId, resolveRootOptions(), true)) {
          resultOutcome = {
            status: "cancelled",
            sessionId: registered.sessionId,
            waitId: registered.waitId,
            reason: "session-deleted",
          };
          return resultOutcome;
        }
        throw new SessionWaiterLockLostError(
          `Session waiter lock was lost: ${compromisedError.message}`,
          { sessionId: registered.sessionId, waitId: registered.waitId },
        );
      }
      const outcome = await new Promise<SessionWaitResult>((resolve, reject) => {
        let settled = false;
        let wantCheck = false;
        let wantHeartbeat = false;

        const stopObserving = (): void => {
          waitersWatcher?.close();
          waitersWatcher = undefined;
          requestsWatcher?.close();
          requestsWatcher = undefined;
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
          }
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = undefined;
          }
          waitController.signal.removeEventListener("abort", onAbort);
        };

        const finishValue = (value: SessionWaitResult): void => {
          if (settled) {
            return;
          }
          settled = true;
          stopObserving();
          resolve(value);
        };

        const finishError = (error: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          stopObserving();
          reject(error);
        };

        const onAbort = (): void => {
          if (settled) {
            return;
          }
          const compromisedError = compromisedState.error;
          if (!compromisedError) {
            finishError(createAbortError());
            return;
          }
          stopObserving();
          void isWorkSessionDeleted(registered.sessionId, resolveRootOptions(), true)
            .then((deleted) => {
              if (deleted) {
                finishValue({
                  status: "cancelled",
                  sessionId: registered.sessionId,
                  waitId: registered.waitId,
                  reason: "session-deleted",
                });
                return;
              }
              finishError(
                new SessionWaiterLockLostError(
                  `Session waiter lock was lost: ${compromisedError.message}`,
                  { sessionId: registered.sessionId, waitId: registered.waitId },
                ),
              );
            })
            .catch(() => {
              finishError(
                new SessionWaiterLockLostError(
                  `Session waiter lock was lost: ${compromisedError.message}`,
                  { sessionId: registered.sessionId, waitId: registered.waitId },
                ),
              );
            });
        };

        const drainQueue = async (): Promise<void> => {
          try {
            while (!settled && (wantCheck || wantHeartbeat)) {
              if (waitController.signal.aborted) {
                onAbort();
                return;
              }

              const doCheck = wantCheck;
              const doHeartbeat = wantHeartbeat;
              wantCheck = false;
              wantHeartbeat = false;

              if (doCheck) {
                const claim = await claimSessionWaiterRequest(
                  {
                    sessionId: registered.sessionId,
                    waitId: registered.waitId,
                    ownerInstanceId,
                  },
                  waitStoreOptions,
                );
                if (settled) {
                  return;
                }
                if (claim.status === "requested") {
                  finishValue({
                    status: "requested",
                    sessionId: claim.sessionId,
                    waitId: claim.waitId,
                    waiter: claim.waiter,
                    request: claim.request,
                  });
                  return;
                }
                if (claim.status === "cancelled") {
                  finishValue({
                    status: "cancelled",
                    sessionId: claim.sessionId,
                    waitId: claim.waitId,
                    reason: claim.reason,
                  });
                  return;
                }
              }

              if (!settled && doHeartbeat) {
                if (waitController.signal.aborted) {
                  onAbort();
                  return;
                }
                const renewed = await renewSessionWaiterLease(
                  {
                    sessionId: registered.sessionId,
                    waitId: registered.waitId,
                    ownerInstanceId,
                  },
                  waitStoreOptions,
                );
                if (settled) {
                  return;
                }
                if (renewed.status === "cancelled") {
                  finishValue({
                    status: "cancelled",
                    sessionId: registered.sessionId,
                    waitId: registered.waitId,
                    reason: renewed.reason,
                  });
                  return;
                }
              }
            }
          } catch (error) {
            finishError(error);
          }
        };

        const ensureDrainStarted = (): void => {
          if (settled || inFlightDrain) {
            return;
          }
          inFlightDrain = drainQueue().finally(() => {
            inFlightDrain = null;
            if (!settled && (wantCheck || wantHeartbeat)) {
              ensureDrainStarted();
            }
          });
        };

        const scheduleCheck = (): void => {
          if (settled) {
            return;
          }
          wantCheck = true;
          ensureDrainStarted();
        };

        const scheduleHeartbeat = (): void => {
          if (settled) {
            return;
          }
          wantHeartbeat = true;
          ensureDrainStarted();
        };

        waitController.signal.addEventListener("abort", onAbort, { once: true });
        if (waitController.signal.aborted) {
          onAbort();
          return;
        }

        const handleWatcherError = (error: unknown): void => {
          const code = errorCode(error);
          if (code === "ENOENT" || code === "EPERM" || code === "EACCES" || code === "EBUSY") {
            scheduleCheck();
            return;
          }
          finishError(error);
        };

        waitersWatcher = watchFs(
          registered.waitersDirectory,
          { persistent: true },
          (_event, filename) => {
            if (matchesWaitIdFilename(filename, registered.waitId)) {
              scheduleCheck();
            }
          },
        );
        waitersWatcher.on("error", handleWatcherError);

        requestsWatcher = watchFs(
          registered.waiterRequestsDirectory,
          { persistent: true },
          (_event, filename) => {
            if (matchesWaitIdFilename(filename, registered.waitId)) {
              scheduleCheck();
            }
          },
        );
        requestsWatcher.on("error", handleWatcherError);

        pollTimer = setInterval(scheduleCheck, pollIntervalMs);
        heartbeatTimer = setInterval(scheduleHeartbeat, heartbeatIntervalMs);

        if (
          process.env.NODE_ENV === "test"
          && process.env.CODEX_ARTIFACTS_TEST_WAIT_READY === "1"
        ) {
          process.stderr.write(
            `SESSION_WAITER_READY:${registered.sessionId}:${registered.waitId}\n`,
          );
        }
        runtimeOptions.onReady?.({
          sessionId: registered.sessionId,
          waitId: registered.waitId,
        });

        // Perform an immediate check after watcher attachment to catch requests written during startup.
        scheduleCheck();
      });

      resultOutcome = outcome;
      return outcome;
    } finally {
      callOptions.signal?.removeEventListener("abort", forwardExternalAbort);
      waitersWatcher?.close();
      requestsWatcher?.close();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }

      if (inFlightDrain) {
        await Promise.allSettled([inFlightDrain]);
      }

      const alreadyCleanedByTerminalResult =
        resultOutcome?.status === "requested"
        || (resultOutcome?.status === "cancelled" && resultOutcome.reason === "session-deleted");
      const shouldCancelWaiter =
        registeredWaiter !== null
        || registrationError instanceof SessionWaiterLockLostError
        || registrationError instanceof SessionWaiterIoError;

      if (!alreadyCleanedByTerminalResult && shouldCancelWaiter) {
        const cleanupStoreOptions = buildBaseStoreOptions();
        try {
          await cancelSessionWaiter(
            {
              sessionId: registeredWaiter?.sessionId ?? input.sessionId,
              waitId: registeredWaiter?.waitId ?? waitId,
              expectedOwnerInstanceId: ownerInstanceId,
            },
            cleanupStoreOptions,
          );
        } catch (cleanupError) {
          if (
            !(cleanupError instanceof ConversationNotFoundError)
            && !(cleanupError instanceof SessionWaiterNotWaitingError)
          ) {
            // Preserve the primary error or allow best-effort abort teardown without recreating dirs.
          }
        }
      }

      activeWaits.delete(waitId);
      resolveDone();
    }
  }

  async function requestWaiterInSession(
    rawInput: RequestWaiterInSessionInput,
  ): Promise<SessionWaitRequestSent> {
    const input = requestWaiterInSessionInputSchema.parse(rawInput);
    return sendSessionWaiterRequest(
      {
        sessionId: input.sessionId,
        waitId: input.waitId,
        requestMessage: input.requestMessage,
        ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
      },
      buildBaseStoreOptions(),
    );
  }

  async function shutdown(): Promise<void> {
    const entries = [...activeWaits.values()];
    for (const entry of entries) {
      entry.controller.abort();
    }
    await Promise.allSettled(entries.map((entry) => entry.done));
  }

  return {
    ownerInstanceId,
    waitInSession,
    requestWaiterInSession,
    shutdown,
  };
}
