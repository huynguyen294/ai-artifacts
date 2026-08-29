import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function runHook(hookPath: string, input: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `Hook exited ${code}`)));
    child.stdin.end(JSON.stringify(input));
  });
}

function manifest(workspaceRoot: string, artifactId: string): Record<string, unknown> {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: 3,
    kind: "implementation-plan",
    artifactId,
    title: "Review artifact",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewRound: 1,
    location: { workspaceRoot },
    origin: {},
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("stamp-origin hook", () => {
  it("links a new schema v3 artifact and creates round-one comments", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-"));
    temporaryDirectories.push(workspace);
    const workspaceRoot = path.join(workspace, "backend");
    const codexCwd = path.join(workspace, "codex-session");
    const artifactDirectory = path.join(workspaceRoot, ".codex-artifacts", "artifacts", "artifact-next");
    const unrelatedDirectory = path.join(workspaceRoot, ".codex-artifacts", "artifacts", "artifact-unrelated");
    await mkdir(codexCwd, { recursive: true });
    await mkdir(artifactDirectory, { recursive: true });
    await mkdir(unrelatedDirectory, { recursive: true });
    const markdown = "# Next\n";
    await writeFile(path.join(artifactDirectory, "artifact.md"), markdown, "utf8");
    await writeFile(path.join(artifactDirectory, "artifact.json"), JSON.stringify(manifest(workspaceRoot, "artifact-next")), "utf8");
    await writeFile(path.join(unrelatedDirectory, "artifact.md"), "# Unrelated\n", "utf8");
    await writeFile(path.join(unrelatedDirectory, "artifact.json"), JSON.stringify(manifest(workspaceRoot, "artifact-unrelated")), "utf8");

    const hookPath = path.resolve(import.meta.dirname, "../dist/integration/codex-artifacts-stamp-origin.mjs");
    await runHook(hookPath, {
      session_id: "thread-origin",
      turn_id: "turn-origin",
      cwd: codexCwd,
      tool_input: {
        patch: [
          "*** Begin Patch",
          `*** Add File: ${path.join(artifactDirectory, "artifact.json")}`,
          "+{}",
          `*** Add File: ${path.join(artifactDirectory, "artifact.md")}`,
          "+# Next",
          "*** End Patch",
        ].join("\n"),
      },
    });

    const stamped = JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"));
    const comments = JSON.parse(await readFile(path.join(artifactDirectory, "comments.json"), "utf8"));
    expect(stamped.origin).toMatchObject({ threadId: "thread-origin", turnId: "turn-origin", codexCwd });
    expect(comments).toMatchObject({
      schemaVersion: 3,
      artifactId: "artifact-next",
      reviewRound: 1,
      artifactSha256: sha256(markdown),
      comments: [],
    });
    await expect(access(path.join(unrelatedDirectory, "comments.json"))).rejects.toThrow();
    expect(await readdir(path.join(workspaceRoot, ".codex-artifacts"))).toEqual(["artifacts"]);
  });

  it("rejects an artifact whose declared workspace root does not match its path", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-root-"));
    temporaryDirectories.push(workspace);
    const actualRoot = path.join(workspace, "frontend");
    const declaredRoot = path.join(workspace, "backend");
    const artifactDirectory = path.join(actualRoot, ".codex-artifacts", "artifacts", "artifact-mismatch");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "artifact.md"), "# Mismatch\n", "utf8");
    await writeFile(path.join(artifactDirectory, "artifact.json"), JSON.stringify(manifest(declaredRoot, "artifact-mismatch")), "utf8");
    const hookPath = path.resolve(import.meta.dirname, "../dist/integration/codex-artifacts-stamp-origin.mjs");
    await runHook(hookPath, {
      session_id: "thread-mismatch",
      cwd: actualRoot,
      tool_input: { patch: `*** Add File: ${path.join(artifactDirectory, "artifact.json")}\n*** Add File: ${path.join(artifactDirectory, "artifact.md")}` },
    });
    const unchanged = JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"));
    expect(unchanged.origin.threadId).toBeUndefined();
    await expect(access(path.join(artifactDirectory, "comments.json"))).rejects.toThrow();
  });

  it("ignores update patches and incomplete creation pairs", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-update-"));
    temporaryDirectories.push(workspaceRoot);
    const artifactDirectory = path.join(workspaceRoot, ".codex-artifacts", "artifacts", "artifact-existing");
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(path.join(artifactDirectory, "artifact.md"), "# Existing\n", "utf8");
    await writeFile(path.join(artifactDirectory, "artifact.json"), JSON.stringify(manifest(workspaceRoot, "artifact-existing")), "utf8");
    const hookPath = path.resolve(import.meta.dirname, "../dist/integration/codex-artifacts-stamp-origin.mjs");
    await runHook(hookPath, {
      session_id: "thread-update",
      cwd: workspaceRoot,
      tool_input: { patch: `*** Update File: ${path.join(artifactDirectory, "artifact.md")}` },
    });
    await runHook(hookPath, {
      session_id: "thread-incomplete",
      cwd: workspaceRoot,
      tool_input: { patch: `*** Add File: ${path.join(artifactDirectory, "artifact.json")}` },
    });
    const unchanged = JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"));
    expect(unchanged.origin.threadId).toBeUndefined();
    await expect(access(path.join(artifactDirectory, "comments.json"))).rejects.toThrow();
  });
});
