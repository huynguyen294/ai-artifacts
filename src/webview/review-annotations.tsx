import { cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import type { ReviewComment } from "../shared/contracts";

type CommentClickHandler = (commentId: string, anchor: HTMLElement) => void;

function collectTextLeaves(node: ReactNode, leaves: string[]): void {
  if (typeof node === "string" || typeof node === "number") {
    leaves.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectTextLeaves(child, leaves);
    return;
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    collectTextLeaves(node.props.children, leaves);
  }
}

function normalizeLeaves(leaves: string[], preserveWhitespace: boolean): string[] {
  if (preserveWhitespace) return [...leaves];
  const result = leaves.map(() => "");
  let emitted = false;
  let pendingWhitespaceLeaf: number | undefined;

  leaves.forEach((leaf, leafIndex) => {
    for (const character of leaf) {
      if (/\s/.test(character)) {
        if (emitted && pendingWhitespaceLeaf === undefined) pendingWhitespaceLeaf = leafIndex;
        continue;
      }
      if (pendingWhitespaceLeaf !== undefined) {
        result[pendingWhitespaceLeaf] += " ";
        pendingWhitespaceLeaf = undefined;
      }
      result[leafIndex] += character;
      emitted = true;
    }
  });
  return result;
}

function markedText(
  value: string,
  startOffset: number,
  comments: ReviewComment[],
  onCommentClick: CommentClickHandler,
): ReactNode {
  if (!value || comments.length === 0) return value;
  const endOffset = startOffset + value.length;
  const boundaries = new Set([startOffset, endOffset]);
  for (const comment of comments) {
    const start = Math.max(startOffset, Math.min(endOffset, comment.selection.start));
    const end = Math.max(startOffset, Math.min(endOffset, comment.selection.end));
    if (end > start) {
      boundaries.add(start);
      boundaries.add(end);
    }
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  const nodes: ReactNode[] = [];
  for (let index = 0; index < sorted.length - 1; index++) {
    const segmentStart = sorted[index]!;
    const segmentEnd = sorted[index + 1]!;
    const text = value.slice(segmentStart - startOffset, segmentEnd - startOffset);
    const active = comments.filter(
      (comment) => comment.selection.start < segmentEnd && comment.selection.end > segmentStart,
    );
    if (active.length === 0) {
      nodes.push(text);
      continue;
    }
    const ids = active.map((comment) => comment.id);
    nodes.push(
      <mark
        key={`${segmentStart}-${segmentEnd}-${ids.join("-")}`}
        className="review-highlight"
        data-comment-ids={ids.join(",")}
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onCommentClick(ids[0]!, event.currentTarget);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onCommentClick(ids[0]!, event.currentTarget);
          }
        }}
      >
        {text}
      </mark>,
    );
  }
  return nodes;
}

export function annotateChildren(
  children: ReactNode,
  comments: ReviewComment[],
  onCommentClick: CommentClickHandler,
  preserveWhitespace = false,
): ReactNode {
  const leaves: string[] = [];
  collectTextLeaves(children, leaves);
  const normalizedLeaves = normalizeLeaves(leaves, preserveWhitespace);
  let leafIndex = 0;
  let cursor = 0;

  const rebuild = (node: ReactNode): ReactNode => {
    if (typeof node === "string" || typeof node === "number") {
      const value = normalizedLeaves[leafIndex++] ?? "";
      const result = markedText(value, cursor, comments, onCommentClick);
      cursor += value.length;
      return result;
    }
    if (Array.isArray(node)) {
      return node.map((child, index) => <Fragment key={index}>{rebuild(child)}</Fragment>);
    }
    if (isValidElement<{ children?: ReactNode }>(node)) {
      const element = node as ReactElement<{ children?: ReactNode }>;
      if (element.props.children === undefined) return element;
      return cloneElement(element, undefined, rebuild(element.props.children));
    }
    return node;
  };

  return rebuild(children);
}
