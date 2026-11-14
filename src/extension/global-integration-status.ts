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
