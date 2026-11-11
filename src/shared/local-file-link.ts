export function isLocalFileLink(url: string): boolean {
  if (/^(?:[a-z]:(?:[\\/]|%5c)|\/(?!\/))/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" && !parsed.hostname;
  } catch {
    return false;
  }
}
