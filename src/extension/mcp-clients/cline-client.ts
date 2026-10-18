import fsSync from "node:fs";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import { getVsCodeUserDirectory } from "./copilot-client";
import {
  hasJsonMcpServer,
  removeJsonMcpServer,
  upsertJsonMcpServer,
} from "./json-mcp-helper";

export function getClineSettingsPath(customConfigPath?: string): string {
  if (customConfigPath) return customConfigPath;
  return path.join(
    getVsCodeUserDirectory(),
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json",
  );
}

export class ClineClientDriver implements McpClientDriver {
  readonly id = "cline";
  readonly name = "Cline";

  constructor(private readonly customConfigPath?: string) {}

  get configPath(): string {
    return getClineSettingsPath(this.customConfigPath);
  }

  isDetected(): boolean {
    return fsSync.existsSync(this.configPath) || fsSync.existsSync(path.dirname(this.configPath));
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (configured) return { status: "ready" };
    return { status: "missing" };
  }

  async install(mcpScriptPath: string): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
  }

  async uninstall(): Promise<boolean> {
    return removeJsonMcpServer(this.configPath, "ai_artifacts");
  }
}
