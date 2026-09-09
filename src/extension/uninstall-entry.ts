import { getAllClientDrivers } from "./mcp-clients/index";
import { cleanupBaseMcpServer } from "./mcp-clients/base-cleanup";

export async function runUninstall(options?: { userHome?: string }): Promise<{ uninstalledClients: string[] }> {
  const drivers = getAllClientDrivers();
  const uninstalledClients: string[] = [];

  for (const driver of drivers) {
    try {
      if (driver.isDetected()) {
        const removed = await driver.uninstall();
        if (removed) {
          uninstalledClients.push(driver.name);
        }
      }
    } catch (error) {
      console.error(`[ai-artifacts:uninstall] Failed to uninstall integration for ${driver.name}:`, error);
    }
  }

  try {
    await cleanupBaseMcpServer(options);
  } catch (error) {
    console.error("[ai-artifacts:uninstall] Failed to clean up base MCP assets:", error);
  }

  return { uninstalledClients };
}

if (typeof require !== "undefined" && require.main === module) {
  runUninstall()
    .then((result) => {
      console.log(
        `[ai-artifacts:uninstall] Uninstalled AI Artifacts integrations: ${
          result.uninstalledClients.length > 0 ? result.uninstalledClients.join(", ") : "None detected"
        }. Base runtime assets cleaned up.`,
      );
    })
    .catch((err) => {
      console.error("[ai-artifacts:uninstall] Fatal error during uninstallation:", err);
    });
}
