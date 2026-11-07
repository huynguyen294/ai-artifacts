import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../src/extension/artifact-store";
import { hasManagedCodexArtifactsMcp, upsertCodexArtifactsMcp } from "../src/extension/mcp-config";
import {
  globalArtifactsRoot,
  managedIntegrationVersionPath,
} from "../src/shared/artifact-files";
import { MCP_VERSION, SKILL_VERSION } from "../src/shared/contracts";
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
  baseAssetsAreCurrent,
  baseScriptIsCurrent,
  checkAllIntegrations,
  installAllDetectedIntegrations,
  installClaudeIntegration,
  readInstalledIntegrationVersion,
  skillAssetsAreCurrent,
  getReviewSkillMarkdown,
  setupBaseMcpServer,
  uninstallAllDetectedIntegrations,
  writeInstalledIntegrationVersion,
  type BaseIntegrationPaths,
} from "../src/extension/workspace-integration";

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
      targetLegacySkill: path.join(targetDir, ".agents", "skills", "create-plan-artifact"),
      sourceMcpScript: path.join(sourceDir, "dist", "server.mjs"),
      sourceSkill: path.join(sourceDir, "skills", "create-review-artifact"),
    };

    // Prepare source assets
    await fs.mkdir(path.dirname(paths.sourceMcpScript), { recursive: true });
    await fs.writeFile(paths.sourceMcpScript, "// MCP server script v1", "utf8");

    await fs.mkdir(path.join(paths.sourceSkill, "references"), { recursive: true });
    await fs.mkdir(path.join(paths.sourceSkill, "agents"), { recursive: true });
    await fs.writeFile(path.join(paths.sourceSkill, "SKILL.md"), SOURCE_SKILL_MARKDOWN, "utf8");
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
    }, { userHome: targetDir });
    await writeInstalledIntegrationVersion({
      skills: { claude: SKILL_VERSION },
    }, { userHome: targetDir });
    const complete = await readInstalledIntegrationVersion({ userHome: targetDir });
    expect(complete).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: SKILL_VERSION, claude: SKILL_VERSION },
      },
    });

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
    expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: SKILL_VERSION },
      },
    });
    expect(await fs.readFile(installedPaths.targetMcpScript)).toEqual(
      await fs.readFile(installedPaths.sourceMcpScript),
    );
    await expect(fs.access(installedPaths.targetLegacyMcpScript)).rejects.toThrow();
    for (const relativePath of [
      "SKILL.md",
      path.join("references", "artifact-contract.md"),
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
      "inspect_artifact_review",
      "join_session",
      "advance_and_wait_for_artifact",
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
      name: "inspect_artifact_review",
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

    await expect(installClaudeIntegration(context)).rejects.toThrow("run the installer command again");
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
    await installClaudeIntegration(context);
    expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: SKILL_VERSION, claude: SKILL_VERSION },
      },
    });
  });

  it("reinstalls all detected clients from current assets and uninstalls without touching artifacts or unrelated config", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "..");
    const codexHome = path.join(targetDir, ".codex");
    const cursorConfig = path.join(targetDir, ".cursor", "mcp.json");
    const claudeConfig = path.join(targetDir, ".claude.json");
    const windsurfConfig = path.join(targetDir, ".codeium", "windsurf", "mcp_config.json");
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
    const claudeSkill = path.join(targetDir, ".claude", "skills", "create-review-artifact", "SKILL.md");
    const originalCodexHome = process.env.CODEX_HOME;

    vi.spyOn(os, "homedir").mockReturnValue(targetDir);
    process.env.CODEX_HOME = codexHome;

    try {
      await Promise.all([
        fs.mkdir(path.dirname(cursorConfig), { recursive: true }),
        fs.mkdir(codexHome, { recursive: true }),
        fs.mkdir(path.join(targetDir, ".claude"), { recursive: true }),
        fs.mkdir(path.dirname(windsurfConfig), { recursive: true }),
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

      const firstInstall = await installAllDetectedIntegrations(context);
      expect(firstInstall.installedClients).toEqual([
        "GitHub Copilot (VS Code)",
        "Cursor",
        "Codex",
        "Claude",
        "Windsurf",
        "Cline",
      ]);
      await expect(
        fs.access(path.join(targetDir, ".vscode", "ai-artifacts", "codex-artifacts-review-mcp.mjs")),
      ).rejects.toThrow();
      await expect(fs.access(path.join(targetDir, ".agents", "skills", "create-plan-artifact"))).rejects.toThrow();
      await expect(fs.access(claudeSkill)).resolves.toBeUndefined();
      expect(await readInstalledIntegrationVersion({ userHome: targetDir })).toMatchObject({
        status: "valid",
        manifest: {
          mcpVersion: MCP_VERSION,
          skills: { agents: SKILL_VERSION, claude: SKILL_VERSION },
        },
      });

      let report = await checkAllIntegrations(context);
      expect(report.baseCurrent).toBe(true);
      expect(report.skillCurrent).toBe(true);
      expect(report.clients.filter((client) => client.isDetected).map((client) => client.status)).toEqual([
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
        "ready",
      ]);

      const currentSetup = await setupBaseMcpServer(context);
      expect(currentSetup.assetsUpdated).toBe(false);
      const installedPaths = currentSetup.paths;
      await fs.writeFile(installedPaths.targetMcpScript, "// stale runtime\n", "utf8");
      await fs.writeFile(path.join(installedPaths.targetSkill, "SKILL.md"), "# Stale skill\n", "utf8");
      await fs.writeFile(path.join(installedPaths.targetSkill, "obsolete-instruction.md"), "obsolete\n", "utf8");

      report = await checkAllIntegrations(context);
      expect(report.baseCurrent).toBe(false);
      expect(report.skillCurrent).toBe(false);
      expect(report.clients.filter((client) => client.isDetected).map((client) => client.status)).toEqual([
        "outdated",
        "outdated",
        "outdated",
        "outdated",
        "outdated",
        "outdated",
      ]);

      await installAllDetectedIntegrations(context);
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
      ]);

      const cursorBeforeUninstall = JSON.parse(await fs.readFile(cursorConfig, "utf8"));
      const claudeBeforeUninstall = JSON.parse(await fs.readFile(claudeConfig, "utf8"));
      const windsurfBeforeUninstall = JSON.parse(await fs.readFile(windsurfConfig, "utf8"));
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

      const uninstall = await uninstallAllDetectedIntegrations(context);
      expect(uninstall.uninstalledClients).toEqual(firstInstall.installedClients);
      await expect(fs.access(installedPaths.targetDirectory)).rejects.toThrow();
      await expect(fs.access(managedIntegrationVersionPath({ userHome: targetDir }))).rejects.toThrow();
      await expect(fs.access(installedPaths.targetSkill)).rejects.toThrow();
      await expect(fs.access(path.join(targetDir, ".vscode", "ai-artifacts"))).rejects.toThrow();
      await expect(fs.access(path.dirname(claudeSkill))).rejects.toThrow();
      await expect(fs.access(productRoot)).resolves.toBeUndefined();
      await expect(fs.readFile(unrelatedSiblingFile, "utf8")).resolves.toBe("do not touch me\n");
      await expect(fs.readFile(unrelatedSkill, "utf8")).resolves.toBe("# Unrelated skill\n");
      await expect(fs.readFile(unrelatedClaudeSkill, "utf8")).resolves.toBe("# Unrelated Claude skill\n");

      const afterHash = crypto
        .createHash("sha256")
        .update(await fs.readFile(retainedArtifact))
        .digest("hex");
      expect(afterHash).toBe(beforeHash);
      await expect(fs.readFile(retainedArtifact, "utf8")).resolves.toBe("# Retain me\n");

      // Idempotent double uninstall
      await expect(uninstallAllDetectedIntegrations(context)).resolves.not.toThrow();

      const cursorAfterUninstall = JSON.parse(await fs.readFile(cursorConfig, "utf8"));
      const claudeAfterUninstall = JSON.parse(await fs.readFile(claudeConfig, "utf8"));
      const windsurfAfterUninstall = JSON.parse(await fs.readFile(windsurfConfig, "utf8"));
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
});
