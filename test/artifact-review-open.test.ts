import { createHash } from "node:crypto";
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
  createArtifactReadyHandler,
  openArtifactReview,
  setupGlobalArtifactReadyWatcher,
  validateArtifactReviewTarget,
  type ArtifactFileUri,
} from "../src/extension/artifact-review-open";
import { globalArtifactsRoot } from "../src/shared/artifact-files";
import { ensureSafeGlobalArtifactsRoot } from "../src/shared/artifact-validation";

const temporaryDirectories: string[] = [];

type TestUri = ArtifactFileUri & { source?: string };

class TestWatcher {
  private listener: ((uri: TestUri) => void | Promise<void>) | undefined;

  onDidCreate(listener: (uri: TestUri) => void | Promise<void>): void {
    this.listener = listener;
  }

  async fire(uri: TestUri): Promise<void> {
    if (!this.listener) throw new Error("The watcher listener is not registered.");
    await this.listener(uri);
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
): Promise<{
  artifactDirectory: string;
  artifactPath: string;
  manifestPath: string;
  commentsPath: string;
}> {
  const markdown = "# Safe artifact\n";
  const artifactDirectory = path.join(globalArtifactsRoot({ userHome }), artifactId);
  const artifactPath = path.join(artifactDirectory, "artifact.md");
  const manifestPath = path.join(artifactDirectory, "artifact.json");
  const commentsPath = path.join(artifactDirectory, "comments.json");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(artifactPath, markdown, "utf8");
  const timestamp = new Date().toISOString();
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 5,
    kind: "implementation-plan",
    artifactId,
    title: "Safe artifact",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    location: { workspaceRoot: path.join(userHome, "workspace") },
    reviewSessionId: "11111111-1111-4111-8111-111111111111",
  }, null, 2)}\n`, "utf8");
  await writeFile(commentsPath, `${JSON.stringify({
    schemaVersion: 5,
    artifactId,
    reviewRound: 1,
    artifactSha256: sha256(markdown),
    comments: [],
  }, null, 2)}\n`, "utf8");
  return { artifactDirectory, artifactPath, manifestPath, commentsPath };
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
    expect(target.manifest.location.workspaceRoot).toBe(path.join(userHome, "workspace"));
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

describe("artifact-ready event handler", () => {
  it("does not derive or open an artifact when auto-open is disabled", async () => {
    const artifactUriFromComments = vi.fn((uri: TestUri) => uri);
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();
    const handler = createArtifactReadyHandler<TestUri>({
      isAutoOpenEnabled: () => false,
      isWindowFocused: () => true,
      artifactUriFromComments,
      openArtifactReview: open,
      reportError,
    });

    await handler({ fsPath: "comments.json" });

    expect(artifactUriFromComments).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("maps one comments event to one artifact open and reports failures", async () => {
    const error = new Error("injected handler failure");
    const reportError = vi.fn();
    const handler = createArtifactReadyHandler<TestUri>({
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async () => { throw error; },
      reportError,
    });

    await handler({ fsPath: path.join("artifact-001", "comments.json") });

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error);
  });

  it("does not derive or open an artifact when the VS Code window is unfocused", async () => {
    const artifactUriFromComments = vi.fn((uri: TestUri) => uri);
    const open = vi.fn(async (_uri: TestUri) => undefined);
    const handler = createArtifactReadyHandler<TestUri>({
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => false,
      artifactUriFromComments,
      openArtifactReview: open,
      reportError: vi.fn(),
    });

    await handler({ fsPath: "comments.json" });

    expect(artifactUriFromComments).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("global artifact-ready watcher setup", () => {
  it("wires the extension to the global RelativePattern, focused state, safe-open, and subscriptions", async () => {
    const extensionSource = await readFile(
      path.resolve(import.meta.dirname, "../src/extension/extension.ts"),
      "utf8",
    );

    expect(extensionSource).toContain("new vscode.RelativePattern(vscode.Uri.file(collectionRoot), pattern)");
    expect(extensionSource).toContain("isWindowFocused: () => vscode.window.state.focused");
    expect(extensionSource.match(/artifactReviewOpenCoordinator\.open\(/g)).toHaveLength(2);
    expect(extensionSource).toContain("ArtifactReviewProvider.viewType");
    expect(extensionSource).toContain("supportsMultipleEditorsPerDocument: false");
    expect(extensionSource).toContain("vscode.window.tabGroups.activeTabGroup.activeTab?.input");
    expect(extensionSource).toContain("activeTabInput instanceof vscode.TabInputCustom");
    expect(extensionSource).toContain("activeTabInput.viewType === ArtifactReviewProvider.viewType");
    expect(extensionSource).toContain("defaultUri: vscode.Uri.file(await ensureSafeGlobalArtifactsRoot())");
    expect(extensionSource).toContain("context.subscriptions.push(artifactReadyWatcher)");
    expect(extensionSource).not.toContain("**/{.ai-artifacts,.codex-artifacts}/artifacts/**/comments.json");
    expect(extensionSource).not.toContain("reviewRound === 1");
    expect(extensionSource).not.toContain("tabGroups.all");
    expect(extensionSource).not.toMatch(/for\s*\([^)]*tabGroups/);
  });

  it("creates a fresh safe root before registering the RelativePattern watcher", async () => {
    const userHome = await makeUserHome();
    const expectedRoot = globalArtifactsRoot({ userHome });
    const events: string[] = [];
    const watcher = new TestWatcher();

    const result = await setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: async () => {
        events.push("ensure:start");
        const root = await ensureSafeGlobalArtifactsRoot({ userHome });
        events.push("ensure:complete");
        return root;
      },
      createWatcher: (collectionRoot, pattern) => {
        events.push("watcher:create");
        expect(collectionRoot).toBe(expectedRoot);
        expect(pattern).toBe("*/comments.json");
        return watcher;
      },
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => uri,
      openArtifactReview: async () => undefined,
      reportError: vi.fn(),
    });

    expect(result).toBe(watcher);
    expect(events).toEqual(["ensure:start", "ensure:complete", "watcher:create"]);
    await expect(access(expectedRoot)).resolves.toBeUndefined();
  });

  it("does not create a watcher or open an artifact when root validation fails", async () => {
    const createWatcher = vi.fn((_root: string, _pattern: string) => new TestWatcher());
    const open = vi.fn(async (_uri: TestUri) => undefined);

    await expect(setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: async () => { throw new Error("unsafe root"); },
      createWatcher,
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => uri,
      openArtifactReview: open,
      reportError: vi.fn(),
    })).rejects.toThrow("unsafe root");

    expect(createWatcher).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the first artifact created after registration exactly once through safe-open", async () => {
    const userHome = await makeUserHome();
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    await setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, {
          uriFromFilePath: (fsPath) => ({ fsPath }),
          openWith,
        }, { userHome });
      },
      reportError: vi.fn(),
    });

    const artifact = await writeArtifact(userHome, "first-artifact-001");
    await watcher.fire({ fsPath: artifact.commentsPath });

    expect(openWith).toHaveBeenCalledTimes(1);
    expect(openWith).toHaveBeenCalledWith({ fsPath: artifact.artifactPath });
  });

  it("rejects an invalid event target before openWith and reports the validation error", async () => {
    const userHome = await makeUserHome();
    const watcher = new TestWatcher();
    const openWith = vi.fn(async (_uri: TestUri) => undefined);
    const reportError = vi.fn();
    await setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => {
        await openArtifactReview(uri, {
          uriFromFilePath: (fsPath) => ({ fsPath }),
          openWith,
        }, { userHome });
      },
      reportError,
    });
    const artifact = await writeArtifact(userHome, "invalid-artifact-001");
    await writeFile(artifact.manifestPath, "{", "utf8");

    await watcher.fire({ fsPath: artifact.commentsPath });

    expect(openWith).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("keeps sequential round-transition create events eligible to reveal the editor", async () => {
    const userHome = await makeUserHome();
    const watcher = new TestWatcher();
    const open = vi.fn(async (_uri: TestUri) => undefined);
    await setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: open,
      reportError: vi.fn(),
    });
    const artifact = await writeArtifact(userHome, "round-transition-001");

    await watcher.fire({ fsPath: artifact.commentsPath });
    await watcher.fire({ fsPath: artifact.commentsPath });

    expect(open).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent duplicate watcher events through the shared open coordinator", async () => {
    const userHome = await makeUserHome();
    const watcher = new TestWatcher();
    const artifact = await writeArtifact(userHome, "duplicate-event-001");
    let releaseOpen: (() => void) | undefined;
    const openGate = new Promise<void>((resolve) => { releaseOpen = resolve; });
    const openWith = vi.fn(async (_uri: TestUri) => openGate);
    const coordinator = new ArtifactReviewOpenCoordinator<TestUri>({
      uriFromFilePath: (fsPath) => ({ fsPath }),
      openWith,
    }, { userHome });
    await setupGlobalArtifactReadyWatcher<TestUri, TestWatcher>({
      ensureGlobalArtifactsRoot: () => ensureSafeGlobalArtifactsRoot({ userHome }),
      createWatcher: () => watcher,
      isAutoOpenEnabled: () => true,
      isWindowFocused: () => true,
      artifactUriFromComments: (uri) => ({ fsPath: path.join(path.dirname(uri.fsPath), "artifact.md") }),
      openArtifactReview: async (uri) => { await coordinator.open(uri); },
      reportError: vi.fn(),
    });

    const first = watcher.fire({ fsPath: artifact.commentsPath });
    const second = watcher.fire({ fsPath: artifact.commentsPath });
    await vi.waitFor(() => expect(openWith).toHaveBeenCalledTimes(1));
    releaseOpen?.();
    await Promise.all([first, second]);

    expect(openWith).toHaveBeenCalledTimes(1);
  });
});
