export type ArtifactConnectPromptOptions =
  | { mode?: "legacy" }
  | { mode: "new" }
  | { mode: "join"; sessionId: string };

export function buildArtifactConnectPrompt(
  artifactDirectory: string,
  options?: ArtifactConnectPromptOptions,
): string {
  if (!options || !options.mode || options.mode === "legacy") {
    return ["Inspect this exact AI Artifact:", `artifactDirectory: ${JSON.stringify(artifactDirectory)}`].join("\n");
  }

  if (options.mode === "new") {
    return [
      "Inspect this exact AI Artifact and create a new session:",
      `artifactDirectory: ${JSON.stringify(artifactDirectory)}`,
      "Do not pass any existing artifactConversationId for this request. Omit artifactConversationId when inspecting and retain the newly returned artifactConversationId for future turns.",
    ].join("\n");
  }

  if (options.mode === "join") {
    return [
      "Inspect this exact AI Artifact and join the session:",
      `artifactDirectory: ${JSON.stringify(artifactDirectory)}`,
      `artifactConversationId: ${JSON.stringify(options.sessionId)}`,
      "Use this artifactConversationId when inspecting and set it as your active session context.",
    ].join("\n");
  }

  return ["Inspect this exact AI Artifact:", `artifactDirectory: ${JSON.stringify(artifactDirectory)}`].join("\n");
}
