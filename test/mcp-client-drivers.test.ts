import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hasJsonMcpServer,
  readJsonConfig,
  upsertJsonMcpServer,
  writeJsonConfig,
} from "../src/extension/mcp-clients/json-mcp-helper";
import { CursorClientDriver } from "../src/extension/mcp-clients/cursor-client";
import { ClaudeClientDriver } from "../src/extension/mcp-clients/claude-client";
import { WindsurfClientDriver } from "../src/extension/mcp-clients/windsurf-client";
import { CodexClientDriver } from "../src/extension/mcp-clients/codex-client";
import { CopilotClientDriver } from "../src/extension/mcp-clients/copilot-client";

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
    const windowsPath = "C:\\Users\\Admin\\.vscode\\ai-artifacts\\ai-artifacts-review-mcp.mjs";
    const forwardSlashPath = "C:/Users/Admin/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs";

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
    const storedPath = "C:/Users/Admin/AppData/Roaming/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs";
    const mixedQueryPath = "c:\\Users\\Admin/AppData\\Roaming/.vscode\\ai-artifacts\\ai-artifacts-review-mcp.mjs";

    await upsertJsonMcpServer(targetFile, "ai_artifacts", storedPath);

    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", mixedQueryPath)).toBe(true);
    expect(await hasJsonMcpServer(targetFile, "ai_artifacts", storedPath)).toBe(true);
  });
});

describe("Client Drivers", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(os.tmpdir(), `ai-artifacts-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("Cursor driver initializes mcp.json cleanly", async () => {
    const cursorDriver = new CursorClientDriver();
    const customConfig = path.join(tempHome, ".cursor", "mcp.json");
    // Override configPath getter via prototype or custom property for isolation
    Object.defineProperty(cursorDriver, "configPath", { value: customConfig });

    const scriptPath = "C:/Users/Admin/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs";
    await cursorDriver.install(scriptPath);

    const check = await cursorDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = await fs.readFile(customConfig, "utf8");
    const json = JSON.parse(content);
    expect(json.mcpServers.ai_artifacts.command).toBe("node");
    expect(json.mcpServers.ai_artifacts.args[0]).toBe(scriptPath);
  });

  it("Claude driver initializes .claude.json while preserving root keys", async () => {
    const claudeDriver = new ClaudeClientDriver();
    const customConfig = path.join(tempHome, ".claude.json");
    await fs.writeFile(customConfig, JSON.stringify({ opusProMigrationComplete: true }), "utf8");
    Object.defineProperty(claudeDriver, "configPath", { value: customConfig });

    const scriptPath = "/Users/test/.vscode/ai-artifacts/ai-artifacts-review-mcp.mjs";
    await claudeDriver.install(scriptPath);

    const check = await claudeDriver.check(scriptPath);
    expect(check.status).toBe("ready");

    const content = await fs.readFile(customConfig, "utf8");
    const json = JSON.parse(content);
    expect(json.opusProMigrationComplete).toBe(true);
    expect(json.mcpServers.ai_artifacts.command).toBe("node");
    expect(json.mcpServers.ai_artifacts.args[0]).toBe(scriptPath);
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
});
