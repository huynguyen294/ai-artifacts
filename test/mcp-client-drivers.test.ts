import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasJsonMcpServer,
  readJsonConfig,
  removeJsonMcpServer,
  upsertJsonMcpServer,
  writeJsonConfig,
} from "../src/extension/mcp-clients/json-mcp-helper";
import {
  ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
  AntigravityClientDriver,
  getAllClientDrivers,
} from "../src/extension/mcp-clients/index";
import { CursorClientDriver } from "../src/extension/mcp-clients/cursor-client";
import { ClaudeClientDriver } from "../src/extension/mcp-clients/claude-client";
import { WindsurfClientDriver } from "../src/extension/mcp-clients/windsurf-client";
import { CodexClientDriver } from "../src/extension/mcp-clients/codex-client";
import { CopilotClientDriver } from "../src/extension/mcp-clients/copilot-client";
import { ClineClientDriver, getClineSettingsPath } from "../src/extension/mcp-clients/cline-client";
import { cleanupBaseMcpServer } from "../src/extension/mcp-clients/base-cleanup";
import {
  CODEX_UNEXPECTED_KEY_CONFLICT,
  CodexUnexpectedKeyConflictError,
} from "../src/extension/mcp-config";
import { runUninstall } from "../src/extension/uninstall-entry";
import { OFFICIAL_SKILL_DESCRIPTIONS, USER_CUSTOM_RULES_END } from "../src/extension/mcp-clients/skill-helper";

describe("JSON MCP Helper", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `ai-artifacts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns empty object for non-existent file", async () => {
    const config = await readJsonConfig(path.join(tempDir, "missing.json"));
    expect(config).toEqual({});
  });

  it("throws clear error when JSON syntax is corrupted", async () => {
    const corruptFile = path.join(tempDir, "corrupt.json");
    await fs.writeFile(corruptFile, "{ mcpServers: { broken }", "utf8");
    await expect(readJsonConfig(corruptFile)).rejects.toThrow("Invalid JSON syntax");
  });

  it.each(["[]", "null", "123", '"scalar"', "true"])(
    "rejects non-object JSON root %s in upsertJsonMcpServer without modifying the file",
    async (rawRoot) => {
      const targetFile = path.join(tempDir, "mcp.json");
      await fs.writeFile(targetFile, rawRoot, "utf8");

      await expect(
        upsertJsonMcpServer(targetFile, "ai_artifacts", "C:/path/to/ai-artifacts-review-mcp.mjs"),
      ).rejects.toThrow("must contain a JSON object");

      await expect(fs.readFile(targetFile, "utf8")).resolves.toBe(rawRoot);
    },
  );

  it("adds ai_artifacts server and preserves other servers and properties", async () => {
    const targetFile = path.join(tempDir, "nested", "mcp.json");
    const existing = {
      userID: "user-12345",
      mcpServers: {
        other_tool: {
          command: "python",
          args: ["-m", "other"],
        },
      },
    };
    await writeJsonConfig(targetFile, existing);

    const mcpScript = "C:/path/to/ai-artifacts-review-mcp.mjs";
    await upsertJsonMcpServer(targetFile, "ai_artifacts", mcpScript);

    const updated = await readJsonConfig(targetFile);
    expect(updated.userID).toBe("user-12345");
    expect(updated.mcpServers.other_tool).toEqual({ command: "python", args: ["-m", "other"] });
    expect(updated.mcpServers.ai_artifacts).toEqual({ command: "node", args: [mcpScript] });

    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", mcpScript)).toBe(true);
    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", "different/path.mjs")).toBe(false);
  });

  it("normalizes Windows backslashes when writing and checking MCP servers in .vscode/mcp.json", async () => {
    const targetFile = path.join(tempDir, ".vscode", "mcp.json");
    const windowsPath = "C:\\Users\\Admin\\.ai-artifacts\\managed\\runtime\\ai-artifacts-review-mcp.mjs";
    const forwardSlashPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";

    await upsertJsonMcpServer(targetFile, "ai_artifacts", windowsPath);

    const updated = await readJsonConfig(targetFile);
    expect(updated.mcpServers.ai_artifacts).toEqual({
      command: "node",
      args: [forwardSlashPath],
    });

    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", windowsPath)).toBe(true);
    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", forwardSlashPath)).toBe(true);
  });

  it("normalizes mixed slashes and case variations when checking MCP servers", async () => {
    const targetFile = path.join(tempDir, ".vscode", "mcp.json");
    const storedPath = "C:/Users/Admin/AppData/Roaming/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    const mixedQueryPath = "c:\\Users\\Admin/AppData\\Roaming/.ai-artifacts\\managed\\runtime\\ai-artifacts-review-mcp.mjs";

    await upsertJsonMcpServer(targetFile, "ai_artifacts", storedPath);

    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", mixedQueryPath)).toBe(true);
    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", storedPath)).toBe(true);
  });

  it("removes server key and leaves remaining keys intact", async () => {
    const targetFile = path.join(tempDir, "mcp.json");
    await writeJsonConfig(targetFile, {
      other: 123,
      mcpServers: {
        ai_artifacts: { command: "node", args: ["test.js"] },
        keep_me: { command: "node", args: ["keep.js"] },
      },
    });

    const removed = await removeJsonMcpServer(targetFile, "ai_artifacts");
    expect(removed).toBe(true);

    const updated = await readJsonConfig(targetFile);
    expect(updated.other).toBe(123);
    expect(updated.mcpServers.ai_artifacts).toBeUndefined();
    expect(updated.mcpServers.keep_me).toBeDefined();

    const removedAgain = await removeJsonMcpServer(targetFile, "ai_artifacts");
    expect(removedAgain).toBe(false);
  });
});

describe("Client Drivers", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `ai-artifacts-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("Cursor driver initializes mcp.json cleanly", async () => {
    const cursorDriver = new CursorClientDriver();
    const customConfig = path.join(tempHome, ".cursor", "mcp.json");
    // Override configPath getter via prototype or custom property for isolation
    Object.defineProperty(cursorDriver, "configPath", { value: customConfig });

    const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    await cursorDriver.install(scriptPath);

    const check = await cursorDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = await fs.readFile(customConfig, "utf8");
    const json = JSON.parse(content);
    expect(json.mcpServers.ai_artifacts.command).toBe("node");
    expect(json.mcpServers.ai_artifacts.args[0]).toBe(scriptPath);
  });

  it("Claude driver initializes .claude.json while preserving root keys", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const claudeDriver = new ClaudeClientDriver(customConfig);
    await fs.writeFile(customConfig, JSON.stringify({ opusProMigrationComplete: true }), "utf8");

    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    await claudeDriver.install(scriptPath);

    const check = await claudeDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = await fs.readFile(customConfig, "utf8");
    const json = JSON.parse(content);
    expect(json.opusProMigrationComplete).toBe(true);
    expect(json.mcpServers.ai_artifacts.command).toBe("node");
    expect(json.mcpServers.ai_artifacts.args[0]).toBe(scriptPath);

    const skillMain = path.join(claudeDriver.skillDirectory, "SKILL.md");
    expect((await fs.stat(skillMain)).isFile()).toBe(true);
  });

  it("Claude driver reports missing when MCP is configured but skill is absent", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const claudeDriver = new ClaudeClientDriver(customConfig);
    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    await upsertJsonMcpServer(customConfig, "ai_artifacts", scriptPath);

    const check = await claudeDriver.check(scriptPath);
    expect(check.status).toBe("missing");
    expect(check.detail).toContain("Claude skill directory is missing SKILL.md");
  });

  it("Claude driver prefers the packaged skill over a customized .agents fallback", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const deployedAgentsSkill = path.join(tempHome, ".agents", "skills", "create-review-artifact");
    await fs.mkdir(deployedAgentsSkill, { recursive: true });
    await fs.writeFile(
      path.join(deployedAgentsSkill, "SKILL.md"),
      "# Contaminated agents-only customization\n",
      "utf8",
    );
    const claudeDriver = new ClaudeClientDriver(customConfig);

    expect(path.resolve(claudeDriver.sourceSkill)).not.toBe(path.resolve(deployedAgentsSkill));
    await claudeDriver.install("/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs");

    const claudeSkill = await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8");
    expect(claudeSkill).toContain("# Create Review Artifact");
    expect(claudeSkill).not.toContain("Contaminated agents-only customization");
  });

  it("Claude driver throws on install when review or session skill source is missing", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";

    const missingReviewDriver = new ClaudeClientDriver(
      customConfig,
      undefined,
      path.join(tempHome, "missing-review-skill"),
    );
    await expect(missingReviewDriver.install(scriptPath)).rejects.toThrow();

    const missingSessionDriver = new ClaudeClientDriver(
      customConfig,
      undefined,
      undefined,
      undefined,
      path.join(tempHome, "missing-session-skill"),
    );
    await expect(missingSessionDriver.install(scriptPath)).rejects.toThrow();
  });

  it("Claude driver accepts valid custom regions and reports modified core content as outdated", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const claudeDriver = new ClaudeClientDriver(customConfig);
    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    await claudeDriver.install(scriptPath);
    const skillPath = path.join(claudeDriver.skillDirectory, "SKILL.md");
    const installed = await fs.readFile(skillPath, "utf8");
    const customized = installed
      .replace(
        /^description:.*$/m,
        "description: Create artifacts for my explicit Claude review requests.",
      )
      .replace(
        "<!-- <<< USER CUSTOM RULES <<< -->",
        "- Reply in Vietnamese.\n<!-- <<< USER CUSTOM RULES <<< -->",
      )
      .replaceAll("\n", "\r\n");
    await fs.writeFile(skillPath, customized, "utf8");
    expect((await claudeDriver.check(scriptPath)).status).toBe("ready");

    await fs.writeFile(
      skillPath,
      customized.replace("# Create Review Artifact", "# Modified Core Review Artifact"),
      "utf8",
    );
    const outdated = await claudeDriver.check(scriptPath);
    expect(outdated.status).toBe("outdated");
    expect(outdated.detail).toContain("Claude review skill assets are outdated");
  });

  it("Windsurf driver initializes mcp_config.json cleanly", async () => {
    const windsurfDriver = new WindsurfClientDriver();
    const customConfig = path.join(tempHome, ".codeium", "windsurf", "mcp_config.json");
    Object.defineProperty(windsurfDriver, "configPath", { value: customConfig });

    const scriptPath = "D:/path/to/server.mjs";
    await windsurfDriver.install(scriptPath);

    const check = await windsurfDriver.check(scriptPath);
    expect(check.status).toBe("ready");
  });

  it("Codex driver initializes config.toml, handles conflict, and cleans up legacy hooks", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempHome;
    try {
      // Set up legacy hooks.json
      const legacyHooksPath = path.join(tempHome, "hooks.json");
      const initialHooks = {
        hooks: {
          PostToolUse: [
            {
              matcher: "apply_patch",
              hooks: [
                {
                  type: "command",
                  command: "node ~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs",
                },
                {
                  type: "command",
                  command: "echo unrelated",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(legacyHooksPath, JSON.stringify(initialHooks, null, 2), "utf8");

      // Set up legacy hook script file
      const legacyScriptDir = path.join(tempHome, "codex-artifacts");
      await fs.mkdir(legacyScriptDir, { recursive: true });
      const legacyScriptFile = path.join(legacyScriptDir, "codex-artifacts-stamp-origin.mjs");
      await fs.writeFile(legacyScriptFile, "// legacy script", "utf8");

      const codexDriver = new CodexClientDriver();
      const scriptPath = "C:/test/ai-artifacts-review-mcp.mjs";
      await codexDriver.install(scriptPath);

      const check = await codexDriver.check(scriptPath);
      expect(check.status).toBe("ready");

      const content = await fs.readFile(codexDriver.configPath, "utf8");
      expect(content).toContain("[mcp_servers.ai_artifacts]");

      // Verify legacy hook was cleaned from hooks.json
      const cleanedHooks = JSON.parse(await fs.readFile(legacyHooksPath, "utf8"));
      expect(cleanedHooks.hooks.PostToolUse[0].hooks).toHaveLength(1);
      expect(cleanedHooks.hooks.PostToolUse[0].hooks[0].command).toBe("echo unrelated");

      // Verify legacy hook script was deleted
      expect(await fs.stat(legacyScriptFile).catch(() => null)).toBeNull();

      // Markerless whitelisted entry is replaced cleanly into a canonical block
      await fs.writeFile(
        codexDriver.configPath,
        '[mcp_servers.ai_artifacts]\ncommand = "custom"\ntool_timeout_sec = 180\n',
        "utf8",
      );
      expect((await codexDriver.check(scriptPath)).status).toBe("missing");
      await codexDriver.install(scriptPath);
      expect((await codexDriver.check(scriptPath)).status).toBe("ready");

      // Unexpected key fails closed across check/install/uninstall
      await fs.writeFile(
        codexDriver.configPath,
        '[mcp_servers.ai_artifacts]\ncommand = "node"\nfollowUpQueueMode = "steer"\n',
        "utf8",
      );
      const conflictCheck = await codexDriver.check(scriptPath);
      expect(conflictCheck.status).toBe("configuration-conflict");
      expect(conflictCheck.detail).toContain("followUpQueueMode");
      await expect(codexDriver.install(scriptPath)).rejects.toSatisfy(
        (err: unknown) => err instanceof CodexUnexpectedKeyConflictError && err.code === CODEX_UNEXPECTED_KEY_CONFLICT,
      );
      await expect(codexDriver.uninstall()).rejects.toThrow(CodexUnexpectedKeyConflictError);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("Copilot driver initializes Code/User/mcp.json with servers key and preserves existing servers", async () => {
    const customConfig = path.join(tempHome, "Code", "User", "mcp.json");
    const existing = {
      servers: {
        "dhis2-docs": {
          type: "http",
          url: "https://dhis2docs.mcp.kapa.ai",
        },
      },
      inputs: [],
    };
    await writeJsonConfig(customConfig, existing);

    const copilotDriver = new CopilotClientDriver(customConfig);
    const scriptPath = "C:/path/to/server.mjs";
    await copilotDriver.install(scriptPath);

    const check = await copilotDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(content.servers["dhis2-docs"]).toBeDefined();
    expect(content.servers.ai_artifacts).toEqual({
      type: "stdio",
      command: "node",
      args: [scriptPath],
    });
    expect(content.inputs).toEqual([]);
  });

  it("Cline driver initializes cline_mcp_settings.json cleanly and preserves other servers", async () => {
    const customConfig = path.join(
      tempHome,
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    const existing = {
      mcpServers: {
        other_tool: {
          command: "python",
          args: ["-m", "other"],
        },
      },
    };
    await writeJsonConfig(customConfig, existing);

    const clineDriver = new ClineClientDriver(customConfig);
    const scriptPath = "C:/path/to/server.mjs";
    await clineDriver.install(scriptPath);

    const check = await clineDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(content.mcpServers.other_tool).toBeDefined();
    expect(content.mcpServers.ai_artifacts).toEqual({
      command: "node",
      args: [scriptPath],
    });
  });

  it("Cline driver only detects the VS Code extension configuration", async () => {
    const clineStandaloneDirectory = path.join(tempHome, ".cline");
    const vscodeConfig = path.join(
      tempHome,
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    await fs.mkdir(clineStandaloneDirectory, { recursive: true });

    const clineDriver = new ClineClientDriver(vscodeConfig);
    expect(clineDriver.isDetected()).toBe(false);

    const originalSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
    process.env.CLINE_MCP_SETTINGS_PATH = path.join(clineStandaloneDirectory, "cline_mcp_settings.json");
    try {
      expect(getClineSettingsPath()).not.toBe(process.env.CLINE_MCP_SETTINGS_PATH);
    } finally {
      if (originalSettingsPath === undefined) {
        delete process.env.CLINE_MCP_SETTINGS_PATH;
      } else {
        process.env.CLINE_MCP_SETTINGS_PATH = originalSettingsPath;
      }
    }
  });

  it("Cursor driver uninstalls ai_artifacts cleanly", async () => {
    const cursorDriver = new CursorClientDriver();
    const customConfig = path.join(tempHome, ".cursor", "mcp.json");
    Object.defineProperty(cursorDriver, "configPath", { value: customConfig });

    const scriptPath = "C:/test/ai-artifacts-review-mcp.mjs";
    await cursorDriver.install(scriptPath);
    expect((await cursorDriver.check(scriptPath)).status).toBe("ready");

    const uninstalled = await cursorDriver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await cursorDriver.check(scriptPath)).status).toBe("missing");

    const json = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(json.mcpServers.ai_artifacts).toBeUndefined();
  });

  it("Claude driver uninstalls ai_artifacts while preserving root keys", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const claudeDriver = new ClaudeClientDriver(customConfig);
    await fs.writeFile(customConfig, JSON.stringify({ opusProMigrationComplete: true }), "utf8");

    const scriptPath = "/path/to/server.mjs";
    await claudeDriver.install(scriptPath);
    expect((await claudeDriver.check(scriptPath)).status).toBe("ready");
    expect(await fs.stat(claudeDriver.skillDirectory)).toBeDefined();
    expect(await fs.stat(claudeDriver.sessionSkillDirectory)).toBeDefined();

    const uninstalled = await claudeDriver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await claudeDriver.check(scriptPath)).status).toBe("missing");

    const json = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(json.opusProMigrationComplete).toBe(true);
    expect(json.mcpServers.ai_artifacts).toBeUndefined();
    expect(await fs.stat(claudeDriver.skillDirectory).catch(() => null)).toBeNull();
    expect(await fs.stat(claudeDriver.sessionSkillDirectory).catch(() => null)).toBeNull();
  });

  it("Windsurf driver uninstalls ai_artifacts cleanly", async () => {
    const windsurfDriver = new WindsurfClientDriver();
    const customConfig = path.join(tempHome, ".codeium", "windsurf", "mcp_config.json");
    Object.defineProperty(windsurfDriver, "configPath", { value: customConfig });

    const scriptPath = "D:/path/to/server.mjs";
    await windsurfDriver.install(scriptPath);
    expect((await windsurfDriver.check(scriptPath)).status).toBe("ready");

    const uninstalled = await windsurfDriver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await windsurfDriver.check(scriptPath)).status).toBe("missing");
  });

  it("Codex driver uninstalls ai_artifacts cleanly from config.toml", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempHome;
    try {
      const codexDriver = new CodexClientDriver();
      const scriptPath = "C:/test/ai-artifacts-review-mcp.mjs";
      await codexDriver.install(scriptPath);
      expect((await codexDriver.check(scriptPath)).status).toBe("ready");

      const uninstalled = await codexDriver.uninstall();
      expect(uninstalled).toBe(true);
      expect((await codexDriver.check(scriptPath)).status).toBe("missing");

      const content = await fs.readFile(codexDriver.configPath, "utf8");
      expect(content).not.toContain("[mcp_servers.ai_artifacts]");
      expect(content).not.toContain("AI Artifacts review MCP");

      const uninstalledAgain = await codexDriver.uninstall();
      expect(uninstalledAgain).toBe(false);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("Codex driver correctly detects ready status even when config.toml has displaced closing marker", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempHome;
    try {
      const codexDriver = new CodexClientDriver();
      const scriptPath = "C:/Users/Admin/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
      const displacedConfig = [
        'model = "gpt-5.6-sol"',
        "",
        "# >>> AI Artifacts review MCP >>>",
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        'args = ["C:\\\\Users\\\\Admin\\\\.ai-artifacts\\\\managed\\\\runtime\\\\ai-artifacts-review-mcp.mjs"]',
        "tool_timeout_sec = 3600",
        'default_tools_approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.create_artifact]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.inspect_artifact]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.update_artifact]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.join_session]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.node_repl]",
        'command = "node_repl.exe"',
        "",
        '[plugins."test-plugin"]',
        "enabled = true",
        "# <<< AI Artifacts review MCP <<<",
      ].join("\n");

      await fs.writeFile(codexDriver.configPath, displacedConfig, "utf8");
      const checkResult = await codexDriver.check(scriptPath);
      expect(checkResult.status).toBe("ready");

      // Markerless 6-tool config with scattered sub-tables is also recognized as ready and uninstalls cleanly
      const markerlessConfig = displacedConfig
        .replace("# >>> AI Artifacts review MCP >>>\n", "")
        .replace("\n# <<< AI Artifacts review MCP <<<", "");
      await fs.writeFile(codexDriver.configPath, markerlessConfig, "utf8");
      expect((await codexDriver.check(scriptPath)).status).toBe("ready");
      expect(await codexDriver.uninstall()).toBe(true);
      expect((await codexDriver.check(scriptPath)).status).toBe("missing");
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("Codex driver cleans legacy hooks even when config.toml has no ai_artifacts block", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempHome;
    try {
      const codexDriver = new CodexClientDriver();
      const hooksPath = path.join(tempHome, "hooks.json");
      const sampleHooks = {
        description: "Custom hooks",
        hooks: {
          PostToolUse: [
            {
              matcher: "apply_patch",
              hooks: [
                {
                  type: "command",
                  command: "node ~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs",
                },
              ],
            },
          ],
        },
      };
      await fs.writeFile(hooksPath, JSON.stringify(sampleHooks, null, 2), "utf8");

      const uninstalled = await codexDriver.uninstall();
      expect(uninstalled).toBe(true);

      const updatedHooks = JSON.parse(await fs.readFile(hooksPath, "utf8"));
      expect(updatedHooks.hooks.PostToolUse).toEqual([]);

      const uninstalledAgain = await codexDriver.uninstall();
      expect(uninstalledAgain).toBe(false);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("Copilot driver uninstalls ai_artifacts while preserving other servers", async () => {
    const customConfig = path.join(tempHome, "Code", "User", "mcp.json");
    const existing = {
      servers: {
        "dhis2-docs": {
          type: "http",
          url: "https://dhis2docs.mcp.kapa.ai",
        },
      },
    };
    await writeJsonConfig(customConfig, existing);

    const copilotDriver = new CopilotClientDriver(customConfig);
    const scriptPath = "C:/path/to/server.mjs";
    await copilotDriver.install(scriptPath);
    expect((await copilotDriver.check(scriptPath)).status).toBe("ready");

    const uninstalled = await copilotDriver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await copilotDriver.check(scriptPath)).status).toBe("missing");

    const content = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(content.servers["dhis2-docs"]).toBeDefined();
    expect(content.servers.ai_artifacts).toBeUndefined();
  });

  it("Cline driver uninstalls ai_artifacts while preserving other servers", async () => {
    const customConfig = path.join(
      tempHome,
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    );
    const existing = {
      mcpServers: {
        other_tool: {
          command: "python",
          args: ["-m", "other"],
        },
      },
    };
    await writeJsonConfig(customConfig, existing);

    const clineDriver = new ClineClientDriver(customConfig);
    const scriptPath = "C:/path/to/server.mjs";
    await clineDriver.install(scriptPath);
    expect((await clineDriver.check(scriptPath)).status).toBe("ready");

    const uninstalled = await clineDriver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await clineDriver.check(scriptPath)).status).toBe("missing");

    const content = JSON.parse(await fs.readFile(customConfig, "utf8"));
    expect(content.mcpServers.other_tool).toBeDefined();
    expect(content.mcpServers.ai_artifacts).toBeUndefined();
  });

  it("Antigravity driver detects config or .gemini/antigravity specifically and installs cleanly on an empty home", async () => {
    const emptyDriver = new AntigravityClientDriver({ userHome: tempHome });
    expect(emptyDriver.isDetected()).toBe(false);

    await fs.mkdir(path.join(tempHome, ".gemini", "config"), { recursive: true });
    expect(emptyDriver.isDetected()).toBe(false);

    const antigravityDir = path.join(tempHome, ".gemini", "antigravity");
    await fs.mkdir(antigravityDir, { recursive: true });
    expect(emptyDriver.isDetected()).toBe(true);
    await fs.rm(antigravityDir, { recursive: true, force: true });
    expect(emptyDriver.isDetected()).toBe(false);

    const scriptPath = "C:\\Users\\Test\\.ai-artifacts\\managed\\runtime\\ai-artifacts-review-mcp.mjs";
    await emptyDriver.install(scriptPath);
    expect(emptyDriver.isDetected()).toBe(true);
    expect((await emptyDriver.check(scriptPath)).status).toBe("ready");

    const installedConfig = await readJsonConfig(emptyDriver.configPath);
    expect(installedConfig).toEqual({
      mcpServers: {
        ai_artifacts: {
          command: "node",
          args: ["C:/Users/Test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs"],
          timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
        },
      },
    });
    expect(await fs.stat(path.join(emptyDriver.skillDirectory, "references", "storage-protocol.md"))).toBeDefined();
    expect(await fs.stat(path.join(emptyDriver.skillDirectory, "references", "recovery.md"))).toBeDefined();
    expect(await fs.stat(path.join(emptyDriver.skillDirectory, "references", "ai-feedback.md"))).toBeDefined();
    expect(await fs.stat(path.join(emptyDriver.skillDirectory, "agents", "openai.yaml"))).toBeDefined();
    expect(await fs.stat(path.join(emptyDriver.sessionSkillDirectory, "SKILL.md"))).toBeDefined();
    expect(await fs.stat(path.join(emptyDriver.sessionSkillDirectory, "agents", "openai.yaml"))).toBeDefined();
  });

  it("Antigravity driver preserves mcpServers siblings, root keys, custom entry fields, and rejects corrupt JSON", async () => {
    const driver = new AntigravityClientDriver({ userHome: tempHome });
    await writeJsonConfig(driver.configPath, {
      theme: "dark",
      servers: {
        unrelated_root_servers: { type: "http", url: "https://example.test" },
      },
      mcpServers: {
        "dhis2-docs": { command: "npx", args: ["-y", "dhis2-mcp"] },
        ai_artifacts: {
          command: "node",
          args: ["/old/path/server.mjs"],
          timeoutSeconds: 180,
          disabled: false,
          disabledTools: ["join_session"],
          env: { LOG_LEVEL: "info" },
        },
      },
    });

    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
    await driver.install(scriptPath);
    expect((await driver.check(scriptPath)).status).toBe("ready");

    const updated = await readJsonConfig(driver.configPath);
    expect(updated.theme).toBe("dark");
    expect(updated.servers).toEqual({
      unrelated_root_servers: { type: "http", url: "https://example.test" },
    });
    expect(updated.mcpServers["dhis2-docs"]).toEqual({ command: "npx", args: ["-y", "dhis2-mcp"] });
    expect(updated.mcpServers.ai_artifacts).toEqual({
      command: "node",
      args: [scriptPath],
      timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
      disabled: false,
      disabledTools: ["join_session"],
      env: { LOG_LEVEL: "info" },
    });
    expect(updated.mcpServers.ai_artifacts.enabledTools).toBeUndefined();
    expect(updated.mcpServers.ai_artifacts.tools).toBeUndefined();

    // Corrupt JSON must error cleanly without being overwritten
    const corruptRaw = "{ mcpServers: broken";
    await fs.writeFile(driver.configPath, corruptRaw, "utf8");
    await expect(driver.install(scriptPath)).rejects.toThrow("Invalid JSON syntax");
    await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe(corruptRaw);
  });

  it("Antigravity driver checks timeout, missing skills, outdated assets, source availability, and preserves customizations independently from .agents", async () => {
    const agentsSkillDir = path.join(tempHome, ".agents", "skills", "create-review-artifact");
    await fs.mkdir(agentsSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(agentsSkillDir, "SKILL.md"),
      "# Contaminated .agents skill that must not leak into Antigravity\n",
      "utf8",
    );

    const driver = new AntigravityClientDriver({ userHome: tempHome });
    const scriptPath = "D:/runtime/ai-artifacts-review-mcp.mjs";

    // Obsolete files in existing work-session directory should be removed during install
    await fs.mkdir(path.join(driver.sessionSkillDirectory, "references"), { recursive: true });
    await fs.writeFile(
      path.join(driver.sessionSkillDirectory, "references", "session-contract.md"),
      "# Obsolete session file\n",
      "utf8",
    );

    await driver.install(scriptPath);
    await expect(
      fs.access(path.join(driver.sessionSkillDirectory, "references", "session-contract.md")),
    ).rejects.toThrow();

    const installedSkill = await fs.readFile(path.join(driver.skillDirectory, "SKILL.md"), "utf8");
    expect(installedSkill).not.toContain("Contaminated .agents skill");

    // Customize Antigravity review skill with CRLF and verify ready + preserved across reinstall
    const customized = installedSkill
      .replace(/^description:.*$/m, "description: Antigravity explicit review artifacts only.")
      .replace(
        USER_CUSTOM_RULES_END,
        `- Always check Antigravity rules.\n${USER_CUSTOM_RULES_END}`,
      )
      .replaceAll("\n", "\r\n");
    await fs.writeFile(path.join(driver.skillDirectory, "SKILL.md"), customized, "utf8");
    expect((await driver.check(scriptPath)).status).toBe("ready");

    await driver.install(scriptPath);
    const reinstalledSkill = await fs.readFile(path.join(driver.skillDirectory, "SKILL.md"), "utf8");
    expect(reinstalledSkill).toContain("description: Antigravity explicit review artifacts only.");
    expect(reinstalledSkill).toContain("- Always check Antigravity rules.");

    // Mismatched runtime path or wrong command -> missing
    expect((await driver.check("D:/other/runtime.mjs")).status).toBe("missing");

    const wrongCmdCfg = await readJsonConfig(driver.configPath);
    wrongCmdCfg.mcpServers.ai_artifacts.command = "python";
    await writeJsonConfig(driver.configPath, wrongCmdCfg);
    expect((await driver.check(scriptPath)).status).toBe("missing");
    await driver.install(scriptPath);

    // Missing or mismatched timeoutSeconds -> outdated with reinstall detail
    const cfg = await readJsonConfig(driver.configPath);
    delete cfg.mcpServers.ai_artifacts.timeoutSeconds;
    await writeJsonConfig(driver.configPath, cfg);
    const missingTimeout = await driver.check(scriptPath);
    expect(missingTimeout.status).toBe("outdated");
    expect(missingTimeout.detail).toContain("timeoutSeconds");

    cfg.mcpServers.ai_artifacts.timeoutSeconds = 180;
    await writeJsonConfig(driver.configPath, cfg);
    expect((await driver.check(scriptPath)).status).toBe("outdated");

    // Restore valid timeout, then test missing skills & outdated reference files
    cfg.mcpServers.ai_artifacts.timeoutSeconds = ANTIGRAVITY_MCP_TIMEOUT_SECONDS;
    await writeJsonConfig(driver.configPath, cfg);

    await fs.rm(path.join(driver.skillDirectory, "SKILL.md"));
    const missingReview = await driver.check(scriptPath);
    expect(missingReview.status).toBe("missing");
    expect(missingReview.detail).toContain("Antigravity skill directory is missing SKILL.md");
    await driver.install(scriptPath);

    await fs.rm(path.join(driver.sessionSkillDirectory, "SKILL.md"));
    const missingSession = await driver.check(scriptPath);
    expect(missingSession.status).toBe("missing");
    expect(missingSession.detail).toContain("work-session");

    await driver.install(scriptPath);
    await fs.writeFile(
      path.join(driver.skillDirectory, "references", "storage-protocol.md"),
      "# Outdated reference\n",
      "utf8",
    );
    expect((await driver.check(scriptPath)).status).toBe("outdated");

    await driver.install(scriptPath);
    await fs.writeFile(path.join(driver.sessionSkillDirectory, "SKILL.md"), "# Outdated session\n", "utf8");
    expect((await driver.check(scriptPath)).status).toBe("outdated");

    // Missing packaged source must error instead of reporting ready
    await driver.install(scriptPath);
    const missingSourceDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(tempHome, "nonexistent-source"),
    });
    await expect(missingSourceDriver.install(scriptPath)).rejects.toThrow("unavailable or incomplete");
    await expect(missingSourceDriver.check(scriptPath)).rejects.toThrow("unavailable or incomplete");
  });

  it("Antigravity driver uninstalls only ai_artifacts and its two skills while preserving global rules and unrelated assets", async () => {
    const driver = new AntigravityClientDriver({ userHome: tempHome });
    const geminiRulesDoc = path.join(tempHome, ".gemini", "GEMINI.md");
    const globalRuleFile = path.join(tempHome, ".gemini", "config", "rules", "artifact-review-policy.md");
    const unrelatedSkillFile = path.join(tempHome, ".gemini", "config", "skills", "unrelated-skill", "SKILL.md");
    const managedRuntimeFile = path.join(tempHome, ".ai-artifacts", "managed", "runtime", "ai-artifacts-review-mcp.mjs");

    await fs.mkdir(path.dirname(geminiRulesDoc), { recursive: true });
    await fs.mkdir(path.dirname(globalRuleFile), { recursive: true });
    await fs.mkdir(path.dirname(unrelatedSkillFile), { recursive: true });
    await fs.mkdir(path.dirname(managedRuntimeFile), { recursive: true });
    await fs.writeFile(geminiRulesDoc, "# Global GEMINI rules\n", "utf8");
    await fs.writeFile(globalRuleFile, "# Custom artifact review policy\n", "utf8");
    await fs.writeFile(unrelatedSkillFile, "# Keep this skill\n", "utf8");
    await fs.writeFile(managedRuntimeFile, "// shared runtime\n", "utf8");
    await writeJsonConfig(driver.configPath, {
      mcpServers: {
        keep_me: { command: "node", args: ["keep.js"] },
      },
    });

    await driver.install(managedRuntimeFile);
    expect((await driver.check(managedRuntimeFile)).status).toBe("ready");

    const uninstalled = await driver.uninstall();
    expect(uninstalled).toBe(true);
    expect((await driver.check(managedRuntimeFile)).status).toBe("missing");
    await expect(fs.access(driver.skillDirectory)).rejects.toThrow();
    await expect(fs.access(driver.sessionSkillDirectory)).rejects.toThrow();

    const remainingConfig = await readJsonConfig(driver.configPath);
    expect(remainingConfig.mcpServers.ai_artifacts).toBeUndefined();
    expect(remainingConfig.mcpServers.keep_me).toBeDefined();
    await expect(fs.readFile(geminiRulesDoc, "utf8")).resolves.toBe("# Global GEMINI rules\n");
    await expect(fs.readFile(globalRuleFile, "utf8")).resolves.toBe("# Custom artifact review policy\n");
    await expect(fs.readFile(unrelatedSkillFile, "utf8")).resolves.toBe("# Keep this skill\n");
    await expect(fs.readFile(managedRuntimeFile, "utf8")).resolves.toBe("// shared runtime\n");

    expect(await driver.uninstall()).toBe(false);
    expect(getAllClientDrivers().at(-1)?.id).toBe("antigravity");
  });
});

describe("Uninstall & Base Assets Cleanup", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `ai-artifacts-cleanup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("cleanupBaseMcpServer removes deployed base directories and skills cleanly", async () => {
    const baseDir = path.join(tempHome, ".vscode", "ai-artifacts");
    const skillDir = path.join(tempHome, ".agents", "skills", "create-review-artifact");
    const sessionSkillDir = path.join(tempHome, ".agents", "skills", "work-session");
    const legacySkillDir = path.join(tempHome, ".agents", "skills", "create-plan-artifact");
    const claudeSkillDir = path.join(tempHome, ".claude", "skills", "create-review-artifact");
    const claudeSessionSkillDir = path.join(tempHome, ".claude", "skills", "work-session");
    const antigravitySkillDir = path.join(tempHome, ".gemini", "config", "skills", "create-review-artifact");
    const antigravitySessionSkillDir = path.join(tempHome, ".gemini", "config", "skills", "work-session");
    const geminiRules = path.join(tempHome, ".gemini", "GEMINI.md");
    const antigravityRule = path.join(tempHome, ".gemini", "config", "rules", "custom.md");
    const antigravityMcpConfig = path.join(tempHome, ".gemini", "config", "mcp_config.json");
    const unrelatedAntigravitySkill = path.join(tempHome, ".gemini", "config", "skills", "unrelated", "SKILL.md");
    const retainedArtifact = path.join(tempHome, ".ai-artifacts", "artifacts", "a1", "artifact.md");

    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, "ai-artifacts-review-mcp.mjs"), "// server", "utf8");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Skill", "utf8");
    await fs.mkdir(sessionSkillDir, { recursive: true });
    await fs.writeFile(path.join(sessionSkillDir, "SKILL.md"), "# Session Skill", "utf8");
    await fs.mkdir(legacySkillDir, { recursive: true });
    await fs.writeFile(path.join(legacySkillDir, "SKILL.md"), "# Legacy", "utf8");
    await fs.mkdir(claudeSkillDir, { recursive: true });
    await fs.writeFile(path.join(claudeSkillDir, "SKILL.md"), "# Claude Skill", "utf8");
    await fs.mkdir(claudeSessionSkillDir, { recursive: true });
    await fs.writeFile(path.join(claudeSessionSkillDir, "SKILL.md"), "# Claude Session Skill", "utf8");
    await fs.mkdir(antigravitySkillDir, { recursive: true });
    await fs.writeFile(path.join(antigravitySkillDir, "SKILL.md"), "# Antigravity Skill", "utf8");
    await fs.mkdir(antigravitySessionSkillDir, { recursive: true });
    await fs.writeFile(path.join(antigravitySessionSkillDir, "SKILL.md"), "# Antigravity Session Skill", "utf8");
    await fs.mkdir(path.dirname(geminiRules), { recursive: true });
    await fs.writeFile(geminiRules, "# GEMINI rules\n", "utf8");
    await fs.mkdir(path.dirname(antigravityRule), { recursive: true });
    await fs.writeFile(antigravityRule, "# User rule\n", "utf8");
    await fs.writeFile(antigravityMcpConfig, '{"mcpServers":{}}\n', "utf8");
    await fs.mkdir(path.dirname(unrelatedAntigravitySkill), { recursive: true });
    await fs.writeFile(unrelatedAntigravitySkill, "# Keep skill\n", "utf8");
    await fs.mkdir(path.dirname(retainedArtifact), { recursive: true });
    await fs.writeFile(retainedArtifact, "# Keep artifact\n", "utf8");

    await cleanupBaseMcpServer({ userHome: tempHome });

    expect(await fs.stat(baseDir).catch(() => null)).toBeNull();
    expect(await fs.stat(skillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(sessionSkillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(legacySkillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(claudeSkillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(claudeSessionSkillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(antigravitySkillDir).catch(() => null)).toBeNull();
    expect(await fs.stat(antigravitySessionSkillDir).catch(() => null)).toBeNull();
    await expect(fs.readFile(geminiRules, "utf8")).resolves.toBe("# GEMINI rules\n");
    await expect(fs.readFile(antigravityRule, "utf8")).resolves.toBe("# User rule\n");
    await expect(fs.readFile(antigravityMcpConfig, "utf8")).resolves.toBe('{"mcpServers":{}}\n');
    await expect(fs.readFile(unrelatedAntigravitySkill, "utf8")).resolves.toBe("# Keep skill\n");
    await expect(fs.readFile(retainedArtifact, "utf8")).resolves.toBe("# Keep artifact\n");
  });

  it("cleanupBaseMcpServer does not throw when folders do not exist", async () => {
    await expect(cleanupBaseMcpServer({ userHome: tempHome })).resolves.not.toThrow();
  });

  it("runUninstall executes cleanups and returns uninstalled clients", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    const originalAppData = process.env.APPDATA;
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    process.env.CODEX_HOME = path.join(tempHome, ".codex");
    process.env.APPDATA = path.join(tempHome, "AppData", "Roaming");
    try {
      const codexDriver = new CodexClientDriver();
      await codexDriver.install("C:/test/server.mjs");

      const antigravityDriver = new AntigravityClientDriver({ userHome: tempHome });
      await antigravityDriver.install("C:/test/server.mjs");

      const baseDir = path.join(tempHome, ".vscode", "ai-artifacts");
      await fs.mkdir(baseDir, { recursive: true });

      const result = await runUninstall({ userHome: tempHome });
      expect(result.uninstalledClients).toContain("Codex");
      expect(result.uninstalledClients).toContain("Antigravity");
      expect(await fs.stat(baseDir).catch(() => null)).toBeNull();
      expect(await fs.stat(antigravityDriver.skillDirectory).catch(() => null)).toBeNull();
      expect(await fs.stat(antigravityDriver.sessionSkillDirectory).catch(() => null)).toBeNull();
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
      if (originalAppData === undefined) {
        delete process.env.APPDATA;
      } else {
        process.env.APPDATA = originalAppData;
      }
    }
  });
});

describe("Client Driver Upgrade", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `ai-artifacts-upgrade-driver-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempHome, { recursive: true });
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("JSON-only drivers return unchanged immediately without reading or writing config files", async () => {
    const scriptPath = "D:/runtime/ai-artifacts-review-mcp.mjs";
    const copilotConfig = path.join(tempHome, "Code", "User", "mcp.json");
    const clineConfig = path.join(tempHome, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");

    const drivers = [
      new CopilotClientDriver(copilotConfig),
      new CursorClientDriver(),
      new WindsurfClientDriver(),
      new ClineClientDriver(clineConfig),
    ];

    const readFileSpy = vi.spyOn(fs, "readFile");
    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    // Missing config files -> unchanged without reading or creating files
    for (const driver of drivers) {
      const missingRes = await driver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: true,
        updateSessionSkill: true,
      });
      expect(missingRes).toEqual({ status: "unchanged" });
      await expect(fs.access(driver.configPath)).rejects.toThrow();
    }
    expect(readFileSpy).not.toHaveBeenCalled();

    // Install all 4, record exact contents, verify upgrade() is unchanged without reading or writing
    for (const driver of drivers) {
      await driver.install(scriptPath);
    }
    const beforeContents = await Promise.all(drivers.map((d) => fs.readFile(d.configPath, "utf8")));
    readFileSpy.mockClear();
    writeFileSpy.mockClear();
    renameSpy.mockClear();

    for (const driver of drivers) {
      const readyRes = await driver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: true,
        updateSessionSkill: true,
      });
      expect(readyRes).toEqual({ status: "unchanged" });
    }
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    for (const [index, driver] of drivers.entries()) {
      await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe(beforeContents[index]);
    }

    // Mismatched runtime path and corrupt JSON both still yield unchanged without reading or writing
    for (const [index, driver] of drivers.entries()) {
      readFileSpy.mockClear();
      const mismatchRes = await driver.upgrade({
        mcpScriptPath: "D:/runtime/other.mjs",
        previousMcpVersion: 12,
        targetMcpVersion: 13,
        updateReviewSkill: false,
        updateSessionSkill: false,
      });
      expect(mismatchRes).toEqual({ status: "unchanged" });
      expect(readFileSpy).not.toHaveBeenCalled();
      await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe(beforeContents[index]);

      const corruptRaw = "{ invalid json";
      await fs.writeFile(driver.configPath, corruptRaw, "utf8");
      readFileSpy.mockClear();
      writeFileSpy.mockClear();
      renameSpy.mockClear();
      const corruptRes = await driver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      });
      expect(corruptRes).toEqual({ status: "unchanged" });
      expect(readFileSpy).not.toHaveBeenCalled();
      expect(writeFileSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe(corruptRaw);
    }
  });

  it("Codex driver gates replacement at MCP 12, handles ENOENT/I/O/unconfigured/unexpected-key configs, resets whitelisted overrides, and ignores legacy hooks", async () => {
    const originalCodexHome = process.env.CODEX_HOME;
    const codexHome = path.join(tempHome, ".codex");
    process.env.CODEX_HOME = codexHome;
    try {
      const scriptPath = "C:/Users/Test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";
      const codexDriver = new CodexClientDriver();

      // Missing config when crossing version 12 -> unchanged without creating .codex/config.toml
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      await expect(fs.access(codexDriver.configPath)).rejects.toThrow();

      await fs.mkdir(codexHome, { recursive: true });
      const legacyHooksPath = path.join(codexHome, "hooks.json");
      const legacyHookContent = JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: "apply_patch", hooks: [{ type: "command", command: "node ~/.codex/codex-artifacts/codex-artifacts-stamp-origin.mjs" }] }],
        },
      });
      await fs.writeFile(legacyHooksPath, legacyHookContent, "utf8");

      // Unconfigured config.toml without ai_artifacts tables stays unchanged without writing
      await fs.writeFile(codexDriver.configPath, 'model = "gpt-test"\n\n[mcp_servers.other]\ncommand = "other"\n', "utf8");
      const unconfiguredWriteSpy = vi.spyOn(fs, "writeFile");
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      expect(unconfiguredWriteSpy).not.toHaveBeenCalled();

      const fiveTool = [
        'model = "gpt-test"',
        "",
        "# >>> AI Artifacts review MCP >>>",
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = ["${scriptPath}"]`,
        "tool_timeout_sec = 3600",
        'default_tools_approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.create_artifact]",
        'approval_mode = "never"',
        "",
        "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.inspect_artifact_review]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]",
        'approval_mode = "approve"',
        "# <<< AI Artifacts review MCP <<<",
        "",
      ].join("\n");
      await fs.writeFile(codexDriver.configPath, fiveTool, "utf8");

      // Version gate 12 -> 12 and 13 -> 12 never even read config.toml
      const readSpy = vi.spyOn(fs, "readFile");
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 12,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 13,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      expect(readSpy).not.toHaveBeenCalled();

      // I/O error other than ENOENT throws
      readSpy.mockRejectedValueOnce(Object.assign(new Error("EACCES permission denied"), { code: "EACCES" }));
      await expect(codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).rejects.toThrow("EACCES permission denied");

      // Version gate >= 12 (12 -> 13) upgrades a 6-tool config with legacy names + join_session while preserving unrelated entries
      const legacySixTool = [
        'model = "gpt-test"',
        "",
        "# >>> AI Artifacts review MCP >>>",
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = ["${scriptPath}"]`,
        "tool_timeout_sec = 3600",
        'default_tools_approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.create_artifact]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.wait_for_artifact_review]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.inspect_artifact_review]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.join_session]",
        'approval_mode = "approve"',
        "# <<< AI Artifacts review MCP <<<",
        "",
      ].join("\n");
      await fs.writeFile(codexDriver.configPath, legacySixTool, "utf8");
      const sixToolUpgrade = await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 12,
        targetMcpVersion: 13,
        updateReviewSkill: false,
        updateSessionSkill: false,
      });
      expect(sixToolUpgrade).toEqual({ status: "updated" });
      expect((await codexDriver.check(scriptPath)).status).toBe("ready");
      const sixToolUpgradedContent = await fs.readFile(codexDriver.configPath, "utf8");
      expect(sixToolUpgradedContent).toContain('model = "gpt-test"');
      expect(sixToolUpgradedContent).toContain("[mcp_servers.ai_artifacts.tools.inspect_artifact]");
      expect(sixToolUpgradedContent).toContain("[mcp_servers.ai_artifacts.tools.update_artifact]");
      expect(sixToolUpgradedContent).toContain("[mcp_servers.ai_artifacts.tools.join_session]");
      expect(sixToolUpgradedContent).not.toContain("inspect_artifact_review");
      expect(sixToolUpgradedContent).not.toContain("advance_and_wait_for_artifact");

      await fs.writeFile(codexDriver.configPath, fiveTool, "utf8");

      // Crossing 11 -> 12 replaces outdated 5-tool block with canonical 6-tool managed defaults and leaves legacy hooks untouched
      const firstUpgrade = await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      });
      expect(firstUpgrade).toEqual({ status: "updated" });
      expect((await codexDriver.check(scriptPath)).status).toBe("ready");

      const upgradedContent = await fs.readFile(codexDriver.configPath, "utf8");
      expect(upgradedContent).toContain('[mcp_servers.ai_artifacts.tools.create_artifact]\napproval_mode = "approve"');
      expect(upgradedContent).toContain('[mcp_servers.ai_artifacts.tools.inspect_artifact]\napproval_mode = "approve"');
      expect(upgradedContent).toContain('[mcp_servers.ai_artifacts.tools.update_artifact]\napproval_mode = "approve"');
      expect(upgradedContent).toContain('[mcp_servers.ai_artifacts.tools.join_session]\napproval_mode = "approve"');
      expect(upgradedContent).not.toContain("inspect_artifact_review");
      expect(upgradedContent).not.toContain("advance_and_wait_for_artifact");
      await expect(fs.readFile(legacyHooksPath, "utf8")).resolves.toBe(legacyHookContent);

      // Re-running on ready 6-tool config (with or without markers) across 10 -> 13 is unchanged with no write
      const writeSpy = vi.spyOn(fs, "writeFile");
      const renameSpy = vi.spyOn(fs, "rename");
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 10,
        targetMcpVersion: 13,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      await fs.writeFile(
        codexDriver.configPath,
        upgradedContent
          .replace("# >>> AI Artifacts review MCP >>>\n", "")
          .replace("\n# <<< AI Artifacts review MCP <<<", ""),
        "utf8",
      );
      writeSpy.mockClear();
      renameSpy.mockClear();
      expect(await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 10,
        targetMcpVersion: 13,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).toEqual({ status: "unchanged" });
      expect(writeSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();

      // Markerless / legacy / custom whitelisted overrides (timeout, args) are replaced cleanly with canonical defaults
      const markerlessOverride = fiveTool
        .replace("# >>> AI Artifacts review MCP >>>\n", "")
        .replace("\n# <<< AI Artifacts review MCP <<<", "")
        .replace("[mcp_servers.ai_artifacts]", "[mcp_servers.codex_artifacts]")
        .replace("tool_timeout_sec = 3600", "tool_timeout_sec = 180")
        .replace(`args = ["${scriptPath}"]`, 'args = ["D:/other.mjs"]');
      await fs.writeFile(codexDriver.configPath, markerlessOverride, "utf8");
      const overrideUpgrade = await codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 10,
        targetMcpVersion: 13,
        updateReviewSkill: false,
        updateSessionSkill: false,
      });
      expect(overrideUpgrade).toEqual({ status: "updated" });
      const overrideAfter = await fs.readFile(codexDriver.configPath, "utf8");
      expect(overrideAfter).toContain("tool_timeout_sec = 3600");
      expect(overrideAfter).toContain(`args = ["${scriptPath}"]`);
      expect(overrideAfter).not.toContain("[mcp_servers.codex_artifacts]");
      expect(overrideAfter).toContain("[mcp_servers.ai_artifacts.tools.join_session]");

      // Unexpected key in config.toml fails closed by throwing CodexUnexpectedKeyConflictError without writing
      const unexpectedConfig = [
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = ["${scriptPath}"]`,
        'followUpQueueMode = "steer"',
        "",
      ].join("\n");
      await fs.writeFile(codexDriver.configPath, unexpectedConfig, "utf8");
      writeSpy.mockClear();
      renameSpy.mockClear();
      await expect(codexDriver.upgrade({
        mcpScriptPath: scriptPath,
        previousMcpVersion: 11,
        targetMcpVersion: 12,
        updateReviewSkill: false,
        updateSessionSkill: false,
      })).rejects.toSatisfy(
        (err: unknown) => err instanceof CodexUnexpectedKeyConflictError && err.code === CODEX_UNEXPECTED_KEY_CONFLICT,
      );
      expect(writeSpy).not.toHaveBeenCalled();
      expect(renameSpy).not.toHaveBeenCalled();
      await expect(fs.readFile(codexDriver.configPath, "utf8")).resolves.toBe(unexpectedConfig);
    } finally {
      if (originalCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = originalCodexHome;
      }
    }
  });

  it("Claude driver upgrades only flagged skills regardless of missing or corrupt .claude.json and validates sources before writes", async () => {
    const customConfig = path.join(tempHome, ".claude.json");
    const scriptPath = "/Users/test/.ai-artifacts/managed/runtime/ai-artifacts-review-mcp.mjs";

    const reviewSource = path.join(tempHome, "src-skills", "create-review-artifact");
    const sessionSource = path.join(tempHome, "src-skills", "work-session");
    await fs.mkdir(path.join(reviewSource, "references"), { recursive: true });
    await fs.mkdir(path.join(reviewSource, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(reviewSource, "SKILL.md"),
      [
        "---",
        "name: create-review-artifact",
        `description: ${OFFICIAL_SKILL_DESCRIPTIONS.at(-1)}`,
        "---",
        "# New Review Core",
        "<!-- >>> USER CUSTOM RULES >>> -->",
        "<!-- <<< USER CUSTOM RULES <<< -->",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(reviewSource, "references", "storage-protocol.md"), "# Contract v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "references", "recovery.md"), "# Recovery v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "references", "ai-feedback.md"), "# Feedback v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "agents", "openai.yaml"), "prompt: review", "utf8");
    await fs.mkdir(path.join(sessionSource, "agents"), { recursive: true });
    await fs.writeFile(path.join(sessionSource, "SKILL.md"), "# Session v2", "utf8");
    await fs.writeFile(path.join(sessionSource, "agents", "openai.yaml"), "prompt: session", "utf8");

    const claudeDriver = new ClaudeClientDriver(customConfig, undefined, reviewSource, undefined, sessionSource);

    // Missing config still upgrades flagged skills without creating .claude.json
    expect(await claudeDriver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 11,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: true,
    })).toEqual({ status: "updated" });
    await expect(fs.access(customConfig)).rejects.toThrow();
    await expect(fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8")).resolves.toContain("# New Review Core");
    await expect(fs.readFile(path.join(claudeDriver.sessionSkillDirectory, "SKILL.md"), "utf8")).resolves.toBe("# Session v2");

    // Corrupt config still upgrades flagged skills without touching .claude.json
    await fs.writeFile(customConfig, "{ broken json", "utf8");
    await fs.rm(claudeDriver.skillDirectory, { recursive: true, force: true });
    await fs.rm(claudeDriver.sessionSkillDirectory, { recursive: true, force: true });
    expect(await claudeDriver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: true,
    })).toEqual({ status: "updated" });
    await expect(fs.readFile(customConfig, "utf8")).resolves.toBe("{ broken json");
    await fs.rm(customConfig);
    await fs.rm(claudeDriver.skillDirectory, { recursive: true, force: true });
    await fs.rm(claudeDriver.sessionSkillDirectory, { recursive: true, force: true });

    // Valid config + independent .agents contamination + existing custom Claude review skill + missing session skill
    await fs.writeFile(customConfig, JSON.stringify({ opusProMigrationComplete: true }), "utf8");
    await upsertJsonMcpServer(customConfig, "ai_artifacts", scriptPath);
    const beforeConfig = await fs.readFile(customConfig, "utf8");

    const agentsSkill = path.join(tempHome, ".agents", "skills", "create-review-artifact", "SKILL.md");
    await fs.mkdir(path.dirname(agentsSkill), { recursive: true });
    await fs.writeFile(agentsSkill, "# Agents contamination\n", "utf8");

    await fs.mkdir(claudeDriver.skillDirectory, { recursive: true });
    await fs.writeFile(
      path.join(claudeDriver.skillDirectory, "SKILL.md"),
      [
        "---",
        "name: create-review-artifact",
        "description: Claude custom description only.",
        "---",
        "# Old Review Core",
        "<!-- >>> USER CUSTOM RULES >>> -->",
        "- Keep Claude rule.",
        "<!-- <<< USER CUSTOM RULES <<< -->",
        "",
      ].join("\n"),
      "utf8",
    );

    // Missing packaged session source preflights before modifying review skill too
    await fs.rm(path.join(sessionSource, "agents", "openai.yaml"));
    await expect(claudeDriver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: true,
    })).rejects.toThrow("unavailable or incomplete");
    await expect(fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8")).resolves.toContain("# Old Review Core");

    // Selective review-only upgrade works cleanly when session flag is false
    const reviewOnlyRes = await claudeDriver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: false,
    });
    expect(reviewOnlyRes).toEqual({ status: "updated" });
    await expect(fs.readFile(customConfig, "utf8")).resolves.toBe(beforeConfig);
    const updatedClaudeReview = await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8");
    expect(updatedClaudeReview).toContain("Claude custom description only.");
    expect(updatedClaudeReview).toContain("- Keep Claude rule.");
    expect(updatedClaudeReview).toContain("# New Review Core");
    expect(updatedClaudeReview).not.toContain("Agents contamination");
    await expect(fs.access(claudeDriver.sessionSkillDirectory)).rejects.toThrow();

    // False flags -> unchanged without reading config or writing disk
    await fs.writeFile(path.join(sessionSource, "agents", "openai.yaml"), "prompt: session", "utf8");
    const readSpy = vi.spyOn(fs, "readFile");
    const unchangedRes = await claudeDriver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: false,
      updateSessionSkill: false,
    });
    expect(unchangedRes).toEqual({ status: "unchanged" });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("Antigravity driver upgrades only flagged skills without reading mcp_config.json or touching rules and permissions", async () => {
    const scriptPath = "D:/runtime/ai-artifacts-review-mcp.mjs";
    const reviewSource = path.join(tempHome, "src-ag", "create-review-artifact");
    const sessionSource = path.join(tempHome, "src-ag", "work-session");
    await fs.mkdir(path.join(reviewSource, "references"), { recursive: true });
    await fs.mkdir(path.join(reviewSource, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(reviewSource, "SKILL.md"),
      [
        "---",
        "name: create-review-artifact",
        `description: ${OFFICIAL_SKILL_DESCRIPTIONS.at(-1)}`,
        "---",
        "# Antigravity Review v2",
        "<!-- >>> USER CUSTOM RULES >>> -->",
        "<!-- <<< USER CUSTOM RULES <<< -->",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(reviewSource, "references", "storage-protocol.md"), "# Contract v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "references", "recovery.md"), "# Recovery v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "references", "ai-feedback.md"), "# Feedback v2", "utf8");
    await fs.writeFile(path.join(reviewSource, "agents", "openai.yaml"), "prompt: review", "utf8");
    await fs.mkdir(path.join(sessionSource, "agents"), { recursive: true });
    await fs.writeFile(path.join(sessionSource, "SKILL.md"), "# Session v2", "utf8");
    await fs.writeFile(path.join(sessionSource, "agents", "openai.yaml"), "prompt: session", "utf8");

    const driver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: reviewSource,
      sourceSessionSkillDirectory: sessionSource,
    });

    const geminiRulesDoc = path.join(tempHome, ".gemini", "GEMINI.md");
    const globalRule = path.join(tempHome, ".gemini", "config", "rules", "policy.md");
    await fs.mkdir(path.dirname(geminiRulesDoc), { recursive: true });
    await fs.mkdir(path.dirname(globalRule), { recursive: true });
    await fs.writeFile(geminiRulesDoc, "# GEMINI custom rules\n", "utf8");
    await fs.writeFile(globalRule, "# Policy rule\n", "utf8");

    const readSpy = vi.spyOn(fs, "readFile");

    // False flags -> unchanged immediately without reading mcp_config.json
    expect(await driver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: false,
      updateSessionSkill: false,
    })).toEqual({ status: "unchanged" });
    expect(readSpy).not.toHaveBeenCalled();

    // Bad timeoutSeconds or corrupt JSON in mcp_config.json are ignored during skill upgrade
    await writeJsonConfig(driver.configPath, {
      mcpServers: {
        ai_artifacts: {
          command: "node",
          args: [scriptPath],
          timeoutSeconds: 180,
          disabledTools: ["join_session"],
        },
      },
    });
    const badTimeoutRaw = await fs.readFile(driver.configPath, "utf8");
    readSpy.mockClear();
    const badTimeoutRes = await driver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 11,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: true,
    });
    expect(badTimeoutRes).toEqual({ status: "updated" });
    expect(readSpy.mock.calls.some(([p]) => path.resolve(String(p)) === path.resolve(driver.configPath))).toBe(false);
    await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe(badTimeoutRaw);

    await fs.writeFile(driver.configPath, "{ broken", "utf8");
    await fs.mkdir(driver.skillDirectory, { recursive: true });
    await fs.writeFile(
      path.join(driver.skillDirectory, "SKILL.md"),
      [
        "---",
        "name: create-review-artifact",
        "description: Antigravity custom desc.",
        "---",
        "# Old AG Core",
        "<!-- >>> USER CUSTOM RULES >>> -->",
        "- AG rule",
        "<!-- <<< USER CUSTOM RULES <<< -->",
        "",
      ].join("\n"),
      "utf8",
    );

    readSpy.mockClear();
    const res = await driver.upgrade({
      mcpScriptPath: scriptPath,
      previousMcpVersion: 12,
      targetMcpVersion: 12,
      updateReviewSkill: true,
      updateSessionSkill: true,
    });
    expect(res).toEqual({ status: "updated" });
    expect(readSpy.mock.calls.some(([p]) => path.resolve(String(p)) === path.resolve(driver.configPath))).toBe(false);
    await expect(fs.readFile(driver.configPath, "utf8")).resolves.toBe("{ broken");
    await expect(fs.readFile(geminiRulesDoc, "utf8")).resolves.toBe("# GEMINI custom rules\n");
    await expect(fs.readFile(globalRule, "utf8")).resolves.toBe("# Policy rule\n");
    const agSkillAfter = await fs.readFile(path.join(driver.skillDirectory, "SKILL.md"), "utf8");
    expect(agSkillAfter).toContain("description: Antigravity custom desc.");
    expect(agSkillAfter).toContain("- AG rule");
    expect(agSkillAfter).toContain("# Antigravity Review v2");
  });
});


