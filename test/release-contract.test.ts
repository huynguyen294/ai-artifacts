import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function read(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

describe("v1.2.0 release contract", () => {
  it("keeps package and lock metadata synchronized", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const packageLock = JSON.parse(await read("package-lock.json"));

    expect(packageJson.name).toBe("ai-artifacts");
    expect(packageJson.version).toBe("1.2.0");
    expect(packageLock.name).toBe(packageJson.name);
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""].name).toBe(packageJson.name);
    expect(packageLock.packages[""].version).toBe(packageJson.version);
  });

  it("contributes only the global schema-v6 artifact selector", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const selectors = packageJson.contributes.customEditors
      .find((editor: any) => editor.viewType === "agentPlus.artifactReview")
      ?.selector;

    expect(selectors).toEqual([
      { filenamePattern: "**/.ai-artifacts/artifacts/**/artifact.md" },
    ]);
  });

  it("registers both sidebar views in a valid Activity Bar container", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const containers = packageJson.contributes.viewsContainers.activitybar;
    const container = containers.find((item: any) => item.title === "AI Artifacts");

    expect(container).toBeDefined();
    // VS Code rejects invalid container IDs and moves their views into Explorer.
    expect(container.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(packageJson.contributes.views[container.id].map((view: any) => view.id)).toEqual([
      "agentPlus.recentArtifacts",
      "agentPlus.sessions",
    ]);
    expect(container.icon).toBe("$(library)");
  });

  it("contributes the safe-open command for artifact.md Explorer, editor, and editor-tab context menus", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const openCommand = packageJson.contributes.commands.find(
      (command: any) => command.command === "agentPlus.openArtifactReview",
    );

    expect(openCommand).toEqual({
      command: "agentPlus.openArtifactReview",
      title: "Open Artifact Review",
      category: "AI Artifacts",
    });
    expect(packageJson.contributes.menus).toEqual({
      "explorer/context": [
        {
          command: "agentPlus.openArtifactReview",
          when: "resourceFilename == artifact.md && resourceScheme == file && !explorerResourceIsFolder",
          group: "navigation@0",
        },
      ],
      "editor/context": [
        {
          command: "agentPlus.openArtifactReview",
          when: "resourceFilename == artifact.md && resourceScheme == file",
          group: "navigation@0",
        },
      ],
      "editor/title/context": [
        {
          command: "agentPlus.openArtifactReview",
          when: "resourceFilename == artifact.md && resourceScheme == file",
          group: "navigation@0",
        },
      ],
      "view/title": [
        {
          command: "agentPlus.filterRecentArtifacts",
          when: "view == agentPlus.recentArtifacts",
          group: "navigation@0",
        },
        {
          command: "agentPlus.createSession",
          when: "view == agentPlus.sessions",
          group: "navigation@0",
        },
        {
          command: "agentPlus.filterSessions",
          when: "view == agentPlus.sessions",
          group: "navigation@1",
        },
        {
          command: "agentPlus.searchSessions",
          when: "view == agentPlus.sessions",
          group: "navigation@2",
        },
        {
          command: "agentPlus.manageSessionTypes",
          when: "view == agentPlus.sessions",
          group: "navigation@3",
        },
      ],
      "view/item/context": [
        {
          command: "agentPlus.openArtifact",
          when: "view == agentPlus.recentArtifacts && (viewItem == artifact || viewItem == artifact.pinned)",
          group: "0_open@1",
        },
        {
          command: "agentPlus.copyArtifactConnectPromptFromTree",
          when: "view == agentPlus.recentArtifacts && (viewItem == artifact || viewItem == artifact.pinned)",
          group: "1_actions@1",
        },
        {
          command: "agentPlus.pinArtifact",
          when: "view == agentPlus.recentArtifacts && viewItem == artifact",
          group: "2_pin@1",
        },
        {
          command: "agentPlus.unpinArtifact",
          when: "view == agentPlus.recentArtifacts && viewItem == artifact.pinned",
          group: "2_pin@1",
        },
        {
          command: "agentPlus.archiveArtifact",
          when: "view == agentPlus.recentArtifacts && (viewItem == artifact || viewItem == artifact.pinned)",
          group: "3_archive@1",
        },
        {
          command: "agentPlus.deleteArtifactPermanently",
          when: "view == agentPlus.recentArtifacts && (viewItem == artifact || viewItem == artifact.pinned)",
          group: "4_delete@1",
        },
        {
          command: "agentPlus.openWorkSession",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "0_open@1",
        },
        {
          command: "agentPlus.renameSessionFromTree",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "1_modify@1",
        },
        {
          command: "agentPlus.changeSessionTypeFromTree",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "1_modify@2",
        },
        {
          command: "agentPlus.copySessionConnectPromptFromTree",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "2_connect@1",
        },
        {
          command: "agentPlus.openSessionInstructionsFileFromTree",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "2_connect@2",
        },
        {
          command: "agentPlus.copySessionInstructionsFilePathFromTree",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "2_connect@3",
        },
        {
          command: "agentPlus.pinSession",
          when: "view == agentPlus.sessions && viewItem == session",
          group: "3_pin@1",
        },
        {
          command: "agentPlus.unpinSession",
          when: "view == agentPlus.sessions && viewItem == session.pinned",
          group: "3_pin@1",
        },
        {
          command: "agentPlus.archiveSession",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "4_archive@1",
        },
        {
          command: "agentPlus.deleteSessionPermanently",
          when: "view == agentPlus.sessions && (viewItem == session || viewItem == session.pinned)",
          group: "5_delete@1",
        },
      ],
    });
  });

  it("contributes only the grouped Installer and Uninstall integration commands with matching activation events", async () => {
    const packageJson = JSON.parse(await read("package.json"));

    expect(packageJson.activationEvents).toEqual(
      expect.arrayContaining(["onCommand:agentPlus.installer", "onCommand:agentPlus.uninstall"]),
    );
    expect(packageJson.contributes.commands).toEqual(
      expect.arrayContaining([
        { command: "agentPlus.installer", title: "AI Artifacts: Installer" },
        { command: "agentPlus.uninstall", title: "AI Artifacts: Uninstall" },
      ]),
    );

    const removedCommandIds = [
      "agentPlus.reinstallIntegration",
      "agentPlus.installWorkspaceIntegration",
      "agentPlus.installAllIntegrations",
      "agentPlus.uninstallAllIntegrations",
      ...["Copilot", "Codex", "Cursor", "Claude", "Windsurf", "Cline", "Antigravity"].flatMap((client) => [
        `agentPlus.install${client}Integration`,
        `agentPlus.uninstall${client}Integration`,
      ]),
    ];
    const contributedCommandIds = packageJson.contributes.commands.map(
      (command: { command: string }) => command.command,
    );
    for (const commandId of removedCommandIds) {
      expect(contributedCommandIds).not.toContain(commandId);
      expect(packageJson.activationEvents).not.toContain(`onCommand:${commandId}`);
    }
  });

  it("contributes agentPlus.openWhatsNew command and matching activation event", async () => {
    const packageJson = JSON.parse(await read("package.json"));

    expect(packageJson.activationEvents).toContain("onCommand:agentPlus.openWhatsNew");
    expect(packageJson.contributes.commands).toEqual(
      expect.arrayContaining([
        {
          command: "agentPlus.openWhatsNew",
          title: "AI Artifacts: What's New",
        },
      ]),
    );
  });

  it("keeps release-facing docs on global v6 and independent integration versions", async () => {
    const [readme, philosophy, architecture, components, instructions, contract, changelog, documentationChanges] =
      await Promise.all([
        read("README.md"),
        read("docs/PHILOSOPHY.md"),
        read("docs/ARCHITECTURE.md"),
        read("docs/COMPONENTS.md"),
        read("docs/INSTRUCTION.md"),
        read("skills/create-review-artifact/references/artifact-contract.md"),
        read("CHANGELOG.md"),
        read("docs/CHANGE_LOGS.md"),
      ]);

    for (const document of [readme, philosophy, architecture, components, instructions, contract]) {
      expect(document).toMatch(/schema[- ]v6/i);
      expect(document).toContain("~/.ai-artifacts/artifacts/");
    }
    for (const document of [readme, philosophy, architecture, components, instructions]) {
      expect(document).toContain("~/.ai-artifacts/conversation-registry/");
    }
    expect(readme).toContain("MCP_VERSION = 12");
    expect(readme).toContain("SKILL_VERSION = 4");
    expect(readme).toContain("~/.ai-artifacts/managed/integration-version.json");
    expect(readme).toContain("USER CUSTOM RULES");
    expect(readme).toContain("It does not prove that custom rules remain semantically compatible");
    expect(readme).not.toContain("reinstall every integration");
    expect(readme).not.toContain("After every extension upgrade");
    expect(readme).toContain("same user filesystem");
    expect(readme).toContain("not a deep link");
    expect(readme).toContain("artifact-connection.json");
    expect(readme).toContain("The target may be unfocused; other windows ignore the event");
    expect(philosophy).toContain("Focus is a ranking hint, not identity, authorization, or a requirement");
    expect(philosophy).toContain("numeric MCP version 12");
    expect(philosophy).toContain("numeric skill version 4");
    expect(philosophy).toContain("not SemVer");
    expect(architecture).toContain("Integration asset versioning and skill customization");
    expect(architecture).toContain("valid partial install");
    expect(architecture).toContain("extension-only update with current receipts");
    expect(architecture).toContain("artifact-connection.json` creation and change");
    expect(architecture).toContain("Both wait and advance preserve existing connection state");
    expect(components).toContain("WINDOW_SELECTION_REQUIRED");
    expect(components).toContain("numeric `MCP_VERSION` / `SKILL_VERSION`");
    expect(components).toContain("Record verified MCP, `.agents`, `.claude`, and Antigravity (`.gemini/config`) versions independently");
    expect(instructions).toContain("Focus is only a ranking hint");
    expect(instructions).toContain("Artifacts are owned by review sessions");
    expect(instructions).toContain("extension-only changes with current receipts must not force reinstall");
    expect(instructions).toContain("Never mark a partial failure current");
    expect(contract).toContain("schema-v1 UI-routing state only");
    expect(contract).toContain("AI Artifacts: Installer");
    expect(changelog).toContain("## [1.1.4] - 2026-11-04");
    expect(changelog).toContain("## [1.1.3] - 2026-11-02");
    expect(changelog).toContain("### Preserve Active Waiters During Non-waiting Updates");
    expect(changelog.indexOf("### Preserve Active Waiters During Non-waiting Updates"))
      .toBeLessThan(changelog.indexOf("## [1.1.4] - 2026-11-04"));
    expect(changelog).toContain("Skill Customization & Independent Integration Versioning");
    expect(changelog).toContain("## [1.1.2] - 2026-10-18");
    expect(changelog).toContain("## [1.1.0] - 2026-10-18");
    expect(changelog).toContain("## [1.0.1] - 2026-09-21");
    expect(changelog).toContain("## [1.0.0] - 2026-09-20");
    expect(changelog).toContain("MCP server 9.0.0");
    const { version } = JSON.parse(await read("package.json"));
    const latestRelease = changelog.match(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m);
    expect(latestRelease?.[1]).toBe(version);
    expect(changelog).toContain("MCP server 10.0.0");
    expect(documentationChanges).toContain("Skill Customization & Independent Integration Asset Versioning");
    expect(documentationChanges).toContain("Automatic artifact retention cleanup and bounded lifetime model");
    expect(documentationChanges).toContain("Artifacts in Conversations, Conversation Registry v1, and MCP server 10.0.0");
  });

  it("keeps the public setting and version matrix on the 1.1.4 targeted-window contract", async () => {
    const packageJson = JSON.parse(await read("package.json"));
    const autoOpen = packageJson.contributes.configuration.properties["agentPlus.autoOpenArtifactReview"];
    const retentionDays = packageJson.contributes.configuration.properties["agentPlus.artifactRetentionDays"];

    expect(packageJson.version).toBe("1.2.0");
    expect(autoOpen.type).toBe("boolean");
    expect(autoOpen.default).toBe(true);
    expect(autoOpen.description).toContain("selected target window");
    expect(autoOpen.description).not.toContain("focused window");
    expect(retentionDays.type).toBe("integer");
    expect(retentionDays.default).toBe(90);
    expect(retentionDays.minimum).toBe(1);
    expect(retentionDays.scope).toBe("machine");
  });

  it("keeps sensitive artifact directories out of source and VSIX payloads", async () => {
    const [gitignore, vscodeignore] = await Promise.all([
      read(".gitignore"),
      read(".vscodeignore"),
    ]);

    expect(gitignore).toContain(".ai-artifacts/");
    expect(gitignore).toContain(".codex-artifacts/");
    expect(vscodeignore).toContain(".ai-artifacts/**");
    expect(vscodeignore).toContain(".codex-artifacts/**");
  });
});
