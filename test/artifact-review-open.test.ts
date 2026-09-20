import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactReviewOpenCoordinator,
  createTargetedArtifactConnectionHandler,
  openArtifactReview,
  setupGlobalArtifactConnectionWatcher,
  validateArtifactReviewTarget,
  type ArtifactFileUri,
} from "../src/extension/artifact-review-open";
import { ARTIFACT_CONNECTION_FILE, globalArtifactsRoot } from "../src/shared/artifact-files";
import { ensureSafeGlobalArtifactsRoot } from "../src/shared/artifact-validation";

const temporaryDirectories: string[] = [];

type TestUri = ArtifactFileUri & { source?: string };

class TestWatcher {
  private readonly createListeners: ((uri: TestUri) => void | Promise<void>)[] = [];
  private readonly changeListeners: ((uri: TestUri) => void | Promise<void>)[] = [];

  onDidCreate(listener: (uri: TestUri) => void | Promise<void>): void {
    this.createListeners.push(listener);
  }

  onDidChange(listener: (uri: TestUri) => void | Promise<void>): void {
    this.changeListeners.push(listener);
  }

  async fireCreate(uri: TestUri): Promise<void> {
    for (const listener of [...this.createListeners]) {
      await listener(uri);
    }
  }

  async fireChange(uri: TestUri): Promise<void> {
    for (const listener of [...this.changeListeners]) {
      await listener(uri);
    }
  }

  async fire(uri: TestUri): Promise<void> {
    for (const listener of [...this.createListeners]) {
      await listener(uri);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function makeUserHome(): Promise<string> {
  const userHome = await mkdtemp(path.join(tmpdir(), "agent-plus-open-home-"));
  temporaryDirectories.push(userHome);
  return userHome;
}

async function writeArtifact(
  userHome: string,
  artifactId = "artifact-001",
  options: {
    windowInstanceId?: string;
    openRequestId?: string;
    connectionRevision?: number;
    source?: "create" | "inspect";
  } = {},
): Promise<{
  artifactDirectory: string;
  artifactPath: string;
  manifestPath: string;
  commentsPath: string;
  connectionPath: string;
}> {
  const markdown = "# Safe artifact\n";
  const artifactDirectory = path.join(globalArtifactsRoot({ userHome }), artifactId);
  const artifactPath = path.join(artifactDirectory, "artifact.md");
  const manifestPath = path.join(artifactDirectory, "artifact.json");
  const commentsPath = path.join(artifactDirectory, "comments.json");
  const connectionPath = path.join(artifactDirectory, ARTIFACT_CONNECTION_FILE);
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, markdown, "utf8");
  const timestamp = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 6,
    kind: "implementation-plan",
    artifactId,
    title: "Safe artifact",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    reviewSessionId: "11111111-1111-4111-8111-111111111111",
  }, null, 2)}\n`, "utf8");
  await writeFile(commentsPath, `${JSON.stringify({
    schemaVersion: 6,
    artifactId,
    reviewRound: 1,
    artifactSha256: sha256(markdown),
    comments: [],
  }, null, 2)}\n`, "utf8");
  await writeFile(connectionPath, `${JSON.stringify({
    schemaVersion: 1,
    windowInstanceId: options.windowInstanceId ?? "11111111-1111-4111-8111-111111111111",
    connectionRevision: options.connectionRevision ?? 1,
    openRequestId: options.openRequestId ?? "22222222-2222-4222-8222-222222222222",
    updatedAt: timestamp,
    source: options.source ?? "create",
  }, null, 2)}\n`, "utf8");
  return { artifactDirectory, artifactPath, manifestPath, commentsPath, connectionPath };
}

async function fixture(artifactId = "artifact-001"): Promise<{
  userHome: string;
  artifactDirectory: string;
  artifactPath: string;
  manifestPath: string;
}> {
  const userHome = await makeUserHome();
  const { artifactDirectory, artifactPath, manifestPath } = await writeArtifact(userHome, artifactId);
  return { userHome, artifactDirectory, artifactPath, manifestPath };
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("artifact review safe-open boundary", () => {
  it("validates one exact global artifact URI before opening its canonical artifact.md path", async () => {
    const { userHome, artifactDirectory, artifactPath } = await fixture();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const target = await openArtifactReview<TestUri>(
      { fsPath: artifactPath, source: "requested" },
      {
        uriFromFilePath: (filePath) => ({ fsPath: filePath, source: "validated" }),
        openWith,
      },
      { userHome },
    );

    expect(target.artifactId).toBe("artifact-001");
    expect(target.artifactDirectory).toBe(artifactDirectory);
    expect(openWith).toHaveBeenCalledTimes(1);
    expect(openWith).toHaveBeenCalledWith({ fsPath: artifactPath, source: "validated" });
  });

  it.each([
    ["outside the global root", (home: string) => path.join(home, "outside", "artifact-001", "artifact.md")],
    ["nested below a global artifact", (home: string) => path.join(globalArtifactsRoot({ userHome: home }), "parent", "artifact-001", "artifact.md")],
  ])("rejects a target %s before calling openWith", async (_label, targetPath) => {
    const { userHome } = await fixture();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);

    await expect(openArtifactReview<TestUri>(
      { fsPath: targetPath(userHome) },
      { uriFromFilePath: (fsPath) => ({ fsPath }), openWith },
      { userHome },
    )).rejects.toThrow("direct child of the collection root");
    expect(openWith).not.toHaveBeenCalled();
  });

  it("rejects a global handle that does not point to artifact.md", async () => {
    const { userHome, manifestPath } = await fixture();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);

    await expect(openArtifactReview<TestUri>(
      { fsPath: manifestPath },
      { uriFromFilePath: (fsPath) => ({ fsPath }), openWith },
      { userHome },
    )).rejects.toThrow("must point to artifact.md");
    expect(openWith).not.toHaveBeenCalled();
  });

  it("rejects an artifact-id mismatch and malformed manifest before opening", async () => {
    const { userHome, artifactPath, manifestPath } = await fixture();
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, artifactId: "artifact-002" }), "utf8");
    const openWith = vi.fn(async (_uri: TestUri) => undefined);

    await expect(openArtifactReview<TestUri>(
      { fsPath: artifactPath },
      { uriFromFilePath: (fsPath) => ({ fsPath }), openWith },
      { userHome },
    )).rejects.toThrow("does not belong to this global artifact directory");
    expect(openWith).not.toHaveBeenCalled();

    await writeFile(manifestPath, "{", "utf8");
    await expect(validateArtifactReviewTarget(artifactPath, { userHome })).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejects linked artifact directories and linked managed files before opening", async () => {
    const linkedDirectoryFixture = await fixture("linked-directory-001");
    const outsideDirectory = path.join(linkedDirectoryFixture.userHome, "outside-directory");
    await rename(linkedDirectoryFixture.artifactDirectory, outsideDirectory);
    await createDirectoryLink(outsideDirectory, linkedDirectoryFixture.artifactDirectory);

    await expect(validateArtifactReviewTarget(
      linkedDirectoryFixture.artifactPath,
      { userHome: linkedDirectoryFixture.userHome },
    )).rejects.toThrow("symbolic links and junctions");

    const linkedFileFixture = await fixture("linked-file-001");
    const outsideFileTarget = path.join(linkedFileFixture.userHome, "outside-file-target");
    await mkdir(outsideFileTarget);
    await rm(linkedFileFixture.manifestPath);
    await createDirectoryLink(outsideFileTarget, linkedFileFixture.manifestPath);

    await expect(validateArtifactReviewTarget(
      linkedFileFixture.artifactPath,
      { userHome: linkedFileFixture.userHome },
    )).rejects.toThrow("symbolic links");
  });

  it("propagates an open dependency failure without changing artifact contents", async () => {
    const { userHome, artifactDirectory, artifactPath, manifestPath } = await fixture();
    const before = {
      files: await readdir(artifactDirectory),
      artifact: await readFile(artifactPath, "utf8"),
      manifest: await readFile(manifestPath, "utf8"),
    };

    await expect(openArtifactReview<TestUri>(
      { fsPath: artifactPath },
      {
        uriFromFilePath: (fsPath) => ({ fsPath }),
        openWith: async () => { throw new Error("injected open failure"); },
      },
      { userHome },
    )).rejects.toThrow("injected open failure");

    expect(await readdir(artifactDirectory)).toEqual(before.files);
    expect(await readFile(artifactPath, "utf8")).toBe(before.artifact);
    expect(await readFile(manifestPath, "utf8")).toBe(before.manifest);
  });
});

describe("artifact review open coordinator", () => {
  it("rejects an invalid command target before calling openWith", async () => {
    const userHome = await makeUserHome();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });

    await expect(coordinator.open({
      fsPath: path.join(userHome, "outside", "artifact-001", "artifact.md"),
    })).rejects.toThrow("direct child of the collection root");

    expect(openWith).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests for the same validated artifact into one openWith call", async () => {
    const { userHome, artifactPath } = await fixture("single-flight-001");
    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const openWith = vi.fn(async (_uri: TestUri) => openGate);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });
    const artifactUri = { fsPath: artifactPath };

    const first = coordinator.open(artifactUri);
    const second = coordinator.open(artifactUri);
    await vi.waitFor(() => expect(openWith).toHaveBeenCalledTimes(1));
    releaseOpen?.();

    const [firstTarget, secondTarget] = await Promise.all([first, second]);
    expect(firstTarget.artifactPath).toBe(artifactPath);
    expect(secondTarget.artifactPath).toBe(artifactPath);
    expect(openWith).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate different artifacts", async () => {
    const userHome = await makeUserHome();
    const first = await writeArtifact(userHome, "different-001");
    const second = await writeArtifact(userHome, "different-002");
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });

    await Promise.all([
      coordinator.open({ fsPath: first.artifactPath }),
      coordinator.open({ fsPath: second.artifactPath }),
    ]);

    expect(openWith).toHaveBeenCalledTimes(2);
    expect(openWith.mock.calls.map(([uri]) => uri.fsPath).sort()).toEqual([
      first.artifactPath,
      second.artifactPath,
    ].sort());
  });

  it("cleans up the single-flight entry after success", async () => {
    const { userHome, artifactPath } = await fixture("cleanup-success-001");
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });

    await coordinator.open({ fsPath: artifactPath });
    await coordinator.open({ fsPath: artifactPath });

    expect(openWith).toHaveBeenCalledTimes(2);
  });

  it("cleans up the single-flight entry after an openWith error", async () => {
    const { userHome, artifactPath } = await fixture("cleanup-error-001");
    const openWith = vi.fn()
      .mockRejectedValueOnce(new Error("injected open failure"))
      .mockResolvedValueOnce(undefined);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });

    await expect(coordinator.open({ fsPath: artifactPath })).rejects.toThrow("injected open failure");
    await expect(coordinator.open({ fsPath: artifactPath })).resolves.toMatchObject({ artifactPath });

    expect(openWith).toHaveBeenCalledTimes(2);
  });
});

describe("targeted artifact-connection event handler", () => {
  it("does not derive or open an artifact when auto-open is disabled", async () => {
    const userHome = await makeUserHome();
    const artifact = await writeArtifact(userHome, "disabled-auto-open");
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => "11111111-1111-4111-8111-111111111111",
      isAutoOpenEnabled: () => false,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError,
      rootOptions: { userHome },
    });

    await handler({ fsPath: artifact.connectionPath });

    expect(open).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("silently ignores events targeted at a different window instance", async () => {
    const userHome = await makeUserHome();
    const targetWindow = "11111111-1111-4111-8111-111111111111";
    const otherWindow = "99999999-9999-4999-8999-999999999999";
    const artifact = await writeArtifact(userHome, "other-window-artifact", {
      windowInstanceId: targetWindow,
    });
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => otherWindow,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError,
      rootOptions: { userHome },
    });

    await handler({ fsPath: artifact.connectionPath });

    expect(open).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("opens artifact review when target window matches local instance regardless of focus", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const artifact = await writeArtifact(userHome, "matching-window-artifact", {
      windowInstanceId: windowA,
    });
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError,
      rootOptions: { userHome },
    });

    await handler({ fsPath: artifact.connectionPath });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ fsPath: artifact.artifactPath });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("deduplicates multiple events with the same openRequestId", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const openRequestId = "33333333-3333-4333-8333-333333333333";
    const artifact = await writeArtifact(userHome, "dedupe-artifact", {
      windowInstanceId: windowA,
      openRequestId,
    });
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    // Simulate both create and change event fired for the same commit
    await handler({ fsPath: artifact.connectionPath });
    await handler({ fsPath: artifact.connectionPath });

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("opens again when a new openRequestId is received for the same artifact", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const req1 = "11111111-1111-4111-8111-111111111111";
    const req2 = "22222222-2222-4222-8222-222222222222";
    const artifact = await writeArtifact(userHome, "reopen-artifact", {
      windowInstanceId: windowA,
      openRequestId: req1,
    });
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    await handler({ fsPath: artifact.connectionPath });
    expect(open).toHaveBeenCalledTimes(1);

    // Update connection with new openRequestId (simulate reconnect/rebind)
    await writeFile(artifact.connectionPath, JSON.stringify({
      schemaVersion: 1,
      windowInstanceId: windowA,
      connectionRevision: 2,
      openRequestId: req2,
      updatedAt: new Date().toISOString(),
      source: "inspect",
    }, null, 2), "utf8");

    await handler({ fsPath: artifact.connectionPath });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("reports error when open operation fails or connection is malformed", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const artifact = await writeArtifact(userHome, "error-artifact", {
      windowInstanceId: windowA,
    });
    const error = new Error("injected open failure");
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async () => { throw error; },
      reportError,
      rootOptions: { userHome },
    });

    await handler({ fsPath: artifact.connectionPath });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("P1.1: coalesces concurrent events with the same openRequestId and executes openArtifactReview once", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const openRequestId = randomUUID();
    const artifact = await writeArtifact(userHome, "concurrent-events-artifact", {
      windowInstanceId: windowA,
      openRequestId,
    });

    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const open = vi.fn(async (_uri: TestUri) => openGate);
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    const p1 = handler({ fsPath: artifact.connectionPath });
    const p2 = handler({ fsPath: artifact.connectionPath });

    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    releaseOpen?.();
    await Promise.all([p1, p2]);

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("P1.1: retries opening the same openRequestId after an initial failure without getting permanently deduplicated", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const openRequestId = randomUUID();
    const artifact = await writeArtifact(userHome, "retry-after-fail-artifact", {
      windowInstanceId: windowA,
      openRequestId,
    });

    let attempt = 0;
    const open = vi.fn(async (_uri: TestUri) => {
      attempt++;
      if (attempt === 1) {
        throw new Error("transient open failure");
      }
    });
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError,
      rootOptions: { userHome },
    });

    // First attempt fails
    await handler({ fsPath: artifact.connectionPath });
    expect(open).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);

    // Second event with the SAME openRequestId retries and succeeds!
    await handler({ fsPath: artifact.connectionPath });
    expect(open).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("P1.1: concurrent joiner does not report duplicate error when owning open fails", async () => {
    const userHome = await makeUserHome();
    const windowA = "11111111-1111-4111-8111-111111111111";
    const openRequestId = randomUUID();
    const artifact = await writeArtifact(userHome, "joiner-error-artifact", {
      windowInstanceId: windowA,
      openRequestId,
    });

    let rejectOpen: ((err: Error) => void) | undefined;
    const openGate = new Promise<void>((_, reject) => { rejectOpen = reject; });
    const open = vi.fn(async (_uri: TestUri) => openGate);
    const reportError = vi.fn();
    const handler = createTargetedArtifactConnectionHandler<TestUri>({
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError,
      rootOptions: { userHome },
    });

    const p1 = handler({ fsPath: artifact.connectionPath });
    const p2 = handler({ fsPath: artifact.connectionPath });

    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    rejectOpen?.(new Error("injected open failure"));
    await Promise.all([p1, p2]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("global artifact-connection watcher setup", () => {
  it("wires the extension to the global RelativePattern, local instance ID, safe-open, and subscriptions", async () => {
    const extensionSource = await readFile(
      path.resolve(import.meta.dirname, "../src/extension/extension.ts"),
      "utf8",
    );

    expect(extensionSource).toContain("new vscode.RelativePattern(vscode.Uri.file(collectionRoot), pattern)");
    expect(extensionSource).toContain("localWindowInstanceId: () => workspaceRegistryPublisher.currentInstanceId");
    expect(extensionSource).toContain("setupGlobalArtifactConnectionWatcher");
    expect(extensionSource.match(/artifactReviewOpenCoordinator\.open\(/g)).toHaveLength(3);
    expect(extensionSource).toContain("ArtifactReviewProvider.viewType");
    expect(extensionSource).toContain("supportsMultipleEditorsPerDocument: false");
    expect(extensionSource).toContain("context.subscriptions.push(artifactConnectionWatcher)");
    expect(extensionSource).not.toContain("isWindowFocused");
    expect(extensionSource).not.toContain("setupGlobalArtifactReadyWatcher");
    expect(extensionSource).not.toContain("*/comments.json");

    const openSource = await readFile(
      path.resolve(import.meta.dirname, "../src/extension/artifact-review-open.ts"),
      "utf8",
    );
    expect(openSource).not.toContain("isWindowFocused");
    expect(openSource).not.toContain("setupGlobalArtifactReadyWatcher");
    expect(openSource).not.toContain("createArtifactReadyHandler");
    expect(openSource).not.toContain("comments.json");
  });

  it("creates a fresh safe root before registering the RelativePattern watcher for artifact-connection.json", async () => {
    const userHome = await makeUserHome();
    const expectedRoot = globalArtifactsRoot({ userHome });
    const events: string[] = [];
    const watcher = new TestWatcher();

    const result = await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: async () => {
        events.push("ensure:start");
        const root = await ensureSafeGlobalArtifactsRoot({ userHome });
        events.push("ensure:complete");
        return root;
      },
      createWatcher: (collectionRoot, pattern) => {
        events.push("watcher:create");
        expect(collectionRoot).toBe(expectedRoot);
        expect(pattern).toBe(`*/${ARTIFACT_CONNECTION_FILE}`);
        return watcher;
      },
      localWindowInstanceId: () => "11111111-1111-4111-8111-111111111111",
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => uri,
      openArtifactReview: async () => undefined,
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    expect(result).toBe(watcher);
    expect(events).toEqual(["ensure:start", "ensure:complete", "watcher:create"]);
    await expect(access(expectedRoot)).resolves.toBeUndefined();
  });

  it("multi-window isolation: only the targeted window calls openWith while non-target window remains silent", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const windowB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const watcher = new TestWatcher();

    const openWithA = vi.fn(async (_uri: TestUri) => undefined);
    const openWithB = vi.fn(async (_uri: TestUri) => undefined);
    const reportErrorA = vi.fn();
    const reportErrorB = vi.fn();

    // Window A watcher
    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithA }, { userHome });
      },
      reportError: reportErrorA,
      rootOptions: { userHome },
    });

    // Window B watcher
    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowB,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithB }, { userHome });
      },
      reportError: reportErrorB,
      rootOptions: { userHome },
    });

    // Artifact targeted to Window A
    const artifactForA = await writeArtifact(userHome, "artifact-target-a", {
      windowInstanceId: windowA,
      openRequestId: randomUUID(),
    });

    await watcher.fireCreate({ fsPath: artifactForA.connectionPath });

    // Assert: Window A opens, Window B remains completely silent
    expect(openWithA).toHaveBeenCalledTimes(1);
    expect(openWithA).toHaveBeenCalledWith({ fsPath: artifactForA.artifactPath });
    expect(openWithB).not.toHaveBeenCalled();
    expect(reportErrorA).not.toHaveBeenCalled();
    expect(reportErrorB).not.toHaveBeenCalled();

    // Artifact targeted to Window B
    const artifactForB = await writeArtifact(userHome, "artifact-target-b", {
      windowInstanceId: windowB,
      openRequestId: randomUUID(),
    });

    await watcher.fireCreate({ fsPath: artifactForB.connectionPath });

    // Assert: Window B opens, Window A does not open again
    expect(openWithA).toHaveBeenCalledTimes(1);
    expect(openWithB).toHaveBeenCalledTimes(1);
    expect(openWithB).toHaveBeenCalledWith({ fsPath: artifactForB.artifactPath });
    expect(reportErrorA).not.toHaveBeenCalled();
    expect(reportErrorB).not.toHaveBeenCalled();
  });

  it("deduplicates create and change events fired in sequence for the same connection write", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "sequence-dedupe", {
      windowInstanceId: windowA,
      openRequestId: randomUUID(),
    });

    // Firing both create and change event
    await watcher.fireCreate({ fsPath: artifact.connectionPath });
    await watcher.fireChange({ fsPath: artifact.connectionPath });

    expect(openWith).toHaveBeenCalledTimes(1);
  });

  it("reconnect change event with new openRequestId triggers openWith", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "reconnect-change", {
      windowInstanceId: windowA,
      openRequestId: randomUUID(),
    });

    await watcher.fireCreate({ fsPath: artifact.connectionPath });
    expect(openWith).toHaveBeenCalledTimes(1);

    // Update connection file with new revision and openRequestId
    await writeFile(artifact.connectionPath, JSON.stringify({
      schemaVersion: 1,
      windowInstanceId: windowA,
      connectionRevision: 2,
      openRequestId: randomUUID(),
      updatedAt: new Date().toISOString(),
      source: "inspect",
    }, null, 2), "utf8");

    await watcher.fireChange({ fsPath: artifact.connectionPath });
    expect(openWith).toHaveBeenCalledTimes(2);
  });

  it("P2.1: malformed connection fails closed silently without openWith or reportError spam", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError,
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "invalid-conn-artifact", {
      windowInstanceId: windowA,
    });
    // Overwrite with malformed JSON
    await writeFile(artifact.connectionPath, "{ not-json", "utf8");

    await watcher.fireCreate({ fsPath: artifact.connectionPath });

    expect(openWith).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("P2.1: multi-window error isolation: valid route to window A with invalid manifest only causes window A to report error", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const windowB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const watcher = new TestWatcher();

    const openWithA = vi.fn(async (_uri: TestUri) => undefined);
    const openWithB = vi.fn(async (_uri: TestUri) => undefined);
    const reportErrorA = vi.fn();
    const reportErrorB = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithA }, { userHome });
      },
      reportError: reportErrorA,
      rootOptions: { userHome },
    });

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowB,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithB }, { userHome });
      },
      reportError: reportErrorB,
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "corrupt-manifest-artifact", {
      windowInstanceId: windowA,
    });
    // Corrupt the manifest
    await writeFile(artifact.manifestPath, "{ corrupted manifest", "utf8");

    await watcher.fireCreate({ fsPath: artifact.connectionPath });

    expect(openWithA).not.toHaveBeenCalled();
    expect(openWithB).not.toHaveBeenCalled();
    expect(reportErrorA).toHaveBeenCalledTimes(1);
    expect(reportErrorB).not.toHaveBeenCalled();
  });

  it("P2.1: multi-window error isolation: valid route to window A with linked/unsafe artifact only causes window A to report error", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const windowB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const watcher = new TestWatcher();

    const openWithA = vi.fn(async (_uri: TestUri) => undefined);
    const openWithB = vi.fn(async (_uri: TestUri) => undefined);
    const reportErrorA = vi.fn();
    const reportErrorB = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithA }, { userHome });
      },
      reportError: reportErrorA,
      rootOptions: { userHome },
    });

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowB,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith: openWithB }, { userHome });
      },
      reportError: reportErrorB,
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "linked-target-artifact", {
      windowInstanceId: windowA,
    });
    const outsideTarget = path.join(userHome, "outside-target.md");
    await writeFile(outsideTarget, "# outside", "utf8");
    await rm(artifact.artifactPath);
    await createDirectoryLink(outsideTarget, artifact.artifactPath);

    await watcher.fireCreate({ fsPath: artifact.connectionPath });

    expect(openWithA).not.toHaveBeenCalled();
    expect(openWithB).not.toHaveBeenCalled();
    expect(reportErrorA).toHaveBeenCalledTimes(1);
    expect(reportErrorB).not.toHaveBeenCalled();
  });

  it("P2.2: wrong-root event fails closed without calling openWith or reportError", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError,
      rootOptions: { userHome },
    });

    const outsidePath = path.join(userHome, "outside", "artifact-001", ARTIFACT_CONNECTION_FILE);
    await mkdir(path.dirname(outsidePath), { recursive: true });
    await writeFile(outsidePath, JSON.stringify({
      schemaVersion: 1,
      windowInstanceId: windowA,
      connectionRevision: 1,
      openRequestId: randomUUID(),
      updatedAt: new Date().toISOString(),
      source: "create",
    }), "utf8");

    await watcher.fireCreate({ fsPath: outsidePath });

    expect(openWith).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("P2.2: linked connection directory fails closed without calling openWith or reportError", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError,
      rootOptions: { userHome },
    });

    const collectionRoot = globalArtifactsRoot({ userHome });
    const realDir = path.join(userHome, "real-symlink-artifact");
    await mkdir(realDir, { recursive: true });
    const connPath = path.join(realDir, ARTIFACT_CONNECTION_FILE);
    await writeFile(connPath, JSON.stringify({
      schemaVersion: 1,
      windowInstanceId: windowA,
      connectionRevision: 1,
      openRequestId: randomUUID(),
      updatedAt: new Date().toISOString(),
      source: "create",
    }), "utf8");

    const linkDir = path.join(collectionRoot, "symlinked-artifact");
    await createDirectoryLink(realDir, linkDir);

    await watcher.fireCreate({ fsPath: path.join(linkDir, ARTIFACT_CONNECTION_FILE) });

    expect(openWith).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("P2.2: recovers from transient missing/partial connection read via bounded retry and opens", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError,
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "transient-read-artifact", {
      windowInstanceId: windowA,
    });
    const original = await readFile(artifact.connectionPath, "utf8");

    const readFileSpy = vi.spyOn(fs, "readFile")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(original);

    await watcher.fireCreate({ fsPath: artifact.connectionPath });

    expect(openWith).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
    expect(readFileSpy).toHaveBeenCalled();
  });

  it("P1.2: recovers from actual ENOENT on connection read via bounded retry and opens", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, { uriFromFilePath: (p) => ({ fsPath: p }), openWith }, { userHome });
      },
      reportError,
      rootOptions: { userHome },
    });

    const artifact = await writeArtifact(userHome, "transient-enoent-artifact", {
      windowInstanceId: windowA,
    });
    const original = await readFile(artifact.connectionPath, "utf8");

    const enoent = Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" });
    const readFileSpy = vi.spyOn(fs, "readFile")
      .mockRejectedValueOnce(enoent)
      .mockResolvedValueOnce(original);

    await watcher.fireCreate({ fsPath: artifact.connectionPath });

    expect(openWith).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
    expect(readFileSpy).toHaveBeenCalled();
  });

  it("P2.2: setupGlobalArtifactConnectionWatcher rejects before watcher registration if ensureGlobalArtifactsRoot fails", async () => {
    const createWatcher = vi.fn();
    await expect(setupGlobalArtifactConnectionWatcher<TestUri, any>({
      ensureGlobalArtifactsRoot: async () => { throw new Error("root error"); },
      createWatcher,
      localWindowInstanceId: () => "win",
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (u) => u,
      openArtifactReview: async () => undefined,
      reportError: vi.fn(),
    })).rejects.toThrow("root error");

    expect(createWatcher).not.toHaveBeenCalled();
  });

  it("coalesces concurrent duplicate watcher events through the shared open coordinator", async () => {
    const userHome = await makeUserHome();
    const windowA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const watcher = new TestWatcher();
    const artifact = await writeArtifact(userHome, "concurrent-coord-artifact", {
      windowInstanceId: windowA,
      openRequestId: randomUUID(),
    });

    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const openWith = vi.fn(async (_uri: TestUri) => openGate);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });

    await setupGlobalArtifactConnectionWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      localWindowInstanceId: () => windowA,
      isAutoOpenEnabled: () => true,
      artifactUriFromConnection: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => { await coordinator.open(uri); },
      reportError: vi.fn(),
      rootOptions: { userHome },
    });

    const first = watcher.fireCreate({ fsPath: artifact.connectionPath });
    const second = watcher.fireChange({ fsPath: artifact.connectionPath });
    await vi.waitFor(() => expect(openWith).toHaveBeenCalledTimes(1));
    releaseOpen?.();
    await Promise.all([first, second]);

    expect(openWith).toHaveBeenCalledTimes(1);
  });
});
