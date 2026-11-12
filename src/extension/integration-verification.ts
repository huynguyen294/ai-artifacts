import type { IntegrationStatus } from "./global-integration-status";

export interface IntegrationVerificationClient {
  name: string;
  isDetected: boolean;
  status: IntegrationStatus;
}

export interface IntegrationVerificationReport {
  skillCurrent: boolean;
  sessionSkillCurrent?: boolean;
  baseCurrent: boolean;
  clients: readonly IntegrationVerificationClient[];
}

export interface IntegrationVerificationSummary {
  severity: "information" | "warning";
  message: string;
}

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  ready: "Ready",
  missing: "Missing",
  outdated: "Outdated",
  "configuration-conflict": "Configuration conflict",
  "restart-required": "Restart required",
};

function assetStatus(isCurrent: boolean): string {
  return isCurrent ? "Ready" : "Outdated / Missing";
}

export function summarizeIntegrationVerification(
  report: IntegrationVerificationReport,
): IntegrationVerificationSummary {
  const detectedClients = report.clients.filter((client) => client.isDetected);
  const hasSeparateSessionSkill = typeof report.sessionSkillCurrent === "boolean";
  const sessionSkillReady = report.sessionSkillCurrent ?? true;
  const isBaseReady = report.skillCurrent && sessionSkillReady && report.baseCurrent;
  const summary = [
    `${hasSeparateSessionSkill ? "Review skill" : "Agent skill"}: ${assetStatus(report.skillCurrent)}.`,
    ...(hasSeparateSessionSkill
      ? [`Work session skill: ${assetStatus(report.sessionSkillCurrent!)}.`]
      : []),
    `MCP runtime: ${assetStatus(report.baseCurrent)}.`,
  ];

  if (detectedClients.length === 0) {
    summary.push(
      isBaseReady
        ? "No supported AI clients were detected. Use AI Artifacts: Installer if needed."
        : "No supported AI clients were detected. Review the installation guide, then verify again.",
    );
    return {
      severity: isBaseReady ? "information" : "warning",
      message: `${isBaseReady ? "AI Artifacts base setup verified." : "AI Artifacts base setup needs attention."} ${summary.join(" ")}`,
    };
  }

  const clientsReady = detectedClients.every(
    (client) => client.status === "ready",
  );
  summary.push(
    `Detected clients: ${detectedClients
      .map((client) => `${client.name}: ${STATUS_LABELS[client.status]}`)
      .join("; ")}.`,
  );

  if (isBaseReady && clientsReady) {
    summary.push("Restart your AI client and start a new chat to use this version.");
    return {
      severity: "information",
      message: `AI Artifacts installation verified. ${summary.join(" ")}`,
    };
  }

  summary.push(
    "Review the installation guide or use AI Artifacts: Installer, then verify again.",
  );
  return {
    severity: "warning",
    message: `AI Artifacts installation needs attention. ${summary.join(" ")}`,
  };
}
