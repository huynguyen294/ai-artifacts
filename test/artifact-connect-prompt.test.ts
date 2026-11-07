import { describe, expect, it } from "vitest";
import { buildArtifactConnectPrompt } from "../src/shared/artifact-connect-prompt";

describe("buildArtifactConnectPrompt", () => {
  it("identifies the exact artifact and requests inspection", () => {
    expect(buildArtifactConnectPrompt("D:\\Users\\A User\\.ai-artifacts\\artifacts\\artifact-001")).toBe(
      "Inspect this exact AI Artifact:\n"
      + 'artifactDirectory: "D:\\\\Users\\\\A User\\\\.ai-artifacts\\\\artifacts\\\\artifact-001"',
    );
  });

  it("quotes unusual path characters safely", () => {
    const prompt = buildArtifactConnectPrompt('D:\\artifact "quoted"');
    expect(prompt).toContain('artifactDirectory: "D:\\\\artifact \\"quoted\\""');
  });

  it("builds new session connect prompt instructing agent to drop prior conversation ID and replace active session only after success", () => {
    const prompt = buildArtifactConnectPrompt("/path/to/art-1", { mode: "new" });
    expect(prompt).toContain("create a new session");
    expect(prompt).toContain('artifactDirectory: "/path/to/art-1"');
    expect(prompt).toContain("Do not pass any existing artifactConversationId");
    expect(prompt).toContain("after the inspect call succeeds, replace your active session context with the newly returned artifactConversationId for future turns");
    expect(prompt).not.toContain("artifactConversationId:");
  });

  it("builds join session connect prompt specifying the target session ID and success-only replacement", () => {
    const prompt = buildArtifactConnectPrompt("/path/to/art-1", {
      mode: "join",
      sessionId: "00000000-0000-4000-8000-000000000001",
    });
    expect(prompt).toContain("join the session");
    expect(prompt).toContain('artifactDirectory: "/path/to/art-1"');
    expect(prompt).toContain('artifactConversationId: "00000000-0000-4000-8000-000000000001"');
    expect(prompt).toContain("only after the inspect call succeeds, set it as your active session context for future turns");
  });
});
