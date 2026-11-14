import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import {
  CODEX_UNEXPECTED_KEY_CONFLICT,
  hasManagedCodexArtifactsMcp,
  upsertCodexArtifactsMcp,
} from "../src/extension/mcp-config";
import {
  globalArtifactsRoot,
  managedInstalledClientsPath,
  managedIntegrationVersionPath,
  managedMcpScriptPath,
} from "../src/shared/artifact-files";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  MCP_CLIENT_IDS,
  MCP_VERSION,
  SKILL_VERSION,
  WORK_SESSION_SKILL_VERSION,
} from "../src/shared/contracts";
import { addInstalledClient, readInstalledClients } from "../src/extension/installed-client-state";
import {
  OFFICIAL_SKILL_DESCRIPTIONS,
  USER_CUSTOM_RULES_BEGIN,
  USER_CUSTOM_RULES_END,
  extractCustomRulesBlock,
  extractFrontmatterDescriptionEntry,
  replaceSkillDirectory,
} from "../src/extension/mcp-clients/skill-helper";

// Mock vscode for any imports in workspace-integration-v4
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  },
}));

import {
  baseScriptIsCurrent,
  checkAllIntegrations,
  getCodexMcpConfigSnippet,
  installSelectedIntegrations,
  listInstallableClients,
  listInstallerClients,
  readInstalledIntegrationVersion,
  sessionSkillAssetsAreCurrent,
  skillAssetsAreCurrent,
  getReviewSkillMarkdown,
  setupBaseMcpServer,
  uninstallSelectedIntegrations,
  upgradeDetectedIntegrations,
  writeInstalledIntegrationVersion,
  type BaseIntegrationPaths,
} from "../src/extension/workspace-integration";
import { resolveWorkSessionSupport } from "../src/extension/work-session-support";

const ALL_CLIENT_IDS = ["copilot", "cursor", "codex", "claude", "windsurf", "cline", "antigravity"] as const;

async function baseAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  const [skillCurrent, sessionSkillCurrent, scriptCurrent] = await Promise.all([
    skillAssetsAreCurrent(paths),
    sessionSkillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
  ]);
  return skillCurrent && sessionSkillCurrent && scriptCurrent;
}

async function installClientsOrThrow(
  context: Parameters<typeof installSelectedIntegrations>[0],
  clientIds: Parameters<typeof installSelectedIntegrations>[1],
  options?: Parameters<typeof installSelectedIntegrations>[2],
): Promise<Awaited<ReturnType<typeof installSelectedIntegrations>>> {
  const result = await installSelectedIntegrations(context, clientIds, options);
  const failure = result.failedClients[0];
  if (failure) throw new Error(failure.error);
  return result;
}
import {
  AntigravityClientDriver,
  ClaudeClientDriver,
  ClineClientDriver,
  CodexClientDriver,
  CopilotClientDriver,
  CursorClientDriver,
  WindsurfClientDriver,
} from "../src/extension/mcp-clients/index";

const installedMcpProcesses: ChildProcessWithoutNullStreams[] = [];
const CURRENT_SKILL_DESCRIPTION = OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!;
const SOURCE_SKILL_MARKDOWN = [
  "---",
  "name: create-review-artifact",
  `description: ${CURRENT_SKILL_DESCRIPTION}`,
  "---",
  "",
  "# Skill content",
  "",
  "## User Custom Rules",
  "",
  "Custom rules override default rules when they conflict.",
  "",
  USER_CUSTOM_RULES_BEGIN,
  USER_CUSTOM_RULES_END,
  "",
].join("\n");

type InstalledMcpClient = {
  request: (method: string, params?: Record<string, unknown>) => Promise<any>;
  notify: (method: string, params?: Record<string, unknown>) => void;
};

function startInstalledMcp(scriptPath: string, environment: NodeJS.ProcessEnv): InstalledMcpClient {
  const processHandle = spawn(process.execPath, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...environment },
  });
  installedMcpProcesses.push(processHandle);
  let nextId = 1;
  let stderr = "";
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  processHandle.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
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
      targetDirectory: path.join(targetDir, ".ai-artifacts", "managed"),
      workspacesDirectory: path.join(targetDir, ".ai-artifacts", "managed", "workspaces"),
      targetMcpScript: path.join(targetDir, ".ai-artifacts", "managed", "runtime", "ai-artifacts-review-mcp.mjs"),
      targetLegacyMcpScript: path.join(targetDir, ".vscode", "ai-artifacts", "ai-artifacts-review-mcp.mjs"),
      targetSkill: path.join(targetDir, ".agents", "skills", "create-review-artifact"),
      targetSessionSkill: path.join(targetDir, ".agents", "skills", "work-session"),
      targetLegacySkill: path.join(targetDir, ".agents", "skills", "create-plan-artifact"),
      sourceMcpScript: path.join(sourceDir, "dist", "server.mjs"),
      sourceSkill: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkill: path.join(sourceDir, "skills", "work-session"),
    };

    // Prepare source assets
    await fs.mkdir(path.dirname(paths.sourceMcpScript), { recursive: true });
    await fs.writeFile(paths.sourceMcpScript, "// MCP server script v1", "utf8");

    await fs.mkdir(path.join(paths.sourceSkill, "references"), { recursive: true });
    await fs.mkdir(path.join(paths.sourceSkill, "agents"), { recursive: true });
    await fs.writeFile(path.join(paths.sourceSkill, "SKILL.md"), SOURCE_SKILL_MARKDOWN, "utf8");
    await fs.writeFile(path.join(paths.sourceSkill, "references", "artifact-contract.md"), "# Contract", "utf8");
    await fs.writeFile(path.join(paths.sourceSkill, "references", "ai-feedback.md"), "# AI feedback", "utf8");
    await fs.writeFile(path.join(paths.sourceSkill, "agents", "openai.yaml"), "prompt: test", "utf8");

    await fs.mkdir(path.join(paths.sourceSessionSkill, "agents"), { recursive: true });
    await fs.writeFile(path.join(paths.sourceSessionSkill, "SKILL.md"), "# Work Session", "utf8");
    await fs.writeFile(path.join(paths.sourceSessionSkill, "agents", "openai.yaml"), "prompt: test", "utf8");
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

  it("classifies description frontmatter and custom marker states", () => {
    expect(extractFrontmatterDescriptionEntry("# Legacy skill\n").status).toBe("absent");
    expect(extractFrontmatterDescriptionEntry(SOURCE_SKILL_MARKDOWN)).toMatchObject({
      status: "valid",
      normalizedValue: CURRENT_SKILL_DESCRIPTION,
    });
    expect(extractFrontmatterDescriptionEntry(
      SOURCE_SKILL_MARKDOWN.replace(`description: ${CURRENT_SKILL_DESCRIPTION}`, 'description: "unfinished'),
    ).status).toBe("malformed");

    expect(extractCustomRulesBlock("# Legacy skill\n").status).toBe("absent");
    expect(extractCustomRulesBlock(SOURCE_SKILL_MARKDOWN)).toMatchObject({ status: "valid", content: "" });
    expect(extractCustomRulesBlock(SOURCE_SKILL_MARKDOWN.replace(USER_CUSTOM_RULES_END, "")).status)
      .toBe("malformed");
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
      path.join(paths.sourceSkill, "references", "ai-feedback.md"),
      path.join(paths.targetSkill, "references", "ai-feedback.md"),
    );
    await fs.copyFile(
      path.join(paths.sourceSkill, "agents", "openai.yaml"),
      path.join(paths.targetSkill, "agents", "openai.yaml"),
    );

    expect(await baseScriptIsCurrent(paths)).toBe(true);
    expect(await skillAssetsAreCurrent(paths)).toBe(true);
    expect(await sessionSkillAssetsAreCurrent(paths)).toBe(false);
    expect(await baseAssetsAreCurrent(paths)).toBe(false);

    // Deploy Session Skill
    await fs.mkdir(path.join(paths.targetSessionSkill, "agents"), { recursive: true });
    await fs.copyFile(path.join(paths.sourceSessionSkill, "SKILL.md"), path.join(paths.targetSessionSkill, "SKILL.md"));
    await fs.copyFile(
      path.join(paths.sourceSessionSkill, "agents", "openai.yaml"),
      path.join(paths.targetSessionSkill, "agents", "openai.yaml"),
    );

    expect(await sessionSkillAssetsAreCurrent(paths)).toBe(true);
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

  it("preserves custom description and rules while replacing the whole skill directory", async () => {
    const customDescription = "Create review artifacts whenever my team requests an architecture decision.";
    const existingSkill = SOURCE_SKILL_MARKDOWN
      .replace(`description: ${CURRENT_SKILL_DESCRIPTION}`, `description: ${customDescription}`)
      .replace("# Skill content", "# Legacy core content")
      .replace(USER_CUSTOM_RULES_END, "- Reply in Vietnamese.\n- Keep plans concise.\n" + USER_CUSTOM_RULES_END);
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), existingSkill, "utf8");
    await fs.writeFile(path.join(paths.targetSkill, "obsolete-instruction.md"), "obsolete\n", "utf8");

    await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);

    const installed = await fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8");
    expect(installed).toContain(`description: ${customDescription}`);
    expect(installed).toContain("- Reply in Vietnamese.\n- Keep plans concise.");
    expect(installed).toContain("# Skill content");
    expect(installed).not.toContain("# Legacy core content");
    await expect(fs.access(path.join(paths.targetSkill, "obsolete-instruction.md"))).rejects.toThrow();
    expect(await skillAssetsAreCurrent(paths)).toBe(true);
  });

  it("upgrades an old official description and treats CRLF customizations as current", async () => {
    const oldOfficialDescription = OFFICIAL_SKILL_DESCRIPTIONS[0]!;
    const oldOfficialSkill = SOURCE_SKILL_MARKDOWN
      .replace(CURRENT_SKILL_DESCRIPTION, oldOfficialDescription)
      .replaceAll("\n", "\r\n");
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), oldOfficialSkill, "utf8");

    await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);
    const upgraded = await fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8");
    expect(upgraded).toContain(`description: ${CURRENT_SKILL_DESCRIPTION}`);
    expect(upgraded).not.toContain(oldOfficialDescription);

    const customCrLf = upgraded
      .replace(`description: ${CURRENT_SKILL_DESCRIPTION}`, "description: Review artifacts when I explicitly request one.")
      .replace(USER_CUSTOM_RULES_END, "- Use Vietnamese.\n" + USER_CUSTOM_RULES_END)
      .replaceAll("\n", "\r\n");
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), customCrLf, "utf8");
    expect(await skillAssetsAreCurrent(paths)).toBe(true);
  });

  it.each([
    ["quoted", 'description: "Create artifacts when I explicitly request a review."'],
    ["folded", "description: >\n  Create artifacts whenever I request\n  a structured review workflow."],
    ["multiline plain scalar", "description: Create artifacts for my team\n  only when a design review is explicitly requested."],
    ["quoted YAML key", '"description": Custom trigger'],
  ])("preserves a %s custom description", async (_label, descriptionEntry) => {
    const existingSkill = SOURCE_SKILL_MARKDOWN.replace(
      `description: ${CURRENT_SKILL_DESCRIPTION}`,
      descriptionEntry,
    );
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), existingSkill, "utf8");

    await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);

    const installed = await fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8");
    expect(installed).toContain(descriptionEntry);
    expect(await skillAssetsAreCurrent(paths)).toBe(true);
  });

  it("migrates a marker-free legacy target with an empty custom rules block", async () => {
    const legacyDescription = "Create artifacts for explicit legacy workflow requests.";
    const legacySkill = [
      "---",
      "name: create-review-artifact",
      `description: ${legacyDescription}`,
      "---",
      "",
      "# Legacy skill",
      "",
    ].join("\n");
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), legacySkill, "utf8");

    await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);

    const installed = await fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8");
    expect(installed).toContain(`description: ${legacyDescription}`);
    expect(installed.slice(
      installed.indexOf(USER_CUSTOM_RULES_BEGIN) + USER_CUSTOM_RULES_BEGIN.length,
      installed.indexOf(USER_CUSTOM_RULES_END),
    ).trim()).toBe("");
  });

  it.each([
    ["one marker", SOURCE_SKILL_MARKDOWN.replace(USER_CUSTOM_RULES_END, "")],
    ["duplicate marker", SOURCE_SKILL_MARKDOWN.replace(USER_CUSTOM_RULES_END, `${USER_CUSTOM_RULES_BEGIN}\n${USER_CUSTOM_RULES_END}`)],
    ["reversed markers", SOURCE_SKILL_MARKDOWN.replace(`${USER_CUSTOM_RULES_BEGIN}\n${USER_CUSTOM_RULES_END}`, `${USER_CUSTOM_RULES_END}\n${USER_CUSTOM_RULES_BEGIN}`)],
    ["malformed frontmatter", SOURCE_SKILL_MARKDOWN.replace(`description: ${CURRENT_SKILL_DESCRIPTION}`, 'description: "unfinished')],
  ])("fails before swap for %s and leaves the target unchanged", async (_label, malformedSkill) => {
    const sentinelPath = path.join(paths.targetSkill, "sentinel.txt");
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), malformedSkill, "utf8");
    await fs.writeFile(sentinelPath, "preserve me\n", "utf8");

    let thrown: unknown;
    try {
      await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(paths.targetSkill);
    expect((thrown as Error).message).toContain(path.join(paths.targetSkill, "SKILL.md"));
    expect((thrown as Error).message).toContain("run the installer command again");
    await expect(fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8")).resolves.toBe(malformedSkill);
    await expect(fs.readFile(sentinelPath, "utf8")).resolves.toBe("preserve me\n");
  });

  it("restores the previous directory when the staged directory swap fails", async () => {
    const existingSkill = SOURCE_SKILL_MARKDOWN
      .replace(CURRENT_SKILL_DESCRIPTION, "Create artifacts for my rollback workflow.")
      .replace(USER_CUSTOM_RULES_END, "- Preserve this rule.\n" + USER_CUSTOM_RULES_END);
    await fs.mkdir(paths.targetSkill, { recursive: true });
    await fs.writeFile(path.join(paths.targetSkill, "SKILL.md"), existingSkill, "utf8");
    await fs.writeFile(path.join(paths.targetSkill, "sentinel.txt"), "previous directory\n", "utf8");

    const originalRename = fs.rename.bind(fs);
    let injectedFailure = false;
    vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      if (
        !injectedFailure
        && path.basename(oldPath.toString()) === "next"
        && path.resolve(newPath.toString()) === path.resolve(paths.targetSkill)
      ) {
        injectedFailure = true;
        throw Object.assign(new Error("injected staged swap failure"), { code: "EIO" });
      }
      return originalRename(oldPath, newPath);
    });

    await expect(replaceSkillDirectory(paths.sourceSkill, paths.targetSkill)).rejects.toThrow(
      "injected staged swap failure",
    );
    await expect(fs.readFile(path.join(paths.targetSkill, "SKILL.md"), "utf8")).resolves.toBe(existingSkill);
    await expect(fs.readFile(path.join(paths.targetSkill, "sentinel.txt"), "utf8")).resolves.toBe(
      "previous directory\n",
    );
    const stagingDirectories = (await fs.readdir(path.dirname(paths.targetSkill)))
      .filter((entry) => entry.startsWith(".create-review-artifact-install-"));
    expect(stagingDirectories).toEqual([]);
  });

  it("reads and atomically patches valid, missing, and invalid version receipts", async () => {
    await expect(readInstalledIntegrationVersion({ userHome: targetDir })).resolves.toEqual({ status: "missing" });

    await writeInstalledIntegrationVersion({
      mcpVersion: MCP_VERSION,
      skills: { agents: SKILL_VERSION },
      sessionSkills: { agents: 1 },
    }, { userHome: targetDir });
    const legacyWithoutAntigravity = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(legacyWithoutAntigravity.status).toBe("valid");

    await writeInstalledIntegrationVersion({
      skills: { claude: SKILL_VERSION },
      sessionSkills: { claude: 1 },
    }, { userHome: targetDir });
    await writeInstalledIntegrationVersion({
      skills: { antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
      sessionSkills: { antigravity: WORK_SESSION_SKILL_VERSION },
    }, { userHome: targetDir });
    const complete = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(complete).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: {
          agents: SKILL_VERSION,
          claude: SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: 1,
          claude: 1,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });
    if (complete.status === "valid") {
      expect(Number.isNaN(Date.parse(complete.manifest.updatedAt))).toBe(false);
    }

    await fs.writeFile(managedIntegrationVersionPath({ userHome: targetDir }), "{ invalid json", "utf8");
    expect((await readInstalledIntegrationVersion({ userHome: targetDir })).status).toBe("invalid");
    await writeInstalledIntegrationVersion({ skills: { agents: SKILL_VERSION } }, { userHome: targetDir });
    const recovered = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(recovered).toMatchObject({
      status: "valid",
      manifest: { skills: { agents: SKILL_VERSION } },
    });
    if (recovered.status === "valid") {
      expect(recovered.manifest.mcpVersion).toBeUndefined();
      expect(recovered.manifest.skills.claude).toBeUndefined();
    }
  });

  it("getReviewSkillMarkdown reads source SKILL.md", async () => {
    const mockContext = {
      extensionUri: { fsPath: sourceDir },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    const content = await getReviewSkillMarkdown(mockContext);
    expect(content).toBe(SOURCE_SKILL_MARKDOWN);
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
    expect(typeof report.sessionSkillCurrent).toBe("boolean");
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
    expect(await sessionSkillAssetsAreCurrent(installedPaths)).toBe(true);
    expect(await baseAssetsAreCurrent(installedPaths)).toBe(true);
    expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
    });
    expect(await fs.readFile(installedPaths.targetMcpScript)).toEqual(
      await fs.readFile(installedPaths.sourceMcpScript),
    );
    await expect(fs.access(installedPaths.targetLegacyMcpScript)).rejects.toThrow();
    for (const relativePath of [
      "SKILL.md",
      path.join("references", "artifact-contract.md"),
      path.join("references", "ai-feedback.md"),
      path.join("agents", "openai.yaml"),
    ]) {
      if (relativePath === "SKILL.md") {
        const [targetSkill, sourceSkill] = await Promise.all([
          fs.readFile(path.join(installedPaths.targetSkill, relativePath), "utf8"),
          fs.readFile(path.join(installedPaths.sourceSkill, relativePath), "utf8"),
        ]);
        expect(targetSkill.replace(/\r\n?/g, "\n")).toBe(sourceSkill.replace(/\r\n?/g, "\n"));
      } else {
        expect(await fs.readFile(path.join(installedPaths.targetSkill, relativePath))).toEqual(
          await fs.readFile(path.join(installedPaths.sourceSkill, relativePath)),
        );
      }
    }
    for (const relativePath of [
      "SKILL.md",
      path.join("agents", "openai.yaml"),
    ]) {
      expect(await fs.readFile(path.join(installedPaths.targetSessionSkill, relativePath))).toEqual(
        await fs.readFile(path.join(installedPaths.sourceSessionSkill, relativePath)),
      );
    }

    const configPath = path.join(targetDir, ".codex", "config.toml");
    const config = upsertCodexArtifactsMcp('model = "gpt-test"\n', installedPaths.targetMcpScript);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, config, "utf8");
    expect(hasManagedCodexArtifactsMcp(config, installedPaths.targetMcpScript)).toBe(true);
    const configuredTools = [...config.matchAll(/^\[mcp_servers\.ai_artifacts\.tools\.([^\]]+)\]$/gm)].map(
      (match) => match[1],
    );
    const expectedTools = [
      "resolve_artifact_window",
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact",
      "update_artifact",
      "join_session",
    ];
    expect(configuredTools).toEqual(expectedTools);

    const workspace = path.join(tempDir, "workspace");
    const taggedFile = path.join(workspace, "AGENTS.md");
    await fs.mkdir(workspace);
    await fs.writeFile(taggedFile, "# Workspace\n", "utf8");
    const instanceId = randomUUID();
    const now = Date.now();
    await fs.writeFile(
      path.join(installedPaths.workspacesDirectory, `${instanceId}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 2,
          instanceId,
          processId: process.pid,
          workspaceFile: null,
          focused: true,
          folders: [{ path: workspace, realPath: await fs.realpath(workspace) }],
          activeFile: { path: taggedFile, workspaceRoot: workspace },
          updatedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 60_000).toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const client = startInstalledMcp(installedPaths.targetMcpScript, {
      NODE_ENV: "test",
      CODEX_ARTIFACTS_TEST_USER_HOME: targetDir,
      CODEX_ARTIFACTS_REGISTRY_DIRECTORY: installedPaths.workspacesDirectory,
    });
    const initialized = await client.request("initialize", { protocolVersion: "2025-06-18" });
    expect(initialized.serverInfo.version).toBe(String(MCP_VERSION));
    expect(initialized.instructions).toContain("resolve_artifact_window");
    client.notify("notifications/initialized");
    const catalog = await client.request("tools/list");
    expect(catalog.tools.map((tool: any) => tool.name)).toEqual([
      "resolve_artifact_window",
      "create_artifact",
      "wait_for_artifact_review",
      "inspect_artifact",
      "join_session",
      "update_artifact",
    ]);

    const installedSkill = await fs.readFile(path.join(installedPaths.targetSkill, "SKILL.md"), "utf8");
    const installedContract = await fs.readFile(
      path.join(installedPaths.targetSkill, "references", "artifact-contract.md"),
      "utf8",
    );
    expect(installedSkill).toContain("The server routes directly to the currently focused VS Code window");
    expect(installedSkill).toContain("WINDOW_SELECTION_REQUIRED");
    expect(installedContract).toContain("schema-v1 UI-routing state only");
    expect(installedContract).toContain("wait and advance preserve it unchanged");

    const resolution = await client.request("tools/call", {
      name: "resolve_artifact_window",
      arguments: { query: workspace },
    });
    expect(resolution.isError, resolution.content?.[0]?.text).not.toBe(true);
    expect(resolution.structuredContent).toMatchObject({
      status: "matched",
      window: {
        windowInstanceId: instanceId,
        focused: true,
      },
    });

    const markdown = "# Installed lifecycle\n\nReview the installed schema-v6 bridge.\n";
    const createResult = await client.request("tools/call", {
      name: "create_artifact",
      arguments: {
        title: "Installed lifecycle",
        kind: "implementation-plan",
        markdown,
        wait: false,
      },
    });
    expect(createResult.isError, createResult.content?.[0]?.text).not.toBe(true);
    const created = createResult.structuredContent;
    expect(created.connection).toMatchObject({
      schemaVersion: 1,
      windowInstanceId: instanceId,
      connectionRevision: 1,
      source: "create",
    });
    expect(created.connection.openRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(path.dirname(created.artifactDirectory)).toBe(
      await fs.realpath(globalArtifactsRoot({ userHome: targetDir })),
    );
    await expect(fs.access(path.join(workspace, ".ai-artifacts"))).rejects.toThrow();

    const store = new ArtifactStore(created.artifactPath, { userHome: targetDir });
    const loaded = await store.load();
    expect(loaded.artifact).toMatchObject({
      schemaVersion: 6,
      artifactId: created.artifactId,
      reviewRound: 1,
    });
    expect(loaded.artifact).not.toHaveProperty("location");
    expect(loaded.markdown).toBe(markdown);

    const reconnectResult = await client.request("tools/call", {
      name: "inspect_artifact",
      arguments: {
        artifactDirectory: created.artifactDirectory,
        expectedReviewRound: 1,
        intent: "reconnect",
      },
    });
    expect(reconnectResult.isError, reconnectResult.content?.[0]?.text).not.toBe(true);
    expect(reconnectResult.structuredContent.connection).toMatchObject({
      schemaVersion: 1,
      windowInstanceId: instanceId,
      connectionRevision: 2,
      source: "inspect",
    });
    expect(reconnectResult.structuredContent.connection.openRequestId).not.toBe(created.connection.openRequestId);
    expect(reconnectResult.structuredContent.reviewRound).toBe(1);
    expect(reconnectResult.structuredContent.artifactSha256).toBe(created.artifactSha256);

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

  it("commits the Claude receipt only after Claude install and verification succeed", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const context = {
      extensionUri: { fsPath: repositoryRoot },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;
    const claudeSkillDirectory = path.join(targetDir, ".claude", "skills", "create-review-artifact");
    const malformedClaudeSkill = SOURCE_SKILL_MARKDOWN.replace(USER_CUSTOM_RULES_END, "");
    await fs.mkdir(claudeSkillDirectory, { recursive: true });
    await fs.writeFile(path.join(claudeSkillDirectory, "SKILL.md"), malformedClaudeSkill, "utf8");

    await expect(installClientsOrThrow(context, ["claude"])).rejects.toThrow("run the installer command again");
    const partial = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(partial).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: SKILL_VERSION },
      },
    });
    if (partial.status === "valid") expect(partial.manifest.skills.claude).toBeUndefined();
    await expect(fs.readFile(path.join(claudeSkillDirectory, "SKILL.md"), "utf8")).resolves.toBe(
      malformedClaudeSkill,
    );

    await fs.rm(claudeSkillDirectory, { recursive: true, force: true });
    await installClientsOrThrow(context, ["claude"]);
    expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: SKILL_VERSION, claude: SKILL_VERSION },
      },
    });
  });

  it("commits the Antigravity receipt only after Antigravity install succeeds without calling post-check and preserves prior entries on failure", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const context = {
      extensionUri: { fsPath: repositoryRoot },
      globalStorageUri: { fsPath: path.join(tempDir, "storage") },
    } as any;

    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
      { userHome: targetDir },
    );

    const antigravitySkillDir = path.join(targetDir, ".gemini", "config", "skills", "create-review-artifact");
    const malformedAntigravitySkill = SOURCE_SKILL_MARKDOWN.replace(USER_CUSTOM_RULES_END, "");
    await fs.mkdir(antigravitySkillDir, { recursive: true });
    await fs.writeFile(path.join(antigravitySkillDir, "SKILL.md"), malformedAntigravitySkill, "utf8");

    await expect(installClientsOrThrow(context, ["antigravity"])).rejects.toThrow("run the installer command again");
    const partial = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(partial).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
    });
    await expect(fs.readFile(path.join(antigravitySkillDir, "SKILL.md"), "utf8")).resolves.toBe(
      malformedAntigravitySkill,
    );

    await fs.rm(antigravitySkillDir, { recursive: true, force: true });
    const checkSpy = vi.spyOn(AntigravityClientDriver.prototype, "check");
    vi.spyOn(AntigravityClientDriver.prototype, "install").mockRejectedValueOnce(
      new Error("injected install failure"),
    );
    await expect(installClientsOrThrow(context, ["antigravity"])).rejects.toThrow("injected install failure");
    expect(checkSpy).not.toHaveBeenCalled();
    const afterInstallFailure = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(afterInstallFailure).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
    });

    await installClientsOrThrow(context, ["antigravity"]);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });
    expect((await uninstallSelectedIntegrations(undefined, ["antigravity"])).uninstalledClients).toEqual([
      { id: "antigravity", name: "Antigravity" },
    ]);
    expect((await uninstallSelectedIntegrations(undefined, ["antigravity"])).notConfiguredClients).toEqual([
      { id: "antigravity", name: "Antigravity" },
    ]);
  });

  it("reinstalls all detected clients from current assets and uninstalls without touching artifacts or unrelated config", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const codexHome = path.join(targetDir, ".codex");
    const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
    const claudeConfig = path.join(targetDir, ".claude.json");
    const windsurfConfig = path.join(targetDir, ".codeium", "windsurf", "mcp_config.json");
    const antigravityConfig = path.join(targetDir, ".gemini", "config", "mcp_config.json");
    const globalStoragePath = path.join(targetDir, "Code", "User", "globalStorage", "huynguyen294.ai-artifacts");
    const copilotConfig = path.resolve(globalStoragePath, "..", "..", "mcp.json");
    const clineConfig = path.resolve(globalStoragePath, "..", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    const codexConfig = path.join(codexHome, "config.toml");
    const artifactsRoot = globalArtifactsRoot({ userHome: targetDir });
    const productRoot = path.join(targetDir, ".ai-artifacts");
    const retainedArtifact = path.join(artifactsRoot, "retained-artifact", "artifact.md");
    const unrelatedSiblingFile = path.join(productRoot, "unrelated-sibling.txt");
    const unrelatedSkill = path.join(targetDir, ".agents", "skills", "unrelated-skill", "SKILL.md");
    const unrelatedClaudeSkill = path.join(targetDir, ".claude", "skills", "unrelated-claude", "SKILL.md");
    const unrelatedAntigravitySkill = path.join(targetDir, ".gemini", "config", "skills", "unrelated-antigravity", "SKILL.md");
    const antigravityRule = path.join(targetDir, ".gemini", "config", "rules", "artifact-review-policy.md");
    const geminiRulesDoc = path.join(targetDir, ".gemini", "GEMINI.md");
    const antigravitySkill = path.join(targetDir, ".gemini", "config", "skills", "create-review-artifact", "SKILL.md");
    const antigravitySessionSkill = path.join(targetDir, ".gemini", "config", "skills", "work-session", "SKILL.md");
    const claudeSkill = path.join(targetDir, ".claude", "skills", "create-review-artifact", "SKILL.md");
    const claudeSessionSkill = path.join(targetDir, ".claude", "skills", "work-session", "SKILL.md");
    const originalCodexHome = process.env.CODEX_HOME;

    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    process.env.CODEX_HOME = codexHome;

    try {
      await Promise.all([
        fs.mkdir(path.dirname(cursorConfig), { recursive: true }),
        fs.mkdir(codexHome, { recursive: true }),
        fs.mkdir(path.join(targetDir, ".claude"), { recursive: true }),
        fs.mkdir(path.dirname(windsurfConfig), { recursive: true }),
        fs.mkdir(path.dirname(antigravityConfig), { recursive: true }),
        fs.mkdir(path.dirname(antigravityRule), { recursive: true }),
        fs.mkdir(path.dirname(unrelatedAntigravitySkill), { recursive: true }),
        fs.mkdir(path.dirname(copilotConfig), { recursive: true }),
        fs.mkdir(path.dirname(clineConfig), { recursive: true }),
        fs.mkdir(path.dirname(retainedArtifact), { recursive: true }),
        fs.mkdir(path.join(targetDir, ".vscode", "ai-artifacts"), { recursive: true }),
        fs.mkdir(path.join(targetDir, ".agents", "skills", "create-plan-artifact"), { recursive: true }),
        fs.mkdir(path.dirname(unrelatedSiblingFile), { recursive: true }),
        fs.mkdir(path.dirname(unrelatedSkill), { recursive: true }),
        fs.mkdir(path.dirname(unrelatedClaudeSkill), { recursive: true }),
      ]);
      await Promise.all([
        fs.writeFile(
          cursorConfig,
          `${JSON.stringify({ theme: "dark", mcpServers: { keep_cursor: { command: "keep" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(
          claudeConfig,
          `${JSON.stringify({ opusProMigrationComplete: true, mcpServers: { keep_claude: { command: "keep" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(
          windsurfConfig,
          `${JSON.stringify({ telemetry: false, mcpServers: { keep_windsurf: { command: "keep" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(
          antigravityConfig,
          `${JSON.stringify({ customRoot: true, mcpServers: { keep_antigravity: { command: "keep" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(geminiRulesDoc, "# Keep Antigravity GEMINI rules\n", "utf8"),
        fs.writeFile(antigravityRule, "# Keep Antigravity rule\n", "utf8"),
        fs.writeFile(unrelatedAntigravitySkill, "# Unrelated Antigravity skill\n", "utf8"),
        fs.writeFile(
          copilotConfig,
          `${JSON.stringify({ inputs: [{ id: "keep-input" }], servers: { keep_copilot: { type: "http", url: "https://example.test" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(
          clineConfig,
          `${JSON.stringify({ mcpServers: { keep_cline: { command: "keep" } } }, null, 2)}\n`,
          "utf8",
        ),
        fs.writeFile(codexConfig, 'model = "gpt-test"\n\n[mcp_servers.keep_codex]\ncommand = "keep"\n', "utf8"),
        fs.writeFile(retainedArtifact, "# Retain me\n", "utf8"),
        fs.writeFile(unrelatedSiblingFile, "do not touch me\n", "utf8"),
        fs.writeFile(unrelatedSkill, "# Unrelated skill\n", "utf8"),
        fs.writeFile(unrelatedClaudeSkill, "# Unrelated Claude skill\n", "utf8"),
        fs.writeFile(
          path.join(targetDir, ".vscode", "ai-artifacts", "codex-artifacts-review-mcp.mjs"),
          "// legacy runtime\n",
          "utf8",
        ),
        fs.writeFile(
          path.join(targetDir, ".agents", "skills", "create-plan-artifact", "SKILL.md"),
          "# Legacy skill\n",
          "utf8",
        ),
      ]);

      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;

      const firstInstall = await installSelectedIntegrations(context, ALL_CLIENT_IDS);
      const firstInstallNames = firstInstall.installedClients.map((client) => client.name);
      expect(firstInstallNames).toEqual([
        "GitHub Copilot (VS Code)",
        "Cursor",
        "Codex",
        "Claude",
        "Windsurf",
        "Cline",
        "Antigravity",
      ]);
      await expect(
        fs.access(path.join(targetDir, ".vscode", "ai-artifacts", "codex-artifacts-review-mcp.mjs")),
      ).rejects.toThrow();
      await expect(fs.access(path.join(targetDir, ".agents", "skills", "create-plan-artifact"))).rejects.toThrow();
      await expect(fs.access(claudeSkill)).resolves.toBeUndefined();
      await expect(fs.access(claudeSessionSkill)).resolves.toBeUndefined();
      await expect(fs.access(antigravitySkill)).resolves.toBeUndefined();
      await expect(fs.access(antigravitySessionSkill)).resolves.toBeUndefined();
      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          skills: {
            agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          },
          sessionSkills: {
            agents: WORK_SESSION_SKILL_VERSION,
            claude: WORK_SESSION_SKILL_VERSION,
            antigravity: WORK_SESSION_SKILL_VERSION,
          },
        },
      });

      let report = await checkAllIntegrations(context);
      expect(report.baseCurrent).toBe(true);
      expect(report.skillCurrent).toBe(true);
      expect(report.sessionSkillCurrent).toBe(true);
      expect(report.clients.filter((client) => client.isDetected).map((client) => client.status)).toEqual([
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
      ]);

      // Making one Antigravity skill stale should mark only Antigravity non-ready while shared assets remain current
      await fs.writeFile(antigravitySessionSkill, "# Stale Antigravity work-session\n", "utf8");
      const staleAntigravityReport = await checkAllIntegrations(context);
      expect(staleAntigravityReport.baseCurrent).toBe(true);
      expect(staleAntigravityReport.clients.find((client) => client.id === "antigravity")?.status).toBe("outdated");

      const currentSetup = await setupBaseMcpServer(context);
      expect(currentSetup).not.toHaveProperty("assetsUpdated");
      const installedPaths = currentSetup.paths;
      expect(await baseAssetsAreCurrent(installedPaths)).toBe(true);
      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          skills: {
            agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
            antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          },
          sessionSkills: {
            agents: WORK_SESSION_SKILL_VERSION,
            claude: WORK_SESSION_SKILL_VERSION,
            antigravity: WORK_SESSION_SKILL_VERSION,
          },
        },
      });
      await fs.writeFile(installedPaths.targetMcpScript, "// stale runtime\n", "utf8");
      await fs.writeFile(path.join(installedPaths.targetSkill, "SKILL.md"), "# Stale skill\n", "utf8");
      await fs.writeFile(path.join(installedPaths.targetSkill, "obsolete-instruction.md"), "obsolete\n", "utf8");

      report = await checkAllIntegrations(context);
      expect(report.baseCurrent).toBe(false);
      expect(report.skillCurrent).toBe(false);
      expect(report.sessionSkillCurrent).toBe(true);
      expect(report.clients.filter((client) => client.isDetected).map((client) => client.status)).toEqual([
        "outdated",
        "outdated",
        "outdated",
        "outdated",
        "outdated",
        "outdated",
        "outdated",
      ]);

      await installSelectedIntegrations(context, ALL_CLIENT_IDS);
      expect(await baseAssetsAreCurrent(installedPaths)).toBe(true);
      await expect(fs.access(path.join(installedPaths.targetSkill, "obsolete-instruction.md"))).rejects.toThrow();
      report = await checkAllIntegrations(context);
      expect(report.clients.filter((client) => client.isDetected).map((client) => client.status)).toEqual([
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
      ]);

      const cursorBeforeUninstall = JSON.parse(await fs.readFile(cursorConfig, "utf8"));
      const claudeBeforeUninstall = JSON.parse(await fs.readFile(claudeConfig, "utf8"));
      const windsurfBeforeUninstall = JSON.parse(await fs.readFile(windsurfConfig, "utf8"));
      const antigravityBeforeUninstall = JSON.parse(await fs.readFile(antigravityConfig, "utf8"));
      const copilotBeforeUninstall = JSON.parse(await fs.readFile(copilotConfig, "utf8"));
      const clineBeforeUninstall = JSON.parse(await fs.readFile(clineConfig, "utf8"));
      const codexBeforeUninstall = await fs.readFile(codexConfig, "utf8");
      expect(cursorBeforeUninstall).toMatchObject({ theme: "dark", mcpServers: { keep_cursor: { command: "keep" } } });
      expect(claudeBeforeUninstall).toMatchObject({
        opusProMigrationComplete: true,
        mcpServers: { keep_claude: { command: "keep" } },
      });
      expect(windsurfBeforeUninstall).toMatchObject({
        telemetry: false,
        mcpServers: { keep_windsurf: { command: "keep" } },
      });
      expect(antigravityBeforeUninstall).toMatchObject({
        customRoot: true,
        mcpServers: {
          keep_antigravity: { command: "keep" },
          ai_artifacts: { command: "node", timeoutSeconds: 3600 },
        },
      });
      expect(copilotBeforeUninstall).toMatchObject({
        inputs: [{ id: "keep-input" }],
        servers: { keep_copilot: { type: "http" } },
      });
      expect(clineBeforeUninstall).toMatchObject({
        mcpServers: { keep_cline: { command: "keep" } },
      });
      expect(codexBeforeUninstall).toContain('model = "gpt-test"');
      expect(codexBeforeUninstall).toContain("[mcp_servers.keep_codex]");

      const crypto = await import("node:crypto");
      const beforeHash = crypto
        .createHash("sha256")
        .update(await fs.readFile(retainedArtifact))
        .digest("hex");

      const uninstall = await uninstallSelectedIntegrations(context, ALL_CLIENT_IDS, { cleanupBase: true });
      expect(uninstall.failedClients).toEqual([]);
      expect(uninstall.uninstalledClients.map((client) => client.name)).toEqual(firstInstallNames);
      await expect(fs.access(installedPaths.targetDirectory)).rejects.toThrow();
      await expect(fs.access(managedIntegrationVersionPath({ userHome: targetDir }))).rejects.toThrow();
      await expect(fs.access(installedPaths.targetSkill)).rejects.toThrow();
      await expect(fs.access(installedPaths.targetSessionSkill)).rejects.toThrow();
      await expect(fs.access(path.join(targetDir, ".vscode", "ai-artifacts"))).rejects.toThrow();
      await expect(fs.access(path.dirname(claudeSkill))).rejects.toThrow();
      await expect(fs.access(path.dirname(claudeSessionSkill))).rejects.toThrow();
      await expect(fs.access(path.dirname(antigravitySkill))).rejects.toThrow();
      await expect(fs.access(path.dirname(antigravitySessionSkill))).rejects.toThrow();
      await expect(fs.access(productRoot)).resolves.toBeUndefined();
      await expect(fs.readFile(unrelatedSiblingFile, "utf8")).resolves.toBe("do not touch me\n");
      await expect(fs.readFile(unrelatedSkill, "utf8")).resolves.toBe("# Unrelated skill\n");
      await expect(fs.readFile(unrelatedClaudeSkill, "utf8")).resolves.toBe("# Unrelated Claude skill\n");
      await expect(fs.readFile(unrelatedAntigravitySkill, "utf8")).resolves.toBe("# Unrelated Antigravity skill\n");
      await expect(fs.readFile(geminiRulesDoc, "utf8")).resolves.toBe("# Keep Antigravity GEMINI rules\n");
      await expect(fs.readFile(antigravityRule, "utf8")).resolves.toBe("# Keep Antigravity rule\n");

      const afterHash = crypto
        .createHash("sha256")
        .update(await fs.readFile(retainedArtifact))
        .digest("hex");
      expect(afterHash).toBe(beforeHash);
      await expect(fs.readFile(retainedArtifact, "utf8")).resolves.toBe("# Retain me\n");

      // Idempotent double uninstall
      await expect(
        uninstallSelectedIntegrations(context, ALL_CLIENT_IDS, { cleanupBase: true }),
      ).resolves.toMatchObject({ uninstalledClients: [], failedClients: [] });

      const cursorAfterUninstall = JSON.parse(await fs.readFile(cursorConfig, "utf8"));
      const claudeAfterUninstall = JSON.parse(await fs.readFile(claudeConfig, "utf8"));
      const windsurfAfterUninstall = JSON.parse(await fs.readFile(windsurfConfig, "utf8"));
      const antigravityAfterUninstall = JSON.parse(await fs.readFile(antigravityConfig, "utf8"));
      const copilotAfterUninstall = JSON.parse(await fs.readFile(copilotConfig, "utf8"));
      const clineAfterUninstall = JSON.parse(await fs.readFile(clineConfig, "utf8"));
      const codexAfterUninstall = await fs.readFile(codexConfig, "utf8");
      expect(cursorAfterUninstall).toMatchObject({ theme: "dark", mcpServers: { keep_cursor: { command: "keep" } } });
      expect(claudeAfterUninstall).toMatchObject({
        opusProMigrationComplete: true,
        mcpServers: { keep_claude: { command: "keep" } },
      });
      expect(windsurfAfterUninstall).toMatchObject({
        telemetry: false,
        mcpServers: { keep_windsurf: { command: "keep" } },
      });
      expect(antigravityAfterUninstall).toMatchObject({
        customRoot: true,
        mcpServers: { keep_antigravity: { command: "keep" } },
      });
      expect(copilotAfterUninstall).toMatchObject({
        inputs: [{ id: "keep-input" }],
        servers: { keep_copilot: { type: "http" } },
      });
      expect(clineAfterUninstall).toMatchObject({
        mcpServers: { keep_cline: { command: "keep" } },
      });
      expect(cursorAfterUninstall.mcpServers.ai_artifacts).toBeUndefined();
      expect(claudeAfterUninstall.mcpServers.ai_artifacts).toBeUndefined();
      expect(windsurfAfterUninstall.mcpServers.ai_artifacts).toBeUndefined();
      expect(antigravityAfterUninstall.mcpServers.ai_artifacts).toBeUndefined();
      expect(copilotAfterUninstall.servers.ai_artifacts).toBeUndefined();
      expect(clineAfterUninstall.mcpServers.ai_artifacts).toBeUndefined();
      expect(codexAfterUninstall).toContain("[mcp_servers.keep_codex]");
      expect(codexAfterUninstall).not.toContain("[mcp_servers.ai_artifacts]");
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("installSelectedIntegrations installs only selected clients, records them, isolates failures, and surfaces status in listInstallerClients", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const codexConfig = path.join(codexHome, "config.toml");
      const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
      const antigravityDir = path.join(targetDir, ".gemini", "antigravity");
      const antigravityConfig = path.join(targetDir, ".gemini", "config", "mcp_config.json");

      await fs.mkdir(codexHome, { recursive: true });
      await fs.mkdir(path.dirname(cursorConfig), { recursive: true });
      await fs.mkdir(antigravityDir, { recursive: true });

      // Conflict in Codex should fail Codex without blocking Cursor or Antigravity
      await fs.writeFile(
        codexConfig,
        '[mcp_servers.ai_artifacts]\ncommand = "node"\nargs = ["/custom/server.mjs"]\nfollowUpQueueMode = "steer"\n',
        "utf8",
      );
      await fs.writeFile(cursorConfig, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");

      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;

      const codexSnippet = getCodexMcpConfigSnippet(context);
      expect(codexSnippet).toContain("[mcp_servers.ai_artifacts]");
      expect(hasManagedCodexArtifactsMcp(codexSnippet, managedMcpScriptPath({ userHome: targetDir }))).toBe(true);

      const initialList = await listInstallerClients(context);
      const codexInitial = initialList.clients.find((c) => c.id === "codex");
      const cursorInitial = initialList.clients.find((c) => c.id === "cursor");
      const claudeInitial = initialList.clients.find((c) => c.id === "claude");
      expect(codexInitial).toMatchObject({
        isDetected: true,
        isSaved: false,
        status: "configuration-conflict",
      });
      expect(cursorInitial).toMatchObject({
        isDetected: true,
        isSaved: false,
        status: "missing",
      });
      expect(claudeInitial).toMatchObject({
        isDetected: false,
        isSaved: false,
        status: "missing",
      });

      const installResult = await installSelectedIntegrations(
        context,
        ["cursor", "codex", "antigravity"],
        { recordClientSelection: true },
      );

      expect(installResult.installedClients).toEqual([
        { id: "cursor", name: "Cursor" },
        { id: "antigravity", name: "Antigravity" },
      ]);
      expect(installResult.failedClients).toHaveLength(1);
      expect(installResult.failedClients[0]).toMatchObject({
        id: "codex",
        name: "Codex",
        errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
      });
      await expect(fs.access(antigravityConfig)).resolves.toBeUndefined();

      const updatedList = await listInstallerClients(context);
      expect(updatedList.clients.find((c) => c.id === "cursor")).toMatchObject({
        isDetected: true,
        isSaved: true,
        status: "ready",
      });
      expect(updatedList.clients.find((c) => c.id === "antigravity")).toMatchObject({
        isDetected: true,
        isSaved: true,
        status: "ready",
      });
      expect(updatedList.clients.find((c) => c.id === "codex")).toMatchObject({
        isDetected: true,
        isSaved: false,
        status: "configuration-conflict",
      });
      // Unselected client remains untouched
      expect(updatedList.clients.find((c) => c.id === "claude")).toMatchObject({
        isDetected: false,
        isSaved: false,
        status: "missing",
      });

      // Uninstall only Antigravity while leaving Cursor and shared base assets intact
      const partialUninstall = await uninstallSelectedIntegrations(
        context,
        ["antigravity", "claude"],
        { recordClientSelection: true },
      );
      expect(partialUninstall.uninstalledClients).toEqual([{ id: "antigravity", name: "Antigravity" }]);
      expect(partialUninstall.notConfiguredClients).toEqual([{ id: "claude", name: "Claude" }]);
      expect(partialUninstall.failedClients).toEqual([]);

      const afterUninstallList = await listInstallerClients(context);
      expect(afterUninstallList.baseCurrent).toBe(true);
      expect(afterUninstallList.clients.find((c) => c.id === "antigravity")).toMatchObject({
        isSaved: false,
        status: "missing",
      });
      expect(afterUninstallList.clients.find((c) => c.id === "cursor")).toMatchObject({
        isSaved: true,
        status: "ready",
      });
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("isolates per-driver check failures in listInstallerClients and checkAllIntegrations so healthy clients remain selectable for install and uninstall", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
      const antigravityConfig = path.join(targetDir, ".gemini", "config", "mcp_config.json");
      const corruptRaw = "{ \"mcpServers\": broken";

      await fs.mkdir(path.dirname(cursorConfig), { recursive: true });
      await fs.mkdir(path.dirname(antigravityConfig), { recursive: true });
      await fs.writeFile(cursorConfig, JSON.stringify({ mcpServers: {} }, null, 2), "utf8");
      await fs.writeFile(antigravityConfig, corruptRaw, "utf8");

      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;

      const list = await listInstallerClients(context);
      const antigravity = list.clients.find((c) => c.id === "antigravity");
      const cursor = list.clients.find((c) => c.id === "cursor");
      expect(antigravity).toMatchObject({
        id: "antigravity",
        isDetected: true,
        status: "configuration-conflict",
      });
      expect(antigravity?.detail).toContain("Invalid JSON syntax");
      expect(cursor).toMatchObject({
        id: "cursor",
        isDetected: true,
        status: "missing",
      });

      const verifyReport = await checkAllIntegrations(context);
      expect(verifyReport.clients.find((c) => c.id === "antigravity")?.status).toBe("configuration-conflict");
      expect(verifyReport.clients.find((c) => c.id === "cursor")?.status).toBe("missing");

      // User can still install and then uninstall Cursor despite Antigravity config corruption
      const installResult = await installSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
      });
      expect(installResult).toEqual({
        installedClients: [{ id: "cursor", name: "Cursor" }],
        failedClients: [],
      });

      const afterInstallList = await listInstallerClients(context);
      expect(afterInstallList.clients.find((c) => c.id === "cursor")).toMatchObject({
        isSaved: true,
        status: "ready",
      });
      expect(afterInstallList.clients.find((c) => c.id === "antigravity")?.status).toBe("configuration-conflict");

      const uninstallResult = await uninstallSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(uninstallResult).toEqual({
        uninstalledClients: [{ id: "cursor", name: "Cursor" }],
        notConfiguredClients: [],
        failedClients: [],
      });
      // Base assets stay intact because Antigravity state is indeterminate (corrupt config)
      await expect(fs.access(managedMcpScriptPath({ userHome: targetDir }))).resolves.toBeUndefined();
      await expect(fs.readFile(antigravityConfig, "utf8")).resolves.toBe(corruptRaw);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("uninstallSelectedIntegrations cleans shared base assets once only when no remaining client uses or may use them", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;
      const runtimePath = managedMcpScriptPath({ userHome: targetDir });
      const clientsManifestPath = managedInstalledClientsPath({ userHome: targetDir });
      const sharedReviewSkillPath = path.join(targetDir, ".agents", "skills", "create-review-artifact", "SKILL.md");

      // 1. Partial uninstall (Cursor + Windsurf installed -> uninstall Cursor only) keeps base & Windsurf intact
      await installClientsOrThrow(context, ["cursor"], { recordClientSelection: true });
      await installClientsOrThrow(context, ["windsurf"], { recordClientSelection: true });

      const step1 = await uninstallSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(step1.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
      expect(step1.failedClients).toEqual([]);
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();
      await expect(fs.access(sharedReviewSkillPath)).resolves.toBeUndefined();
      const afterStep1 = await listInstallerClients(context);
      expect(afterStep1.clients.find((c) => c.id === "windsurf")?.status).toBe("ready");

      // 2. Final client uninstall cleans shared base assets once
      const step2 = await uninstallSelectedIntegrations(context, ["windsurf"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(step2.uninstalledClients).toEqual([{ id: "windsurf", name: "Windsurf" }]);
      expect(step2.failedClients).toEqual([]);
      await expect(fs.access(runtimePath)).rejects.toThrow();
      await expect(fs.access(sharedReviewSkillPath)).rejects.toThrow();
      await expect(fs.access(clientsManifestPath)).rejects.toThrow();

      // 3. Failure on one selected client retains base assets for the failed client
      await installClientsOrThrow(context, ["cursor"], { recordClientSelection: true });
      await installClientsOrThrow(context, ["windsurf"], { recordClientSelection: true });
      vi.spyOn(WindsurfClientDriver.prototype, "uninstall").mockRejectedValueOnce(new Error("windsurf locked"));

      const failedBatch = await uninstallSelectedIntegrations(context, ["cursor", "windsurf"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(failedBatch.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
      expect(failedBatch.failedClients).toEqual([
        { id: "windsurf", name: "Windsurf", error: "windsurf locked" },
      ]);
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();

      // Finish Windsurf uninstall cleanly to clear base again
      const clearStep = await uninstallSelectedIntegrations(context, ["windsurf"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(clearStep.failedClients).toEqual([]);
      await expect(fs.access(runtimePath)).rejects.toThrow();

      // 4. Unselected client with corrupt JSON (indeterminate) keeps base assets even though Cursor succeeds
      await installClientsOrThrow(context, ["cursor"], { recordClientSelection: true });
      const windsurfConfig = path.join(targetDir, ".codeium", "windsurf", "mcp_config.json");
      await fs.mkdir(path.dirname(windsurfConfig), { recursive: true });
      await fs.writeFile(windsurfConfig, "{ invalid json", "utf8");

      const withCorruptSibling = await uninstallSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(withCorruptSibling.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();
      await fs.rm(windsurfConfig);

      // 5. Unselected Claude client missing SKILL.md (driver.check() === "missing") but still pointing MCP to runtime keeps base
      await installClientsOrThrow(context, ["cursor"], { recordClientSelection: true });
      await installClientsOrThrow(context, ["claude"], { recordClientSelection: true });
      await fs.rm(path.join(targetDir, ".claude", "skills", "create-review-artifact", "SKILL.md"));

      const withPartialClaude = await uninstallSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(withPartialClaude.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();

      await uninstallSelectedIntegrations(context, ["claude"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      await expect(fs.access(runtimePath)).rejects.toThrow();

      // 6. Unselected client using an absolute Node executable path (e.g. process.execPath) still references runtime -> keep base
      await installClientsOrThrow(context, ["cursor"], { recordClientSelection: true });
      await installClientsOrThrow(context, ["windsurf"], { recordClientSelection: true });
      const windsurfAbsoluteCmdCfg = JSON.parse(await fs.readFile(windsurfConfig, "utf8"));
      windsurfAbsoluteCmdCfg.mcpServers.ai_artifacts.command = process.execPath;
      await fs.writeFile(windsurfConfig, `${JSON.stringify(windsurfAbsoluteCmdCfg, null, 2)}\n`, "utf8");

      const withCustomNodePath = await uninstallSelectedIntegrations(context, ["cursor"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(withCustomNodePath.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();
      await uninstallSelectedIntegrations(context, ["windsurf"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      await expect(fs.access(runtimePath)).rejects.toThrow();

      // 7a. Selected Codex with markerless whitelisted [mcp_servers.ai_artifacts] entry uninstalls cleanly and cleans base
      await setupBaseMcpServer(context, { userHome: targetDir });
      await fs.mkdir(codexHome, { recursive: true });
      await fs.writeFile(
        path.join(codexHome, "config.toml"),
        `[mcp_servers.ai_artifacts]\ncommand = "node"\nargs = ${JSON.stringify([runtimePath])}\n`,
        "utf8",
      );
      const markerlessCodexResult = await uninstallSelectedIntegrations(context, ["codex"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(markerlessCodexResult.uninstalledClients).toEqual([{ id: "codex", name: "Codex" }]);
      await expect(fs.access(runtimePath)).rejects.toThrow();

      // 7b. Selected Codex with unexpected key left on disk fails closed and keeps base
      await setupBaseMcpServer(context, { userHome: targetDir });
      await fs.writeFile(
        path.join(codexHome, "config.toml"),
        `[mcp_servers.ai_artifacts]\ncommand = "node"\nargs = ${JSON.stringify([runtimePath])}\nfollowUpQueueMode = "steer"\n`,
        "utf8",
      );
      const conflictCodexResult = await uninstallSelectedIntegrations(context, ["codex"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(conflictCodexResult.failedClients).toHaveLength(1);
      expect(conflictCodexResult.failedClients[0]).toMatchObject({
        id: "codex",
        name: "Codex",
      });
      expect(conflictCodexResult.failedClients[0]!.error).toContain("followUpQueueMode");
      await expect(fs.access(runtimePath)).resolves.toBeUndefined();
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("listInstallableClients returns metadata for all 7 clients in factory order without check(), config/skill reads, or asset comparison", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const copilotConfig = path.resolve(globalStoragePath, "..", "..", "mcp.json");
      const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
      const claudeConfig = path.join(targetDir, ".claude.json");
      const claudeSkillFile = path.join(targetDir, ".claude", "skills", "create-review-artifact", "SKILL.md");
      const windsurfConfig = path.join(targetDir, ".codeium", "windsurf", "mcp_config.json");
      const clineConfig = path.resolve(
        globalStoragePath,
        "..",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json",
      );
      const antigravityConfig = path.join(targetDir, ".gemini", "config", "mcp_config.json");
      const runtimePath = managedMcpScriptPath({ userHome: targetDir });

      // Seed detected state (corrupt Cursor JSON + Claude dir/skill) and saved-only Windsurf
      await fs.mkdir(path.dirname(cursorConfig), { recursive: true });
      await fs.writeFile(cursorConfig, "{ broken cursor json", "utf8");
      await fs.mkdir(path.dirname(claudeSkillFile), { recursive: true });
      await fs.writeFile(claudeSkillFile, "# corrupt skill without markers", "utf8");
      await fs.mkdir(path.dirname(runtimePath), { recursive: true });
      await fs.writeFile(runtimePath, "// existing runtime\n", "utf8");
      await writeInstalledIntegrationVersion(
        {
          mcpVersion: MCP_VERSION,
          skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        },
        { userHome: targetDir },
      );
      await addInstalledClient("claude", { userHome: targetDir });
      await addInstalledClient("windsurf", { userHome: targetDir });

      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;

      const checkSpies = [
        vi.spyOn(CopilotClientDriver.prototype, "check"),
        vi.spyOn(CursorClientDriver.prototype, "check"),
        vi.spyOn(CodexClientDriver.prototype, "check"),
        vi.spyOn(ClaudeClientDriver.prototype, "check"),
        vi.spyOn(WindsurfClientDriver.prototype, "check"),
        vi.spyOn(ClineClientDriver.prototype, "check"),
        vi.spyOn(AntigravityClientDriver.prototype, "check"),
      ];

      const originalReadFile = fs.readFile.bind(fs);
      const readPaths: string[] = [];
      vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
        readPaths.push(path.resolve(filePath.toString()));
        return originalReadFile(filePath, options);
      }) as any);
      const readdirSpy = vi.spyOn(fs, "readdir");

      const result = await listInstallableClients(context);

      expect(Object.keys(result)).toEqual(["clients"]);
      expect(result.clients.map((c) => c.id)).toEqual([...MCP_CLIENT_IDS]);
      for (const client of result.clients) {
        expect(Object.keys(client).sort()).toEqual([
          "configPath",
          "id",
          "isDetected",
          "isSaved",
          "name",
        ]);
      }

      expect(result.clients).toEqual([
        {
          id: "copilot",
          name: "GitHub Copilot (VS Code)",
          configPath: copilotConfig,
          isDetected: false,
          isSaved: false,
        },
        {
          id: "cursor",
          name: "Cursor",
          configPath: cursorConfig,
          isDetected: true,
          isSaved: false,
        },
        {
          id: "codex",
          name: "Codex",
          configPath: path.join(codexHome, "config.toml"),
          isDetected: false,
          isSaved: false,
        },
        {
          id: "claude",
          name: "Claude",
          configPath: claudeConfig,
          isDetected: true,
          isSaved: true,
        },
        {
          id: "windsurf",
          name: "Windsurf",
          configPath: windsurfConfig,
          isDetected: false,
          isSaved: true,
        },
        {
          id: "cline",
          name: "Cline",
          configPath: clineConfig,
          isDetected: false,
          isSaved: false,
        },
        {
          id: "antigravity",
          name: "Antigravity",
          configPath: antigravityConfig,
          isDetected: false,
          isSaved: false,
        },
      ]);

      for (const spy of checkSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(readPaths).toEqual([path.resolve(managedInstalledClientsPath({ userHome: targetDir }))]);
      expect(readdirSpy).not.toHaveBeenCalled();
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("handles empty selection without writing base assets and writes shared runtime once in a batch without target read-back", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;
      const runtimePath = path.resolve(managedMcpScriptPath({ userHome: targetDir }));
      const versionPath = path.resolve(managedIntegrationVersionPath({ userHome: targetDir }));
      const clientsPath = path.resolve(managedInstalledClientsPath({ userHome: targetDir }));

      const emptyResult = await installSelectedIntegrations(context, [], { recordClientSelection: true });
      expect(emptyResult).toEqual({ installedClients: [], failedClients: [] });
      await expect(fs.access(runtimePath)).rejects.toThrow();
      await expect(fs.access(versionPath)).rejects.toThrow();
      await expect(fs.access(clientsPath)).rejects.toThrow();

      const originalReadFile = fs.readFile.bind(fs);
      const originalRename = fs.rename.bind(fs);
      const readPaths: string[] = [];
      const renameTargets: string[] = [];

      vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
        readPaths.push(path.resolve(filePath.toString()));
        return originalReadFile(filePath, options);
      }) as any);
      vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
        renameTargets.push(path.resolve(newPath.toString()));
        return originalRename(oldPath, newPath);
      });

      const checkSpies = [
        vi.spyOn(CodexClientDriver.prototype, "check"),
        vi.spyOn(CursorClientDriver.prototype, "check"),
        vi.spyOn(WindsurfClientDriver.prototype, "check"),
      ];
      vi.spyOn(CursorClientDriver.prototype, "install").mockRejectedValueOnce(
        new Error("cursor batch failure"),
      );

      const batchResult = await installSelectedIntegrations(
        context,
        ["cursor", "codex", "windsurf"],
        { recordClientSelection: true },
      );

      // Canonical order is cursor -> codex -> windsurf; cursor error must not stop codex or windsurf
      expect(batchResult).toEqual({
        installedClients: [
          { id: "codex", name: "Codex" },
          { id: "windsurf", name: "Windsurf" },
        ],
        failedClients: [
          { id: "cursor", name: "Cursor", error: "cursor batch failure" },
        ],
      });
      for (const spy of checkSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
      expect(renameTargets.filter((target) => target === runtimePath)).toHaveLength(1);
      expect(readPaths).not.toContain(runtimePath);
      expect(readPaths).not.toContain(
        path.resolve(targetDir, ".agents", "skills", "create-review-artifact", "references", "artifact-contract.md"),
      );
      expect(readPaths).not.toContain(
        path.resolve(targetDir, ".agents", "skills", "create-review-artifact", "references", "ai-feedback.md"),
      );
      expect(readPaths).not.toContain(
        path.resolve(targetDir, ".agents", "skills", "create-review-artifact", "agents", "openai.yaml"),
      );
      expect(readPaths).not.toContain(
        path.resolve(targetDir, ".agents", "skills", "work-session", "SKILL.md"),
      );
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("reports a per-client failure and skips saving selection when a JSON client config has a root array", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const globalStoragePath = path.join(
      targetDir,
      "Code",
      "User",
      "globalStorage",
      "huynguyen294.ai-artifacts",
    );
    const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
    await fs.mkdir(path.dirname(cursorConfig), { recursive: true });
    await fs.writeFile(cursorConfig, "[]", "utf8");

    const checkSpies = [
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(WindsurfClientDriver.prototype, "check"),
    ];
    const context = {
      extensionUri: { fsPath: repositoryRoot },
      globalStorageUri: { fsPath: globalStoragePath },
    } as any;

    const result = await installSelectedIntegrations(context, ["cursor", "windsurf"], {
      recordClientSelection: true,
    });

    expect(result.installedClients).toEqual([{ id: "windsurf", name: "Windsurf" }]);
    expect(result.failedClients).toHaveLength(1);
    expect(result.failedClients[0]).toMatchObject({
      id: "cursor",
      name: "Cursor",
    });
    expect(result.failedClients[0]?.error).toContain("must contain a JSON object");
    await expect(readInstalledClients({ userHome: targetDir })).resolves.toEqual(["windsurf"]);
    await expect(fs.readFile(cursorConfig, "utf8")).resolves.toBe("[]");
    for (const spy of checkSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("preserves pending codexMcpVersion when installer updates sibling clients from v11 without inventing it on fresh installs", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;

      // 1. Fresh install of Claude alone omits codexMcpVersion
      await installClientsOrThrow(context, ["claude"], { recordClientSelection: true });
      const freshReceipt = await readInstalledIntegrationVersion({ userHome: targetDir });
      expect(freshReceipt.status).toBe("valid");
      if (freshReceipt.status === "valid") {
        expect(freshReceipt.manifest.mcpVersion).toBe(MCP_VERSION);
        expect(freshReceipt.manifest.codexMcpVersion).toBeUndefined();
      }

      // 2. Prior v11 receipt with existing v11 Codex config + user installs only Claude
      const runtimePath = managedMcpScriptPath({ userHome: targetDir });
      const codexConfigPath = path.join(codexHome, "config.toml");
      await fs.mkdir(codexHome, { recursive: true });
      await fs.writeFile(
        codexConfigPath,
        [
          "[mcp_servers.ai_artifacts]",
          'command = "node"',
          `args = [${JSON.stringify(runtimePath)}]`,
          "tool_timeout_sec = 3600",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeInstalledIntegrationVersion(
        {
          mcpVersion: 11,
          skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
          sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, claude: WORK_SESSION_SKILL_VERSION },
        },
        { userHome: targetDir },
      );

      await installClientsOrThrow(context, ["claude"], { recordClientSelection: true });
      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          codexMcpVersion: 11,
        },
      });

      const snapshot = await readInstalledIntegrationVersion({ userHome: targetDir });
      expect(snapshot.status).toBe("valid");
      if (snapshot.status === "valid") {
        const upgradeReport = await upgradeDetectedIntegrations(context, snapshot);
        expect(upgradeReport.clients.find((client) => client.id === "codex")?.status).toBe("updated");
        expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
          status: "valid",
          manifest: {
            mcpVersion: MCP_VERSION,
            codexMcpVersion: MCP_VERSION,
          },
        });
      }
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("records pending codexMcpVersion on Codex install failure without blocking sibling installs or Session Manager, and clears it on Codex uninstall", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(targetDir, ".codex");
    process.env.CODEX_HOME = codexHome;

    try {
      const globalStoragePath = path.join(
        targetDir,
        "Code",
        "User",
        "globalStorage",
        "huynguyen294.ai-artifacts",
      );
      const context = {
        extensionUri: { fsPath: repositoryRoot },
        globalStorageUri: { fsPath: globalStoragePath },
      } as any;
      const runtimePath = managedMcpScriptPath({ userHome: targetDir });
      const codexConfigPath = path.join(codexHome, "config.toml");

      // Uninstalling Codex when receipt is missing must not create integration-version.json
      await fs.mkdir(codexHome, { recursive: true });
      await uninstallSelectedIntegrations(context, ["codex"], { cleanupBase: false });
      await expect(readInstalledIntegrationVersion({ userHome: targetDir })).resolves.toEqual({ status: "missing" });

      // Install [codex, claude] when Codex config has an unexpected custom key
      const conflictToml = [
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = [${JSON.stringify(runtimePath)}]`,
        'followUpQueueMode = "steer"',
        "",
      ].join("\n");
      await fs.writeFile(codexConfigPath, conflictToml, "utf8");

      const installResult = await installSelectedIntegrations(context, ["codex", "claude"], {
        recordClientSelection: true,
      });
      expect(installResult.installedClients).toEqual([{ id: "claude", name: "Claude" }]);
      expect(installResult.failedClients).toHaveLength(1);
      expect(installResult.failedClients[0]).toMatchObject({
        id: "codex",
        errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
      });

      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          codexMcpVersion: 0,
        },
      });
      await expect(resolveWorkSessionSupport({ userHome: targetDir })).resolves.toMatchObject({
        supported: true,
        installedMcpVersion: MCP_VERSION,
        requiredMcpVersion: MCP_VERSION,
      });

      // Next activation continues detecting & reporting the unresolved Codex conflict
      const snapshotWhileConflicted = await readInstalledIntegrationVersion({ userHome: targetDir });
      expect(snapshotWhileConflicted.status).toBe("valid");
      if (snapshotWhileConflicted.status === "valid") {
        const retryReport = await upgradeDetectedIntegrations(context, snapshotWhileConflicted);
        expect(retryReport.updatedAssets).toEqual([]);
        expect(retryReport.clients.find((client) => client.id === "codex")).toMatchObject({
          id: "codex",
          status: "failed",
          errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
        });
      }

      // Uninstall also fails closed while the unexpected custom key remains in config.toml
      const blockedUninstallResult = await uninstallSelectedIntegrations(context, ["codex"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(blockedUninstallResult.uninstalledClients).toEqual([]);
      expect(blockedUninstallResult.failedClients).toHaveLength(1);
      expect(blockedUninstallResult.failedClients[0]?.id).toBe("codex");
      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          codexMcpVersion: 0,
        },
      });

      // Removing the unexpected custom key lets Codex uninstall succeed, clears pending codexMcpVersion,
      // and keeps Claude + Session Manager working
      await fs.writeFile(
        codexConfigPath,
        conflictToml.replace('followUpQueueMode = "steer"\n', ""),
        "utf8",
      );
      const uninstallResult = await uninstallSelectedIntegrations(context, ["codex"], {
        recordClientSelection: true,
        cleanupBase: true,
      });
      expect(uninstallResult.uninstalledClients).toEqual([{ id: "codex", name: "Codex" }]);
      expect(uninstallResult.failedClients).toEqual([]);

      const afterUninstallReceipt = await readInstalledIntegrationVersion({ userHome: targetDir });
      expect(afterUninstallReceipt.status).toBe("valid");
      if (afterUninstallReceipt.status === "valid") {
        expect(afterUninstallReceipt.manifest.mcpVersion).toBe(MCP_VERSION);
        expect(afterUninstallReceipt.manifest.codexMcpVersion).toBeUndefined();
      }
      await expect(resolveWorkSessionSupport({ userHome: targetDir })).resolves.toMatchObject({
        supported: true,
        installedMcpVersion: MCP_VERSION,
        requiredMcpVersion: MCP_VERSION,
      });

      if (afterUninstallReceipt.status === "valid") {
        const cleanReport = await upgradeDetectedIntegrations(context, afterUninstallReceipt);
        expect(cleanReport.updatedAssets).toEqual([]);
        expect(cleanReport.clients.find((client) => client.id === "codex")?.status).toBe("unchanged");
      }
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });
});
