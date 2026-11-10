import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { ClientUpgradeContext, ClientUpgradeResult, McpClientDriver } from "./index";
import {
  normalizePathForComparison,
  readJsonConfig,
  writeJsonConfig,
} from "./json-mcp-helper";
import {
  REVIEW_SKILL_ASSETS,
  WORK_SESSION_SKILL_ASSETS,
  assertSkillSourceAssetsPresent,
  findPackagedSkillDirectory,
  officialSkillDirectoryIsCurrent,
  replaceOfficialSkillDirectory,
  replaceSkillDirectory,
  skillDirectoryIsCurrent,
} from "./skill-helper";

export const ANTIGRAVITY_MCP_TIMEOUT_SECONDS = 3600;

export type AntigravityClientDriverOptions = {
  userHome?: string | undefined;
  sourceSkillDirectory?: string | undefined;
  sourceSessionSkillDirectory?: string | undefined;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectorySync(targetPath: string): boolean {
  try {
    return fsSync.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFileSync(targetPath: string): boolean {
  try {
    return fsSync.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

async function removeTargetIfExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(targetPath);
      return true;
    }
    await fs.rm(targetPath, { recursive: true, force: true });
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export class AntigravityClientDriver implements McpClientDriver {
  readonly id = "antigravity";
  readonly name = "Antigravity";

  constructor(private readonly options: AntigravityClientDriverOptions = {}) {}

  private get homeDirectory(): string {
    return this.options.userHome || os.homedir();
  }

  private get antigravityDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "antigravity");
  }

  get configPath(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "mcp_config.json");
  }

  get skillDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "skills", "create-review-artifact");
  }

  get sessionSkillDirectory(): string {
    return path.join(this.homeDirectory, ".gemini", "config", "skills", "work-session");
  }

  private resolveSkillSource(explicitPath?: string): string | undefined {
    return (
      explicitPath ??
      this.options.sourceSkillDirectory ??
      findPackagedSkillDirectory("create-review-artifact", __dirname)
    );
  }

  private resolveSessionSkillSource(explicitPath?: string): string | undefined {
    return (
      explicitPath ??
      this.options.sourceSessionSkillDirectory ??
      findPackagedSkillDirectory("work-session", __dirname)
    );
  }

  isDetected(): boolean {
    return (
      isFileSync(this.configPath) ||
      isDirectorySync(this.antigravityDirectory)
    );
  }

  private async checkDefinition(mcpScriptPath: string): Promise<IntegrationCheck> {
    const config = await readJsonConfig(this.configPath);
    if (!isPlainObject(config)) {
      return { status: "missing" };
    }
    const server = isPlainObject(config.mcpServers) ? config.mcpServers.ai_artifacts : undefined;
    if (!isPlainObject(server)) {
      return { status: "missing" };
    }

    const normalizedTarget = normalizePathForComparison(mcpScriptPath);
    const existingScript =
      Array.isArray(server.args) && server.args.length === 1 && typeof server.args[0] === "string"
        ? normalizePathForComparison(server.args[0])
        : "";
    if (server.command !== "node" || existingScript !== normalizedTarget) {
      return { status: "missing" };
    }

    if (server.timeoutSeconds !== ANTIGRAVITY_MCP_TIMEOUT_SECONDS) {
      return {
        status: "outdated",
        detail: `Antigravity MCP server timeoutSeconds must be ${ANTIGRAVITY_MCP_TIMEOUT_SECONDS}. Reinstall the Antigravity integration.`,
      };
    }

    return { status: "ready" };
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const definition = await this.checkDefinition(mcpScriptPath);
    if (definition.status !== "ready") {
      return definition;
    }

    const skillMain = path.join(this.skillDirectory, "SKILL.md");
    if (!isFileSync(skillMain)) {
      return { status: "missing", detail: "Antigravity skill directory is missing SKILL.md." };
    }

    const sessionSkillMain = path.join(this.sessionSkillDirectory, "SKILL.md");
    if (!isFileSync(sessionSkillMain)) {
      return {
        status: "missing",
        detail: "Antigravity work-session skill directory is missing SKILL.md.",
      };
    }

    const source = await assertSkillSourceAssetsPresent(
      "create-review-artifact",
      this.resolveSkillSource(),
      REVIEW_SKILL_ASSETS,
      "Antigravity",
    );
    const sourceSession = await assertSkillSourceAssetsPresent(
      "work-session",
      this.resolveSessionSkillSource(),
      WORK_SESSION_SKILL_ASSETS,
      "Antigravity",
    );

    if (!(await skillDirectoryIsCurrent(source, this.skillDirectory))) {
      return { status: "outdated", detail: "Antigravity review skill assets are outdated." };
    }

    if (!(await officialSkillDirectoryIsCurrent(sourceSession, this.sessionSkillDirectory))) {
      return { status: "outdated", detail: "Antigravity work-session skill assets are outdated." };
    }

    return { status: "ready" };
  }

  async install(
    mcpScriptPath: string,
    sourceSkillPath?: string,
    sourceSessionSkillPath?: string,
  ): Promise<void> {
    const source = await assertSkillSourceAssetsPresent(
      "create-review-artifact",
      this.resolveSkillSource(sourceSkillPath),
      REVIEW_SKILL_ASSETS,
      "Antigravity",
    );
    const sourceSession = await assertSkillSourceAssetsPresent(
      "work-session",
      this.resolveSessionSkillSource(sourceSessionSkillPath),
      WORK_SESSION_SKILL_ASSETS,
      "Antigravity",
    );

    const config = await readJsonConfig(this.configPath);
    if (!isPlainObject(config)) {
      throw new Error(`Configuration file at "${this.configPath}" must contain a JSON object.`);
    }
    if (!isPlainObject(config.mcpServers)) {
      config.mcpServers = {};
    }
    const existingEntry = isPlainObject(config.mcpServers.ai_artifacts)
      ? config.mcpServers.ai_artifacts
      : {};
    const normalizedPath = mcpScriptPath.replaceAll("\\", "/");
    config.mcpServers.ai_artifacts = {
      ...existingEntry,
      command: "node",
      args: [normalizedPath],
      timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
    };
    await writeJsonConfig(this.configPath, config);

    await replaceSkillDirectory(source, this.skillDirectory);
    await replaceOfficialSkillDirectory(sourceSession, this.sessionSkillDirectory);
  }

  async upgrade(context: ClientUpgradeContext): Promise<ClientUpgradeResult> {
    const definition = await this.checkDefinition(context.mcpScriptPath);
    if (definition.status !== "ready") {
      return {
        status: "setup-required",
        detail: definition.detail ?? "Antigravity MCP configuration is missing or needs setup.",
      };
    }

    if (!context.updateReviewSkill && !context.updateSessionSkill) {
      return { status: "unchanged" };
    }

    const source = context.updateReviewSkill
      ? await assertSkillSourceAssetsPresent(
          "create-review-artifact",
          this.resolveSkillSource(),
          REVIEW_SKILL_ASSETS,
          "Antigravity",
        )
      : undefined;
    const sourceSession = context.updateSessionSkill
      ? await assertSkillSourceAssetsPresent(
          "work-session",
          this.resolveSessionSkillSource(),
          WORK_SESSION_SKILL_ASSETS,
          "Antigravity",
        )
      : undefined;

    if (source) {
      await replaceSkillDirectory(source, this.skillDirectory);
    }
    if (sourceSession) {
      await replaceOfficialSkillDirectory(sourceSession, this.sessionSkillDirectory);
    }

    return { status: "updated" };
  }

  async uninstall(): Promise<boolean> {
    let removedMcp = false;
    const config = await readJsonConfig(this.configPath);
    if (
      isPlainObject(config) &&
      isPlainObject(config.mcpServers) &&
      Object.prototype.hasOwnProperty.call(config.mcpServers, "ai_artifacts")
    ) {
      delete config.mcpServers.ai_artifacts;
      await writeJsonConfig(this.configPath, config);
      removedMcp = true;
    }

    const removedReviewSkill = await removeTargetIfExists(this.skillDirectory);
    const removedSessionSkill = await removeTargetIfExists(this.sessionSkillDirectory);
    return removedMcp || removedReviewSkill || removedSessionSkill;
  }
}
