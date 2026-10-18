import type { IntegrationCheck } from "../global-integration-status";
import { CodexClientDriver } from "./codex-client";
import { CursorClientDriver } from "./cursor-client";
import { ClaudeClientDriver } from "./claude-client";
import { WindsurfClientDriver } from "./windsurf-client";
import { CopilotClientDriver } from "./copilot-client";
import { ClineClientDriver } from "./cline-client";

export interface McpClientDriver {
  readonly id: string;
  readonly name: string;
  readonly configPath: string;
  isDetected(): boolean;
  check(mcpScriptPath: string): Promise<IntegrationCheck>;
  install(mcpScriptPath: string): Promise<void>;
  uninstall(): Promise<boolean>;
}

export { CodexClientDriver } from "./codex-client";
export { CursorClientDriver } from "./cursor-client";
export { ClaudeClientDriver } from "./claude-client";
export { WindsurfClientDriver } from "./windsurf-client";
export { CopilotClientDriver, getVsCodeUserDirectory, getVsCodeUserMcpPath } from "./copilot-client";
export { ClineClientDriver, getClineSettingsPath } from "./cline-client";

export function getAllClientDrivers(
  copilotConfigPath?: string,
  clineConfigPath?: string,
  sourceSkillDirectory?: string,
): McpClientDriver[] {
  return [
    new CopilotClientDriver(copilotConfigPath),
    new CursorClientDriver(),
    new CodexClientDriver(),
    new ClaudeClientDriver(undefined, undefined, sourceSkillDirectory),
    new WindsurfClientDriver(),
    new ClineClientDriver(clineConfigPath),
  ];
}

