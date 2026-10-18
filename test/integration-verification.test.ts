import { describe, expect, it } from "vitest";
import { summarizeIntegrationVerification } from "../src/extension/integration-verification";

describe("integration verification summary", () => {
  it("confirms ready assets and every detected client", () => {
    const summary = summarizeIntegrationVerification({
      skillCurrent: true,
      baseCurrent: true,
      clients: [
        { name: "Codex", isDetected: true, status: "ready" },
        { name: "Cursor", isDetected: false, status: "missing" },
      ],
    });

    expect(summary).toEqual({
      severity: "information",
      message:
        "AI Artifacts installation verified. Agent skill: Ready. MCP runtime: Ready. Detected clients: Codex: Ready. Restart your AI client and start a new chat to use this version.",
    });
  });

  it("reports a usable base setup when no supported client is detected", () => {
    const summary = summarizeIntegrationVerification({
      skillCurrent: true,
      baseCurrent: true,
      clients: [
        { name: "Codex", isDetected: false, status: "missing" },
      ],
    });

    expect(summary).toEqual({
      severity: "information",
      message:
        "AI Artifacts base setup verified. Agent skill: Ready. MCP runtime: Ready. No supported AI clients were detected. Use a client-specific install command if needed.",
    });
  });

  it("warns when no client is detected and base setup is incomplete", () => {
    const summary = summarizeIntegrationVerification({
      skillCurrent: false,
      baseCurrent: true,
      clients: [
        { name: "Codex", isDetected: false, status: "missing" },
      ],
    });

    expect(summary.severity).toBe("warning");
    expect(summary.message).toBe(
      "AI Artifacts base setup needs attention. Agent skill: Outdated / Missing. MCP runtime: Ready. No supported AI clients were detected. Review the installation guide, then verify again.",
    );
  });

  it("warns with the detected client status when verification finds an issue", () => {
    const summary = summarizeIntegrationVerification({
      skillCurrent: true,
      baseCurrent: false,
      clients: [
        {
          name: "Codex",
          isDetected: true,
          status: "configuration-conflict",
        },
      ],
    });

    expect(summary.severity).toBe("warning");
    expect(summary.message).toBe(
      "AI Artifacts installation needs attention. Agent skill: Ready. MCP runtime: Outdated / Missing. Detected clients: Codex: Configuration conflict. Review the installation guide or use a client-specific install command, then verify again.",
    );
  });
});
