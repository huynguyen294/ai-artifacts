export function buildArtifactConnectPrompt(artifactDirectory: string): string {
  return ["Inspect this exact AI Artifact:", `artifactDirectory: ${JSON.stringify(artifactDirectory)}`].join("\n");
}
