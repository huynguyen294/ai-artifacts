const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeArtifactUrl(url: string): string {
  if (url.startsWith("#")) return url;
  try {
    const parsed = new URL(url);
    return SAFE_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? url : "";
  } catch {
    return "";
  }
}
