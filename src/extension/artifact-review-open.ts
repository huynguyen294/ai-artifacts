import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ensureSafeGlobalArtifactHandle,
  ensureSafeManagedArtifactFile,
  parseArtifactManifest,
  type SafeGlobalArtifactHandle,
} from "../shared/artifact-validation";
import type { ArtifactManifest } from "../shared/contracts";
import type { GlobalArtifactsRootOptions } from "../shared/artifact-files";

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

export type ArtifactReadyHandlerDependencies<TUri> = {
  isAutoOpenEnabled: () => boolean;
  isWindowFocused: () => boolean;
  artifactUriFromComments: (commentsUri: TUri) => TUri;
  openArtifactReview: (artifactUri: TUri) => Promise<void>;
  reportError: (error: unknown) => void;
};

export function createArtifactReadyHandler<TUri>(
  dependencies: ArtifactReadyHandlerDependencies<TUri>,
): (commentsUri: TUri) => Promise<void> {
  return async (commentsUri) => {
    if (!dependencies.isAutoOpenEnabled()) return;
    if (!dependencies.isWindowFocused()) return;
    try {
      const artifactUri = dependencies.artifactUriFromComments(commentsUri);
      await dependencies.openArtifactReview(artifactUri);
    } catch (error) {
      dependencies.reportError(error);
    }
  };
}

export type ArtifactReadyWatcher<TUri> = {
  onDidCreate: (listener: (commentsUri: TUri) => void | Promise<void>) => unknown;
};

export type GlobalArtifactWatcherDependencies<TUri, TWatcher extends ArtifactReadyWatcher<TUri>> =
  ArtifactReadyHandlerDependencies<TUri> & {
    ensureGlobalArtifactsRoot: () => Promise<string>;
    createWatcher: (collectionRoot: string, pattern: string) => TWatcher;
  };

export async function setupGlobalArtifactReadyWatcher<
  TUri,
  TWatcher extends ArtifactReadyWatcher<TUri>,
>(dependencies: GlobalArtifactWatcherDependencies<TUri, TWatcher>): Promise<TWatcher> {
  const collectionRoot = await dependencies.ensureGlobalArtifactsRoot();
  const watcher = dependencies.createWatcher(collectionRoot, "*/comments.json");
  watcher.onDidCreate(createArtifactReadyHandler(dependencies));
  return watcher;
}
