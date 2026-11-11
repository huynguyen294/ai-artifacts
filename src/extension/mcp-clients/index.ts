import type { McpClientId } from "../../shared/contracts";
import type { IntegrationCheck } from "../global-integration-status";
import { CodexClientDriver } from "./codex-client";
import { CursorClientDriver } from "./cursor-client";
import { ClaudeClientDriver } from "./claude-client";
import { WindsurfClientDriver } from "./windsurf-client";
import { CopilotClientDriver } from "./copilot-client";
import { ClineClientDriver } from "./cline-client";
import { AntigravityClientDriver } from "./antigravity-client";

export type ClientUpgradeContext = {
  mcpScriptPath: string;
  previousMcpVersion: number;
  targetMcpVersion: number;
  updateReviewSkill: boolean;
  updateSessionSkill: boolean;
};

export type ClientUpgradeResult = {
  status: "unchanged" | "updated";
  detail?: string;
};

export interface McpClientDriver {
  readonly id: McpClientId;
  readonly name: string;
  readonly configPath: string;
  isDetected(): boolean;
  check(mcpScriptPath: string): Promise<IntegrationCheck>;
  install(mcpScriptPath: string): Promise<void>;
  upgrade(context: ClientUpgradeContext): Promise<ClientUpgradeResult>;
  uninstall(): Promise<boolean>;
}

export { CodexClientDriver } from "./codex-client";
export { CursorClientDriver } from "./cursor-client";
export { ClaudeClientDriver } from "./claude-client";
export { WindsurfClientDriver } from "./windsurf-client";
export { CopilotClientDriver, getVsCodeUserDirectory, getVsCodeUserMcpPath } from "./copilot-client";
export { ClineClientDriver, getClineSettingsPath } from "./cline-client";
export {
  AntigravityClientDriver,
  ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
  type AntigravityClientDriverOptions,
} from "./antigravity-client";

export function getAllClientDrivers(
  copilotConfigPath?: string,
  clineConfigPath?: string,
  sourceSkillDirectory?: string,
  sourceSessionSkillDirectory?: string,
): McpClientDriver[] {
  return [
    new CopilotClientDriver(copilotConfigPath),
    new CursorClientDriver(),
    new CodexClientDriver(),
    new ClaudeClientDriver(undefined, undefined, sourceSkillDirectory, undefined, sourceSessionSkillDirectory),
    new WindsurfClientDriver(),
    new ClineClientDriver(clineConfigPath),
    new AntigravityClientDriver({
      sourceSkillDirectory,
      sourceSessionSkillDirectory,
    }),
  ];
}

