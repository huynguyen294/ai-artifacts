import fsSync from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { ClientUpgradeContext, ClientUpgradeResult, McpClientDriver } from "./index";
import {
  hasJsonMcpServer,
  removeJsonMcpServer,
  upsertJsonMcpServer,
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

export class ClaudeClientDriver implements McpClientDriver {
  readonly id = "claude";
  readonly name = "Claude";

  constructor(
    private readonly customConfigPath?: string,
    private readonly customSkillDirectory?: string,
    private readonly sourceSkillDirectory?: string,
    private readonly customSessionSkillDirectory?: string,
    private readonly sourceSessionSkillDirectory?: string,
  ) {}

  get configPath(): string {
    return this.customConfigPath || path.join(os.homedir(), ".claude.json");
  }

  get skillDirectory(): string {
    if (this.customSkillDirectory) return this.customSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    return path.join(baseHome, ".claude", "skills", "create-review-artifact");
  }

  get sessionSkillDirectory(): string {
    if (this.customSessionSkillDirectory) return this.customSessionSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    return path.join(baseHome, ".claude", "skills", "work-session");
  }

  get sourceSkill(): string {
    if (this.sourceSkillDirectory) return this.sourceSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    const deployedSkill = path.join(baseHome, ".agents", "skills", "create-review-artifact");
    const candidates = [
      path.resolve(__dirname, "..", "..", "..", "skills", "create-review-artifact"),
      path.resolve(__dirname, "..", "skills", "create-review-artifact"),
      path.resolve(__dirname, "..", "..", "skills", "create-review-artifact"),
    ];
    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) return candidate;
    }
    return deployedSkill;
  }

  get sourceSessionSkill(): string {
    if (this.sourceSessionSkillDirectory) return this.sourceSessionSkillDirectory;
    const baseHome = path.dirname(this.configPath);
    const deployedSkill = path.join(baseHome, ".agents", "skills", "work-session");
    const candidates = [
      path.resolve(__dirname, "..", "..", "..", "skills", "work-session"),
      path.resolve(__dirname, "..", "skills", "work-session"),
      path.resolve(__dirname, "..", "..", "skills", "work-session"),
    ];
    for (const candidate of candidates) {
      if (fsSync.existsSync(candidate)) return candidate;
    }
    return deployedSkill;
  }

  isDetected(): boolean {
    if (this.customConfigPath || this.customSkillDirectory) {
      return (
        fsSync.existsSync(this.configPath) ||
        fsSync.existsSync(this.skillDirectory) ||
        fsSync.existsSync(path.dirname(this.skillDirectory))
      );
    }
    return (
      fsSync.existsSync(path.join(os.homedir(), ".claude.json")) ||
      fsSync.existsSync(path.join(os.homedir(), ".claude"))
    );
  }

  private resolvePackagedSkillSource(): string | undefined {
    return this.sourceSkillDirectory ?? findPackagedSkillDirectory("create-review-artifact", __dirname);
  }

  private resolvePackagedSessionSkillSource(): string | undefined {
    return this.sourceSessionSkillDirectory ?? findPackagedSkillDirectory("work-session", __dirname);
  }

  private async checkDefinition(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (!configured) return { status: "missing" };
    return { status: "ready" };
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const definition = await this.checkDefinition(mcpScriptPath);
    if (definition.status !== "ready") return definition;

    const skillMain = path.join(this.skillDirectory, "SKILL.md");
    if (!fsSync.existsSync(skillMain)) {
      return { status: "missing", detail: "Claude skill directory is missing SKILL.md." };
    }

    const sessionSkillMain = path.join(this.sessionSkillDirectory, "SKILL.md");
    if (!fsSync.existsSync(sessionSkillMain)) {
      return { status: "missing", detail: "Claude work-session skill directory is missing SKILL.md." };
    }

    const source = this.sourceSkill;
    if (fsSync.existsSync(source) && !await skillDirectoryIsCurrent(source, this.skillDirectory)) {
      return { status: "outdated", detail: "Claude review skill assets are outdated." };
    }

    const sourceSession = this.sourceSessionSkill;
    if (fsSync.existsSync(sourceSession) && !await officialSkillDirectoryIsCurrent(sourceSession, this.sessionSkillDirectory)) {
      return { status: "outdated", detail: "Claude work-session skill assets are outdated." };
    }

    return { status: "ready" };
  }

  async install(
    mcpScriptPath: string,
    sourceSkillPath?: string,
    sourceSessionSkillPath?: string,
  ): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    const source = sourceSkillPath || this.sourceSkill;
    if (source && fsSync.existsSync(source)) {
      await replaceSkillDirectory(source, this.skillDirectory);
    }
    const sourceSession = sourceSessionSkillPath || this.sourceSessionSkill;
    if (sourceSession && fsSync.existsSync(sourceSession)) {
      await replaceOfficialSkillDirectory(sourceSession, this.sessionSkillDirectory);
    }
  }

  async upgrade(context: ClientUpgradeContext): Promise<ClientUpgradeResult> {
    const definition = await this.checkDefinition(context.mcpScriptPath);
    if (definition.status !== "ready") {
      return {
        status: "setup-required",
        detail: definition.detail ?? "Claude MCP configuration is missing or needs setup.",
      };
    }

    if (!context.updateReviewSkill && !context.updateSessionSkill) {
      return { status: "unchanged" };
    }

    const reviewSource = context.updateReviewSkill
      ? await assertSkillSourceAssetsPresent(
          "create-review-artifact",
          this.resolvePackagedSkillSource(),
          REVIEW_SKILL_ASSETS,
          "Claude",
        )
      : undefined;
    const sessionSource = context.updateSessionSkill
      ? await assertSkillSourceAssetsPresent(
          "work-session",
          this.resolvePackagedSessionSkillSource(),
          WORK_SESSION_SKILL_ASSETS,
          "Claude",
        )
      : undefined;

    if (reviewSource) {
      await replaceSkillDirectory(reviewSource, this.skillDirectory);
    }
    if (sessionSource) {
      await replaceOfficialSkillDirectory(sessionSource, this.sessionSkillDirectory);
    }

    return { status: "updated" };
  }

  async uninstall(): Promise<boolean> {
    const removedMcp = await removeJsonMcpServer(this.configPath, "ai_artifacts");
    let removedSkill = false;
    if (fsSync.existsSync(this.skillDirectory)) {
      await fs.rm(this.skillDirectory, { recursive: true, force: true });
      removedSkill = true;
    }
    if (fsSync.existsSync(this.sessionSkillDirectory)) {
      await fs.rm(this.sessionSkillDirectory, { recursive: true, force: true });
      removedSkill = true;
    }
    return removedMcp || removedSkill;
  }
}
