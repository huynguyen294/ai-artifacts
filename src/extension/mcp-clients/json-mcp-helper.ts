import { promises as fs } from "node:fs";
import path from "node:path";

export async function readJsonConfig(filePath: string): Promise<Record<string, any>> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const trimmed = content.trim();
    if (!trimmed) return {};
    return JSON.parse(trimmed) as Record<string, any>;
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse configuration file at "${filePath}": Invalid JSON syntax. Please verify the file content.`);
    }
    throw error;
  }
}

export function normalizePathForComparison(targetPath: string): string {
  const unified = targetPath.replaceAll("\\", "/");
  if (/^[a-zA-Z]:\//.test(unified)) {
    return path.posix.normalize(unified).toLowerCase();
  }
  const resolved = path.resolve(targetPath).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function writeTextFileAtomic(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.ai-artifacts-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, contents, "utf8");

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await fs.rename(temporaryPath, filePath);
        return;
      } catch (error: any) {
        if (attempt < 2 && (error?.code === "EPERM" || error?.code === "EBUSY" || error?.code === "EACCES")) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY" || error?.code === "EXDEV") {
          await fs.copyFile(temporaryPath, filePath);
          return;
        }
        throw error;
      }
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

export async function writeJsonConfig(filePath: string, data: Record<string, any>): Promise<void> {
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  await writeTextFileAtomic(filePath, contents);
}

export async function upsertJsonMcpServer(
  filePath: string,
  serverName: string,
  serverScriptPath: string,
  defaultContainerKey: "mcpServers" | "servers" = "mcpServers",
): Promise<void> {
  const config = await readJsonConfig(filePath);
  // Respect existing "servers" key if already present in file, or use defaultContainerKey
  const hasServersKey =
    config.servers && typeof config.servers === "object" && !Array.isArray(config.servers);
  const containerKey = hasServersKey ? "servers" : defaultContainerKey;

  if (!config[containerKey] || typeof config[containerKey] !== "object" || Array.isArray(config[containerKey])) {
    config[containerKey] = {};
  }
  const normalizedPath = serverScriptPath.replaceAll("\\", "/");
  config[containerKey][serverName] = {
    ...(containerKey === "servers" ? { type: "stdio" } : {}),
    command: "node",
    args: [normalizedPath],
  };
  await writeJsonConfig(filePath, config);
}

export async function hasJsonMcpServer(
  filePath: string,
  serverName: string,
  serverScriptPath: string,
): Promise<boolean> {
  try {
    const config = await readJsonConfig(filePath);
    const server = config?.servers?.[serverName] ?? config?.mcpServers?.[serverName];
    if (!server || typeof server !== "object") return false;
    const normalizedTarget = normalizePathForComparison(serverScriptPath);
    const existingScript =
      typeof server.args?.[0] === "string" ? normalizePathForComparison(server.args[0]) : "";
    return (
      server.command === "node" &&
      Array.isArray(server.args) &&
      existingScript === normalizedTarget
    );
  } catch {
    return false;
  }
}

export async function removeJsonMcpServer(
  filePath: string,
  serverName: string,
): Promise<boolean> {
  try {
    const config = await readJsonConfig(filePath);
    let removed = false;
    if (config.mcpServers && typeof config.mcpServers === "object" && !Array.isArray(config.mcpServers)) {
      if (serverName in config.mcpServers) {
        delete config.mcpServers[serverName];
        removed = true;
      }
    }
    if (config.servers && typeof config.servers === "object" && !Array.isArray(config.servers)) {
      if (serverName in config.servers) {
        delete config.servers[serverName];
        removed = true;
      }
    }
    if (removed) {
      await writeJsonConfig(filePath, config);
    }
    return removed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

