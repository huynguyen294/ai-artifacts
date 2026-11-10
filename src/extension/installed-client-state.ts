import { promises as fs } from "node:fs";
import {
  aiArtifactsRoot,
  managedAssetsRoot,
  managedInstalledClientsPath,
  OWNER_ONLY_FILE_MODE,
  type GlobalArtifactsRootOptions,
} from "../shared/artifact-files";
import { ensureManagedDirectory } from "../shared/artifact-validation";
import {
  INSTALLED_CLIENTS_SCHEMA_VERSION,
  installedClientsManifestSchema,
  MCP_CLIENT_IDS,
  mcpClientIdSchema,
  type McpClientId,
} from "../shared/contracts";
import { writeTextFileAtomic } from "./mcp-clients/json-mcp-helper";

function canonicalizeClientIds(clientIds: Iterable<McpClientId>): McpClientId[] {
  const selected = new Set(clientIds);
  return MCP_CLIENT_IDS.filter((id) => selected.has(id));
}

function sameClientSet(left: readonly McpClientId[], right: readonly McpClientId[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

async function writeInstalledClientsManifest(
  clientIds: McpClientId[],
  options: GlobalArtifactsRootOptions = {},
): Promise<void> {
  await ensureManagedDirectory(aiArtifactsRoot(options));
  await ensureManagedDirectory(managedAssetsRoot(options));
  const manifest = installedClientsManifestSchema.parse({
    schemaVersion: INSTALLED_CLIENTS_SCHEMA_VERSION,
    clientIds,
  });
  await writeTextFileAtomic(
    managedInstalledClientsPath(options),
    `${JSON.stringify(manifest, null, 2)}\n`,
    OWNER_ONLY_FILE_MODE,
  );
}

export async function readInstalledClients(
  options: GlobalArtifactsRootOptions = {},
): Promise<McpClientId[]> {
  const filePath = managedInstalledClientsPath(options);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsedJson = JSON.parse(raw);
    const parsedManifest = installedClientsManifestSchema.parse(parsedJson);
    return canonicalizeClientIds(parsedManifest.clientIds);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function addInstalledClient(
  clientId: McpClientId,
  options: GlobalArtifactsRootOptions = {},
): Promise<McpClientId[]> {
  const validatedId = mcpClientIdSchema.parse(clientId);
  const current = await readInstalledClients(options);
  const next = canonicalizeClientIds([...current, validatedId]);
  if (sameClientSet(current, next)) {
    return current;
  }
  await writeInstalledClientsManifest(next, options);
  return next;
}

export async function removeInstalledClient(
  clientId: McpClientId,
  options: GlobalArtifactsRootOptions = {},
): Promise<McpClientId[]> {
  const validatedId = mcpClientIdSchema.parse(clientId);
  const current = await readInstalledClients(options);
  if (!current.includes(validatedId)) {
    return current;
  }
  const next = current.filter((id) => id !== validatedId);
  await writeInstalledClientsManifest(next, options);
  return next;
}

