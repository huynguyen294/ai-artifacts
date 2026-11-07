import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Node } from "unist";

export const MAX_ARTIFACT_DESCRIPTION_LENGTH = 200;

function extractNodeText(node: Node, pieces: string[]): void {
  if (node.type === "html") {
    const stripped = String((node as any).value ?? "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .trim();
    if (stripped) {
      pieces.push(stripped);
    }
    return;
  }

  if (node.type === "code") {
    const val = String((node as any).value ?? "").trim();
    if (val) {
      pieces.push(val);
    }
    return;
  }

  if (
    node.type === "list" ||
    node.type === "listItem" ||
    node.type === "blockquote" ||
    node.type === "table" ||
    node.type === "tableRow"
  ) {
    if ("children" in node && Array.isArray(node.children)) {
      for (const child of node.children as Node[]) {
        extractNodeText(child, pieces);
      }
    }
    return;
  }

  const text = toString(node).trim();
  if (text) {
    pieces.push(text);
  }
}

/**
 * Extracts a concise, plain-text description from Markdown source by parsing
 * its AST, extracting visible text from block children, normalizing whitespace,
 * and truncating to at most maxLength characters (appending '…' only if truncated).
 */
export function extractMarkdownDescription(
  markdown: string,
  maxLength = MAX_ARTIFACT_DESCRIPTION_LENGTH,
): string {
  if (!markdown || !markdown.trim()) {
    return "";
  }

  try {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
    const textPieces: string[] = [];

    if ("children" in tree && Array.isArray(tree.children)) {
      for (const child of tree.children as Node[]) {
        extractNodeText(child, textPieces);
      }
    }

    const raw = textPieces.join(" ");
    const normalized = raw
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength).trimEnd()}…`;
  } catch {
    const normalized = markdown
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength).trimEnd()}…`;
  }
}
