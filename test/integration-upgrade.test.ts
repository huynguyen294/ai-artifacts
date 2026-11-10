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
import {
  OFFICIAL_SKILL_DESCRIPTIONS,
  USER_CUSTOM_RULES_BEGIN,
  USER_CUSTOM_RULES_END,
} from "../src/extension/mcp-clients/skill-helper";
import {
  installAllDetectedIntegrations,
  installAntigravityIntegration,
  installClaudeIntegration,
  installClineIntegration,
  installCodexIntegration,
  installCopilotIntegration,
  installCursorIntegration,
  installWindsurfIntegration,
  readInstalledIntegrationVersion,
  setupBaseMcpServer,
  uninstallAllDetectedIntegrations,
  uninstallAntigravityIntegration,
  uninstallClaudeIntegration,
  uninstallClineIntegration,
  uninstallCodexIntegration,
  uninstallCopilotIntegration,
  uninstallCursorIntegration,
  uninstallWindsurfIntegration,
  upgradeDetectedIntegrations,
  writeInstalledIntegrationVersion,
} from "../src/extension/workspace-integration";
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
  await fs.writeFile(path.join(reviewDir, "references", "artifact-contract.md"), `# Contract ${versionTag}\n`, "utf8");
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

  it("verifies all 7 individual drivers on install with recordClientSelection=false without creating installed-clients.json", async () => {
    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(WindsurfClientDriver.prototype, "check"),
      vi.spyOn(ClineClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];

    const individualInstallers = [
      () => installCopilotIntegration(context),
      () => installCursorIntegration(context),
      () => installCodexIntegration(context),
      () => installClaudeIntegration(context),
      () => installWindsurfIntegration(context),
      () => installClineIntegration(context),
      () => installAntigravityIntegration(context),
    ];

    for (const [idx, runInstall] of individualInstallers.entries()) {
      await runInstall();
      expect(checkSpies[idx]).toHaveBeenCalledTimes(1);
    }
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
  });

  it("verifies all 7 individual drivers on install with recordClientSelection=true and rejects non-ready check without recording", async () => {
    const checkSpies = [
      vi.spyOn(CopilotClientDriver.prototype, "check"),
      vi.spyOn(CursorClientDriver.prototype, "check"),
      vi.spyOn(CodexClientDriver.prototype, "check"),
      vi.spyOn(ClaudeClientDriver.prototype, "check"),
      vi.spyOn(WindsurfClientDriver.prototype, "check"),
      vi.spyOn(ClineClientDriver.prototype, "check"),
      vi.spyOn(AntigravityClientDriver.prototype, "check"),
    ];

    const recordedInstallers: Array<() => Promise<unknown>> = [
      () => installAntigravityIntegration(context, { recordClientSelection: true }),
      () => installCopilotIntegration(context, { recordClientSelection: true }),
      () => installCursorIntegration(context, { recordClientSelection: true }),
      () => installCodexIntegration(context, { recordClientSelection: true }),
      () => installClaudeIntegration(context, { recordClientSelection: true }),
      () => installWindsurfIntegration(context, { recordClientSelection: true }),
      () => installClineIntegration(context, { recordClientSelection: true }),
    ];

    for (const [idx, runInstall] of recordedInstallers.entries()) {
      await runInstall();
      // Every driver check ran once per install (including Claude & Antigravity)
      const spyIndex = idx === 0 ? 6 : idx - 1;
      expect(checkSpies[spyIndex]).toHaveBeenCalledTimes(1);
    }

    expect(await readInstalledClients({ userHome: tempHome })).toEqual([
      "copilot",
      "cursor",
      "codex",
      "claude",
      "windsurf",
      "cline",
      "antigravity",
    ]);

    // Check failure throws with client name + detail/status and does NOT record client ID
    await uninstallClaudeIntegration({ recordClientSelection: true });
    vi.spyOn(ClaudeClientDriver.prototype, "check").mockResolvedValueOnce({
      status: "outdated",
      detail: "Claude verification failed cleanly",
    });
    await expect(installClaudeIntegration(context, { recordClientSelection: true })).rejects.toThrow(
      "Claude integration verification failed after installation: Claude verification failed cleanly",
    );
    expect(await readInstalledClients({ userHome: tempHome })).not.toContain("claude");

    vi.spyOn(CursorClientDriver.prototype, "check").mockResolvedValueOnce({ status: "missing" });
    await uninstallCursorIntegration({ recordClientSelection: true });
    await expect(installCursorIntegration(context, { recordClientSelection: true })).rejects.toThrow(
      "Cursor integration verification failed after installation: missing",
    );
    expect(await readInstalledClients({ userHome: tempHome })).not.toContain("cursor");
  });

  it("installAllDetectedIntegrations retains clients completed before failure, does not install saved-only clients, and updates selection incrementally", async () => {
    // Only Copilot & Codex directories are detected; Claude is saved-only (not detected on disk)
    const copilotDir = path.resolve(globalStoragePath, "..", "..");
    await fs.mkdir(copilotDir, { recursive: true });
    await fs.mkdir(process.env.CODEX_HOME!, { recursive: true });
    await fs.mkdir(path.join(tempHome, ".cursor"), { recursive: true });
    await addInstalledClient("claude", { userHome: tempHome });

    // Cursor fails on check() -> Copilot completed before Cursor must remain recorded, Cursor NOT recorded, Claude saved-only untouched
    vi.spyOn(CursorClientDriver.prototype, "check").mockResolvedValueOnce({
      status: "missing",
      detail: "Cursor check injected failure",
    });

    await expect(
      installAllDetectedIntegrations(context, { recordClientSelection: true }),
    ).rejects.toThrow("Cursor integration verification failed after installation: Cursor check injected failure");

    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "claude"]);
    // Claude was saved-only, so Install All must not have created ~/.claude.json
    await expect(fs.access(path.join(tempHome, ".claude.json"))).rejects.toThrow();
    // Programmatic Install All without flag does not add Codex even on full success
    await installAllDetectedIntegrations(context);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "claude"]);
  });

  it("handles uninstall selection policies across individual, manual Uninstall All, programmatic Uninstall All, mid-way error, and cleanupBase: false", async () => {
    await installCopilotIntegration(context, { recordClientSelection: true });
    await installCodexIntegration(context, { recordClientSelection: true });

    // Individual uninstall removes ID even when config is already absent (uninstall() returns false)
    await fs.rm(path.join(process.env.CODEX_HOME!, "config.toml"));
    await fs.rm(process.env.CODEX_HOME!, { recursive: true, force: true });
    expect(await uninstallCodexIntegration({ recordClientSelection: true })).toBe(false);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot"]);

    // Setup saved-only "windsurf" + absent "claude" + detected "cursor"
    await addInstalledClient("claude", { userHome: tempHome });
    await addInstalledClient("windsurf", { userHome: tempHome });
    await installCursorIntegration(context); // detected on disk, NOT saved in installed-clients.json

    // Programmatic Uninstall All (recordClientSelection=false) with cleanupBase=false keeps saved-only entries & version receipt
    const claudeUninstallSpy = vi.spyOn(ClaudeClientDriver.prototype, "uninstall");
    await uninstallAllDetectedIntegrations(context, { cleanupBase: false });
    expect(claudeUninstallSpy).not.toHaveBeenCalled();
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["copilot", "claude", "windsurf"]);
    expect((await readInstalledIntegrationVersion({ userHome: tempHome })).status).toBe("valid");

    // Mid-way error during manual Uninstall All removes earlier IDs and preserves errored + subsequent IDs
    await installCursorIntegration(context, { recordClientSelection: true });
    vi.spyOn(ClaudeClientDriver.prototype, "uninstall").mockRejectedValueOnce(new Error("claude uninstall I/O fail"));
    await expect(
      uninstallAllDetectedIntegrations(context, { recordClientSelection: true, cleanupBase: false }),
    ).rejects.toThrow("claude uninstall I/O fail");
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["claude", "windsurf"]);

    // Manual Uninstall All (recordClientSelection=true, cleanupBase=false) processes saved ∪ detected and preserves other managed assets
    claudeUninstallSpy.mockClear();
    await uninstallAllDetectedIntegrations(context, { recordClientSelection: true, cleanupBase: false });
    expect(claudeUninstallSpy).toHaveBeenCalledTimes(1);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual([]);
    await expect(fs.access(managedIntegrationVersionPath({ userHome: tempHome }))).resolves.toBeUndefined();
    await expect(fs.access(managedMcpScriptPath({ userHome: tempHome }))).resolves.toBeUndefined();

    // Default uninstallAllDetectedIntegrations cleans base managed directory including installed-clients.json
    await addInstalledClient("codex", { userHome: tempHome });
    await uninstallAllDetectedIntegrations(context, { recordClientSelection: true });
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
    await expect(fs.access(managedMcpScriptPath({ userHome: tempHome }))).rejects.toThrow();
  });

  it("merges saved ∪ detected targets deduplicated in factory order, skips receipt/writes when empty, and includes saved-only Claude/Antigravity skill targets", async () => {
    const readVersionSpy = vi.spyOn(fs, "readFile");
    const emptyReport = await upgradeDetectedIntegrations(context);
    expect(emptyReport).toEqual({
      clientIds: [],
      skillTargets: [],
      updatedAssets: [],
      clients: [],
    });
    expect(
      readVersionSpy.mock.calls.some(([p]) => String(p).endsWith("integration-version.json")),
    ).toBe(false);
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

    const report = await upgradeDetectedIntegrations(context);
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

    const runtimeOnlyReport = await upgradeDetectedIntegrations(context);
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
    const sessionOnlyReport = await upgradeDetectedIntegrations(context);
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
    await expect(upgradeDetectedIntegrations(context)).rejects.toThrow();
    expect(cursorUpgradeSpy).not.toHaveBeenCalled();
    expect((await readInstalledIntegrationVersion({ userHome: tempHome }))).toMatchObject({
      status: "valid",
      manifest: { mcpVersion: 1 },
    });
  });

  it("maps non-ready check statuses (missing, outdated, configuration-conflict, restart-required), exceptions, and preserves independent customizations", async () => {
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

    await writeRawReceipt(
      {
        mcpVersion: MCP_VERSION - 1,
        skills: { agents: 1, claude: 1, antigravity: 1 },
      },
      tempHome,
    );

    // Check non-ready mapping with empty detail fallback (restart-required & outdated) + conflict on Codex + exception on Copilot
    vi.spyOn(CopilotClientDriver.prototype, "upgrade").mockRejectedValueOnce(new Error("copilot boom"));
    vi.spyOn(CursorClientDriver.prototype, "check").mockResolvedValueOnce({ status: "restart-required" });
    vi.spyOn(CodexClientDriver.prototype, "check").mockResolvedValueOnce({
      status: "configuration-conflict",
      detail: "conflict in config.toml",
    });

    const report = await upgradeDetectedIntegrations(context);
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
      {
        id: "cursor",
        name: "Cursor",
        status: "setup-required",
        detail: "Cursor integration status is restart-required. Restart Cursor and start a new chat to apply the updated integration.",
      },
      { id: "codex", name: "Codex", status: "setup-required", detail: "conflict in config.toml" },
      { id: "claude", name: "Claude", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "updated" },
    ]);

    // Verify independent customizations survived without cross-contamination
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

    // Current receipt + missing/modified Claude skill on disk -> NOT force-reinstalled; maps to setup-required
    const currentButModifiedContent = buildReviewSkillMarkdown("# Tampered Core", "- Keep custom").replace(
      OFFICIAL_SKILL_DESCRIPTIONS.at(-1)!,
      "Tampered.",
    );
    await fs.writeFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), currentButModifiedContent, "utf8");
    const currentButModifiedDisk = await upgradeDetectedIntegrations(context);
    expect(currentButModifiedDisk.clients.find((c) => c.id === "claude")).toEqual({
      id: "claude",
      name: "Claude",
      status: "setup-required",
      detail: "Claude review skill assets are outdated.",
    });
    await expect(fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md"), "utf8")).resolves.toBe(
      currentButModifiedContent,
    );

    await fs.rm(path.join(claudeDriver.skillDirectory, "SKILL.md"));
    const currentButMissingDisk = await upgradeDetectedIntegrations(context);
    expect(currentButMissingDisk.clients.find((c) => c.id === "claude")).toEqual({
      id: "claude",
      name: "Claude",
      status: "setup-required",
      detail: "Claude skill directory is missing SKILL.md.",
    });
    await expect(fs.access(path.join(claudeDriver.skillDirectory, "SKILL.md"))).rejects.toThrow();

    // Preserves asymmetric JSON syntax parse error behavior through coordinator:
    // Cursor/Claude corrupt JSON -> setup-required, Antigravity corrupt JSON -> failed
    await fs.writeFile(cursorDriver.configPath, "{ broken cursor", "utf8");
    await fs.writeFile(agDriver.configPath, "{ broken antigravity", "utf8");
    const corruptJsonReport = await upgradeDetectedIntegrations(context);
    expect(corruptJsonReport.clients.find((c) => c.id === "cursor")?.status).toBe("setup-required");
    expect(corruptJsonReport.clients.find((c) => c.id === "antigravity")).toMatchObject({
      id: "antigravity",
      name: "Antigravity",
      status: "failed",
    });
    await fs.rm(cursorDriver.configPath);
    await fs.rm(agDriver.configPath);
    await cursorDriver.install(targetMcp);
    await agDriver.install(targetMcp);

    // Missing Claude packaged source when ONLY Claude skill is stale (agents is current) -> throws -> failed before touching target
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

    const claudeMissingSrcReport = await upgradeDetectedIntegrations(context);
    expect(claudeMissingSrcReport.clients.find((c) => c.id === "claude")).toMatchObject({
      id: "claude",
      name: "Claude",
      status: "failed",
    });
    expect(claudeMissingSrcReport.updatedAssets).not.toContain("skill:claude");
    expect(sha256(await fs.readFile(path.join(claudeDriver.skillDirectory, "SKILL.md")))).toBe(claudeBeforeHash);
  });

  it("does not commit per-client receipt or add asset to updatedAssets when per-client verification fails", async () => {
    await setupBaseMcpServer(context, { userHome: tempHome });
    const targetMcp = managedMcpScriptPath({ userHome: tempHome });
    const agDriver = new AntigravityClientDriver({
      userHome: tempHome,
      sourceSkillDirectory: path.join(sourceDir, "skills", "create-review-artifact"),
      sourceSessionSkillDirectory: path.join(sourceDir, "skills", "work-session"),
    });
    await agDriver.install(targetMcp);
    await writeInstalledIntegrationVersion(
      {
        mcpVersion: MCP_VERSION,
        skills: { agents: CREATE_REVIEW_ARTIFACT_SKILL_VERSION, antigravity: 1 },
        sessionSkills: { agents: WORK_SESSION_SKILL_VERSION, antigravity: 1 },
      },
      { userHome: tempHome },
    );

    vi.spyOn(AntigravityClientDriver.prototype, "check").mockResolvedValueOnce({
      status: "outdated",
      detail: "post-upgrade verification rejected",
    });
    const report = await upgradeDetectedIntegrations(context);
    expect(report.updatedAssets).toEqual([]);
    expect(report.clients).toEqual([
      {
        id: "antigravity",
        name: "Antigravity",
        status: "setup-required",
        detail: "post-upgrade verification rejected",
      },
    ]);
    expect(await readInstalledIntegrationVersion({ userHome: tempHome })).toMatchObject({
      status: "valid",
      manifest: {
        skills: { antigravity: 1 },
        sessionSkills: { antigravity: 1 },
      },
    });

    // Simulate per-client receipt commit I/O failure: client becomes failed and updatedAssets keeps it excluded
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation(async (targetPath, data, options) => {
      if (String(targetPath).includes("integration-version.json")) {
        throw Object.assign(new Error("receipt write I/O failed"), { code: "EIO" });
      }
      return originalWriteFile(targetPath, data as any, options as any);
    });
    const receiptFailReport = await upgradeDetectedIntegrations(context);
    expect(receiptFailReport.updatedAssets).toEqual([]);
    expect(receiptFailReport.clients).toEqual([
      {
        id: "antigravity",
        name: "Antigravity",
        status: "failed",
        detail: "receipt write I/O failed",
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
  });

  it("retries Codex definition patch on subsequent run even when runtime receipt is already current, and leaves Antigravity config/rules/permissions untouched", async () => {
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

    // First run: shared MCP syncs & commits, Antigravity upgrades skills without touching config/rules, Codex upgrade throws transiently
    vi.spyOn(CodexClientDriver.prototype, "upgrade").mockRejectedValueOnce(new Error("transient config write failure"));

    const firstReport = await upgradeDetectedIntegrations(context);
    expect(firstReport.updatedAssets).toEqual([
      "mcp",
      "skill:antigravity",
      "session-skill:antigravity",
    ]);
    expect(firstReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "failed", detail: "transient config write failure" },
      { id: "antigravity", name: "Antigravity", status: "updated" },
    ]);
    await expect(fs.readFile(agDriver.configPath, "utf8")).resolves.toBe(agConfigBefore);
    await expect(fs.readFile(geminiRules, "utf8")).resolves.toBe("# My GEMINI\n");
    await expect(fs.readFile(globalRule, "utf8")).resolves.toBe("# My Policy\n");
    await expect(fs.access(path.join(tempHome, ".gemini", "config", "ai-artifacts-review-mcp.mjs"))).rejects.toThrow();

    // Second run: all receipts are NOW current, yet Codex driver still runs and patches join_session!
    const retryReport = await upgradeDetectedIntegrations(context);
    expect(retryReport.updatedAssets).toEqual([]);
    expect(retryReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "updated" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    const codexPatched = await fs.readFile(codexConfigPath, "utf8");
    expect(codexPatched).toContain("[mcp_servers.ai_artifacts.tools.join_session]");

    // Third run: both unchanged, Codex config not rewritten
    const beforeThird = codexPatched;
    const renameSpy = vi.spyOn(fs, "rename");
    const thirdReport = await upgradeDetectedIntegrations(context);
    expect(thirdReport.updatedAssets).toEqual([]);
    expect(thirdReport.clients).toEqual([
      { id: "codex", name: "Codex", status: "unchanged" },
      { id: "antigravity", name: "Antigravity", status: "unchanged" },
    ]);
    expect(renameSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(codexConfigPath, "utf8")).resolves.toBe(beforeThird);

    // Upgrade never created or modified installed-clients.json
    await expect(fs.access(managedInstalledClientsPath({ userHome: tempHome }))).rejects.toThrow();
  });
});
