import { createHash } from "node:crypto";
import type { Blockquote, Code, Content, Heading, List, ListItem, Paragraph, Root, TableCell } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { MarkdownBlock } from "./contracts";

function createBlockId(type: MarkdownBlock["type"], index: number, source: string): string {
  const digest = createHash("sha256")
    .update(`${type}\0${index}\0${source}`)
    .digest("hex")
    .slice(0, 12);
  return `block-${index}-${digest}`;
}

function createLegacyIdMap(markdown: string): Map<string, string> {
  const lines = markdown.split("\n");
  const ids = new Map<string, string>();
  let blockIndex = 0;
  const push = (type: Exclude<MarkdownBlock["type"], "table-cell">, source: string, line: number): void => {
    ids.set(`${type}:${line}`, createBlockId(type, blockIndex, source));
    blockIndex += 1;
  };

  for (let cursor = 0; cursor < lines.length;) {
    const line = lines[cursor] ?? "";
    if (!line.trim()) {
      cursor += 1;
      continue;
    }
    const startLine = cursor + 1;
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      const source = [line];
      cursor += 1;
      while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor] ?? "")) {
        source.push(lines[cursor] ?? "");
        cursor += 1;
      }
      if (cursor < lines.length) source.push(lines[cursor++] ?? "");
      push("code", source.join("\n"), startLine);
      continue;
    }
    if (/^(#{1,6})\s+(.+?)\s*#*\s*$/.test(line)) {
      push("heading", line, startLine);
      cursor += 1;
      continue;
    }
    if (/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/.test(line)) {
      push("list-item", line, startLine);
      cursor += 1;
      continue;
    }
    if (/^\s*>\s?(.*)$/.test(line)) {
      push("quote", line, startLine);
      cursor += 1;
      continue;
    }
    const source = [line];
    cursor += 1;
    while (
      cursor < lines.length
      && (lines[cursor] ?? "").trim()
      && !/^\s*```/.test(lines[cursor] ?? "")
      && !/^#{1,6}\s+/.test(lines[cursor] ?? "")
      && !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[cursor] ?? "")
      && !/^\s*>/.test(lines[cursor] ?? "")
    ) {
      source.push(lines[cursor++] ?? "");
    }
    push("paragraph", source.join("\n"), startLine);
  }
  return ids;
}

export function normalizeVisibleText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function offsets(node: Content): { sourceStart: number; sourceEnd: number } | null {
  const sourceStart = node.position?.start.offset;
  const sourceEnd = node.position?.end.offset;
  if (sourceStart === undefined || sourceEnd === undefined) return null;
  return { sourceStart, sourceEnd };
}

function directListItemText(node: ListItem): string {
  return normalizeVisibleText(
    node.children
      .filter((child): child is Paragraph => child.type === "paragraph")
      .map((child) => toString(child))
      .join(" "),
  );
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  // Keep the legacy CRLF normalization so existing schema-v3 block IDs remain stable.
  const sourceMarkdown = markdown.replace(/\r\n/g, "\n");
  const tree = unified().use(remarkParse).use(remarkGfm).parse(sourceMarkdown) as Root;
  const legacyIds = createLegacyIdMap(sourceMarkdown);
  const blocks: MarkdownBlock[] = [];
  let currentHeading: string | null = null;

  const push = (
    node: Content,
    type: MarkdownBlock["type"],
    text: string,
    extra: Pick<MarkdownBlock, "level" | "language"> = {},
  ): void => {
    const position = offsets(node);
    if (!position || (!text && type !== "code")) return;
    const source = sourceMarkdown.slice(position.sourceStart, position.sourceEnd);
    const index = blocks.length;
    const startLine = node.position?.start.line;
    const legacyId = type === "table-cell" || startLine === undefined
      ? undefined
      : legacyIds.get(`${type}:${startLine}`);
    blocks.push({
      id: legacyId ?? createBlockId(type, index, source),
      index,
      type,
      text,
      heading: currentHeading,
      ...position,
      ...extra,
    });
  };

  const visit = (node: Content): void => {
    switch (node.type) {
      case "heading": {
        const heading = node as Heading;
        const text = normalizeVisibleText(toString(heading));
        currentHeading = text;
        push(heading, "heading", text, { level: heading.depth });
        return;
      }
      case "paragraph":
        push(node, "paragraph", normalizeVisibleText(toString(node)));
        return;
      case "list":
        for (const item of (node as List).children) visit(item);
        return;
      case "listItem": {
        const item = node as ListItem;
        push(item, "list-item", directListItemText(item));
        for (const child of item.children) {
          if (child.type === "list") visit(child);
        }
        return;
      }
      case "blockquote":
        push(node as Blockquote, "quote", normalizeVisibleText(toString(node)));
        return;
      case "code": {
        const code = node as Code;
        push(code, "code", code.value, { language: code.lang ?? "" });
        return;
      }
      case "table":
        for (const row of node.children) {
          for (const cell of row.children) visit(cell);
        }
        return;
      case "tableCell":
        push(node as TableCell, "table-cell", normalizeVisibleText(toString(node)));
        return;
      default:
        return;
    }
  };

  for (const node of tree.children) visit(node);
  return blocks;
}
