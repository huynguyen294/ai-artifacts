import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("stamp-origin hook", () => {
  it("links the origin, creates comments, and retires a replaced artifact", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-"));
    temporaryDirectories.push(workspace);
    const workspaceRoot = path.join(workspace, "backend");
    const codexCwd = path.join(workspace, "codex-session");
    const plans = path.join(workspaceRoot, ".codex-artifacts", "plans");
    const oldDirectory = path.join(plans, "plan-old");
    const nextDirectory = path.join(plans, "plan-next");
    const unrelatedDirectory = path.join(plans, "plan-unrelated");
    await mkdir(codexCwd, { recursive: true });
    await mkdir(oldDirectory, { recursive: true });
    await mkdir(nextDirectory, { recursive: true });
    await mkdir(unrelatedDirectory, { recursive: true });
    await writeFile(path.join(oldDirectory, "plan.md"), "# Old\n", "utf8");
    await writeFile(path.join(oldDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-old",
      title: "Old",
      createdAt: new Date().toISOString(),
      operation: "create",
      location: { workspaceRoot },
      origin: { threadId: "thread-old", codexCwd },
    }), "utf8");
    await writeFile(path.join(nextDirectory, "plan.md"), "# Next\n", "utf8");
    await writeFile(path.join(nextDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-next",
      title: "Next",
      createdAt: new Date().toISOString(),
      operation: "replace",
      replacesArtifactId: "plan-old",
      location: { workspaceRoot },
      origin: {},
    }), "utf8");
    await writeFile(path.join(unrelatedDirectory, "plan.md"), "# Unrelated\n", "utf8");
    await writeFile(path.join(unrelatedDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-unrelated",
      title: "Unrelated",
      createdAt: new Date().toISOString(),
      operation: "create",
      location: { workspaceRoot },
      origin: {},
    }), "utf8");

    const hookPath = path.resolve(
      import.meta.dirname,
      "../dist/integration/codex-artifacts-stamp-origin.mjs",
    );
    await runHook(hookPath, {
        session_id: "thread-origin",
        turn_id: "turn-origin",
        cwd: codexCwd,
        tool_input: {
          patch: [
            "*** Begin Patch",
            `*** Add File: ${path.join(nextDirectory, "artifact.json")}`,
            "+{}",
            `*** Add File: ${path.join(nextDirectory, "plan.md")}`,
            "+# Next",
            "*** End Patch",
          ].join("\n"),
        },
    });

    const manifest = JSON.parse(await readFile(path.join(nextDirectory, "artifact.json"), "utf8"));
    const comments = JSON.parse(await readFile(path.join(nextDirectory, "comments.json"), "utf8"));
    const trash = await readdir(path.join(workspaceRoot, ".codex-artifacts", ".trash"));
    expect(manifest.origin).toMatchObject({ threadId: "thread-origin", turnId: "turn-origin", codexCwd });
    expect(manifest.location).toEqual({ workspaceRoot });
    expect(comments).toMatchObject({ schemaVersion: 2, artifactId: "plan-next", comments: [] });
    expect(trash[0]).toMatch(/^plan-old-/);
    const nextFiles = await readdir(nextDirectory);
    expect(nextFiles.some((f) => f.includes(".tmp"))).toBe(false);
    await expect(access(path.join(unrelatedDirectory, "comments.json"))).rejects.toThrow();
    const unrelatedManifest = JSON.parse(await readFile(path.join(unrelatedDirectory, "artifact.json"), "utf8"));
    expect(unrelatedManifest.origin.threadId).toBeUndefined();
  });

  it("rejects an artifact whose declared workspace root does not match its patch path", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-root-mismatch-"));
    temporaryDirectories.push(workspace);
    const actualRoot = path.join(workspace, "frontend");
    const declaredRoot = path.join(workspace, "backend");
    const codexCwd = path.join(workspace, "codex-session");
    const artifactDirectory = path.join(actualRoot, ".codex-artifacts", "plans", "plan-mismatch");
    await mkdir(artifactDirectory, { recursive: true });
    await mkdir(declaredRoot, { recursive: true });
    await mkdir(codexCwd, { recursive: true });
    await writeFile(path.join(artifactDirectory, "plan.md"), "# Mismatch\n", "utf8");
    await writeFile(path.join(artifactDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-mismatch",
      title: "Mismatch",
      createdAt: new Date().toISOString(),
      operation: "create",
      location: { workspaceRoot: declaredRoot },
      origin: {},
    }), "utf8");

    const hookPath = path.resolve(
      import.meta.dirname,
      "../dist/integration/codex-artifacts-stamp-origin.mjs",
    );
    await runHook(hookPath, {
      session_id: "thread-mismatch",
      cwd: codexCwd,
      tool_input: {
        patch: [
          "*** Begin Patch",
          `*** Add File: ${path.join(artifactDirectory, "artifact.json")}`,
          "+{}",
          `*** Add File: ${path.join(artifactDirectory, "plan.md")}`,
          "+# Mismatch",
          "*** End Patch",
        ].join("\n"),
      },
    });

    await expect(access(path.join(artifactDirectory, "comments.json"))).rejects.toThrow();
    const manifest = JSON.parse(await readFile(path.join(artifactDirectory, "artifact.json"), "utf8"));
    expect(manifest.origin.threadId).toBeUndefined();
  });

  it("rejects a replacement when the prior artifact exists only in another workspace root", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agent-plus-hook-cross-root-"));
    temporaryDirectories.push(workspace);
    const frontendRoot = path.join(workspace, "frontend");
    const backendRoot = path.join(workspace, "backend");
    const oldDirectory = path.join(frontendRoot, ".codex-artifacts", "plans", "plan-old");
    const nextDirectory = path.join(backendRoot, ".codex-artifacts", "plans", "plan-next");
    await mkdir(oldDirectory, { recursive: true });
    await mkdir(nextDirectory, { recursive: true });
    await writeFile(path.join(oldDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-old",
      title: "Old frontend plan",
      createdAt: new Date().toISOString(),
      operation: "create",
      location: { workspaceRoot: frontendRoot },
      origin: { threadId: "thread-old", codexCwd: frontendRoot },
    }), "utf8");
    await writeFile(path.join(oldDirectory, "plan.md"), "# Old\n", "utf8");
    await writeFile(path.join(nextDirectory, "artifact.json"), JSON.stringify({
      schemaVersion: 2,
      kind: "plan",
      artifactId: "plan-next",
      title: "Invalid cross-root replacement",
      createdAt: new Date().toISOString(),
      operation: "replace",
      replacesArtifactId: "plan-old",
      location: { workspaceRoot: backendRoot },
      origin: {},
    }), "utf8");
    await writeFile(path.join(nextDirectory, "plan.md"), "# Next\n", "utf8");

    const hookPath = path.resolve(
      import.meta.dirname,
      "../dist/integration/codex-artifacts-stamp-origin.mjs",
    );
    await runHook(hookPath, {
      session_id: "thread-next",
      cwd: workspace,
      tool_input: {
        patch: [
          "*** Begin Patch",
          `*** Add File: ${path.join(nextDirectory, "artifact.json")}`,
          "+{}",
          `*** Add File: ${path.join(nextDirectory, "plan.md")}`,
          "+# Next",
          "*** End Patch",
        ].join("\n"),
      },
    });

    await expect(access(path.join(nextDirectory, "comments.json"))).rejects.toThrow();
    await expect(access(oldDirectory)).resolves.toBeUndefined();
    const nextManifest = JSON.parse(await readFile(path.join(nextDirectory, "artifact.json"), "utf8"));
    expect(nextManifest.origin.threadId).toBeUndefined();
  });
});
