import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  type BaseIntegrationPaths,
} from "../src/extension/workspace-integration-v4";

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
});
