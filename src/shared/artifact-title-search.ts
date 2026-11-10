/**
 * Canonical title search normalization helper.
 * Strips diacritics, normalizes Unicode, lowercases, and collapses whitespace.
 * Safe for use across extension, shared contracts, and browser webview.
 */
export function normalizeArtifactTitleSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

