import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  classifyGlobalIntegration,
  type IntegrationCheck,
} from "./global-integration-status";
import {
  AntigravityClientDriver,
  ClaudeClientDriver,
  ClineClientDriver,
  CodexClientDriver,
  CopilotClientDriver,
  CursorClientDriver,
  WindsurfClientDriver,
  getAllClientDrivers,
  getClineSettingsPath,
  getVsCodeUserMcpPath,
  type McpClientDriver,
} from "./mcp-clients/index";
import { upsertJsonMcpServer, writeTextFileAtomic } from "./mcp-clients/json-mcp-helper";
import { cleanupBaseMcpServer } from "./mcp-clients/base-cleanup";
import {
  REVIEW_SKILL_ASSETS,
  WORK_SESSION_SKILL_ASSETS,
  officialSkillDirectoryIsCurrent,
  replaceOfficialSkillDirectory,
  replaceSkillDirectory,
  sameFile,
  skillDirectoryIsCurrent,
} from "./mcp-clients/skill-helper";
import {
  OWNER_ONLY_FILE_MODE,
  aiArtifactsRoot,
  managedAssetsRoot,
  managedIntegrationVersionPath,
  managedMcpScriptPath,
  managedWorkspaceRegistryDirectory,
} from "../shared/artifact-files";
import { ensureManagedDirectory } from "../shared/artifact-validation";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  INTEGRATION_VERSION_SCHEMA_VERSION,
  MCP_VERSION,
  SKILL_VERSION,
  WORK_SESSION_SKILL_VERSION,
  integrationVersionManifestSchema,
  type InstalledSkillVersions,
  type IntegrationVersionManifest,
} from "../shared/contracts";

export { cleanupBaseMcpServer } from "./mcp-clients/base-cleanup";

export type BaseIntegrationPaths = {
  targetDirectory: string;
  targetMcpScript: string;
  targetLegacyMcpScript: string;
  targetSkill: string;
  targetSessionSkill: string;
  targetLegacySkill: string;
  workspacesDirectory: string;
  sourceMcpScript: string;
  sourceSkill: string;
  sourceSessionSkill: string;
};

export function getCopilotConfigPath(context?: vscode.ExtensionContext): string {
  if (context?.globalStorageUri?.fsPath) {
    try {
      return path.resolve(context.globalStorageUri.fsPath, "..", "..", "mcp.json");
    } catch {}
  }
  return getVsCodeUserMcpPath();
}

export function getClineConfigPath(context?: vscode.ExtensionContext): string {
  if (context?.globalStorageUri?.fsPath) {
    try {
      return path.resolve(
        context.globalStorageUri.fsPath,
        "..",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json",
      );
    } catch {}
  }
  return getClineSettingsPath();
}

export function getDetectedSkillTargets(): Array<keyof InstalledSkillVersions> {
  const targets: Array<keyof InstalledSkillVersions> = ["agents"];
  if (new ClaudeClientDriver().isDetected()) targets.push("claude");
  if (new AntigravityClientDriver().isDetected()) targets.push("antigravity");
  return targets;
}

export function getBaseIntegrationPaths(
  context: vscode.ExtensionContext,
  options?: { userHome?: string },
): BaseIntegrationPaths {
  const userHome = options?.userHome ?? os.homedir();
  const targetDirectory = managedAssetsRoot({ userHome });
  const agentSkillsDirectory = path.join(userHome, ".agents", "skills");
  const legacyDirectory = path.join(userHome, ".vscode", "ai-artifacts");
  return {
    targetDirectory,
    targetMcpScript: managedMcpScriptPath({ userHome }),
    targetLegacyMcpScript: path.join(legacyDirectory, "ai-artifacts-review-mcp.mjs"),
    targetSkill: path.join(agentSkillsDirectory, "create-review-artifact"),
    targetSessionSkill: path.join(agentSkillsDirectory, "work-session"),
    targetLegacySkill: path.join(agentSkillsDirectory, "create-plan-artifact"),
    workspacesDirectory: managedWorkspaceRegistryDirectory({ userHome }),
    sourceMcpScript: vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "integration",
      "codex-artifacts-review-mcp.mjs",
    ).fsPath,
    sourceSkill: vscode.Uri.joinPath(context.extensionUri, "skills", "create-review-artifact").fsPath,
    sourceSessionSkill: vscode.Uri.joinPath(context.extensionUri, "skills", "work-session").fsPath,
  };
}

async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, (error: any) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

export async function skillAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return skillDirectoryIsCurrent(paths.sourceSkill, paths.targetSkill);
}

export async function sessionSkillAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return officialSkillDirectoryIsCurrent(paths.sourceSessionSkill, paths.targetSessionSkill);
}

export async function baseScriptIsCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return sameFile(paths.sourceMcpScript, paths.targetMcpScript);
}

export async function baseAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  const [skillCurrent, sessionSkillCurrent, scriptCurrent] = await Promise.all([
    skillAssetsAreCurrent(paths),
    sessionSkillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
  ]);
  return skillCurrent && sessionSkillCurrent && scriptCurrent;
}

export type InstalledIntegrationVersionReadResult =
  | { status: "valid"; manifest: IntegrationVersionManifest }
  | { status: "missing" }
  | { status: "invalid"; error: unknown };

export async function readInstalledIntegrationVersion(
  options: { userHome?: string } = {},
): Promise<InstalledIntegrationVersionReadResult> {
  const manifestPath = managedIntegrationVersionPath(options);
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsedJson = JSON.parse(raw);
    const parsedManifest = integrationVersionManifestSchema.safeParse(parsedJson);
    if (!parsedManifest.success) {
      return { status: "invalid", error: parsedManifest.error };
    }
    return { status: "valid", manifest: parsedManifest.data };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { status: "missing" };
    if (error instanceof SyntaxError) return { status: "invalid", error };
    throw error;
  }
}

export async function writeInstalledIntegrationVersion(
  patch: {
    mcpVersion?: number;
    skills?: Partial<InstalledSkillVersions>;
    sessionSkills?: Partial<InstalledSkillVersions>;
  },
  options: { userHome?: string } = {},
): Promise<IntegrationVersionManifest> {
  const current = await readInstalledIntegrationVersion(options);
  const currentManifest = current.status === "valid" ? current.manifest : undefined;
  const nextManifest = integrationVersionManifestSchema.parse({
    schemaVersion: INTEGRATION_VERSION_SCHEMA_VERSION,
    ...(patch.mcpVersion !== undefined
      ? { mcpVersion: patch.mcpVersion }
      : currentManifest?.mcpVersion !== undefined
        ? { mcpVersion: currentManifest.mcpVersion }
        : {}),
    skills: {
      ...(currentManifest?.skills ?? {}),
      ...(patch.skills ?? {}),
    },
    ...((currentManifest?.sessionSkills !== undefined || patch.sessionSkills !== undefined)
      ? {
          sessionSkills: {
            ...(currentManifest?.sessionSkills ?? {}),
            ...(patch.sessionSkills ?? {}),
          },
        }
      : {}),
    updatedAt: new Date().toISOString(),
  });
  await writeTextFileAtomic(
    managedIntegrationVersionPath(options),
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    OWNER_ONLY_FILE_MODE,
  );
  return nextManifest;
}

export async function setupBaseMcpServer(
  context: vscode.ExtensionContext,
  options?: { userHome?: string },
): Promise<{ paths: BaseIntegrationPaths; assetsUpdated: boolean }> {
  const paths = getBaseIntegrationPaths(context, options);

  // Validate every packaged source before replacing any installed asset.
  await Promise.all([
    fs.access(paths.sourceMcpScript),
    ...REVIEW_SKILL_ASSETS.map((relativePath) =>
      fs.access(path.join(paths.sourceSkill, relativePath)),
    ),
    ...WORK_SESSION_SKILL_ASSETS.map((relativePath) =>
      fs.access(path.join(paths.sourceSessionSkill, relativePath)),
    ),
  ]);
  const [assetsCurrent, legacyScriptPresent, legacySkillPresent] = await Promise.all([
    baseAssetsAreCurrent(paths),
    pathExists(paths.targetLegacyMcpScript),
    pathExists(paths.targetLegacySkill),
  ]);
  const assetsUpdated = !assetsCurrent || legacyScriptPresent || legacySkillPresent;

  const userHome = options?.userHome ?? os.homedir();
  const root = aiArtifactsRoot({ userHome });
  await ensureManagedDirectory(root);
  await ensureManagedDirectory(paths.targetDirectory);
  await ensureManagedDirectory(path.dirname(paths.targetMcpScript));
  await ensureManagedDirectory(paths.workspacesDirectory);

  // Install only the current runtime; upgrades require reinstalling client config.
  const mcpContents = await fs.readFile(paths.sourceMcpScript, "utf8");
  await writeTextFileAtomic(paths.targetMcpScript, mcpContents, OWNER_ONLY_FILE_MODE);
  await fs.rm(paths.targetLegacyMcpScript, { force: true }).catch(() => {});

  // Deploy Agent Skill to ~/.agents/skills/create-review-artifact
  await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);

  // Deploy Work Session Skill to ~/.agents/skills/work-session
  await replaceOfficialSkillDirectory(paths.sourceSessionSkill, paths.targetSessionSkill);

  // Clean up legacy skill if present
  await fs.rm(paths.targetLegacySkill, { recursive: true, force: true }).catch(() => {});

  // Clean up obsolete ~/.vscode/ai-artifacts/mcp.json if it exists
  const legacyDirectory = path.join(userHome, ".vscode", "ai-artifacts");
  await fs.rm(path.join(legacyDirectory, "mcp.json"), { force: true }).catch(() => {});

  const [scriptCurrent, skillCurrent, sessionSkillCurrent] = await Promise.all([
    baseScriptIsCurrent(paths),
    skillAssetsAreCurrent(paths),
    sessionSkillAssetsAreCurrent(paths),
  ]);
  if (!scriptCurrent || !skillCurrent || !sessionSkillCurrent) {
    throw new Error("Base MCP runtime or shared review/session skills verification failed after installation.");
  }
  await writeInstalledIntegrationVersion({
    mcpVersion: MCP_VERSION,
    skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
    sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
  }, { userHome });

  return { paths, assetsUpdated };
}

export function getMcpConfigSnippet(context: vscode.ExtensionContext): string {
  const paths = getBaseIntegrationPaths(context);
  const normalizedPath = paths.targetMcpScript.replaceAll("\\", "/");
  const snippet = {
    servers: {
      ai_artifacts: {
        command: "node",
        args: [normalizedPath],
      },
    },
  };
  return JSON.stringify(snippet, null, 2);
}

export async function getReviewSkillMarkdown(context: vscode.ExtensionContext): Promise<string> {
  const paths = getBaseIntegrationPaths(context);
  const skillFile = path.join(paths.sourceSkill, "SKILL.md");
  try {
    return await fs.readFile(skillFile, "utf8");
  } catch {
    const fallback = path.join(paths.targetSkill, "SKILL.md");
    return await fs.readFile(fallback, "utf8");
  }
}

async function verifyAndRecordAntigravityIntegration(
  driver: McpClientDriver,
  targetMcpScript: string,
  userHome = os.homedir(),
): Promise<void> {
  const check = await driver.check(targetMcpScript);
  if (check.status !== "ready") {
    throw new Error(
      `Antigravity integration verification failed after installation: ${check.detail ?? check.status}`,
    );
  }
  await writeInstalledIntegrationVersion(
    {
      skills: { antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
      sessionSkills: { antigravity: WORK_SESSION_SKILL_VERSION },
    },
    { userHome },
  );
}

// 1. All detected
export async function installAllDetectedIntegrations(
  context: vscode.ExtensionContext,
): Promise<{ installedClients: string[] }> {
  const { paths } = await setupBaseMcpServer(context);
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths.sourceSkill,
    paths.sourceSessionSkill,
  );
  const installedClients: string[] = [];

  for (const driver of drivers) {
    if (driver.isDetected()) {
      await driver.install(paths.targetMcpScript);
      installedClients.push(driver.name);
      if (driver.id === "claude") {
        const check = await driver.check(paths.targetMcpScript);
        if (check.status !== "ready") {
          throw new Error(`Claude integration verification failed after installation: ${check.detail ?? check.status}`);
        }
        await writeInstalledIntegrationVersion(
          {
            skills: { claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
            sessionSkills: { claude: WORK_SESSION_SKILL_VERSION },
          },
          { userHome: os.homedir() },
        );
      } else if (driver.id === "antigravity") {
        await verifyAndRecordAntigravityIntegration(driver, paths.targetMcpScript);
      }
    }
  }

  // Verify all detected clients before cleaning up legacy runtime
  let allReady = true;
  for (const driver of drivers) {
    if (driver.isDetected()) {
      const check = await driver.check(paths.targetMcpScript);
      if (check.status !== "ready") {
        allReady = false;
        break;
      }
    }
  }

  if (allReady) {
    const legacyBaseDir = path.join(os.homedir(), ".vscode", "ai-artifacts");
    await fs.rm(legacyBaseDir, { recursive: true, force: true }).catch(() => {});
  }

  return { installedClients };
}

// 2. Copilot (base setup + Code/User/mcp.json)
export async function installCopilotIntegration(
  context: vscode.ExtensionContext,
): Promise<{ userConfigPath: string }> {
  const { paths } = await setupBaseMcpServer(context);
  const copilotConfigPath = getCopilotConfigPath(context);
  const copilotDriver = new CopilotClientDriver(copilotConfigPath);
  await copilotDriver.install(paths.targetMcpScript);

  return { userConfigPath: copilotConfigPath };
}

// 3. Codex
export async function installCodexIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const codexDriver = new CodexClientDriver();
  await codexDriver.install(paths.targetMcpScript);
}

// 4. Cursor
export async function installCursorIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const cursorDriver = new CursorClientDriver();
  await cursorDriver.install(paths.targetMcpScript);
}

// 5. Claude
export async function installClaudeIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const claudeDriver = new ClaudeClientDriver(
    undefined,
    undefined,
    paths.sourceSkill,
    undefined,
    paths.sourceSessionSkill,
  );
  await claudeDriver.install(paths.targetMcpScript);
  const check = await claudeDriver.check(paths.targetMcpScript);
  if (check.status !== "ready") {
    throw new Error(`Claude integration verification failed after installation: ${check.detail ?? check.status}`);
  }
  await writeInstalledIntegrationVersion({
    skills: { claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
    sessionSkills: { claude: WORK_SESSION_SKILL_VERSION },
  });
}

// 6. Windsurf
export async function installWindsurfIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const windsurfDriver = new WindsurfClientDriver();
  await windsurfDriver.install(paths.targetMcpScript);
}

// 7. Cline
export async function installClineIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const clineConfigPath = getClineConfigPath(context);
  const clineDriver = new ClineClientDriver(clineConfigPath);
  await clineDriver.install(paths.targetMcpScript);
}

// 8. Antigravity
export async function installAntigravityIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const antigravityDriver = new AntigravityClientDriver({
    sourceSkillDirectory: paths.sourceSkill,
    sourceSessionSkillDirectory: paths.sourceSessionSkill,
  });
  await antigravityDriver.install(paths.targetMcpScript);
  await verifyAndRecordAntigravityIntegration(antigravityDriver, paths.targetMcpScript);
}

// 8. Uninstall all detected integrations
export async function uninstallAllDetectedIntegrations(
  context?: vscode.ExtensionContext,
  options?: { cleanupBase?: boolean; userHome?: string },
): Promise<{ uninstalledClients: string[] }> {
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath, clineConfigPath);
  const uninstalledClients: string[] = [];

  for (const driver of drivers) {
    if (driver.isDetected()) {
      const changed = await driver.uninstall();
      if (changed) {
        uninstalledClients.push(driver.name);
      }
    }
  }

  if (options?.cleanupBase !== false) {
    await cleanupBaseMcpServer(options?.userHome ? { userHome: options.userHome } : undefined);
  }

  return { uninstalledClients };
}

// 8. Individual uninstall functions
export async function uninstallCopilotIntegration(
  context?: vscode.ExtensionContext,
): Promise<boolean> {
  const copilotConfigPath = getCopilotConfigPath(context);
  const driver = new CopilotClientDriver(copilotConfigPath);
  return driver.uninstall();
}

export async function uninstallCodexIntegration(): Promise<boolean> {
  const driver = new CodexClientDriver();
  return driver.uninstall();
}

export async function uninstallCursorIntegration(): Promise<boolean> {
  const driver = new CursorClientDriver();
  return driver.uninstall();
}

export async function uninstallClaudeIntegration(): Promise<boolean> {
  const driver = new ClaudeClientDriver();
  return driver.uninstall();
}

export async function uninstallWindsurfIntegration(): Promise<boolean> {
  const driver = new WindsurfClientDriver();
  return driver.uninstall();
}

export async function uninstallClineIntegration(
  context?: vscode.ExtensionContext,
): Promise<boolean> {
  const clineConfigPath = getClineConfigPath(context);
  const driver = new ClineClientDriver(clineConfigPath);
  return driver.uninstall();
}

export async function uninstallAntigravityIntegration(): Promise<boolean> {
  const driver = new AntigravityClientDriver();
  return driver.uninstall();
}

export type ClientVerificationReport = {
  id: string;
  name: string;
  isDetected: boolean;
  status: IntegrationCheck["status"];
  detail?: string;
};

export async function checkAllIntegrations(
  context: vscode.ExtensionContext,
): Promise<{
  skillCurrent: boolean;
  sessionSkillCurrent: boolean;
  baseCurrent: boolean;
  clients: ClientVerificationReport[];
}> {
  const paths = getBaseIntegrationPaths(context);
  const [skillCurrent, sessionSkillCurrent, baseCurrent] = await Promise.all([
    skillAssetsAreCurrent(paths),
    sessionSkillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
  ]);
  const assetsCurrent = skillCurrent && sessionSkillCurrent && baseCurrent;
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths.sourceSkill,
    paths.sourceSessionSkill,
  );
  const clients: ClientVerificationReport[] = [];

  for (const driver of drivers) {
    const isDetected = driver.isDetected();
    const checkResult = await driver.check(paths.targetMcpScript);
    let detail = checkResult.detail;
    let status = checkResult.status;
    if (status === "ready" && !assetsCurrent) {
      status = "outdated";
      if (!detail) {
        if (!skillCurrent && !sessionSkillCurrent) {
          detail = "Shared review skill and work session skill are outdated or missing.";
        } else if (!skillCurrent) {
          detail = "Shared review skill is outdated or missing.";
        } else if (!sessionSkillCurrent) {
          detail = "Shared work session skill is outdated or missing.";
        } else {
          detail = "Base MCP runtime is outdated or missing.";
        }
      }
    }
    clients.push({
      id: driver.id,
      name: driver.name,
      isDetected,
      status,
      ...(detail ? { detail } : {}),
    });
  }

  return { skillCurrent, sessionSkillCurrent, baseCurrent, clients };
}

// Backward compatibility methods for existing tests and callers
export async function checkGlobalIntegration(
  context: vscode.ExtensionContext,
): Promise<IntegrationCheck> {
  const paths = getBaseIntegrationPaths(context);
  const codexDriver = new CodexClientDriver();
  const codexCheck = await codexDriver.check(paths.targetMcpScript);
  const assetsCurrent = await baseAssetsAreCurrent(paths);
  return classifyGlobalIntegration({
    configured: codexCheck.status === "ready",
    assetsCurrent,
    ...(codexCheck.detail ? { configurationConflict: codexCheck.detail } : {}),
  });
}

export async function installGlobalIntegration(
  context: vscode.ExtensionContext,
): Promise<IntegrationCheck> {
  await installCodexIntegration(context);
  const installed = await checkGlobalIntegration(context);
  return installed.status === "ready" ? { status: "restart-required" } : installed;
}
