import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import {
  ARTIFACT_UPDATE_LOCK_FILE,
  OWNER_ONLY_FILE_MODE,
  globalArtifactsRoot,
} from "../src/shared/artifact-files";
import { ARTIFACT_SCHEMA_VERSION } from "../src/shared/contracts";

const temporaryDirectories: string[] = [];
const markdown = "# Artifact\n\nBuild the review view.\n";
const reviewSessionId = "11111111-1111-4111-8111-111111111111";

type StoreFixture = {
  userHome: string;
  workspaceRoot: string;
  directory: string;
  store: ArtifactStore;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(artifactId = "artifact-001"): Promise<StoreFixture> {
  const userHome = await mkdtemp(path.join(tmpdir(), "agent-plus-store-home-"));
  temporaryDirectories.push(userHome);
  const workspaceRoot = path.join(userHome, "source-workspace");
  const directory = path.join(globalArtifactsRoot({ userHome }), artifactId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "artifact.md"), markdown, "utf8");
  const timestamp = new Date().toISOString();
  await writeFile(path.join(directory, "artifact.json"), `${JSON.stringify({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: "implementation-plan",
    artifactId,
    title: "Artifact",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    reviewSessionId,
  }, null, 2)}\n`, "utf8");
  return {
    userHome,
    workspaceRoot,
    directory,
    store: new ArtifactStore(path.join(directory, "artifact.md"), { userHome }),
  };
}

async function writeComments(
  directory: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const raw = `${JSON.stringify({
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    artifactId: "artifact-001",
    reviewRound: 1,
    artifactSha256: sha256(markdown),
    comments: [],
    ...overrides,
  }, null, 2)}\n`;
  await writeFile(path.join(directory, "comments.json"), raw, "utf8");
  return raw;
}

async function createDirectoryLink(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

async function expectNoTemporaryFiles(directory: string): Promise<void> {
  expect((await readdir(directory)).filter((file) => file.includes(".tmp-"))).toEqual([]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ArtifactStore", () => {
  it.each([3, 4, 5])("rejects schema-v%s artifacts", async (schemaVersion) => {
    const { directory, store } = await fixture();
    const manifestPath = path.join(directory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion }), "utf8");

    await expect(store.load()).rejects.toThrow("AI Artifacts supports version 6");
  });

  it("loads from the global handle as a schema-v6 artifact without location", async () => {
    const { directory, userHome, workspaceRoot, store } = await fixture();

    const state = await store.load();

    expect((state.artifact as any).location).toBeUndefined();
    expect(state.artifact.schemaVersion).toBe(6);
    expect(directory).toBe(path.join(globalArtifactsRoot({ userHome }), "artifact-001"));
    expect(directory.startsWith(workspaceRoot)).toBe(false);
    expect(state.lifecycle).toEqual({ readOnly: false });
  });

  it("rejects an artifact handle outside the configured global root", async () => {
    const userHome = await mkdtemp(path.join(tmpdir(), "agent-plus-store-home-"));
    temporaryDirectories.push(userHome);
    const outsidePath = path.join(userHome, "outside", "artifact-001", "artifact.md");
    const store = new ArtifactStore(outsidePath, { userHome });

    await expect(store.load()).rejects.toThrow("direct child of the collection root");
  });

  it("rejects relative handles and global handles that do not name artifact.md", async () => {
    const { directory, userHome } = await fixture();
    const relativeStore = new ArtifactStore(path.join("artifact-001", "artifact.md"), { userHome });
    const manifestStore = new ArtifactStore(path.join(directory, "artifact.json"), { userHome });

    await expect(relativeStore.load()).rejects.toThrow("absolute path to artifact.md");
    await expect(manifestStore.load()).rejects.toThrow("must point to artifact.md");
  });

  it("rejects a manifest whose artifact id differs from the directory handle", async () => {
    const { directory, store } = await fixture();
    const manifestPath = path.join(directory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, artifactId: "artifact-002" }), "utf8");

    await expect(store.load()).rejects.toThrow("does not belong to this global artifact directory");
  });

  it("rejects a linked global artifact directory before reading it", async () => {
    const { directory, store, userHome } = await fixture();
    const outsideDirectory = path.join(userHome, "outside-artifact");
    await rename(directory, outsideDirectory);
    await createDirectoryLink(outsideDirectory, directory);

    await expect(store.load()).rejects.toThrow("symbolic links and junctions");
  });

  it.each([
    "artifact.json",
    "artifact.md",
    "comments.json",
    "review-submission.json",
    ARTIFACT_UPDATE_LOCK_FILE,
  ])("rejects a linked %s before reading or observing it", async (fileName) => {
    const { directory, store, userHome } = await fixture();
    const linkedPath = path.join(directory, fileName);
    const outsideDirectory = path.join(userHome, `linked-target-${fileName.replaceAll(".", "-")}`);
    await mkdir(outsideDirectory);
    await rm(linkedPath, { recursive: true, force: true });
    await createDirectoryLink(outsideDirectory, linkedPath);

    await expect(store.load()).rejects.toThrow("symbolic links");
  });

  it.each(["comments.json", "review-submission.json"])(
    "rejects a non-regular %s target",
    async (fileName) => {
      const { directory, store } = await fixture();
      const targetPath = path.join(directory, fileName);
      await rm(targetPath, { force: true });
      await mkdir(targetPath);

      await expect(store.load()).rejects.toThrow("must be regular files");
    },
  );

  it("creates round-bound comments.json and persists a block-bound comment", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load();
    const paragraph = initial.blocks.find((block) => block.type === "paragraph");
    const state = await store.addComment({
      blockId: paragraph!.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Clarify the interaction.",
    });

    expect(state.comments.comments).toHaveLength(1);
    expect(state.comments).toMatchObject({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: "artifact-001",
      reviewRound: 1,
      artifactSha256: sha256(markdown),
    });
    expect(JSON.parse(await readFile(path.join(directory, "comments.json"), "utf8"))).toEqual(state.comments);

    const removed = await store.removeComment(state.comments.comments[0]!.id);
    expect(removed.comments.comments).toEqual([]);
  });

  it("rejects content changed outside the review update protocol", async () => {
    const { directory, store } = await fixture();
    await store.load();
    await writeFile(path.join(directory, "artifact.md"), "# Changed\n", "utf8");

    await expect(store.load()).rejects.toThrow("outside the artifact review update protocol");
  });

  it("rejects comments bound to another review round", async () => {
    const { directory, store } = await fixture();
    await writeComments(directory, { reviewRound: 2 });

    await expect(store.load()).rejects.toThrow("current artifact review round");
  });

  it.each([
    ["session", { reviewSessionId: "22222222-2222-4222-8222-222222222222" }],
    ["round", { reviewRound: 2 }],
  ])("rejects a submission bound to another %s", async (_label, overrides) => {
    const { directory, store } = await fixture();
    const commentsRaw = await writeComments(directory);
    await writeFile(path.join(directory, "review-submission.json"), `${JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      artifactId: "artifact-001",
      reviewRound: 1,
      reviewSessionId,
      submittedAt: new Date().toISOString(),
      decision: "approve",
      artifactSha256: sha256(markdown),
      commentsSha256: sha256(commentsRaw),
      ...overrides,
    }, null, 2)}\n`, "utf8");

    await expect(store.load()).rejects.toThrow("does not belong to this artifact lifecycle");
  });

  it("submits Review once for the current round and locks it", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load();
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
    await store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Clarify the interaction.",
    });

    const submitted = await store.submitReview("revise");
    expect(submitted.submission).toMatchObject({
      artifactId: "artifact-001",
      reviewRound: 1,
      reviewSessionId,
      decision: "revise",
    });
    await expect(store.removeComment(submitted.comments.comments[0]!.id)).rejects.toThrow("already submitted");
    await expect(store.submitReview("revise")).rejects.toThrow("already submitted");
    expect(JSON.parse(await readFile(path.join(directory, "review-submission.json"), "utf8"))).toMatchObject({
      decision: "revise",
      artifactSha256: sha256(markdown),
    });
  });

  it("rejects Review without comments", async () => {
    const { store } = await fixture();
    await store.load();
    await expect(store.submitReview("revise")).rejects.toThrow("at least one comment");
  });

  it.each(["approve", "save"] as const)("submits %s without comments", async (decision) => {
    const { store } = await fixture();
    await store.load();
    const submitted = await store.submitReview(decision);
    expect(submitted.submission?.decision).toBe(decision);
  });

  it("falls back to copyFile and cleans up tmp files when rename throws EPERM", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load();
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
    const fsModule = await import("node:fs");
    const renameSpy = vi.spyOn(fsModule.promises, "rename").mockRejectedValue(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    try {
      const state = await store.addComment({
        blockId: paragraph.id,
        selection: { quote: "review view", start: 10, end: 21 },
        body: "Fallback comment.",
      });
      expect(state.comments.comments).toHaveLength(1);
      await expectNoTemporaryFiles(directory);
      if (process.platform !== "win32") {
        expect((await stat(path.join(directory, "comments.json"))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      }
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("rejects a linked comments temporary target before mutation", async () => {
    const { directory, store, userHome } = await fixture();
    const initial = await store.load();
    const commentsPath = path.join(directory, "comments.json");
    const commentsBefore = await readFile(commentsPath, "utf8");
    const timestamp = 123456789;
    vi.spyOn(Date, "now").mockReturnValue(timestamp);
    const temporaryPath = `${commentsPath}.tmp-${process.pid}-${timestamp}`;
    const outsideDirectory = path.join(userHome, "linked-comments-temporary");
    await mkdir(outsideDirectory);
    await createDirectoryLink(outsideDirectory, temporaryPath);
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;

    await expect(store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "This must not follow a temporary link.",
    })).rejects.toThrow("symbolic links");

    expect(await readFile(commentsPath, "utf8")).toBe(commentsBefore);
    expect(await readdir(outsideDirectory)).toEqual([]);
  });

  it("cleans the comments temporary file and preserves state when replacement fails", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load();
    const commentsPath = path.join(directory, "comments.json");
    const commentsBefore = await readFile(commentsPath, "utf8");
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "rename").mockRejectedValue(
      Object.assign(new Error("injected replacement failure"), { code: "EIO" }),
    );

    await expect(store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "This write must roll back.",
    })).rejects.toThrow("injected replacement failure");

    expect(await readFile(commentsPath, "utf8")).toBe(commentsBefore);
    await expectNoTemporaryFiles(directory);
  });

  it("revalidates a comments target replaced by a link before copy fallback", async () => {
    const { directory, store, userHome } = await fixture();
    const initial = await store.load();
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
    const commentsPath = path.join(directory, "comments.json");
    const outsideDirectory = path.join(userHome, "comments-fallback-target");
    await mkdir(outsideDirectory);
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "rename").mockImplementationOnce(async () => {
      await rm(commentsPath, { force: true });
      await createDirectoryLink(outsideDirectory, commentsPath);
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    });

    await expect(store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Revalidate before fallback.",
    })).rejects.toThrow("symbolic links");

    expect(await readdir(outsideDirectory)).toEqual([]);
    await expectNoTemporaryFiles(directory);
  });

  it("uses the exclusive copy fallback for submission and cleans its temporary file", async () => {
    const { directory, store } = await fixture();
    await store.load();
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "link").mockRejectedValue(
      Object.assign(new Error("hard links unavailable"), { code: "EPERM" }),
    );

    const submitted = await store.submitReview("approve");

    expect(submitted.submission?.decision).toBe("approve");
    await expectNoTemporaryFiles(directory);
    if (process.platform !== "win32") {
      expect((await stat(path.join(directory, "review-submission.json"))).mode & 0o777)
        .toBe(OWNER_ONLY_FILE_MODE);
    }
  });

  it("rejects a linked submission temporary target before mutation", async () => {
    const { directory, store, userHome } = await fixture();
    await store.load();
    const submissionPath = path.join(directory, "review-submission.json");
    const timestamp = 987654321;
    vi.spyOn(Date, "now").mockReturnValue(timestamp);
    const temporaryPath = `${submissionPath}.tmp-${process.pid}-${timestamp}`;
    const outsideDirectory = path.join(userHome, "linked-submission-temporary");
    await mkdir(outsideDirectory);
    await createDirectoryLink(outsideDirectory, temporaryPath);

    await expect(store.submitReview("approve")).rejects.toThrow("symbolic links");

    await expect(readFile(submissionPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(outsideDirectory)).toEqual([]);
  });

  it("cleans the submission temporary file when its copy fallback fails", async () => {
    const { directory, store } = await fixture();
    await store.load();
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "link").mockRejectedValue(
      Object.assign(new Error("hard links unavailable"), { code: "EPERM" }),
    );
    vi.spyOn(fsModule.promises, "copyFile").mockRejectedValue(
      Object.assign(new Error("injected copy failure"), { code: "EIO" }),
    );

    await expect(store.submitReview("approve")).rejects.toThrow("injected copy failure");

    await expect(readFile(path.join(directory, "review-submission.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expectNoTemporaryFiles(directory);
  });

  it("revalidates a submission target replaced by a link before copy fallback", async () => {
    const { directory, store, userHome } = await fixture();
    await store.load();
    const outsideDirectory = path.join(userHome, "submission-fallback-target");
    await mkdir(outsideDirectory);
    const fsModule = await import("node:fs");
    vi.spyOn(fsModule.promises, "link").mockImplementationOnce(async (_source, target) => {
      await createDirectoryLink(outsideDirectory, String(target));
      throw Object.assign(new Error("hard links unavailable"), { code: "EPERM" });
    });

    await expect(store.submitReview("approve")).rejects.toThrow("symbolic links");

    expect(await readdir(outsideDirectory)).toEqual([]);
    await expectNoTemporaryFiles(directory);
  });

  it("preserves create-once submission semantics when another writer wins", async () => {
    const { directory, store } = await fixture();
    await store.load();
    const fsModule = await import("node:fs");
    const originalLink = fsModule.promises.link.bind(fsModule.promises);
    vi.spyOn(fsModule.promises, "link").mockImplementation(async (source, target) => {
      await originalLink(source, target);
      throw Object.assign(new Error("target already exists"), { code: "EEXIST" });
    });

    await expect(store.submitReview("approve")).rejects.toThrow("already submitted");

    expect(JSON.parse(await readFile(path.join(directory, "review-submission.json"), "utf8"))).toMatchObject({
      decision: "approve",
    });
    await expectNoTemporaryFiles(directory);
  });

  it.skipIf(process.platform === "win32")(
    "keeps comment and submission files owner-only after normal writes",
    async () => {
      const { directory, store } = await fixture();
      const initial = await store.load();
      const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
      await store.addComment({
        blockId: paragraph.id,
        selection: { quote: "review view", start: 10, end: 21 },
        body: "Keep this private.",
      });
      await store.submitReview("approve");

      expect((await stat(path.join(directory, "comments.json"))).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
      expect((await stat(path.join(directory, "review-submission.json"))).mode & 0o777)
        .toBe(OWNER_ONLY_FILE_MODE);
      await expectNoTemporaryFiles(directory);
    },
  );
});
