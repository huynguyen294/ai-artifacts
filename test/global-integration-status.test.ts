import { describe, expect, it } from "vitest";
import { classifyGlobalIntegration } from "../src/extension/global-integration-status";

describe("classifyGlobalIntegration", () => {
  it("distinguishes missing, outdated, and ready installations", () => {
    expect(classifyGlobalIntegration({ configured: false, assetsCurrent: false }).status).toBe("missing");
    expect(classifyGlobalIntegration({ configured: true, assetsCurrent: false }).status).toBe("outdated");
    expect(classifyGlobalIntegration({ configured: true, assetsCurrent: true }).status).toBe("ready");
  });

  it("reports configuration conflicts before other states", () => {
    expect(classifyGlobalIntegration({
      configured: false,
      assetsCurrent: false,
      configurationConflict: "duplicate server",
    })).toEqual({ status: "configuration-conflict", detail: "duplicate server" });
  });

  it("reports a required restart after a successful install", () => {
    expect(classifyGlobalIntegration({
      configured: true,
      assetsCurrent: true,
      restartRequired: true,
    }).status).toBe("restart-required");
  });
});
