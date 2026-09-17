import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  classifyGlobalIntegration,
  type IntegrationCheck,
} from "./global-integration-status";
import {
  ClaudeClientDriver,
  CodexClientDriver,
  CopilotClientDriver,
  CursorClientDriver,
  WindsurfClientDriver,
  getAllClientDrivers,
  getVsCodeUserMcpPath,
  type McpClientDriver,
} from "./mcp-clients/index";
import { upsertJsonMcpServer, writeTextFileAtomic } from "./mcp-clients/json-mcp-helper";
import { cleanupBaseMcpServer } from "./mcp-clients/base-cleanup";
import {
  OWNER_ONLY_FILE_MODE,
  aiArtifactsRoot,
  managedAssetsRoot,
  managedMcpScriptPath,
  managedWorkspaceRegistryDirectory,
} from "../shared/artifact-files";
import { ensureManagedDirectory } from "../shared/artifact-validation";

export { cleanupBaseMcpServer } from "./mcp-clients/base-cleanup";

export type BaseIntegrationPaths = {
  targetDirectory: string;
  targetMcpScript: string;
  targetLegacyMcpScript: string;
  targetSkill: string;
  targetLegacySkill: string;
  workspacesDirectory: string;
  sourceMcpScript: string;
  sourceSkill: string;
};

const REVIEW_SKILL_ASSETS = [
  "SKILL.md",
  path.join("references", "artifact-contract.md"),
  path.join("agents", "openai.yaml"),
];

export function getCopilotConfigPath(context?: vscode.ExtensionContext): string {
  if (context?.globalStorageUri?.fsPath) {
    try {
      return path.resolve(context.globalStorageUri.fsPath, "..", "..", "mcp.json");
    } catch {}
  }
  return getVsCodeUserMcpPath();
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
    targetLegacySkill: path.join(agentSkillsDirectory, "create-plan-artifact"),
    workspacesDirectory: managedWorkspaceRegistryDirectory({ userHome }),
    sourceMcpScript: vscode.Uri.joinPath(
      context.extensionUri,
      "dist",
      "integration",
      "codex-artifacts-review-mcp.mjs",
    ).fsPath,
    sourceSkill: vscode.Uri.joinPath(context.extensionUri, "skills", "create-review-artifact").fsPath,
  };
}

async function sameFile(left: string, right: string): Promise<boolean> {
  try {
    const [leftContents, rightContents] = await Promise.all([fs.readFile(left), fs.readFile(right)]);
    return leftContents.equals(rightContents);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, (error: any) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
}

export async function skillAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  const checks = REVIEW_SKILL_ASSETS.map((relativePath) =>
    sameFile(
      path.join(paths.sourceSkill, relativePath),
      path.join(paths.targetSkill, relativePath),
    ),
  );
  return (await Promise.all(checks)).every(Boolean);
}

async function replaceSkillDirectory(source: string, target: string): Promise<void> {
  const targetParent = path.dirname(target);
  await fs.mkdir(targetParent, { recursive: true });
  const stagingRoot = await fs.mkdtemp(path.join(targetParent, ".create-review-artifact-install-"));
  const stagedSkill = path.join(stagingRoot, "next");
  const previousSkill = path.join(stagingRoot, "previous");
  let previousMoved = false;
  let keepRecoveryDirectory = false;

  try {
    await fs.cp(source, stagedSkill, { recursive: true, force: true });
    try {
      await fs.rename(target, previousSkill);
      previousMoved = true;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(stagedSkill, target);
    } catch (error) {
      if (previousMoved) {
        try {
          await fs.rename(previousSkill, target);
        } catch (restoreError) {
          keepRecoveryDirectory = true;
          throw new AggregateError(
            [error, restoreError],
            `Failed to install the review skill and restore the previous copy. Recovery files remain at "${stagingRoot}".`,
          );
        }
      }
      throw error;
    }
  } finally {
    if (!keepRecoveryDirectory) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function baseScriptIsCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return sameFile(paths.sourceMcpScript, paths.targetMcpScript);
}

export async function baseAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  const [skillCurrent, scriptCurrent] = await Promise.all([
    skillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
  ]);
  return skillCurrent && scriptCurrent;
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

  // Clean up legacy skill if present
  await fs.rm(paths.targetLegacySkill, { recursive: true, force: true }).catch(() => {});

  // Clean up obsolete ~/.vscode/ai-artifacts/mcp.json if it exists
  const legacyDirectory = path.join(userHome, ".vscode", "ai-artifacts");
  await fs.rm(path.join(legacyDirectory, "mcp.json"), { force: true }).catch(() => {});

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

// 1. All detected
export async function installAllDetectedIntegrations(
  context: vscode.ExtensionContext,
): Promise<{ installedClients: string[] }> {
  const { paths } = await setupBaseMcpServer(context);
  const copilotConfigPath = getCopilotConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath);
  const installedClients: string[] = [];

  for (const driver of drivers) {
    if (driver.isDetected()) {
      await driver.install(paths.targetMcpScript);
      installedClients.push(driver.name);
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
  const claudeDriver = new ClaudeClientDriver();
  await claudeDriver.install(paths.targetMcpScript);
}

// 6. Windsurf
export async function installWindsurfIntegration(
  context: vscode.ExtensionContext,
): Promise<void> {
  const { paths } = await setupBaseMcpServer(context);
  const windsurfDriver = new WindsurfClientDriver();
  await windsurfDriver.install(paths.targetMcpScript);
}

// 7. Uninstall all detected integrations
export async function uninstallAllDetectedIntegrations(
  context?: vscode.ExtensionContext,
  options?: { cleanupBase?: boolean; userHome?: string },
): Promise<{ uninstalledClients: string[] }> {
  const copilotConfigPath = getCopilotConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath);
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
  baseCurrent: boolean;
  clients: ClientVerificationReport[];
}> {
  const paths = getBaseIntegrationPaths(context);
  const [skillCurrent, baseCurrent] = await Promise.all([
    skillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
  ]);
  const assetsCurrent = skillCurrent && baseCurrent;
  const copilotConfigPath = getCopilotConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath);
  const clients: ClientVerificationReport[] = [];

  for (const driver of drivers) {
    const isDetected = driver.isDetected();
    const checkResult = await driver.check(paths.targetMcpScript);
    const status = checkResult.status === "ready" && !assetsCurrent
      ? "outdated"
      : checkResult.status;
    clients.push({
      id: driver.id,
      name: driver.name,
      isDetected,
      status,
      ...(checkResult.detail ? { detail: checkResult.detail } : {}),
    });
  }

  return { skillCurrent, baseCurrent, clients };
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
