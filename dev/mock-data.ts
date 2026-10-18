import { parseMarkdownBlocks } from "../src/shared/markdown-blocks";
import {
  ARTIFACT_ROOT_BLOCK_ID,
  ARTIFACT_ROOT_BLOCK_TYPE,
  ARTIFACT_ROOT_TEXT,
  type ConversationArtifactsViewState,
  type ReviewComment,
  type ReviewState,
} from "../src/shared/contracts";
import sampleMarkdown from "./sample-artifact.md?raw";

export function createInitialReviewState(): ReviewState {
  const blocks = parseMarkdownBlocks(sampleMarkdown);

  // Find a paragraph block to attach a sample inline comment to
  const targetParagraph = blocks.find((b) => b.type === "paragraph" && b.text.includes("Sub-millisecond"));

  const comments: ReviewComment[] = [];

  if (targetParagraph) {
    const quote = "Sub-millisecond read latency";
    const start = targetParagraph.text.indexOf(quote);
    if (start !== -1) {
      comments.push({
        id: "11111111-2222-4333-8444-555555555555",
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        block: {
          id: targetParagraph.id,
          type: targetParagraph.type,
          heading: targetParagraph.heading,
        },
        selection: {
          quote,
          start,
          end: start + quote.length,
          prefix: targetParagraph.text.slice(Math.max(0, start - 20), start),
          suffix: targetParagraph.text.slice(start + quote.length, start + quote.length + 20),
        },
        body: "Have we benchmarked this with memory pressure tests under P99 load?",
      });
    }
  }

  // Also add an artifact-wide general feedback comment
  comments.push({
    id: "99999999-8888-4777-8666-555555555555",
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    block: {
      id: ARTIFACT_ROOT_BLOCK_ID,
      type: ARTIFACT_ROOT_BLOCK_TYPE,
      heading: null,
    },
    selection: {
      quote: ARTIFACT_ROOT_TEXT,
      start: 0,
      end: ARTIFACT_ROOT_TEXT.length,
      prefix: "",
      suffix: "",
    },
    body: "Overall architecture looks solid. Let's make sure the rollout schedule is aligned with the DevOps release window.",
  });

  return {
    artifact: {
      schemaVersion: 6,
      kind: "plan",
      artifactId: "cache-resilience-plan",
      title: "Resilient Distributed Cache Implementation",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      updatedAt: new Date().toISOString(),
      reviewRound: 1,
      reviewSessionId: "a0000000-0000-4000-8000-000000000001",
    },
    comments: {
      schemaVersion: 6,
      artifactId: "cache-resilience-plan",
      reviewRound: 1,
      artifactSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      comments,
    },
    blocks,
    markdown: sampleMarkdown,
    lifecycle: {
      readOnly: false,
    },
  };
}

export function createInitialConversationState(): ConversationArtifactsViewState {
  const now = new Date().toISOString();
  return {
    status: "ready",
    groups: [
      {
        artifactConversationId: "b0000000-0000-4000-8000-000000000002",
        conversationName: "Gateway Architecture Redesign",
        currentArtifactRegisteredAt: now,
        artifacts: [
          {
            artifactId: "cache-resilience-plan",
            title: "Resilient Distributed Cache Implementation",
            kind: "plan",
            registeredAt: now,
            isCurrent: true,
          },
          {
            artifactId: "rate-limiting-spec",
            title: "Token Bucket Rate Limiting Specification",
            kind: "spec",
            registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
            isCurrent: false,
          },
        ],
      },
      {
        artifactConversationId: "c0000000-0000-4000-8000-000000000003",
        conversationName: "Database Optimization",
        currentArtifactRegisteredAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
        artifacts: [
          {
            artifactId: "postgres-sharding-proposal",
            title: "PostgreSQL Horizontal Sharding Proposal",
            kind: "plan",
            registeredAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
            isCurrent: false,
          },
        ],
      },
    ],
    skippedCount: 0,
  };
}
