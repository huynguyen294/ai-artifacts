import { describe, expect, it } from "vitest";
import { buildArtifactConnectPrompt } from "../src/shared/artifact-connect-prompt";
import { buildSessionConnectPrompt } from "../src/shared/session-connect-prompt";

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
    expect(prompt).toContain('tool: "inspect_artifact_review"');
    expect(prompt).toContain("takeover: true");
    expect(prompt).toContain("Do not pass any existing artifactConversationId");
    expect(prompt).toContain("after the inspect call succeeds, replace your active session context with the returned session.sessionId and context for future turns");
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

  it("builds join session connect prompt with artifactId using join_session tool in single call", () => {
    const prompt = buildArtifactConnectPrompt("/path/to/art-1", {
      mode: "join",
      sessionId: "00000000-0000-4000-8000-000000000001",
      artifactId: "art-1",
    });
    expect(prompt).toContain('tool: "join_session"');
    expect(prompt).toContain('sessionId: "00000000-0000-4000-8000-000000000001"');
    expect(prompt).toContain('artifactId: "art-1"');
    expect(prompt).toContain("takeover: true");
    expect(prompt).toContain("use the nested inspection object for artifact feedback");
  });
});

describe("buildSessionConnectPrompt", () => {
  it("builds session connect prompt with sessionId and instructions for AI assistant", () => {
    const prompt = buildSessionConnectPrompt({
      sessionId: "11111111-2222-4333-8444-555555555555",
      title: "My Feature Session",
    });
    expect(prompt).toContain('tool: "join_session"');
    expect(prompt).toContain('sessionId: "11111111-2222-4333-8444-555555555555"');
    expect(prompt).toContain('sessionTitle: "My Feature Session"');
    expect(prompt).toContain("adopt the returned session.sessionId as your active session context");
    expect(prompt).toContain("Read the session instructions and catalog to guide your work");
  });
});
