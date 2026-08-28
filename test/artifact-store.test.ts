import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{ directory: string; store: ArtifactStore }> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-plus-store-"));
  temporaryDirectories.push(workspaceRoot);
  const directory = path.join(workspaceRoot, ".codex-artifacts", "plans", "plan-001");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "plan.md"), "# Plan\n\nBuild the review view.\n", "utf8");
  await writeFile(path.join(directory, "artifact.json"), JSON.stringify({
    schemaVersion: 2,
    kind: "plan",
    artifactId: "plan-001",
    title: "Plan",
    createdAt: new Date().toISOString(),
    operation: "create",
    location: { workspaceRoot },
    origin: { codexCwd: workspaceRoot, threadId: "thread-001" },
  }), "utf8");
  return { directory, store: new ArtifactStore(path.join(directory, "plan.md")) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ArtifactStore", () => {
  it("rejects legacy schema version 1 artifacts", async () => {
    const { directory, store } = await fixture();
    const manifestPath = path.join(directory, "artifact.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, schemaVersion: 1 }), "utf8");
    await expect(store.load()).rejects.toThrow("requires version 2");
  });

  it("creates comments.json and persists a block-bound comment", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load(true);
    const paragraph = initial.blocks.find((block) => block.type === "paragraph");
    expect(paragraph).toBeDefined();
    const state = await store.addComment({
      blockId: paragraph!.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Clarify the interaction.",
    });
    expect(state.comments.comments).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(directory, "comments.json"), "utf8")).comments).toHaveLength(1);
  });

  it("rejects comments when plan.md changes in the same lifecycle", async () => {
    const { directory, store } = await fixture();
    await store.load();
    await writeFile(path.join(directory, "plan.md"), "# Changed\n", "utf8");
    await expect(store.load()).rejects.toThrow("Create a new artifact revision");
  });

  it("submits a revision request once and locks the review", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load(true);
    const paragraph = initial.blocks.find((block) => block.type === "paragraph")!;
    await store.addComment({
      blockId: paragraph.id,
      selection: { quote: "review view", start: 10, end: 21 },
      body: "Clarify the interaction.",
    });

    const submitted = await store.submitReview("revise");
    expect(submitted.submission).toMatchObject({
      artifactId: "plan-001",
      threadId: "thread-001",
      decision: "revise",
    });
    expect(JSON.parse(await readFile(path.join(directory, "review-submission.json"), "utf8"))).toMatchObject({
      decision: "revise",
    });
    await expect(store.removeComment(submitted.comments.comments[0]!.id)).rejects.toThrow("already submitted");
    await expect(store.submitReview("revise")).rejects.toThrow("already submitted");
  });

  it("approves a plan with or without comments", async () => {
    const { store } = await fixture();
    await store.load(true);
    await expect(store.submitReview("revise")).rejects.toThrow("at least one comment");
    const approved = await store.submitReview("approve");
    expect(approved.submission?.decision).toBe("approve");
  });

  it("falls back to copyFile and cleans up tmp files when rename throws EPERM", async () => {
    const { directory, store } = await fixture();
    const initial = await store.load(true);
    const paragraph = initial.blocks.find((block) => block.type === "paragraph");
    expect(paragraph).toBeDefined();

    const fsModule = await import("node:fs");
    const renameSpy = vi.spyOn(fsModule.promises, "rename").mockRejectedValue(
      Object.assign(new Error("operation not permitted"), { code: "EPERM" }),
    );

    try {
      const state = await store.addComment({
        blockId: paragraph!.id,
        selection: { quote: "review view", start: 10, end: 21 },
        body: "Fallback comment.",
      });
      expect(state.comments.comments).toHaveLength(1);
      const commentsOnDisk = JSON.parse(await readFile(path.join(directory, "comments.json"), "utf8"));
      expect(commentsOnDisk.comments).toHaveLength(1);
      const files = await readdir(directory);
      expect(files.some((file) => file.includes(".tmp"))).toBe(false);
    } finally {
      renameSpy.mockRestore();
    }
  });
});
