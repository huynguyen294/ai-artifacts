import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    joinPath: (base: { fsPath: string }, ...segments: string[]) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  },
}));

import {
  addInstalledClient,
  readInstalledClients,
} from "../src/extension/installed-client-state";
import {
  ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
  AntigravityClientDriver,
  ClaudeClientDriver,
  ClineClientDriver,
  CodexClientDriver,
  CopilotClientDriver,
  CursorClientDriver,
  WindsurfClientDriver,
} from "../src/extension/mcp-clients/index";
import { upsertJsonMcpServer, writeJsonConfig } from "../src/extension/mcp-clients/json-mcp-helper";
import { CODEX_UNEXPECTED_KEY_CONFLICT } from "../src/extension/mcp-config";
import {
  OFFICIAL_SKILL_DESCRIPTIONS,
  USER_CUSTOM_RULES_BEGIN,
  USER_CUSTOM_RULES_END,
} from "../src/extension/mcp-clients/skill-helper";
import {
  type ExistingInstalledIntegrationVersionReadResult,
  installSelectedIntegrations,
  readInstalledIntegrationVersion,
  setupBaseMcpServer,
  uninstallSelectedIntegrations,
  upgradeDetectedIntegrations,
  writeInstalledIntegrationVersion,
} from "../src/extension/workspace-integration";
import { resolveWorkSessionSupport } from "../src/extension/work-session-support";
import {
  managedInstalledClientsPath,
  managedIntegrationVersionPath,
  managedMcpScriptPath,
} from "../src/shared/artifact-files";
import {
  CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
  MCP_VERSION,
  WORK_SESSION_SKILL_VERSION,
  type McpClientId,
} from "../src/shared/contracts";

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function writeRawReceipt(
  receipt: {
    mcpVersion?: number;
    codexMcpVersion?: number;
    skills: Record<string, number>;
    sessionSkills?: Record<string, number>;
  },
  userHome: string,
): Promise<void> {
  const receiptPath = managedIntegrationVersionPath({ userHome });
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(
    receiptPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        ...receipt,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function readExistingSnapshot(userHome: string): Promise<ExistingInstalledIntegrationVersionReadResult> {
  const result = await readInstalledIntegrationVersion({ userHome });
  expect(result.status).not.toBe("missing");
  if (result.status === "missing") {
    throw new Error("Expected existing integration version receipt in test setup.");
  }
  return result;
}

function buildReviewSkillMarkdown(body = "# Core Instructions", customRules = ""): string {
  return [
    "---",
    "name: create-review-artifact",
    `description: ${OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!}`,
    "---",
    "",
    body,
    "",
    USER_CUSTOM_RULES_BEGIN,
    ...(customRules ? [customRules] : []),
    USER_CUSTOM_RULES_END,
    "",
  ].join("\n");
}

async function createSourceTree(sourceRoot: string, versionTag = "v2"): Promise<void> {
  const mcpScript = path.join(sourceRoot, "dist", "integration", "codex-artifacts-review-mcp.mjs");
  const reviewDir = path.join(sourceRoot, "skills", "create-review-artifact");
  const sessionDir = path.join(sourceRoot, "skills", "work-session");

  await fs.mkdir(path.dirname(mcpScript), { recursive: true });
  await fs.mkdir(path.join(reviewDir, "references"), { recursive: true });
  await fs.mkdir(path.join(reviewDir, "agents"), { recursive: true });
  await fs.mkdir(path.join(sessionDir, "agents"), { recursive: true });

  await fs.writeFile(mcpScript, `// MCP server ${versionTag}\n`, "utf8");
  await fs.writeFile(
    path.join(reviewDir, "SKILL.md"),
    buildReviewSkillMarkdown(`# Core Review ${versionTag}`),
    "utf8",
  );
  await fs.writeFile(path.join(reviewDir, "references", "storage-protocol.md"), `# Contract ${versionTag}\n`, "utf8");
  await fs.writeFile(path.join(reviewDir, "references", "recovery.md"), `# Recovery ${versionTag}\n`, "utf8");
  await fs.writeFile(path.join(reviewDir, "references", "ai-feedback.md"), `# Feedback ${versionTag}\n`, "utf8");
  await fs.writeFile(path.join(reviewDir, "agents", "openai.yaml"), `prompt: review-${versionTag}\n`, "utf8");
  await fs.writeFile(path.join(sessionDir, "SKILL.md"), `# Work Session ${versionTag}\n`, "utf8");
  await fs.writeFile(path.join(sessionDir, "agents", "openai.yaml"), `prompt: session-${versionTag}\n`, "utf8");
}

describe("Workspace Integration Auto-Upgrade Coordinator & Selection Policy", () => {
  let tempRoot: string;
  let tempHome: string;
  let sourceDir: string;
  let globalStoragePath: string;
  let context: any;
  let originalCodexHome: string | undefined;
  let originalAppData: string | undefined;

  beforeEach(async () => {
    tempRoot = path.join(
      os.tmpdir(),
      `ai-artifacts-phase1-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tempHome = path.join(tempRoot, "home");
    sourceDir = path.join(tempRoot, "extension");
    globalStoragePath = path.join(
      tempHome,
      "Code",
      "User",
      "globalStorage",
      "huynguyen294.ai-artifacts",
    );

    await fs.mkdir(tempHome, { recursive: true });
    await createSourceTree(sourceDir, "v-bundle");

    originalCodexHome = process.env.CODEX_HOME;
    originalAppData = process.env.APPDATA;
    process.env.CODEX_HOME = path.join(tempHome, ".codex");
    process.env.APPDATA = path.join(tempHome, "AppData", "Roaming");
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);

    context = {
      extensionUri: { fsPath: sourceDir },
      globalStorageUri: { fsPath: globalStoragePath },
    };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("installs all 7 clients individually through installSelectedIntegrations with recordClientSelection=false without calling driver check() or creating installed-clients.json", async () => {
    const ids = ["copilot", "cursor", "codex", "claude", "windsurf", "cline", "antigravity"] as const satisfies readonly McpClientId[];
    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(WindsurfClientDriver.prototype, "check"),
      vi.spyOn(ClineClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];

    for (const [idx, id] of ids.entries()) {
      const result = await installSelectedIntegrations(context, [id]);
      expect(result.failedClients).toEqual([]);
      expect(result.installedClients.map((client) => client.id)).toEqual([id]);
      expect(checkSpies[idx]).not.toHaveBeenCalled();
    }
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          claude: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });
  });

  it("installs all 7 clients with recordClientSelection=true without calling driver check() and does not record a client on install or state-write failure", async () => {
    const ids = ["copilot", "cursor", "codex", "claude", "windsurf", "cline", "antigravity"] as const satisfies readonly McpClientId[];
    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(WindsurfClientDriver.prototype, "check"),
      vi.spyOn(ClineClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];

    for (const id of ids) {
      const result = await installSelectedIntegrations(context, [id], { recordClientSelection: true });
      expect(result.failedClients).toEqual([]);
    }
    for (const spy of checkSpies) {
      expect(spy).not.toHaveBeenCalled();
    }

    expect(await readInstalledClients({ userHome: tempHome })).toEqual([...ids]);

    // Install failure blocks client recording and Claude skill receipt bump without calling check()
    await uninstallSelectedIntegrations(context, ["claude"], { recordClientSelection: true });
    await writeInstalledIntegrationVersion({ skills: { claude: 1 }, sessionSkills: { claude: 1 } }, { userHome: tempHome });
    vi.spyOn(ClaudeClientDriver.prototype, "install").mockRejectedValueOnce(
      new Error("Claude install failed cleanly"),
    );
    const claudeFailure = await installSelectedIntegrations(context, ["claude"], { recordClientSelection: true });
    expect(claudeFailure).toEqual({
      installedClients: [],
      failedClients: [{ id: "claude", name: "Claude", error: "Claude install failed cleanly" }],
    });
    expect(checkSpies[3]).not.toHaveBeenCalled();
    expect(await readInstalledClients({ userHome: tempHome })).not.toContain("claude");
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: { skills: { claude: 1 }, sessionSkills: { claude: 1 } },
    });

    // State write failure (installed-clients.json) is reported as a failed client and does NOT record it
    await uninstallSelectedIntegrations(context, ["cursor"], { recordClientSelection: true });
    const originalWriteFile = fs.writeFile.bind(fs);
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockImplementation(async (targetPath, data, options) => {
      if (String(targetPath).includes("installed-clients.json")) {
        throw Object.assign(new Error("injected client state write failed"), { code: "EIO" });
      }
      return originalWriteFile(targetPath, data as any, options as any);
    });
    const cursorFailure = await installSelectedIntegrations(context, ["cursor"], { recordClientSelection: true });
    writeFileSpy.mockRestore();
    expect(cursorFailure.installedClients).toEqual([]);
    expect(cursorFailure.failedClients).toHaveLength(1);
    expect(cursorFailure.failedClients[0]).toMatchObject({ id: "cursor" });
    expect(cursorFailure.failedClients[0]!.error).toContain("injected client state write failed");
    expect(checkSpies[1]).not.toHaveBeenCalled();
    expect(await readInstalledClients({ userHome: tempHome })).not.toContain("cursor");
  });

  it("installSelectedIntegrations returns empty without base writes when nothing is selected, aggregates partial failures once, leaves unselected saved-only clients untouched, and respects recordClientSelection", async () => {
    const emptyResult = await installSelectedIntegrations(context, [], { recordClientSelection: true });
    expect(emptyResult).toEqual({ installedClients: [], failedClients: [] });
    await expect(fs.access(managedMcpScriptPath({ userHome: tempHome }))).rejects.toThrow();
    await expect(fs.access(managedIntegrationVersionPath({ userHome: tempHome }))).rejects.toThrow();

    // Claude is saved-only (not selected, not configured on disk)
    await addInstalledClient("claude", { userHome: tempHome });

    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
    ];
    const runtimePath = path.resolve(managedMcpScriptPath({ userHome: tempHome }));
    const originalRename = fs.rename.bind(fs);
    const renameTargets: string[] = [];
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (oldPath, newPath) => {
      renameTargets.push(path.resolve(newPath.toString()));
      return originalRename(oldPath, newPath);
    });

    // Cursor fails install -> Codex after it MUST still install & be recorded; Cursor NOT recorded; Claude saved-only untouched
    vi.spyOn(CursorClientDriver.prototype, "install").mockRejectedValueOnce(
      new Error("Cursor install injected failure"),
    );

    const firstResult = await installSelectedIntegrations(context, ["copilot", "cursor", "codex"], {
      recordClientSelection: true,
    });
    expect(firstResult).toEqual({
      installedClients: [
        { id: "copilot", name: "GitHub Copilot (VS Code)" },
        { id: "codex", name: "Codex" },
      ],
      failedClients: [{ id: "cursor", name: "Cursor", error: "Cursor install injected failure" }],
    });
    for (const spy of checkSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(renameTargets.filter((target) => target === runtimePath)).toHaveLength(1);
    renameSpy.mockRestore();

    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "codex", "claude"]);
    // Claude was not selected, so install must not have created ~/.claude.json
    await expect(fs.access(path.join(tempHome, ".claude.json"))).rejects.toThrow();

    // Programmatic install without the flag installs without recording Cursor or Windsurf
    const programmaticResult = await installSelectedIntegrations(context, ["copilot", "cursor", "codex", "windsurf"]);
    expect(programmaticResult).toEqual({
      installedClients: [
        { id: "copilot", name: "GitHub Copilot (VS Code)" },
        { id: "cursor", name: "Cursor" },
        { id: "codex", name: "Codex" },
        { id: "windsurf", name: "Windsurf" },
      ],
      failedClients: [],
    });
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "codex", "claude"]);
  });

  it("handles uninstallSelectedIntegrations selection policies across single, programmatic, mid-way error, cleanupBase: false, and cleanupBase: true", async () => {
    await installSelectedIntegrations(context, ["copilot", "codex"], { recordClientSelection: true });

    // Selected uninstall removes the saved ID even when config is already absent (not configured)
    await fs.rm(path.join(process.env.CODEX_HOME!, "config.toml"));
    await fs.rm(process.env.CODEX_HOME!, { recursive: true, force: true });
    const codexResult = await uninstallSelectedIntegrations(context, ["codex"], { recordClientSelection: true });
    expect(codexResult).toEqual({
      uninstalledClients: [],
      notConfiguredClients: [{ id: "codex", name: "Codex" }],
      failedClients: [],
    });
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot"]);

    // Setup saved-only "windsurf" + "claude" and an installed "cursor" that is not saved
    await addInstalledClient("claude", { userHome: tempHome });
    await addInstalledClient("windsurf", { userHome: tempHome });
    await installSelectedIntegrations(context, ["cursor"]);

    // Programmatic uninstall (recordClientSelection=false) only touches selected clients, keeps saved entries and the receipt
    const claudeUninstallSpy = vi.spyOn(ClaudeClientDriver.prototype, "uninstall");
    const cursorResult = await uninstallSelectedIntegrations(context, ["cursor"]);
    expect(cursorResult.uninstalledClients).toEqual([{ id: "cursor", name: "Cursor" }]);
    expect(claudeUninstallSpy).not.toHaveBeenCalled();
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "claude", "windsurf"]);
    expect((await readInstalledIntegrationVersion({ userHome: tempHome })).status).toBe("valid");

    // Mid-way error removes earlier and later saved IDs but preserves the errored ID
    await installSelectedIntegrations(context, ["cursor"], { recordClientSelection: true });
    vi.spyOn(ClaudeClientDriver.prototype, "uninstall").mockRejectedValueOnce(new Error("claude uninstall I/O fail"));
    const partialResult = await uninstallSelectedIntegrations(
      context,
      ["copilot", "cursor", "claude", "windsurf"],
      { recordClientSelection: true },
    );
    expect(partialResult.failedClients).toEqual([
      { id: "claude", name: "Claude", error: "claude uninstall I/O fail" },
    ]);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["claude"]);

    // Manual uninstall (recordClientSelection=true, no shared cleanup) preserves other managed assets
    claudeUninstallSpy.mockClear();
    await uninstallSelectedIntegrations(context, ["claude"], { recordClientSelection: true });
    expect(claudeUninstallSpy).toHaveBeenCalledTimes(1);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual([]);
    await expect(fs.access(managedIntegrationVersionPath({ userHome: tempHome }))).resolves.toBeUndefined();
    await expect(fs.access(managedMcpScriptPath({ userHome: tempHome }))).resolves.toBeUndefined();

    // cleanupBase: true removes the shared managed directory including installed-clients.json once no client needs it
    await addInstalledClient("codex", { userHome: tempHome });
    await uninstallSelectedIntegrations(context, ["codex"], { recordClientSelection: true, cleanupBase: true });
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
    await expect(fs.access(managedMcpScriptPath({ userHome: tempHome }))).rejects.toThrow();
  });

  it("merges saved ∪ detected targets deduplicated in factory order, skips receipt/writes when empty, and includes saved-only Claude/Antigravity skill targets", async () => {
    const readVersionSpy = vi.spyOn(fs, "readFile");
    const emptyReport = await upgradeDetectedIntegrations(context, {
      status: "invalid",
      error: new Error("empty target test snapshot"),
    });
    expect(emptyReport).toEqual({
      clientIds: [],
      skillTargets: [],
      updatedAssets: [],
      clients: [],
    });
    expect(
      readVersionSpy.mock.calls.some(([p]) => String(p).endsWith("integration-version.json")),
    ).toBe(false);
    readVersionSpy.mockRestore();
    await expect(fs.access(path.join(tempHome, ".ai-artifacts", "managed", "runtime"))).rejects.toThrow();

    // Prepare Claude + Antigravity valid configs on disk but spy on isDetected to return false (saved-only simulation),
    // while Codex + Cursor are detected on disk and Codex is also in installed-clients.json (overlap deduplication)
    await addInstalledClient("antigravity", { userHome: tempHome });
    await addInstalledClient("codex", { userHome: tempHome });
    await addInstalledClient("claude", { userHome: tempHome });

    const targetScript = managedMcpScriptPath({ userHome: tempHome });
    await setupBaseMcpServer(context, { userHome: tempHome });
    await new CodexClientDriver().install(targetScript);
    await new CursorClientDriver().install(targetScript);

    const claudeDriver = new ClaudeClientDriver(
      undefined,
      undefined,
      path.join(sourceDir, "skills", "create-review-artifact"),
      undefined,
      path.join(sourceDir, "skills", "work-session"),
    );
    await claudeDriver.install(targetScript);
    const agDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkillDirectory: path.join(sourceDir, "skills", "work-session"),
    });
    await agDriver.install(targetScript);

    // Outdated Claude & Antigravity receipts (pre-session-skill entry for claude/antigravity) while base assets are current;
    // simulate detector missing Claude/Antigravity
    await writeRawReceipt(
      {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, claude: 1, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
      tempHome,
    );
    vi.spyOn(ClaudeClientDriver.prototype, "isDetected").mockReturnValue(false);
    vi.spyOn(AntigravityClientDriver.prototype, "isDetected").mockReturnValue(false);

    // Corrupt Claude/Antigravity on disk (missing SKILL.md) so stale receipt triggers real deployment despite isDetected=false
    await fs.rm(path.join(claudeDriver.skillDirectory, "SKILL.md"));
    await fs.rm(path.join(agDriver.sessionSkillDirectory, "SKILL.md"));

    const upgradeCheckSpies = [
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];
    const claudeAgSnapshot = await readExistingSnapshot(tempHome);
    const report = await upgradeDetectedIntegrations(context, claudeAgSnapshot);
    for (const spy of upgradeCheckSpies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    expect(report.clientIds).toEqual(["cursor", "codex", "claude", "antigravity"]);
    expect(report.skillTargets).toEqual(["agents", "claude", "antigravity"]);
    expect(report.updatedAssets).toEqual([
      "skill:claude",
      "session-skill:claude",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);
    expect(report.clients).toEqual([
      { id: "cursor", name: "Cursor", status: "unchanged" },
      { id: "codex", name: "Codex", status: "unchanged" },
      { id: "claude", name: "Claude", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "updated" },
    ]);
    expect((await claudeDriver.check(targetScript)).status).toBe("ready");
    expect((await agDriver.check(targetScript)).status).toBe("ready");
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["codex", "claude", "antigravity"]);
  });

  it("selectively syncs only stale shared assets without touching current assets or legacy paths, and rejects coordinator on base sync error", async () => {
    await fs.mkdir(path.join(tempHome, ".cursor"), { recursive: true });
    await setupBaseMcpServer(context, { userHome: tempHome });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    await new CursorClientDriver().install(targetMcp);

    const agentsReviewPath = path.join(tempHome, ".agents", "skills", "create-review-artifact", "SKILL.md");
    const agentsSessionPath = path.join(tempHome, ".agents", "skills", "work-session", "SKILL.md");

    // Seed legacy artifacts that install cleans up, verify upgrade does NOT delete them
    const legacyScript = path.join(tempHome, ".vscode", "ai-artifacts", "ai-artifacts-review-mcp.mjs");
    const legacySkill = path.join(tempHome, ".agents", "skills", "create-plan-artifact", "SKILL.md");
    await fs.mkdir(path.dirname(legacyScript), { recursive: true });
    await fs.mkdir(path.dirname(legacySkill), { recursive: true });
    await fs.writeFile(legacyScript, "// keep legacy during upgrade\n", "utf8");
    await fs.writeFile(legacySkill, "# keep legacy skill during upgrade\n", "utf8");

    // Make ONLY runtime stale; write distinct marker bytes into target agents skill to ensure it's untouched
    await fs.writeFile(agentsReviewPath, "# untouched review sentinel\n", "utf8");
    await fs.writeFile(agentsSessionPath, "# untouched session sentinel\n", "utf8");
    await fs.writeFile(targetMcp, "// old runtime\n", "utf8");
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, claude: 2 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
      { userHome: tempHome },
    );

    const runtimeStaleSnapshot = await readExistingSnapshot(tempHome);
    const runtimeOnlyReport = await upgradeDetectedIntegrations(context, runtimeStaleSnapshot);
    expect(runtimeOnlyReport.updatedAssets).toEqual(["mcp"]);
    await expect(fs.readFile(targetMcp, "utf8")).resolves.toBe("// MCP server v-bundle\n");
    await expect(fs.readFile(agentsReviewPath, "utf8")).resolves.toBe("# untouched review sentinel\n");
    await expect(fs.readFile(agentsSessionPath, "utf8")).resolves.toBe("# untouched session sentinel\n");
    await expect(fs.readFile(legacyScript, "utf8")).resolves.toBe("// keep legacy during upgrade\n");
    await expect(fs.readFile(legacySkill, "utf8")).resolves.toBe("# keep legacy skill during upgrade\n");
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, claude: 2 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
    });

    // Make ONLY session-skill:agents stale (omitted in receipt); runtime & review skill stay untouched
    await fs.writeFile(targetMcp, "// sentinel runtime\n", "utf8");
    await writeRawReceipt(
      {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
      },
      tempHome,
    );
    const sessionStaleSnapshot = await readExistingSnapshot(tempHome);
    const sessionOnlyReport = await upgradeDetectedIntegrations(context, sessionStaleSnapshot);
    expect(sessionOnlyReport.updatedAssets).toEqual(["session-skill:agents"]);
    await expect(fs.readFile(targetMcp, "utf8")).resolves.toBe("// sentinel runtime\n");
    await expect(fs.readFile(agentsReviewPath, "utf8")).resolves.toBe("# untouched review sentinel\n");
    await expect(fs.readFile(agentsSessionPath, "utf8")).resolves.toBe("# Work Session v-bundle\n");

    // Missing shared source aborts coordinator before running any driver upgrade()
    const cursorUpgradeSpy = vi.spyOn(CursorClientDriver.prototype, "upgrade");
    await fs.rm(path.join(sourceDir, "dist", "integration", "codex-artifacts-review-mcp.mjs"));
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: 1,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
      { userHome: tempHome },
    );
    const abortedBaseSnapshot = await readExistingSnapshot(tempHome);
    await expect(upgradeDetectedIntegrations(context, abortedBaseSnapshot)).rejects.toThrow();
    expect(cursorUpgradeSpy).not.toHaveBeenCalled();
    expect((await readInstalledIntegrationVersion({ userHome: tempHome }))).toMatchObject({
      status: "valid",
      manifest: { mcpVersion: 1 },
    });
  });

  it("maps driver exceptions to failed, upgrades stale Claude/Antigravity skills regardless of JSON config state while preserving customizations, leaves current receipts untouched, and leaves JSON drivers unchanged", async () => {
    await setupBaseMcpServer(context, { userHome: tempHome });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    const copilotDriver = new CopilotClientDriver(path.resolve(globalStoragePath, "..", "..", "mcp.json"));
    const cursorDriver = new CursorClientDriver();
    const codexDriver = new CodexClientDriver();
    const claudeDriver = new ClaudeClientDriver(
      undefined,
      undefined,
      path.join(sourceDir, "skills", "create-review-artifact"),
      undefined,
      path.join(sourceDir, "skills", "work-session"),
    );
    const agDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkillDirectory: path.join(sourceDir, "skills", "work-session"),
    });

    await copilotDriver.install(targetMcp);
    await cursorDriver.install(targetMcp);
    await codexDriver.install(targetMcp);
    await claudeDriver.install(targetMcp);
    await agDriver.install(targetMcp);

    // Independent customizations in all 3 skill targets
    await fs.writeFile(
      path.join(tempHome, ".agents", "skills", "create-review-artifact", "SKILL.md"),
      buildReviewSkillMarkdown("# Old Agents", "- Agents custom rule").replace(
        OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!,
        "Agents custom description.",
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(claudeDriver.skillDirectory, "SKILL.md"),
      buildReviewSkillMarkdown("# Old Claude", "- Claude custom rule").replace(
        OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!,
        "Claude custom description.",
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(agDriver.skillDirectory, "SKILL.md"),
      buildReviewSkillMarkdown("# Old Antigravity", "- Antigravity custom rule").replace(
        OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!,
        "Antigravity custom description.",
      ),
      "utf8",
    );

    // Corrupt Cursor & Antigravity JSON configs and remove ~/.claude.json:
    // JSON drivers are unchanged without reading config; Claude/Antigravity upgrade stale skills without inspecting config.
    await fs.writeFile(cursorDriver.configPath, "{ broken cursor", "utf8");
    await fs.writeFile(agDriver.configPath, "{ broken antigravity", "utf8");
    await fs.rm(claudeDriver.configPath);

    await writeRawReceipt(
      {
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: 1, claude: 1, antigravity: 1 },
      },
      tempHome,
    );

    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];
    vi.spyOn(CopilotClientDriver.prototype, "upgrade").mockRejectedValueOnce(new Error("copilot boom"));

    const allStaleSnapshot = await readExistingSnapshot(tempHome);
    const report = await upgradeDetectedIntegrations(context, allStaleSnapshot);
    for (const spy of checkSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(report.updatedAssets).toEqual([
      "mcp",
      "skill:agents",
      "session-skill:agents",
      "skill:claude",
      "session-skill:claude",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);
    expect(report.clients).toEqual([
      { id: "copilot", name: "GitHub Copilot (VS Code)", status: "failed", detail: "copilot boom" },
      { id: "cursor", name: "Cursor", status: "unchanged" },
      { id: "codex", name: "Codex", status: "unchanged" },
      { id: "claude", name: "Claude", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "updated" },
    ]);

    // Verify independent customizations survived without cross-contamination, configs untouched, and mcpVersion committed
    const agentsAfter = await fs.readFile(path.join(tempHome, ".agents", "skills", "create-review-artifact", "SKILL.md"), "utf8");
    const claudeAfter = await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8");
    const agAfter = await fs.readFile(path.join(agDriver.skillDirectory, "SKILL.md"), "utf8");
    expect(agentsAfter).toContain("Agents custom description.");
    expect(agentsAfter).toContain("- Agents custom rule");
    expect(agentsAfter).not.toContain("Claude custom");
    expect(claudeAfter).toContain("Claude custom description.");
    expect(claudeAfter).toContain("- Claude custom rule");
    expect(claudeAfter).not.toContain("Agents custom");
    expect(agAfter).toContain("Antigravity custom description.");
    expect(agAfter).toContain("- Antigravity custom rule");
    expect(agAfter).not.toContain("Claude custom");
    await expect(fs.readFile(cursorDriver.configPath, "utf8")).resolves.toBe("{ broken cursor");
    await expect(fs.readFile(agDriver.configPath, "utf8")).resolves.toBe("{ broken antigravity");
    await expect(fs.access(claudeDriver.configPath)).rejects.toThrow();
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          claude: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          claude: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });

    // Current receipt + modified/missing Claude skill on disk -> NOT scanned, does not read receipt for stale decision, and stays unchanged
    const currentButModifiedContent = buildReviewSkillMarkdown("# Tampered Core", "- Keep custom").replace(
      OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!,
      "Tampered.",
    );
    await fs.writeFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), currentButModifiedContent, "utf8");
    const currentSnapshot = await readExistingSnapshot(tempHome);
    const originalNoOpReadFile = fs.readFile.bind(fs);
    const noOpReadPaths: string[] = [];
    const noOpReadSpy = vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
      noOpReadPaths.push(path.resolve(filePath.toString()));
      return originalNoOpReadFile(filePath, options);
    }) as any);
    const currentButModifiedDisk = await upgradeDetectedIntegrations(context, currentSnapshot);
    noOpReadSpy.mockRestore();
    expect(noOpReadPaths).not.toContain(path.resolve(managedIntegrationVersionPath({ userHome: tempHome })));
    expect(currentButModifiedDisk.updatedAssets).toEqual([]);
    expect(currentButModifiedDisk.clients.find((c) => c.id === "claude")).toEqual({
      id: "claude",
      name: "Claude",
      status: "unchanged",
    });
    await expect(fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8")).resolves.toBe(
      currentButModifiedContent,
    );

    await fs.rm(path.join(claudeDriver.skillDirectory, "SKILL.md"));
    const currentMissingReadPaths: string[] = [];
    const noOpMissingReadSpy = vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
      currentMissingReadPaths.push(path.resolve(filePath.toString()));
      return originalNoOpReadFile(filePath, options);
    }) as any);
    const currentButMissingDisk = await upgradeDetectedIntegrations(context, currentSnapshot);
    noOpMissingReadSpy.mockRestore();
    expect(currentMissingReadPaths).not.toContain(path.resolve(managedIntegrationVersionPath({ userHome: tempHome })));
    expect(currentButMissingDisk.updatedAssets).toEqual([]);
    expect(currentButMissingDisk.clients.find((c) => c.id === "claude")).toEqual({
      id: "claude",
      name: "Claude",
      status: "unchanged",
    });
    await expect(fs.access(path.join(claudeDriver.skillDirectory, "SKILL.md"))).rejects.toThrow();

    // Missing Claude packaged source when ONLY Claude skill is stale (agents is current) -> throws -> failed before touching target
    await fs.rm(cursorDriver.configPath);
    await fs.rm(agDriver.configPath);
    await cursorDriver.install(targetMcp);
    await agDriver.install(targetMcp);
    await claudeDriver.install(targetMcp);
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          claude: 1,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          claude: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
      { userHome: tempHome },
    );
    const claudeBeforeHash = sha256(await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md")));
    await fs.rm(path.join(sourceDir, "skills", "create-review-artifact", "references", "ai-feedback.md"));

    const claudeMissingSrcSnapshot = await readExistingSnapshot(tempHome);
    const claudeMissingSrcReport = await upgradeDetectedIntegrations(context, claudeMissingSrcSnapshot);
    expect(claudeMissingSrcReport.clients.find((c) => c.id === "claude")).toMatchObject({
      id: "claude",
      name: "Claude",
      status: "failed",
    });
    expect(claudeMissingSrcReport.updatedAssets).not.toContain("skill:claude");
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: { skills: { claude: 1 } },
    });
    expect(sha256(await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md")))).toBe(claudeBeforeHash);
    for (const spy of checkSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("preserves per-client skill receipt on operation or receipt-write failure, still commits mcpVersion when runtime and Codex succeed, and rejects when final MCP receipt commit fails", async () => {
    await setupBaseMcpServer(context, { userHome: tempHome });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    const codexDriver = new CodexClientDriver();
    const agDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkillDirectory: path.join(sourceDir, "skills", "work-session"),
    });
    await codexDriver.install(targetMcp);
    await agDriver.install(targetMcp);
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
      { userHome: tempHome },
    );

    // 1. Only Antigravity skill upgrade throws while runtime + Codex succeed -> Antigravity fails & preserves 1, but mcpVersion commits MCP_VERSION
    vi.spyOn(AntigravityClientDriver.prototype, "upgrade").mockRejectedValueOnce(
      new Error("antigravity skill update failed"),
    );
    const agFailSnapshot = await readExistingSnapshot(tempHome);
    const report = await upgradeDetectedIntegrations(context, agFailSnapshot);
    expect(report.updatedAssets).toEqual(["mcp"]);
    expect(report.clients).toEqual([
      { id: "codex", name: "Codex", status: "unchanged" },
      {
        id: "antigravity",
        name: "Antigravity",
        status: "failed",
        detail: "antigravity skill update failed",
      },
    ]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { antigravity: 1 },
        sessionSkills: { antigravity: 1 },
      },
    });

    // 2. Per-client receipt commit I/O failure: client becomes failed, updatedAssets excludes it, receipt stays 1
    const receiptFailSnapshot = await readExistingSnapshot(tempHome);
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (targetPath, data, options) => {
      if (String(targetPath).includes("integration-version.json")) {
        throw Object.assign(new Error("receipt write I/O failed"), { code: "EIO" });
      }
      return originalWriteFile(targetPath, data as any, options as any);
    });
    const receiptFailReport = await upgradeDetectedIntegrations(context, receiptFailSnapshot);
    expect(receiptFailReport.updatedAssets).toEqual([]);
    expect(receiptFailReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "unchanged" },
      {
        id: "antigravity",
        name: "Antigravity",
        status: "failed",
        detail: "receipt write I/O failed",
        errorCode: "EIO",
      },
    ]);
    vi.restoreAllMocks();
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        skills: { antigravity: 1 },
        sessionSkills: { antigravity: 1 },
      },
    });

    // 3. Final deferred MCP receipt commit I/O failure rejects the coordinator with the root write error
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION - 1,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
      { userHome: tempHome },
    );
    const finalReceiptFailSnapshot = await readExistingSnapshot(tempHome);
    const originalWriteFileForFinal = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (targetPath, data, options) => {
      if (String(targetPath).includes("integration-version.json")) {
        throw Object.assign(new Error("final mcp receipt write failed"), { code: "EIO" });
      }
      return originalWriteFileForFinal(targetPath, data as any, options as any);
    });
    await expect(upgradeDetectedIntegrations(context, finalReceiptFailSnapshot)).rejects.toThrow("final mcp receipt write failed");
    vi.restoreAllMocks();
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: { mcpVersion: MCP_VERSION - 1 },
    });
  });

  it("defers MCP receipt until Codex migration succeeds, commits Skill receipts independently, and skips Codex config read once current", async () => {
    await fs.mkdir(process.env.CODEX_HOME!, { recursive: true });
    await fs.mkdir(path.join(tempHome, ".gemini", "antigravity"), { recursive: true });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    await setupBaseMcpServer(context, { userHome: tempHome });

    // Seed Antigravity with custom rules + permission settings and outdated skill receipt
    const geminiRules = path.join(tempHome, ".gemini", "GEMINI.md");
    const globalRule = path.join(tempHome, ".gemini", "config", "rules", "my-rule.md");
    await fs.mkdir(path.dirname(globalRule), { recursive: true });
    await fs.writeFile(geminiRules, "# My GEMINI\n", "utf8");
    await fs.writeFile(globalRule, "# My Policy\n", "utf8");
    const agDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkillDirectory: path.join(sourceDir, "skills", "work-session"),
    });
    await writeJsonConfig(agDriver.configPath, {
      mcpServers: {
        ai_artifacts: {
          command: "node",
          args: [targetMcp.replaceAll("\\", "/")],
          timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
          disabled: false,
          disabledTools: ["join_session"],
        },
      },
    });
    const agConfigBefore = await fs.readFile(agDriver.configPath, "utf8");

    // Seed Codex with legacy 5-tool managed config (missing join_session) + outdated MCP receipt
    const codexConfigPath = path.join(process.env.CODEX_HOME!, "config.toml");
    await fs.writeFile(
      codexConfigPath,
      [
        "# >>> AI Artifacts review MCP >>>",
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = [${JSON.stringify(targetMcp)}]`,
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
        "# <<< AI Artifacts review MCP <<<",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeRawReceipt(
      {
        mcpVersion: 11,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
      tempHome,
    );

    // First run: shared MCP copies ("mcp" in updatedAssets) and commits shared mcpVersion=12 while keeping
    // codexMcpVersion=11 pending because Codex failed during migration; Antigravity upgrades & commits its skill receipts.
    vi.spyOn(CodexClientDriver.prototype, "upgrade").mockRejectedValueOnce(new Error("transient config write failure"));

    const firstSnapshot = await readExistingSnapshot(tempHome);
    const firstReport = await upgradeDetectedIntegrations(context, firstSnapshot);
    expect(firstReport.updatedAssets).toEqual([
      "mcp",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);
    expect(firstReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "failed", detail: "transient config write failure" },
      { id: "antigravity", name: "Antigravity", status: "updated" },
    ]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: 11,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });
    await expect(resolveWorkSessionSupport({ userHome: tempHome })).resolves.toMatchObject({
      supported: true,
      installedMcpVersion: MCP_VERSION,
      requiredMcpVersion: MCP_VERSION,
    });
    await expect(fs.readFile(agDriver.configPath, "utf8")).resolves.toBe(agConfigBefore);
    await expect(fs.readFile(geminiRules, "utf8")).resolves.toBe("# My GEMINI\n");
    await expect(fs.readFile(globalRule, "utf8")).resolves.toBe("# My Policy\n");
    await expect(fs.access(path.join(tempHome, ".gemini", "config", "ai-artifacts-review-mcp.mjs"))).rejects.toThrow();

    // Second run: shared MCP is already 12 (updatedAssets: []), while Codex sees codexMcpVersion=11 -> patches join_session & commits codexMcpVersion=12
    const retrySnapshot = await readExistingSnapshot(tempHome);
    const retryReport = await upgradeDetectedIntegrations(context, retrySnapshot);
    expect(retryReport.updatedAssets).toEqual([]);
    expect(retryReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: MCP_VERSION,
      },
    });
    const codexPatched = await fs.readFile(codexConfigPath, "utf8");
    expect(codexPatched).toContain("[mcp_servers.ai_artifacts.tools.inspect_artifact]");
    expect(codexPatched).toContain("[mcp_servers.ai_artifacts.tools.update_artifact]");
    expect(codexPatched).toContain("[mcp_servers.ai_artifacts.tools.join_session]");
    expect(codexPatched).not.toContain("[mcp_servers.ai_artifacts.tools.inspect_artifact_review]");
    expect(codexPatched).not.toContain("[mcp_servers.ai_artifacts.tools.advance_and_wait_for_artifact]");

    // Third run: both mcpVersion and codexMcpVersion are now at 12, so Codex & Antigravity neither read receipt/config nor rewrite files
    const beforeThird = codexPatched;
    const thirdSnapshot = await readExistingSnapshot(tempHome);
    const originalReadFile = fs.readFile.bind(fs);
    const readPaths: string[] = [];
    vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
      readPaths.push(path.resolve(filePath.toString()));
      return originalReadFile(filePath, options);
    }) as any);
    const renameSpy = vi.spyOn(fs, "rename");
    const thirdReport = await upgradeDetectedIntegrations(context, thirdSnapshot);
    expect(thirdReport.updatedAssets).toEqual([]);
    expect(thirdReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "unchanged" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    expect(renameSpy).not.toHaveBeenCalled();
    expect(readPaths).not.toContain(path.resolve(managedIntegrationVersionPath({ userHome: tempHome })));
    expect(readPaths).not.toContain(path.resolve(codexConfigPath));
    expect(readPaths).not.toContain(path.resolve(agDriver.configPath));
    expect(readPaths).not.toContain(path.resolve(targetMcp));
    await expect(fs.readFile(codexConfigPath, "utf8")).resolves.toBe(beforeThird);

    // Upgrade never created or modified installed-clients.json
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
  });

  it("upgrades stale shared assets when an existing user passes an invalid version snapshot with detector-only targets", async () => {
    await fs.mkdir(path.join(tempHome, ".cursor"), { recursive: true });
    await new CursorClientDriver().install(managedMcpScriptPath({ userHome: tempHome }));
    const receiptPath = managedIntegrationVersionPath({ userHome: tempHome });
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.writeFile(receiptPath, "{ corrupted receipt json", "utf8");

    const invalidSnapshot = await readExistingSnapshot(tempHome);
    expect(invalidSnapshot.status).toBe("invalid");

    const report = await upgradeDetectedIntegrations(context, invalidSnapshot);
    expect(report).toEqual({
      clientIds: ["cursor"],
      skillTargets: ["agents"],
      updatedAssets: ["mcp", "skill:agents", "session-skill:agents"],
      clients: [{ id: "cursor", name: "Cursor", status: "unchanged" }],
    });
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
    });
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
  });

  it("replaces markerless whitelisted Codex configs cleanly and fails closed with errorCode on unexpected keys while upgrading sibling clients", async () => {
    await fs.mkdir(process.env.CODEX_HOME!, { recursive: true });
    await fs.mkdir(path.join(tempHome, ".gemini", "antigravity"), { recursive: true });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    await setupBaseMcpServer(context, { userHome: tempHome });

    const codexConfigPath = path.join(process.env.CODEX_HOME!, "config.toml");

    // 1. Markerless 5-tool whitelisted override replaces cleanly into canonical 6-tool managed block
    await fs.writeFile(
      codexConfigPath,
      [
        "[mcp_servers.ai_artifacts]",
        'command = "node"',
        `args = [${JSON.stringify(targetMcp)}]`,
        "tool_timeout_sec = 180",
        'default_tools_approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.resolve_artifact_window]",
        'approval_mode = "approve"',
        "",
        "[mcp_servers.ai_artifacts.tools.create_artifact]",
        'approval_mode = "never"',
      ].join("\n"),
      "utf8",
    );
    await writeRawReceipt(
      {
        mcpVersion: 11,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: WORK_SESSION_SKILL_VERSION },
      },
      tempHome,
    );

    const markerlessSnapshot = await readExistingSnapshot(tempHome);
    const markerlessReport = await upgradeDetectedIntegrations(context, markerlessSnapshot);
    expect(markerlessReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    const replacedCodex = await fs.readFile(codexConfigPath, "utf8");
    expect(replacedCodex).toContain("# >>> AI Artifacts review MCP >>>");
    expect(replacedCodex).toContain("tool_timeout_sec = 3600");
    expect(replacedCodex).toContain('[mcp_servers.ai_artifacts.tools.create_artifact]\napproval_mode = "approve"');
    expect(replacedCodex).toContain('[mcp_servers.ai_artifacts.tools.join_session]\napproval_mode = "approve"');
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: { mcpVersion: MCP_VERSION },
    });

    // 2. Unexpected key fails closed with CODEX_UNEXPECTED_KEY_CONFLICT and keeps codexMcpVersion=11 while committing shared mcpVersion=12 & upgrading Antigravity
    const conflictToml = [
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      `args = [${JSON.stringify(targetMcp)}]`,
      'followUpQueueMode = "steer"',
      "",
    ].join("\n");
    await fs.writeFile(codexConfigPath, conflictToml, "utf8");
    await writeRawReceipt(
      {
        mcpVersion: 11,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
      tempHome,
    );

    const conflictSnapshot = await readExistingSnapshot(tempHome);
    const conflictReport = await upgradeDetectedIntegrations(context, conflictSnapshot);
    expect(conflictReport.updatedAssets).toEqual([
      "mcp",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);
    expect(conflictReport.clients).toHaveLength(2);
    expect(conflictReport.clients[0]).toMatchObject({
      id: "codex",
      name: "Codex",
      status: "failed",
      errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
    });
    expect(conflictReport.clients[0]!.detail).toContain("followUpQueueMode");
    expect(conflictReport.clients[1]).toEqual({
      id: "antigravity",
      name: "Antigravity",
      status: "updated",
    });
    await expect(fs.readFile(codexConfigPath, "utf8")).resolves.toBe(conflictToml);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: 11,
        skills: {
          agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
          antigravity: CREATE_REVIEW_ARTIFACT_SKILL_VERSION,
        },
        sessionSkills: {
          agents: WORK_SESSION_SKILL_VERSION,
          antigravity: WORK_SESSION_SKILL_VERSION,
        },
      },
    });
    await expect(resolveWorkSessionSupport({ userHome: tempHome })).resolves.toMatchObject({
      supported: true,
      installedMcpVersion: MCP_VERSION,
      requiredMcpVersion: MCP_VERSION,
    });

    // 3. Removing the unexpected key lets the next automatic upgrade succeed and commit codexMcpVersion=MCP_VERSION without re-copying MCP
    await fs.writeFile(
      codexConfigPath,
      conflictToml.replace('followUpQueueMode = "steer"\n', ""),
      "utf8",
    );
    const resolvedSnapshot = await readExistingSnapshot(tempHome);
    const resolvedReport = await upgradeDetectedIntegrations(context, resolvedSnapshot);
    expect(resolvedReport.updatedAssets).toEqual([]);
    expect(resolvedReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: MCP_VERSION,
      },
    });
  });

  it("treats pre-existing v12 receipts without codexMcpVersion as current for Codex with zero config I/O", async () => {
    await fs.mkdir(process.env.CODEX_HOME!, { recursive: true });
    await setupBaseMcpServer(context, { userHome: tempHome });
    const codexDriver = new CodexClientDriver();
    await codexDriver.install(managedMcpScriptPath({ userHome: tempHome }));
    await writeRawReceipt(
      {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION },
      },
      tempHome,
    );

    const originalReadFile = fs.readFile.bind(fs);
    const readPaths: string[] = [];
    vi.spyOn(fs, "readFile").mockImplementation((async (filePath: any, options: any) => {
      readPaths.push(path.resolve(filePath.toString()));
      return originalReadFile(filePath, options);
    }) as any);

    const snapshot = await readExistingSnapshot(tempHome);
    const report = await upgradeDetectedIntegrations(context, snapshot);
    expect(report.updatedAssets).toEqual([]);
    expect(report.clients).toEqual([{ id: "codex", name: "Codex", status: "unchanged" }]);
    expect(readPaths).not.toContain(path.resolve(codexDriver.configPath));
  });

  it("persists codexMcpVersion=0 when Codex fails migration on an invalid receipt and retries without re-copying MCP", async () => {
    await fs.mkdir(process.env.CODEX_HOME!, { recursive: true });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    const codexConfigPath = path.join(process.env.CODEX_HOME!, "config.toml");
    const conflictToml = [
      "[mcp_servers.ai_artifacts]",
      'command = "node"',
      `args = [${JSON.stringify(targetMcp)}]`,
      'followUpQueueMode = "steer"',
      "",
    ].join("\n");
    await fs.writeFile(codexConfigPath, conflictToml, "utf8");

    const receiptPath = managedIntegrationVersionPath({ userHome: tempHome });
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.writeFile(receiptPath, "{ invalid json", "utf8");

    const invalidSnapshot = await readExistingSnapshot(tempHome);
    const firstReport = await upgradeDetectedIntegrations(context, invalidSnapshot);
    expect(firstReport.updatedAssets).toEqual(["mcp", "skill:agents", "session-skill:agents"]);
    expect(firstReport.clients).toHaveLength(1);
    expect(firstReport.clients[0]).toMatchObject({
      id: "codex",
      status: "failed",
      errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
    });
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: 0,
      },
    });
    await expect(resolveWorkSessionSupport({ userHome: tempHome })).resolves.toMatchObject({
      supported: true,
      installedMcpVersion: MCP_VERSION,
      requiredMcpVersion: MCP_VERSION,
    });

    // Second run while still conflicted must skip redundant receipt rewrites
    const renameWhileConflictedSpy = vi.spyOn(fs, "rename");
    const secondConflictedReport = await upgradeDetectedIntegrations(
      context,
      await readExistingSnapshot(tempHome),
    );
    expect(secondConflictedReport.updatedAssets).toEqual([]);
    expect(secondConflictedReport.clients[0]).toMatchObject({
      id: "codex",
      status: "failed",
      errorCode: CODEX_UNEXPECTED_KEY_CONFLICT,
    });
    expect(renameWhileConflictedSpy).not.toHaveBeenCalled();

    // Clearing the conflict lets the next startup upgrade Codex and advance codexMcpVersion=12
    await fs.writeFile(
      codexConfigPath,
      conflictToml.replace('followUpQueueMode = "steer"\n', ""),
      "utf8",
    );
    const resolvedReport = await upgradeDetectedIntegrations(
      context,
      await readExistingSnapshot(tempHome),
    );
    expect(resolvedReport.updatedAssets).toEqual([]);
    expect(resolvedReport.clients).toEqual([{ id: "codex", name: "Codex", status: "updated" }]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        mcpVersion: MCP_VERSION,
        codexMcpVersion: MCP_VERSION,
      },
    });
  });
});
