import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addInstalledClient,
  readInstalledClients,
  removeInstalledClient,
} from "../src/extension/installed-client-state";
import { managedInstalledClientsPath } from "../src/shared/artifact-files";
import { MCP_CLIENT_IDS } from "../src/shared/contracts";

describe("installed-client-state", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = path.join(
      os.tmpdir(),
      `ai-artifacts-clients-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tempHome, { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it("returns [] when installed-clients.json is absent without creating directories or files", async () => {
    const manifestPath = managedInstalledClientsPath({ userHome: tempHome });

    await expect(readInstalledClients({ userHome: tempHome })).resolves.toEqual([]);
    await expect(removeInstalledClient("codex", { userHome: tempHome })).resolves.toEqual([]);

    await expect(fs.access(path.join(tempHome, ".ai-artifacts"))).rejects.toThrow();
    await expect(fs.access(manifestPath)).rejects.toThrow();
  });

  it("supports all 7 MCP client IDs including antigravity and preserves canonical factory order without duplicates", async () => {
    const manifestPath = managedInstalledClientsPath({ userHome: tempHome });

    await addInstalledClient("antigravity", { userHome: tempHome });
    await addInstalledClient("claude", { userHome: tempHome });
    await addInstalledClient("copilot", { userHome: tempHome });
    await addInstalledClient("cline", { userHome: tempHome });
    await addInstalledClient("codex", { userHome: tempHome });
    await addInstalledClient("windsurf", { userHome: tempHome });
    await addInstalledClient("cursor", { userHome: tempHome });
    await addInstalledClient("codex", { userHome: tempHome });

    expect(await readInstalledClients({ userHome: tempHome })).toEqual([...MCP_CLIENT_IDS]);
    const persisted = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(persisted).toEqual({
      schemaVersion: 1,
      clientIds: [...MCP_CLIENT_IDS],
    });
  });

  it("skips writing to disk when adding an existing client or removing an absent client", async () => {
    await addInstalledClient("codex", { userHome: tempHome });
    await addInstalledClient("antigravity", { userHome: tempHome });

    const manifestPath = managedInstalledClientsPath({ userHome: tempHome });
    const beforeContent = await fs.readFile(manifestPath, "utf8");

    const writeFileSpy = vi.spyOn(fs, "writeFile");
    const renameSpy = vi.spyOn(fs, "rename");

    expect(await addInstalledClient("codex", { userHome: tempHome })).toEqual([
      "codex",
      "antigravity",
    ]);
    expect(await removeInstalledClient("cursor", { userHome: tempHome })).toEqual([
      "codex",
      "antigravity",
    ]);

    expect(writeFileSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    await expect(fs.readFile(manifestPath, "utf8")).resolves.toBe(beforeContent);

    expect(await removeInstalledClient("codex", { userHome: tempHome })).toEqual(["antigravity"]);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    expect(await readInstalledClients({ userHome: tempHome })).toEqual(["antigravity"]);
  });

  it("rejects agents, unknown client IDs, invalid schema, and malformed JSON without repairing the file", async () => {
    await expect(addInstalledClient("agents" as any, { userHome: tempHome })).rejects.toThrow();
    await expect(removeInstalledClient("agents" as any, { userHome: tempHome })).rejects.toThrow();

    const manifestPath = managedInstalledClientsPath({ userHome: tempHome });
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });

    const withAgentsJson = `${JSON.stringify({ schemaVersion: 1, clientIds: ["codex", "agents"] }, null, 2)}\n`;
    await fs.writeFile(manifestPath, withAgentsJson, "utf8");
    await expect(readInstalledClients({ userHome: tempHome })).rejects.toThrow();
    await expect(addInstalledClient("claude", { userHome: tempHome })).rejects.toThrow();
    await expect(fs.readFile(manifestPath, "utf8")).resolves.toBe(withAgentsJson);

    const extraFieldJson = `${JSON.stringify({ schemaVersion: 1, clientIds: ["codex"], extra: true })}\n`;
    await fs.writeFile(manifestPath, extraFieldJson, "utf8");
    await expect(readInstalledClients({ userHome: tempHome })).rejects.toThrow();

    const brokenJson = "{ invalid json";
    await fs.writeFile(manifestPath, brokenJson, "utf8");
    await expect(readInstalledClients({ userHome: tempHome })).rejects.toThrow();
    await expect(removeInstalledClient("codex", { userHome: tempHome })).rejects.toThrow();
    await expect(fs.readFile(manifestPath, "utf8")).resolves.toBe(brokenJson);
  });
});

