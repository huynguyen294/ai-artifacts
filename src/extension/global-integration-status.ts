export type IntegrationStatus =
  | "ready"
  | "missing"
  | "outdated"
  | "configuration-conflict"
  | "restart-required";

export type IntegrationCheck = {
  status: IntegrationStatus;
  detail?: string;
};

export function classifyGlobalIntegration(input: {
  configured: boolean;
  assetsCurrent: boolean;
  configurationConflict?: string;
  restartRequired?: boolean;
}): IntegrationCheck {
  if (input.configurationConflict) {
    return { status: "configuration-conflict", detail: input.configurationConflict };
  }
  if (!input.configured) return { status: "missing" };
  if (!input.assetsCurrent) return { status: "outdated" };
  if (input.restartRequired) return { status: "restart-required" };
  return { status: "ready" };
}
