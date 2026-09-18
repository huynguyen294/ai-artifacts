import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureSafeGlobalArtifactHandle,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
  type SafeGlobalArtifactHandle,
} from "../shared/artifact-validation";
import type { ArtifactManifest } from "../shared/contracts";
import { ARTIFACT_CONNECTION_FILE, type GlobalArtifactsRootOptions } from "../shared/artifact-files";
import { readArtifactConnectionRoute } from "../shared/artifact-connection";

export type ArtifactFileUri = {
  readonly fsPath: string;
};

export type ValidatedArtifactReviewTarget = SafeGlobalArtifactHandle & {
  artifactPath: string;
  manifest: ArtifactManifest;
};

export type ArtifactReviewOpenDependencies<TUri extends ArtifactFileUri> = {
  uriFromFilePath: (filePath: string) => TUri;
  openWith: (artifactUri: TUri) => Promise<void>;
};

function canonicalArtifactOpenKey(artifactPath: string): string {
  const resolved = path.resolve(artifactPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function validateArtifactReviewTarget(
  artifactPath: string,
  options: GlobalArtifactsRootOptions = {},
): Promise<ValidatedArtifactReviewTarget> {
  const handle = await ensureSafeGlobalArtifactHandle(artifactPath, options);
  const [safeArtifactPath, safeManifestPath] = await Promise.all([
    ensureSafeManagedArtifactFile(handle.artifactDirectory, handle.files.artifactPath),
    ensureSafeManagedArtifactFile(handle.artifactDirectory, handle.files.manifestPath),
  ]);
  const manifest = parseArtifactManifest(JSON.parse(await fs.readFile(safeManifestPath, "utf8")));
  if (manifest.artifactId !== handle.artifactId) {
    throw new Error("artifact.json does not belong to this global artifact directory.");
  }
  return { ...handle, artifactPath: safeArtifactPath, manifest };
}

export async function openArtifactReview<TUri extends ArtifactFileUri>(
  artifactUri: TUri,
  dependencies: ArtifactReviewOpenDependencies<TUri>,
  options: GlobalArtifactsRootOptions = {},
): Promise<ValidatedArtifactReviewTarget> {
  const target = await validateArtifactReviewTarget(artifactUri.fsPath, options);
  await dependencies.openWith(dependencies.uriFromFilePath(target.artifactPath));
  return target;
}

export class ArtifactReviewOpenCoordinator<TUri extends ArtifactFileUri> {
  private readonly inFlight = new Map<string, Promise<ValidatedArtifactReviewTarget>>();

  constructor(
    private readonly dependencies: ArtifactReviewOpenDependencies<TUri>,
    private readonly options: GlobalArtifactsRootOptions = {},
  ) {}

  async open(artifactUri: TUri): Promise<ValidatedArtifactReviewTarget> {
    const target = await validateArtifactReviewTarget(artifactUri.fsPath, this.options);
    const key = canonicalArtifactOpenKey(target.artifactPath);
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const request = this.openTarget(target);
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    }
  }

  private async openTarget(
    target: ValidatedArtifactReviewTarget,
  ): Promise<ValidatedArtifactReviewTarget> {
    await this.dependencies.openWith(this.dependencies.uriFromFilePath(target.artifactPath));
    return target;
  }
}

export type TargetedArtifactConnectionHandlerDependencies<TUri extends ArtifactFileUri> = {
  localWindowInstanceId: () => string;
  isAutoOpenEnabled: () => boolean;
  artifactUriFromConnection: (connectionUri: TUri) => TUri;
  openArtifactReview: (artifactUri: TUri) => Promise<void>;
  reportError: (error: unknown) => void;
  rootOptions?: GlobalArtifactsRootOptions;
};

export function createTargetedArtifactConnectionHandler<TUri extends ArtifactFileUri>(
  dependencies: TargetedArtifactConnectionHandlerDependencies<TUri>,
): (connectionUri: TUri) => Promise<void> {
  const completedOpenRequestIds = new Set<string>();
  const inFlightOpenRequests = new Map<string, Promise<void>>();
  const maxDedupeEntries = 200;

  return async (connectionUri: TUri) => {
    if (!dependencies.isAutoOpenEnabled()) return;

    // Stage 1: Safe routing read
    let connection: Awaited<ReturnType<typeof readArtifactConnectionRoute>>;
    try {
      const connectionFilePath = connectionUri.fsPath;
      const artifactDirectory = path.dirname(connectionFilePath);

      connection = await readArtifactConnectionRoute(artifactDirectory, {
        allowMissing: true,
        boundedRetry: true,
        ...(dependencies.rootOptions ? { rootOptions: dependencies.rootOptions } : {}),
      });
    } catch {
      // Fail closed silently if routing read or safety checks fail
      return;
    }

    if (!connection) return;

    // Stage 2: Silent ignore for non-target windows
    if (connection.windowInstanceId !== dependencies.localWindowInstanceId()) {
      return;
    }

    // Stage 3: Deduplication and in-flight request handling
    const requestId = connection.openRequestId;

    if (completedOpenRequestIds.has(requestId)) {
      return;
    }

    const existingFlight = inFlightOpenRequests.get(requestId);
    if (existingFlight) {
      try {
        await existingFlight;
      } catch {
        // Suppress error: only the owner of the in-flight request calls reportError
      }
      return;
    }

    const artifactUri = dependencies.artifactUriFromConnection(connectionUri);
    const openPromise = dependencies.openArtifactReview(artifactUri);
    inFlightOpenRequests.set(requestId, openPromise);

    try {
      await openPromise;
      completedOpenRequestIds.add(requestId);
      if (completedOpenRequestIds.size > maxDedupeEntries) {
        const firstKey = completedOpenRequestIds.values().next().value;
        if (firstKey) completedOpenRequestIds.delete(firstKey);
      }
    } catch (error) {
      dependencies.reportError(error);
    } finally {
      inFlightOpenRequests.delete(requestId);
    }
  };
}

export type ArtifactConnectionWatcher<TUri> = {
  onDidCreate: (listener: (connectionUri: TUri) => void | Promise<void>) => unknown;
  onDidChange: (listener: (connectionUri: TUri) => void | Promise<void>) => unknown;
};

export type GlobalArtifactConnectionWatcherDependencies<
  TUri extends ArtifactFileUri,
  TWatcher extends ArtifactConnectionWatcher<TUri>,
> = TargetedArtifactConnectionHandlerDependencies<TUri> & {
  ensureGlobalArtifactsRoot: () => Promise<string>;
  createWatcher: (collectionRoot: string, pattern: string) => TWatcher;
};

export async function setupGlobalArtifactConnectionWatcher<
  TUri extends ArtifactFileUri,
  TWatcher extends ArtifactConnectionWatcher<TUri>,
>(
  dependencies: GlobalArtifactConnectionWatcherDependencies<TUri, TWatcher>,
): Promise<TWatcher> {
  const collectionRoot = await dependencies.ensureGlobalArtifactsRoot();
  const watcher = dependencies.createWatcher(collectionRoot, `*/${ARTIFACT_CONNECTION_FILE}`);
  const handler = createTargetedArtifactConnectionHandler(dependencies);
  watcher.onDidCreate(handler);
  watcher.onDidChange(handler);
  return watcher;
}
