import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import { assertArtifactDirectory } from "../src/shared/artifact-validation";
import type { AnyArtifactManifest } from "../src/shared/contracts";

const temporaryDirectories: string[] = [];
const markdown = "# Artifact\n\nBuild the review view.\n";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture(): Promise<{ directory: string; store: ArtifactStore }> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-plus-store-"));
  temporaryDirectories.push(workspaceRoot);
  const directory = path.join(workspaceRoot, ".codex-artifacts", "artifacts", "artifact-001");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "artifact.md"), markdown, "utf8");
  const timestamp = new Date().toISOString();
  await writeFile(path.join(directory, "artifact.json"), JSON.stringify({
    schemaVersion: 4,
    kind: "implementation-plan",
    artifactId: "artifact-001",
    title: "Artifact",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    location: { workspaceRoot },
    reviewSessionId: "11111111-1111-4111-8111-111111111111",
  }), "utf8");
  return { directory, store: new ArtifactStore(path.join(directory, "artifact.md")) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ArtifactStore", () => {
  it("rejects unsupported schema version 2 artifacts", async () => {
    const { directory, store } = await fixture();
    const manifestPath = path.join(directory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 2 }), "utf8");
    await expect(store.load()).rejects.toThrow("supports versions 3 and 4");
  });

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
      artifactId: "artifact-001",
      reviewRound: 1,
      artifactSha256: sha256(markdown),
    });
  });

  it("rejects content changed outside the review update protocol", async () => {
    const { directory, store } = await fixture();
    await store.load();
    await writeFile(path.join(directory, "artifact.md"), "# Changed\n", "utf8");
    await expect(store.load()).rejects.toThrow("outside the artifact review update protocol");
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
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
      decision: "revise",
    });
    await expect(store.removeComment(submitted.comments.comments[0]!.id)).rejects.toThrow("already submitted");
    await expect(store.submitReview("revise")).rejects.toThrow("already submitted");
    expect(JSON.parse(await readFile(path.join(directory, "review-submission.json"), "utf8"))).toMatchObject({
      decision: "revise",
      artifactSha256: sha256(markdown),
    });
  });

  it("approves an artifact with or without comments", async () => {
    const { store } = await fixture();
    await store.load();
    await expect(store.submitReview("revise")).rejects.toThrow("at least one comment");
    const approved = await store.submitReview("approve");
    expect(approved.submission?.decision).toBe("approve");
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
      expect((await readdir(directory)).some((file) => file.includes(".tmp"))).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("opens schema-v3 artifacts as read-only", async () => {
    const { directory, store } = await fixture();
    const manifestPath = path.join(directory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({
      ...manifest,
      schemaVersion: 3,
      origin: { codexCwd: manifest.location.workspaceRoot, threadId: "thread-001" },
      reviewSessionId: undefined,
    }), "utf8");
    await rm(path.join(directory, "comments.json"), { force: true });

    const state = await store.load();
    expect(state.lifecycle.readOnly).toBe(true);
    await expect(store.submitReview("approve")).rejects.toThrow("reading only");
  });

  it("validates artifact directories in both .ai-artifacts and .codex-artifacts", () => {
    const mockManifest: AnyArtifactManifest = {
      schemaVersion: 4,
      kind: "implementation-plan",
      artifactId: "test-artifact-001",
      title: "Test Artifact",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewRound: 1,
      location: { workspaceRoot: "D:/workspace/project" },
      reviewSessionId: "11111111-1111-4111-8111-111111111111",
    };

    // Valid with .ai-artifacts (primary)
    expect(() =>
      assertArtifactDirectory(
        mockManifest,
        path.resolve("D:/workspace/project/.ai-artifacts/artifacts/test-artifact-001"),
      ),
    ).not.toThrow();

    // Valid with .codex-artifacts (legacy)
    expect(() =>
      assertArtifactDirectory(
        mockManifest,
        path.resolve("D:/workspace/project/.codex-artifacts/artifacts/test-artifact-001"),
      ),
    ).not.toThrow();

    // Invalid directory name
    expect(() =>
      assertArtifactDirectory(
        mockManifest,
        path.resolve("D:/workspace/project/.other-artifacts/artifacts/test-artifact-001"),
      ),
    ).toThrow("The artifact directory does not match its declared workspace root and id.");
  });

  it("loads and persists comments for artifacts stored under .ai-artifacts", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-plus-ai-store-"));
    temporaryDirectories.push(workspaceRoot);
    const directory = path.join(workspaceRoot, ".ai-artifacts", "artifacts", "artifact-ai-001");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "artifact.md"), markdown, "utf8");
    const timestamp = new Date().toISOString();
    await writeFile(path.join(directory, "artifact.json"), JSON.stringify({
      schemaVersion: 4,
      kind: "implementation-plan",
      artifactId: "artifact-ai-001",
      title: "AI Artifact",
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewRound: 1,
      location: { workspaceRoot },
      reviewSessionId: "22222222-2222-4222-8222-222222222222",
    }), "utf8");

    const store = new ArtifactStore(path.join(directory, "artifact.md"));
    const state = await store.load();
    expect(state.artifact.artifactId).toBe("artifact-ai-001");
    expect(state.blocks.length).toBeGreaterThan(0);

    const paragraph = state.blocks.find((block) => block.type === "paragraph")!;
    const updated = await store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Test comment in .ai-artifacts store.",
    });
    expect(updated.comments.comments).toHaveLength(1);
    expect(updated.comments.comments[0]!.body).toBe("Test comment in .ai-artifacts store.");
  });
});
