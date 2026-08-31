import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import {
  classifyGlobalIntegration,
  type IntegrationCheck,
} from "./global-integration-status";
import {
  CODEX_ARTIFACTS_HOOK_MARKER,
  LEGACY_AGENT_PLUS_HOOK_MARKER,
  removeCodexArtifactsHooks,
  type HooksFile,
} from "./hook-config";
import {
  hasManagedCodexArtifactsMcp,
  upsertCodexArtifactsMcp,
} from "./mcp-config";

function codexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".codex");
}

type IntegrationPaths = {
  targetDirectory: string;
  targetMcpScript: string;
  targetLegacyHookScript: string;
  targetSkill: string;
  targetLegacySkill: string;
  hooksPath: string;
  configPath: string;
  sourceMcpScript: string;
  sourceSkill: string;
};

function integrationPaths(context: vscode.ExtensionContext): IntegrationPaths {
  const globalCodexDirectory = codexHome();
  const targetDirectory = path.join(globalCodexDirectory, "codex-artifacts");
  const agentSkillsDirectory = path.join(os.homedir(), ".agents", "skills");
  return {
    targetDirectory,
    targetMcpScript: path.join(targetDirectory, "codex-artifacts-review-mcp.mjs"),
    targetLegacyHookScript: path.join(targetDirectory, CODEX_ARTIFACTS_HOOK_MARKER),
    targetSkill: path.join(agentSkillsDirectory, "create-review-artifact"),
    targetLegacySkill: path.join(agentSkillsDirectory, "create-plan-artifact"),
    hooksPath: path.join(globalCodexDirectory, "hooks.json"),
    configPath: path.join(globalCodexDirectory, "config.toml"),
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
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function installedAssetsAreCurrent(paths: IntegrationPaths): Promise<boolean> {
  const skillFiles = [
    "SKILL.md",
    path.join("references", "artifact-contract.md"),
    path.join("agents", "openai.yaml"),
  ];
  const checks = [
    sameFile(paths.sourceMcpScript, paths.targetMcpScript),
    ...skillFiles.map((relativePath) => sameFile(
      path.join(paths.sourceSkill, relativePath),
      path.join(paths.targetSkill, relativePath),
    )),
  ];
  return (await Promise.all(checks)).every(Boolean);
}

async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function readHooksFile(hooksPath: string): Promise<HooksFile> {
  const contents = await readTextFile(hooksPath);
  return contents ? JSON.parse(contents) as HooksFile : {};
}

async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.codex-artifacts-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, "utf8");
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.rename(temporaryPath, filePath);
        return;
      } catch (error: any) {
        if (attempt < 2 && (error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES")) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY" || error?.code === "EXDEV") {
          await fs.copyFile(temporaryPath, filePath);
          return;
        }
        throw error;
      }
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

async function removeManagedHooks(hooksPath: string): Promise<boolean> {
  const existing = await readHooksFile(hooksPath);
  const migration = removeCodexArtifactsHooks(existing);
  if (migration.changed) {
    await writeTextFile(hooksPath, `${JSON.stringify(migration.config, null, 2)}\n`);
  }
  return migration.changed;
}

async function removeWorkspaceLegacyIntegration(
  workspaceRoot: string,
  globalHooksPath: string,
  globalSkillPath: string,
): Promise<void> {
  const workspaceHooksPath = path.join(workspaceRoot, ".codex", "hooks.json");
  if (path.resolve(workspaceHooksPath) === path.resolve(globalHooksPath)) return;
  const hadManagedWorkspaceHook = await removeManagedHooks(workspaceHooksPath);
  if (!hadManagedWorkspaceHook) return;

  const workspaceCurrentSkill = path.join(workspaceRoot, ".agents", "skills", "create-review-artifact");
  const removals: Promise<void>[] = [
    fs.rm(path.join(workspaceRoot, ".codex", "hooks", LEGACY_AGENT_PLUS_HOOK_MARKER), { force: true }),
    fs.rm(path.join(workspaceRoot, ".codex", "hooks", CODEX_ARTIFACTS_HOOK_MARKER), { force: true }),
    fs.rm(path.join(workspaceRoot, ".agents", "skills", "create-plan-artifact"), { recursive: true, force: true }),
  ];
  if (path.resolve(workspaceCurrentSkill) !== path.resolve(globalSkillPath)) {
    removals.push(fs.rm(workspaceCurrentSkill, { recursive: true, force: true }));
  }
  await Promise.all(removals);
}

function configurationConflict(config: string): string | undefined {
  const withoutManaged = config.replace(
    /# >>> Codex Artifacts review MCP >>>[\s\S]*?# <<< Codex Artifacts review MCP <<</g,
    "",
  );
  return /^\s*\[mcp_servers\.codex_artifacts\]\s*$/m.test(withoutManaged)
    ? "config.toml defines mcp_servers.codex_artifacts outside the extension-managed block."
    : undefined;
}

export async function checkGlobalIntegration(
  context: vscode.ExtensionContext,
): Promise<IntegrationCheck> {
  const paths = integrationPaths(context);
  const config = await readTextFile(paths.configPath);
  const conflict = configurationConflict(config);
  return classifyGlobalIntegration({
    configured: hasManagedCodexArtifactsMcp(config, paths.targetMcpScript),
    assetsCurrent: await installedAssetsAreCurrent(paths),
    ...(conflict ? { configurationConflict: conflict } : {}),
  });
}

export async function installGlobalIntegration(
  context: vscode.ExtensionContext,
): Promise<IntegrationCheck> {
  const paths = integrationPaths(context);
  const existingConfig = await readTextFile(paths.configPath);
  const conflict = configurationConflict(existingConfig);
  if (conflict) return classifyGlobalIntegration({ configured: false, assetsCurrent: false, configurationConflict: conflict });

  await fs.mkdir(paths.targetDirectory, { recursive: true });
  await fs.copyFile(paths.sourceMcpScript, paths.targetMcpScript);
  await fs.mkdir(path.dirname(paths.targetSkill), { recursive: true });
  await fs.cp(paths.sourceSkill, paths.targetSkill, { recursive: true, force: true });
  await writeTextFile(paths.configPath, upsertCodexArtifactsMcp(existingConfig, paths.targetMcpScript));

  await removeManagedHooks(paths.hooksPath);
  await Promise.all([
    fs.rm(paths.targetLegacyHookScript, { force: true }),
    fs.rm(paths.targetLegacySkill, { recursive: true, force: true }),
  ]);

  const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  await Promise.all(workspaceRoots.map((workspaceRoot) => removeWorkspaceLegacyIntegration(
    workspaceRoot,
    paths.hooksPath,
    paths.targetSkill,
  )));

  const installed = await checkGlobalIntegration(context);
  return installed.status === "ready" ? { status: "restart-required" } : installed;
}
