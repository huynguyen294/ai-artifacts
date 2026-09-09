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
import { upsertJsonMcpServer } from "./mcp-clients/json-mcp-helper";

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

export function getCopilotConfigPath(context?: vscode.ExtensionContext): string {
  if (context?.globalStorageUri?.fsPath) {
    try {
      return path.resolve(context.globalStorageUri.fsPath, "..", "..", "mcp.json");
    } catch {}
  }
  return getVsCodeUserMcpPath();
}

export function getBaseIntegrationPaths(context: vscode.ExtensionContext): BaseIntegrationPaths {
  const targetDirectory = path.join(os.homedir(), ".vscode", "ai-artifacts");
  const agentSkillsDirectory = path.join(os.homedir(), ".agents", "skills");
  return {
    targetDirectory,
    targetMcpScript: path.join(targetDirectory, "ai-artifacts-review-mcp.mjs"),
    targetLegacyMcpScript: path.join(targetDirectory, "codex-artifacts-review-mcp.mjs"),
    targetSkill: path.join(agentSkillsDirectory, "create-review-artifact"),
    targetLegacySkill: path.join(agentSkillsDirectory, "create-plan-artifact"),
    workspacesDirectory: path.join(targetDirectory, "workspaces"),
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

export async function baseAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  const skillFiles = [
    "SKILL.md",
    path.join("references", "artifact-contract.md"),
    path.join("agents", "openai.yaml"),
  ];
  const checks = [
    sameFile(paths.sourceMcpScript, paths.targetMcpScript),
    ...skillFiles.map((relativePath) =>
      sameFile(
        path.join(paths.sourceSkill, relativePath),
        path.join(paths.targetSkill, relativePath),
      ),
    ),
  ];
  return (await Promise.all(checks)).every(Boolean);
}

export async function setupBaseMcpServer(
  context: vscode.ExtensionContext,
): Promise<{ paths: BaseIntegrationPaths; assetsUpdated: boolean }> {
  const paths = getBaseIntegrationPaths(context);

  await fs.mkdir(paths.targetDirectory, { recursive: true });
  await fs.mkdir(paths.workspacesDirectory, { recursive: true });

  // Copy primary server script and backward-compatible alias
  await fs.copyFile(paths.sourceMcpScript, paths.targetMcpScript);
  await fs.copyFile(paths.sourceMcpScript, paths.targetLegacyMcpScript);

  // Deploy Agent Skill to ~/.agents/skills/create-review-artifact
  await fs.mkdir(path.dirname(paths.targetSkill), { recursive: true });
  await fs.cp(paths.sourceSkill, paths.targetSkill, { recursive: true, force: true });

  // Clean up legacy skill if present
  await fs.rm(paths.targetLegacySkill, { recursive: true, force: true }).catch(() => {});

  // Clean up obsolete ~/.vscode/ai-artifacts/mcp.json if it exists
  await fs.rm(path.join(paths.targetDirectory, "mcp.json"), { force: true }).catch(() => {});

  return { paths, assetsUpdated: true };
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
  baseCurrent: boolean;
  clients: ClientVerificationReport[];
}> {
  const paths = getBaseIntegrationPaths(context);
  const baseCurrent = await baseAssetsAreCurrent(paths);
  const copilotConfigPath = getCopilotConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath);
  const clients: ClientVerificationReport[] = [];

  for (const driver of drivers) {
    const isDetected = driver.isDetected();
    const checkResult = await driver.check(paths.targetMcpScript);
    clients.push({
      id: driver.id,
      name: driver.name,
      isDetected,
      status: checkResult.status,
      ...(checkResult.detail ? { detail: checkResult.detail } : {}),
    });
  }

  return { baseCurrent, clients };
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
