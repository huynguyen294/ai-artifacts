import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import { hasManagedCodexArtifactsMcp, upsertCodexArtifactsMcp } from "../src/extension/mcp-config";
import { globalArtifactsRoot } from "../src/shared/artifact-files";

// Mock vscode for any imports in workspace-integration-v4
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  },
}));

import {
  baseAssetsAreCurrent,
  baseScriptIsCurrent,
  checkAllIntegrations,
  skillAssetsAreCurrent,
  getReviewSkillMarkdown,
  setupBaseMcpServer,
  type BaseIntegrationPaths,
} from "../src/extension/workspace-integration-v4";

const installedMcpProcesses: ChildProcessWithoutNullStreams[] = [];

type InstalledMcpClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  notify: (method: string, params?: Record<string, unknown>) => void;
};

function startInstalledMcp(
  scriptPath: string,
  environment: NodeJS.ProcessEnv,
): InstalledMcpClient {
  const processHandle = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  });
  installedMcpProcesses.push(processHandle);
  let nextId = 1;
  let stderr = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  processHandle.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  createInterface({ input: processHandle.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  processHandle.on("exit", (code) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`Installed MCP server exited with ${code}: ${stderr}`));
    }
    pending.clear();
  });
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      processHandle.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
  };
}

describe("Workspace Integration Asset Verifiers", () => {
  let tempDir: string;
  let sourceDir: string;
  let targetDir: string;
  let paths: BaseIntegrationPaths;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `ai-artifacts-integ-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sourceDir = path.join(tempDir, "source");
    targetDir = path.join(tempDir, "target");

    paths = {
      targetDirectory: path.join(targetDir, ".vscode", "ai-artifacts"),
      workspacesDirectory: path.join(targetDir, ".vscode", "ai-artifacts", "workspaces"),
      targetMcpScript: path.join(targetDir, ".vscode", "ai-artifacts", "server.mjs"),
      targetLegacyMcpScript: path.join(targetDir, ".vscode", "ai-artifacts", "legacy.mjs"),
      targetSkill: path.join(targetDir, ".agents", "skills", "create-review-artifact"),
      targetLegacySkill: path.join(targetDir, ".agents", "skills", "create-plan-artifact"),
      sourceMcpScript: path.join(sourceDir, "dist", "server.mjs"),
      sourceSkill: path.join(sourceDir, "skills", "create-review-artifact"),
    };

    // Prepare source assets
    await fs.mkdir(path.dirname(paths.sourceMcpScript), { recursive: true });
    await fs.writeFile(paths.sourceMcpScript, "// MCP server script v1", "utf8");

    await fs.mkdir(path.join(paths.sourceSkill, "references"), { recursive: true });
    await fs.mkdir(path.join(paths.sourceSkill, "agents"), { recursive: true });
    await fs.writeFile(path.join(paths.sourceSkill, "SKILL.md"), "# Skill content", "utf8");
    await fs.writeFile(path.join(paths.sourceSkill, "references", "artifact-contract.md"), "# Contract", "utf8");
    await fs.writeFile(path.join(paths.sourceSkill, "agents", "openai.yaml"), "prompt: test", "utf8");
  });

  afterEach(async () => {
    for (const processHandle of installedMcpProcesses.splice(0)) processHandle.kill();
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("reports false when target files do not exist", async () => {
    expect(await baseScriptIsCurrent(paths)).toBe(false);
    expect(await skillAssetsAreCurrent(paths)).toBe(false);
    expect(await baseAssetsAreCurrent(paths)).toBe(false);
  });

  it("reports true when target assets match source exactly", async () => {
    // Deploy MCP script
    await fs.mkdir(path.dirname(paths.targetMcpScript), { recursive: true });
    await fs.copyFile(paths.sourceMcpScript, paths.targetMcpScript);

    expect(await baseScriptIsCurrent(paths)).toBe(true);
    expect(await skillAssetsAreCurrent(paths)).toBe(false);
    expect(await baseAssetsAreCurrent(paths)).toBe(false);

    // Deploy Skills
    await fs.mkdir(path.join(paths.targetSkill, "references"), { recursive: true });
    await fs.mkdir(path.join(paths.targetSkill, "agents"), { recursive: true });
    await fs.copyFile(path.join(paths.sourceSkill, "SKILL.md"), path.join(paths.targetSkill, "SKILL.md"));
    await fs.copyFile(
      path.join(paths.sourceSkill, "references", "artifact-contract.md"),
      path.join(paths.targetSkill, "references", "artifact-contract.md"),
    );
    await fs.copyFile(
      path.join(paths.sourceSkill, "agents", "openai.yaml"),
      path.join(paths.targetSkill, "agents", "openai.yaml"),
    );

    expect(await baseScriptIsCurrent(paths)).toBe(true);
    expect(await skillAssetsAreCurrent(paths)).toBe(true);
    expect(await baseAssetsAreCurrent(paths)).toBe(true);
  });

  it("detects outdated or mismatched skill assets", async () => {
    await fs.mkdir(path.dirname(paths.targetMcpScript), { recursive: true });
    await fs.copyFile(paths.sourceMcpScript, paths.targetMcpScript);

    await fs.mkdir(path.join(paths.targetSkill, "references"), { recursive: true });
    await fs.mkdir(path.join(paths.targetSkill, "agents"), { recursive: true });
    // Write modified SKILL.md
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), "# Outdated skill", "utf8");
    await fs.copyFile(
      path.join(paths.sourceSkill, "references", "artifact-contract.md"),
      path.join(paths.targetSkill, "references", "artifact-contract.md"),
    );
    await fs.copyFile(
      path.join(paths.sourceSkill, "agents", "openai.yaml"),
      path.join(paths.targetSkill, "agents", "openai.yaml"),
    );

    expect(await baseScriptIsCurrent(paths)).toBe(true);
    expect(await skillAssetsAreCurrent(paths)).toBe(false);
    expect(await baseAssetsAreCurrent(paths)).toBe(false);
  });

  it("getReviewSkillMarkdown reads source SKILL.md", async () => {
    const mockContext = {
      extensionUri: { fsPath: sourceDir },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    const content = await getReviewSkillMarkdown(mockContext);
    expect(content).toBe("# Skill content");
  });

  it("getReviewSkillMarkdown falls back to target SKILL.md when source is missing", async () => {
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);

    // Deploy target skill fallback
    const targetSkillFile = path.join(targetDir, ".agents", "skills", "create-review-artifact", "SKILL.md");
    await fs.mkdir(path.dirname(targetSkillFile), { recursive: true });
    await fs.writeFile(targetSkillFile, "# Fallback target skill", "utf8");

    // Context pointing to empty source dir
    const emptySourceDir = path.join(tempDir, "empty-source");
    await fs.mkdir(emptySourceDir, { recursive: true });

    const mockContext = {
      extensionUri: { fsPath: emptySourceDir },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    const content = await getReviewSkillMarkdown(mockContext);
    expect(content).toBe("# Fallback target skill");
  });

  it("checkAllIntegrations returns expected report structure with independent skill and base status", async () => {
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);

    const mockContext = {
      extensionUri: { fsPath: sourceDir },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    const report = await checkAllIntegrations(mockContext);
    expect(typeof report.skillCurrent).toBe("boolean");
    expect(typeof report.baseCurrent).toBe("boolean");
    expect(Array.isArray(report.clients)).toBe(true);
    expect(report.clients.length).toBeGreaterThan(0);

    for (const client of report.clients) {
      expect(typeof client.id).toBe("string");
      expect(typeof client.name).toBe("string");
      expect(typeof client.isDetected).toBe("boolean");
      expect(["missing", "outdated", "ready", "configuration-conflict"]).toContain(client.status);
    }
  });

  it("installs the real bundle and skill into a temp home and completes the schema-v5 global contract", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const sourceBundle = path.join(repositoryRoot, "dist", "integration", "codex-artifacts-review-mcp.mjs");
    await expect(fs.access(sourceBundle)).resolves.toBeUndefined();
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const context = {
      extensionUri: { fsPath: repositoryRoot },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    const { paths: installedPaths } = await setupBaseMcpServer(context);
    expect(await baseScriptIsCurrent(installedPaths)).toBe(true);
    expect(await skillAssetsAreCurrent(installedPaths)).toBe(true);
    expect(await baseAssetsAreCurrent(installedPaths)).toBe(true);
    expect(await fs.readFile(installedPaths.targetMcpScript)).toEqual(await fs.readFile(installedPaths.sourceMcpScript));
    expect(await fs.readFile(installedPaths.targetLegacyMcpScript)).toEqual(await fs.readFile(installedPaths.sourceMcpScript));
    for (const relativePath of [
      "SKILL.md",
      path.join("references", "artifact-contract.md"),
      path.join("agents", "openai.yaml"),
    ]) {
      expect(await fs.readFile(path.join(installedPaths.targetSkill, relativePath))).toEqual(
        await fs.readFile(path.join(installedPaths.sourceSkill, relativePath)),
      );
    }

    const configPath = path.join(targetDir, ".codex", "config.toml");
    const config = upsertCodexArtifactsMcp('model = "gpt-test"\n', installedPaths.targetMcpScript);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, config, "utf8");
    expect(hasManagedCodexArtifactsMcp(config, installedPaths.targetMcpScript)).toBe(true);
    const configuredTools = [...config.matchAll(/^\[mcp_servers\.ai_artifacts\.tools\.([^\]]+)\]$/gm)]
      .map((match) => match[1]);
    const expectedTools = [
      "resolve_artifact_workspace",
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact_review",
      "advance_and_wait_for_artifact",
    ];
    expect(configuredTools).toEqual(expectedTools);

    const workspace = path.join(tempDir, "workspace");
    const taggedFile = path.join(workspace, "AGENTS.md");
    await fs.mkdir(workspace);
    await fs.writeFile(taggedFile, "# Workspace\n", "utf8");
    const instanceId = randomUUID();
    const now = Date.now();
    await fs.writeFile(path.join(installedPaths.workspacesDirectory, `${instanceId}.json`), `${JSON.stringify({
      schemaVersion: 2,
      instanceId,
      processId: process.pid,
      workspaceFile: null,
      focused: true,
      folders: [{ path: workspace, realPath: await fs.realpath(workspace) }],
      activeFile: { path: taggedFile, workspaceRoot: workspace },
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }, null, 2)}\n`, "utf8");

    const client = startInstalledMcp(installedPaths.targetMcpScript, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_USER_HOME: targetDir,
      CODEX_ARTIFACTS_REGISTRY_DIRECTORY: installedPaths.workspacesDirectory,
    });
    const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
    expect(initialized.serverInfo.version).toBe("7.0.0");
    client.notify("notifications/initialized");
    const catalog = await client.request("tools/list");
    expect(catalog.tools.map((tool: any) => tool.name)).toEqual(expectedTools);

    const markdown = "# Installed lifecycle\n\nReview the installed schema-v5 bridge.\n";
    const createResult = await client.request("tools/call", {
      name: "create_artifact",
      arguments: {
        workspaceRoot: workspace,
        workspaceEvidence: { kind: "tagged-file", filePath: taggedFile },
        title: "Installed lifecycle",
        kind: "implementation-plan",
        markdown,
      },
    });
    expect(createResult.isError, createResult.content?.[0]?.text).not.toBe(true);
    const created = createResult.structuredContent;
    expect(path.dirname(created.artifactDirectory)).toBe(await fs.realpath(globalArtifactsRoot({ userHome: targetDir })));
    await expect(fs.access(path.join(workspace, ".ai-artifacts"))).rejects.toThrow();

    const store = new ArtifactStore(created.artifactPath, { userHome: targetDir });
    const loaded = await store.load();
    expect(loaded.artifact).toMatchObject({
      schemaVersion: 5,
      artifactId: created.artifactId,
      reviewRound: 1,
      location: { workspaceRoot: workspace },
    });
    expect(loaded.markdown).toBe(markdown);
    await store.submitReview("approve");
    const reviewed = await client.request("tools/call", {
      name: "wait_for_artifact_review",
      arguments: {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
      },
    });
    expect(reviewed.isError, reviewed.content?.[0]?.text).not.toBe(true);
    expect(reviewed.structuredContent).toMatchObject({
      artifactId: created.artifactId,
      reviewRound: 1,
      decision: "approve",
    });
  });
});
