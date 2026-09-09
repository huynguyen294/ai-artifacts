import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IntegrationCheck } from "../global-integration-status";
import type { McpClientDriver } from "./index";
import { hasJsonMcpServer, upsertJsonMcpServer } from "./json-mcp-helper";

export class ClaudeClientDriver implements McpClientDriver {
  readonly id = "claude";
  readonly name = "Claude";

  get configPath(): string {
    return path.join(os.homedir(), ".claude.json");
  }

  isDetected(): boolean {
    return (
      fs.existsSync(path.join(os.homedir(), ".claude.json")) ||
      fs.existsSync(path.join(os.homedir(), ".claude"))
    );
  }

  async check(mcpScriptPath: string): Promise<IntegrationCheck> {
    const configured = await hasJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
    if (configured) return { status: "ready" };
    return { status: "missing" };
  }

  async install(mcpScriptPath: string): Promise<void> {
    await upsertJsonMcpServer(this.configPath, "ai_artifacts", mcpScriptPath);
  }
}
