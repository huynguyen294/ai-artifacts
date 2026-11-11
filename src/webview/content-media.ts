const MEDIA_PREFIX = "media/";
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const HIERARCHICAL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const DISALLOWED_BASE_PROTOCOLS = new Set(["file:", "javascript:", "data:", "vbscript:", "mailto:", "command:"]);

function normalizeMediaBaseUri(mediaBaseUri: string): URL | undefined {
  const trimmed = mediaBaseUri.trim();
  if (!trimmed || !HIERARCHICAL_SCHEME_PATTERN.test(trimmed)) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }

  if (DISALLOWED_BASE_PROTOCOLS.has(parsed.protocol.toLowerCase()) || !parsed.pathname.startsWith("/")) {
    return undefined;
  }

  parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

export function resolveContentImage(
  reference: string,
  mediaBaseUri: string,
): string | undefined {
  const normalizedBase = normalizeMediaBaseUri(mediaBaseUri);
  if (!normalizedBase) {
    return undefined;
  }

  if (!reference.startsWith(MEDIA_PREFIX)) {
    return undefined;
  }

  const relativePath = reference.slice(MEDIA_PREFIX.length);
  if (!relativePath) {
    return undefined;
  }

  const segments = relativePath.split("/");
  if (segments.length === 0) {
    return undefined;
  }

  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || !SEGMENT_PATTERN.test(segment)) {
      return undefined;
    }
  }

  const fileSegment = segments[segments.length - 1];
  if (!fileSegment) {
    return undefined;
  }

  const dotIndex = fileSegment.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === fileSegment.length - 1 || !/^[A-Za-z0-9_-]/.test(fileSegment)) {
    return undefined;
  }

  const extension = fileSegment.slice(dotIndex + 1).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return undefined;
  }

  try {
    const resolved = new URL(relativePath, normalizedBase);
    const resolvedHref = resolved.toString();
    if (!resolvedHref.startsWith(normalizedBase.toString())) {
      return undefined;
    }
    return resolvedHref;
  } catch {
    return undefined;
  }
}

