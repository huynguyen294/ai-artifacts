import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import type { IntegrationCheck } from "./global-integration-status";
import {
  AntigravityClientDriver,
  ClaudeClientDriver,
  getAllClientDrivers,
  getClineSettingsPath,
  getVsCodeUserMcpPath,
  type McpClientDriver,
} from "./mcp-clients/index";
import {
  normalizePathForComparison,
  readJsonConfig,
  writeTextFileAtomic,
} from "./mcp-clients/json-mcp-helper";
import {
  hasManagedCodexArtifactsMcp,
  needsCodexArtifactsMcpUpgrade,
} from "./mcp-config";
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
  aiArtifactsRoot,
  managedAssetsRoot,
  managedIntegrationVersionPath,
  managedMcpScriptPath,
  managedWorkspaceRegistryDirectory,
  OWNER_ONLY_FILE_MODE,
} from "../shared/artifact-files";
import { ensureManagedDirectory } from "../shared/artifact-validation";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  INTEGRATION_VERSION_SCHEMA_VERSION,
  MCP_CLIENT_IDS,
  MCP_VERSION,
  SKILL_VERSION,
  WORK_SESSION_SKILL_VERSION,
  integrationVersionManifestSchema,
  type InstalledSkillVersions,
  type IntegrationVersionManifest,
  type McpClientId,
} from "../shared/contracts";
import {
  addInstalledClient,
  readInstalledClients,
  removeInstalledClient,
} from "./installed-client-state";
import {
  computeStaleIntegrationAssets,
  type StaleIntegrationAsset,
} from "./upgrade-notification";

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

export async function skillAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return skillDirectoryIsCurrent(paths.sourceSkill, paths.targetSkill);
}

export async function sessionSkillAssetsAreCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return officialSkillDirectoryIsCurrent(paths.sourceSessionSkill, paths.targetSessionSkill);
}

export async function baseScriptIsCurrent(paths: BaseIntegrationPaths): Promise<boolean> {
  return sameFile(paths.sourceMcpScript, paths.targetMcpScript);
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

type SharedAssetSyncSelection = {
  syncMcp: boolean;
  syncReviewSkill: boolean;
  syncSessionSkill: boolean;
};

async function validateSharedIntegrationSources(
  paths: BaseIntegrationPaths,
  selection: SharedAssetSyncSelection,
): Promise<void> {
  const preflightChecks: Promise<void>[] = [];
  if (selection.syncMcp) {
    preflightChecks.push(fs.access(paths.sourceMcpScript));
  }
  if (selection.syncReviewSkill) {
    for (const relativePath of REVIEW_SKILL_ASSETS) {
      preflightChecks.push(fs.access(path.join(paths.sourceSkill, relativePath)));
    }
  }
  if (selection.syncSessionSkill) {
    for (const relativePath of WORK_SESSION_SKILL_ASSETS) {
      preflightChecks.push(fs.access(path.join(paths.sourceSessionSkill, relativePath)));
    }
  }
  await Promise.all(preflightChecks);
}

async function syncSharedIntegrationAssets(
  paths: BaseIntegrationPaths,
  selection: SharedAssetSyncSelection,
  userHome: string,
  options?: { skipPreflight?: boolean; deferMcpReceipt?: boolean },
): Promise<StaleIntegrationAsset[]> {
  const { syncMcp, syncReviewSkill, syncSessionSkill } = selection;
  if (!syncMcp && !syncReviewSkill && !syncSessionSkill) {
    return [];
  }

  // Validate every packaged source needed for this operation before writing.
  if (!options?.skipPreflight) {
    await validateSharedIntegrationSources(paths, selection);
  }

  await ensureManagedDirectory(aiArtifactsRoot({ userHome }));
  await ensureManagedDirectory(paths.targetDirectory);

  if (syncMcp) {
    await ensureManagedDirectory(path.dirname(paths.targetMcpScript));
    const mcpContents = await fs.readFile(paths.sourceMcpScript, "utf8");
    await writeTextFileAtomic(paths.targetMcpScript, mcpContents, OWNER_ONLY_FILE_MODE);
  }
  if (syncReviewSkill) {
    await replaceSkillDirectory(paths.sourceSkill, paths.targetSkill);
  }
  if (syncSessionSkill) {
    await replaceOfficialSkillDirectory(paths.sourceSessionSkill, paths.targetSessionSkill);
  }

  const receiptPatch: {
    mcpVersion?: number;
    skills?: Partial<InstalledSkillVersions>;
    sessionSkills?: Partial<InstalledSkillVersions>;
  } = {};
  const syncedAssets: StaleIntegrationAsset[] = [];

  if (syncMcp) {
    if (!options?.deferMcpReceipt) {
      receiptPatch.mcpVersion = MCP_VERSION;
    }
    syncedAssets.push("mcp");
  }
  if (syncReviewSkill) {
    receiptPatch.skills = { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION };
    syncedAssets.push("skill:agents");
  }
  if (syncSessionSkill) {
    receiptPatch.sessionSkills = { agents: WORK_SESSION_SKILL_VERSION };
    syncedAssets.push("session-skill:agents");
  }

  if (
    receiptPatch.mcpVersion !== undefined ||
    receiptPatch.skills !== undefined ||
    receiptPatch.sessionSkills !== undefined
  ) {
    await writeInstalledIntegrationVersion(receiptPatch, { userHome });
  }
  return syncedAssets;
}

export async function setupBaseMcpServer(
  context: vscode.ExtensionContext,
  options?: { userHome?: string },
): Promise<{ paths: BaseIntegrationPaths }> {
  const userHome = options?.userHome ?? os.homedir();
  const paths = getBaseIntegrationPaths(context, { userHome });
  const fullSelection: SharedAssetSyncSelection = {
    syncMcp: true,
    syncReviewSkill: true,
    syncSessionSkill: true,
  };

  await syncSharedIntegrationAssets(paths, fullSelection, userHome);
  await ensureManagedDirectory(paths.workspacesDirectory);

  // Clean up legacy runtime, skill, and obsolete config files if present.
  await fs.rm(paths.targetLegacyMcpScript, { force: true }).catch(() => {});
  await fs.rm(paths.targetLegacySkill, { recursive: true, force: true }).catch(() => {});
  const legacyDirectory = path.join(userHome, ".vscode", "ai-artifacts");
  await fs.rm(path.join(legacyDirectory, "mcp.json"), { force: true }).catch(() => {});

  return { paths };
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

export type IntegrationMutationOptions = {
  recordClientSelection?: boolean;
};

async function installClientAndRecordState(
  driver: McpClientDriver,
  targetMcpScript: string,
  options: {
    userHome: string;
    recordClientSelection: boolean;
  },
): Promise<void> {
  await driver.install(targetMcpScript);
  if (driver.id === "claude") {
    await writeInstalledIntegrationVersion(
      {
        skills: { claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { claude: WORK_SESSION_SKILL_VERSION },
      },
      { userHome: options.userHome },
    );
  } else if (driver.id === "antigravity") {
    await writeInstalledIntegrationVersion(
      {
        skills: { antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { antigravity: WORK_SESSION_SKILL_VERSION },
      },
      { userHome: options.userHome },
    );
  }
  if (options.recordClientSelection) {
    await addInstalledClient(driver.id, { userHome: options.userHome });
  }
}

async function uninstallClient(
  driver: McpClientDriver,
  options: {
    userHome: string;
    recordClientSelection: boolean;
  },
): Promise<boolean> {
  const changed = await driver.uninstall();
  if (options.recordClientSelection) {
    await removeInstalledClient(driver.id, { userHome: options.userHome });
  }
  return changed;
}

export type SelectedIntegrationsInstallResult = {
  installedClients: Array<{ id: McpClientId; name: string }>;
  failedClients: Array<{ id: McpClientId; name: string; error: string }>;
};

export async function installSelectedIntegrations(
  context: vscode.ExtensionContext,
  clientIds: readonly McpClientId[],
  options?: IntegrationMutationOptions,
): Promise<SelectedIntegrationsInstallResult> {
  const userHome = os.homedir();
  const recordClientSelection = options?.recordClientSelection ?? false;
  const selectedIds = new Set(clientIds);
  const canonicalSelectedIds = MCP_CLIENT_IDS.filter((id) => selectedIds.has(id));
  if (canonicalSelectedIds.length === 0) {
    return { installedClients: [], failedClients: [] };
  }

  const { paths } = await setupBaseMcpServer(context, { userHome });
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths.sourceSkill,
    paths.sourceSessionSkill,
  );
  const selectedDrivers = drivers.filter((driver) => selectedIds.has(driver.id));

  const installedClients: Array<{ id: McpClientId; name: string }> = [];
  const failedClients: Array<{ id: McpClientId; name: string; error: string }> = [];

  for (const driver of selectedDrivers) {
    try {
      await installClientAndRecordState(driver, paths.targetMcpScript, {
        userHome,
        recordClientSelection,
      });
      installedClients.push({ id: driver.id, name: driver.name });
    } catch (error) {
      failedClients.push({
        id: driver.id,
        name: driver.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (installedClients.length > 0) {
    const legacyBaseDir = path.join(userHome, ".vscode", "ai-artifacts");
    await fs.rm(legacyBaseDir, { recursive: true, force: true }).catch(() => {});
  }

  return { installedClients, failedClients };
}

export type SelectedIntegrationsUninstallResult = {
  uninstalledClients: Array<{ id: McpClientId; name: string }>;
  notConfiguredClients: Array<{ id: McpClientId; name: string }>;
  failedClients: Array<{ id: McpClientId; name: string; error: string }>;
};

type ClientBaseUsageState = "in-use" | "indeterminate" | "absent";

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEntryUsesManagedRuntime(
  entry: unknown,
  normalizedTargets: readonly string[],
): boolean {
  if (!isPlainJsonObject(entry) || !Array.isArray(entry.args)) return false;
  return entry.args.some(
    (arg) => typeof arg === "string" && normalizedTargets.includes(normalizePathForComparison(arg)),
  );
}

function jsonConfigUsesManagedRuntime(
  config: Record<string, unknown>,
  normalizedTargets: readonly string[],
): boolean {
  if (
    isPlainJsonObject(config.mcpServers) &&
    jsonEntryUsesManagedRuntime(config.mcpServers.ai_artifacts, normalizedTargets)
  ) {
    return true;
  }
  if (
    isPlainJsonObject(config.servers) &&
    jsonEntryUsesManagedRuntime(config.servers.ai_artifacts, normalizedTargets)
  ) {
    return true;
  }
  return false;
}

function codexConfigUsesManagedRuntime(
  content: string,
  targetMcpScript: string,
  legacyMcpScript: string,
): boolean {
  if (
    hasManagedCodexArtifactsMcp(content, targetMcpScript) ||
    hasManagedCodexArtifactsMcp(content, legacyMcpScript)
  ) {
    return true;
  }
  const hasArtifactsTable = /^\s*\[mcp_servers\.(?:ai_artifacts|codex_artifacts)(?:\.|\s*\])/m.test(
    content,
  );
  if (!hasArtifactsTable) return false;

  const normalizedTargets = [
    normalizePathForComparison(targetMcpScript),
    normalizePathForComparison(legacyMcpScript),
  ];
  const argsMatches = content.matchAll(
    /^\s*args\s*=\s*\[\s*(?:"([^"]+)"|'([^']+)')(?:\s*,|\s*\])/gm,
  );
  for (const match of argsMatches) {
    const scriptArg = match[1] ?? match[2] ?? "";
    if (scriptArg && normalizedTargets.includes(normalizePathForComparison(scriptArg))) {
      return true;
    }
  }
  return false;
}

async function pathPresentOrIndeterminate(
  targetPath: string,
): Promise<"present" | "absent" | "indeterminate"> {
  try {
    await fs.lstat(targetPath);
    return "present";
  } catch (error: any) {
    if (error?.code === "ENOENT") return "absent";
    return "indeterminate";
  }
}

async function assessClientBaseUsage(
  driver: McpClientDriver,
  targetMcpScript: string,
  legacyMcpScript: string,
): Promise<ClientBaseUsageState> {
  const normalizedTargets = [
    normalizePathForComparison(targetMcpScript),
    normalizePathForComparison(legacyMcpScript),
  ];

  if (driver.id === "codex") {
    try {
      const content = await fs.readFile(driver.configPath, "utf8");
      if (codexConfigUsesManagedRuntime(content, targetMcpScript, legacyMcpScript)) {
        return "in-use";
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        return "indeterminate";
      }
    }
  } else {
    try {
      const config = await readJsonConfig(driver.configPath);
      if (!isPlainJsonObject(config)) {
        return "indeterminate";
      }
      if (jsonConfigUsesManagedRuntime(config, normalizedTargets)) {
        return "in-use";
      }
    } catch {
      return "indeterminate";
    }

    if (driver instanceof ClaudeClientDriver || driver instanceof AntigravityClientDriver) {
      const [reviewSkillState, sessionSkillState] = await Promise.all([
        pathPresentOrIndeterminate(driver.skillDirectory),
        pathPresentOrIndeterminate(driver.sessionSkillDirectory),
      ]);
      if (reviewSkillState === "indeterminate" || sessionSkillState === "indeterminate") {
        return "indeterminate";
      }
      if (reviewSkillState === "present" || sessionSkillState === "present") {
        return "in-use";
      }
    }
  }

  try {
    const checkResult = await driver.check(targetMcpScript);
    if (checkResult.status !== "missing") {
      return "in-use";
    }
  } catch {
    return "indeterminate";
  }

  return "absent";
}

export async function uninstallSelectedIntegrations(
  context: vscode.ExtensionContext | undefined,
  clientIds: readonly McpClientId[],
  options?: { cleanupBase?: boolean; userHome?: string; recordClientSelection?: boolean },
): Promise<SelectedIntegrationsUninstallResult> {
  const userHome = options?.userHome ?? os.homedir();
  const recordClientSelection = options?.recordClientSelection ?? false;
  const cleanupBase = options?.cleanupBase === true;
  const selectedIds = new Set(clientIds);
  const canonicalSelectedIds = MCP_CLIENT_IDS.filter((id) => selectedIds.has(id));
  if (canonicalSelectedIds.length === 0) {
    return {
      uninstalledClients: [],
      notConfiguredClients: [],
      failedClients: [],
    };
  }

  const paths = context?.extensionUri ? getBaseIntegrationPaths(context, { userHome }) : undefined;
  const targetMcpScript = paths?.targetMcpScript ?? managedMcpScriptPath({ userHome });
  const legacyMcpScript =
    paths?.targetLegacyMcpScript ??
    path.join(userHome, ".vscode", "ai-artifacts", "ai-artifacts-review-mcp.mjs");
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths?.sourceSkill,
    paths?.sourceSessionSkill,
  );
  const selectedDrivers = drivers.filter((driver) => selectedIds.has(driver.id));

  let globalIndeterminate = false;
  const remainingClientsNeedingBase = new Set<McpClientId>();
  if (cleanupBase) {
    try {
      await readInstalledClients({ userHome });
    } catch {
      globalIndeterminate = true;
    }

    const initialUsage = await Promise.all(
      drivers.map(async (driver) => ({
        id: driver.id,
        state: await assessClientBaseUsage(driver, targetMcpScript, legacyMcpScript),
      })),
    );
    for (const { id, state } of initialUsage) {
      if (state === "in-use" || state === "indeterminate") {
        remainingClientsNeedingBase.add(id);
      }
    }
  }

  const uninstalledClients: Array<{ id: McpClientId; name: string }> = [];
  const notConfiguredClients: Array<{ id: McpClientId; name: string }> = [];
  const failedClients: Array<{ id: McpClientId; name: string; error: string }> = [];

  for (const driver of selectedDrivers) {
    try {
      const changed = await uninstallClient(driver, { userHome, recordClientSelection });
      if (changed) {
        uninstalledClients.push({ id: driver.id, name: driver.name });
      } else {
        notConfiguredClients.push({ id: driver.id, name: driver.name });
      }
      if (cleanupBase) {
        const postState = await assessClientBaseUsage(driver, targetMcpScript, legacyMcpScript);
        if (postState === "absent") {
          remainingClientsNeedingBase.delete(driver.id);
        } else {
          remainingClientsNeedingBase.add(driver.id);
        }
      }
    } catch (error) {
      if (cleanupBase) {
        remainingClientsNeedingBase.add(driver.id);
      }
      failedClients.push({
        id: driver.id,
        name: driver.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    cleanupBase &&
    !globalIndeterminate &&
    failedClients.length === 0 &&
    remainingClientsNeedingBase.size === 0
  ) {
    await cleanupBaseMcpServer({ userHome });
  }

  return {
    uninstalledClients,
    notConfiguredClients,
    failedClients,
  };
}

export type ExistingInstalledIntegrationVersionReadResult = Exclude<
  InstalledIntegrationVersionReadResult,
  { status: "missing" }
>;

export type IntegrationUpgradeClientReport = {
  id: McpClientId;
  name: string;
  status: "unchanged" | "updated" | "failed";
  detail?: string;
};

export type IntegrationUpgradeReport = {
  clientIds: McpClientId[];
  skillTargets: Array<keyof InstalledSkillVersions>;
  updatedAssets: StaleIntegrationAsset[];
  clients: IntegrationUpgradeClientReport[];
};

export async function upgradeDetectedIntegrations(
  context: vscode.ExtensionContext,
  installedVersion: ExistingInstalledIntegrationVersionReadResult,
): Promise<IntegrationUpgradeReport> {
  const userHome = os.homedir();
  const paths = getBaseIntegrationPaths(context, { userHome });
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const allDrivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths.sourceSkill,
    paths.sourceSessionSkill,
  );
  const savedClientIds = new Set(await readInstalledClients({ userHome }));
  const selectedDrivers = allDrivers.filter(
    (driver) => savedClientIds.has(driver.id) || driver.isDetected(),
  );
  const clientIds = selectedDrivers.map((driver) => driver.id);

  if (selectedDrivers.length === 0) {
    return {
      clientIds: [],
      skillTargets: [],
      updatedAssets: [],
      clients: [],
    };
  }

  const clientIdSet = new Set(clientIds);
  const skillTargets: Array<keyof InstalledSkillVersions> = ["agents"];
  if (clientIdSet.has("claude")) skillTargets.push("claude");
  if (clientIdSet.has("antigravity")) skillTargets.push("antigravity");

  const manifest = installedVersion.status === "valid" ? installedVersion.manifest : undefined;
  const previousMcpVersion = manifest?.mcpVersion ?? 0;
  const staleAssets = computeStaleIntegrationAssets(
    {
      mcpVersion: MCP_VERSION,
      skillVersion: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
      sessionSkillVersion: WORK_SESSION_SKILL_VERSION,
    },
    manifest,
    skillTargets,
  );
  const staleSet = new Set<StaleIntegrationAsset>(staleAssets);
  const syncMcp = staleSet.has("mcp");
  const codexNeedsMigration =
    clientIdSet.has("codex") && needsCodexArtifactsMcpUpgrade(previousMcpVersion, MCP_VERSION);

  const updatedAssets: StaleIntegrationAsset[] = await syncSharedIntegrationAssets(
    paths,
    {
      syncMcp,
      syncReviewSkill: staleSet.has("skill:agents"),
      syncSessionSkill: staleSet.has("session-skill:agents"),
    },
    userHome,
    { deferMcpReceipt: true },
  );

  let codexDefinitionMigrationFailed = false;
  const clients: IntegrationUpgradeClientReport[] = [];
  for (const driver of selectedDrivers) {
    const updateReviewSkill =
      driver.id === "claude"
        ? staleSet.has("skill:claude")
        : driver.id === "antigravity"
          ? staleSet.has("skill:antigravity")
          : false;
    const updateSessionSkill =
      driver.id === "claude"
        ? staleSet.has("session-skill:claude")
        : driver.id === "antigravity"
          ? staleSet.has("session-skill:antigravity")
          : false;

    try {
      const upgradeResult = await driver.upgrade({
        mcpScriptPath: paths.targetMcpScript,
        previousMcpVersion,
        targetMcpVersion: MCP_VERSION,
        updateReviewSkill,
        updateSessionSkill,
      });

      if (driver.id === "claude" || driver.id === "antigravity") {
        if (updateReviewSkill || updateSessionSkill) {
          await ensureManagedDirectory(aiArtifactsRoot({ userHome }));
          await ensureManagedDirectory(paths.targetDirectory);
          await writeInstalledIntegrationVersion(
            {
              ...(updateReviewSkill
                ? { skills: { [driver.id]: CREATE_REVIEW_ARTIFACT_SKILL_VERSION } }
                : {}),
              ...(updateSessionSkill
                ? { sessionSkills: { [driver.id]: WORK_SESSION_SKILL_VERSION } }
                : {}),
            },
            { userHome },
          );
          if (updateReviewSkill) {
            updatedAssets.push(`skill:${driver.id}`);
          }
          if (updateSessionSkill) {
            updatedAssets.push(`session-skill:${driver.id}`);
          }
        }
      }

      clients.push({
        id: driver.id,
        name: driver.name,
        status: upgradeResult.status,
        ...(upgradeResult.detail ? { detail: upgradeResult.detail } : {}),
      });
    } catch (error) {
      if (driver.id === "codex" && codexNeedsMigration) {
        codexDefinitionMigrationFailed = true;
      }
      clients.push({
        id: driver.id,
        name: driver.name,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (syncMcp && !codexDefinitionMigrationFailed) {
    await ensureManagedDirectory(aiArtifactsRoot({ userHome }));
    await ensureManagedDirectory(paths.targetDirectory);
    await writeInstalledIntegrationVersion({ mcpVersion: MCP_VERSION }, { userHome });
  }

  return {
    clientIds,
    skillTargets,
    updatedAssets,
    clients,
  };
}

export type ClientVerificationReport = {
  id: string;
  name: string;
  isDetected: boolean;
  status: IntegrationCheck["status"];
  detail?: string;
};

export type InstallableClientDescriptor = {
  id: McpClientId;
  name: string;
  configPath: string;
  isDetected: boolean;
  isSaved: boolean;
};

export type InstallerClientDescriptor = {
  id: McpClientId;
  name: string;
  configPath: string;
  isDetected: boolean;
  isSaved: boolean;
  status: IntegrationCheck["status"];
  detail?: string;
};

export async function listInstallableClients(
  context: vscode.ExtensionContext,
): Promise<{ clients: InstallableClientDescriptor[] }> {
  const userHome = os.homedir();
  const savedClients = await readInstalledClients({ userHome });
  const savedSet = new Set(savedClients);
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(copilotConfigPath, clineConfigPath);

  return {
    clients: drivers.map((driver) => ({
      id: driver.id,
      name: driver.name,
      configPath: driver.configPath,
      isDetected: driver.isDetected(),
      isSaved: savedSet.has(driver.id),
    })),
  };
}

function formatOutdatedBaseAssetsDetail(
  skillCurrent: boolean,
  sessionSkillCurrent: boolean,
): string {
  if (!skillCurrent && !sessionSkillCurrent) {
    return "Shared review skill and work session skill are outdated or missing.";
  }
  if (!skillCurrent) {
    return "Shared review skill is outdated or missing.";
  }
  if (!sessionSkillCurrent) {
    return "Shared work session skill is outdated or missing.";
  }
  return "Base MCP runtime is outdated or missing.";
}

async function checkDriverSafely(
  driver: McpClientDriver,
  targetMcpScript: string,
): Promise<IntegrationCheck> {
  try {
    return await driver.check(targetMcpScript);
  } catch (error) {
    const detail = error instanceof Error ? error.message.trim() : String(error).trim();
    return {
      status: "configuration-conflict",
      detail: detail || `Failed to inspect ${driver.name} configuration.`,
    };
  }
}

export async function listInstallerClients(
  context: vscode.ExtensionContext,
): Promise<{
  skillCurrent: boolean;
  sessionSkillCurrent: boolean;
  baseCurrent: boolean;
  clients: InstallerClientDescriptor[];
}> {
  const userHome = os.homedir();
  const paths = getBaseIntegrationPaths(context, { userHome });
  const [skillCurrent, sessionSkillCurrent, baseCurrent, savedClients] = await Promise.all([
    skillAssetsAreCurrent(paths),
    sessionSkillAssetsAreCurrent(paths),
    baseScriptIsCurrent(paths),
    readInstalledClients({ userHome }),
  ]);
  const savedSet = new Set(savedClients);
  const assetsCurrent = skillCurrent && sessionSkillCurrent && baseCurrent;
  const copilotConfigPath = getCopilotConfigPath(context);
  const clineConfigPath = getClineConfigPath(context);
  const drivers = getAllClientDrivers(
    copilotConfigPath,
    clineConfigPath,
    paths.sourceSkill,
    paths.sourceSessionSkill,
  );
  const clients: InstallerClientDescriptor[] = [];

  for (const driver of drivers) {
    const isDetected = driver.isDetected();
    const isSaved = savedSet.has(driver.id);
    const checkResult = await checkDriverSafely(driver, paths.targetMcpScript);
    let detail = checkResult.detail;
    let status = checkResult.status;
    if (status === "ready" && !assetsCurrent) {
      status = "outdated";
      if (!detail) {
        detail = formatOutdatedBaseAssetsDetail(skillCurrent, sessionSkillCurrent);
      }
    }
    clients.push({
      id: driver.id,
      name: driver.name,
      configPath: driver.configPath,
      isDetected,
      isSaved,
      status,
      ...(detail ? { detail } : {}),
    });
  }

  return { skillCurrent, sessionSkillCurrent, baseCurrent, clients };
}

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
    const checkResult = await checkDriverSafely(driver, paths.targetMcpScript);
    let detail = checkResult.detail;
    let status = checkResult.status;
    if (status === "ready" && !assetsCurrent) {
      status = "outdated";
      if (!detail) {
        detail = formatOutdatedBaseAssetsDetail(skillCurrent, sessionSkillCurrent);
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
