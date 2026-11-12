import path from "node:path";
import esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { whatsNewReleases, type WhatsNewRelease } from "../src/shared/whats-new-releases";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

describe("whats-new-releases", () => {
  it("keeps pure release metadata in author order with unique versions and opt-in notify defaults", () => {
    expect(whatsNewReleases).toHaveLength(1);

    const versions = whatsNewReleases.map((release) => release.version);
    expect(new Set(versions).size).toBe(versions.length);

    const preview = whatsNewReleases[0]!;
    expect(preview).toEqual({
      version: "1.2.0",
      title: "Work Sessions are here — with multi-agent support",
      description:
        "You can now manage your session’s artifacts and shared instructions in one place, and continue the work across AI agents and chats.",
      features: [
        "A Session Manager for your Working, References, and Archived artifacts.",
        "Shared instructions and artifacts across multiple AI agents and chats.",
        "Agent-to-agent review: one agent waits while another submits feedback.",
        "A dedicated sidebar with pinning, archiving, search, and session types.",
      ],
      bugFixes: [],
      icon: "layers",
      preview: true,
      notify: false,
    });
    expect(preview.publishedAt).toBeUndefined();
    expect(preview.notify === true).toBe(false);

    // Strictly opt-in: both notify: false and omitted notify leave notifications disabled
    const omittedNotifyRelease: WhatsNewRelease = {
      version: "1.1.0",
      title: "Baseline",
      description: "Legacy fixture",
      features: [],
      bugFixes: [],
    };
    expect(omittedNotifyRelease.notify === true).toBe(false);
    expect(whatsNewReleases.some((release) => release.notify === true)).toBe(false);
  });

  it("bundles standalone for Node without ?raw, VS Code, or React dependencies", async () => {
    const result = await esbuild.build({
      entryPoints: [path.join(repositoryRoot, "src", "shared", "whats-new-releases.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles).toHaveLength(1);
    const bundledCode = result.outputFiles[0]!.text;
    expect(bundledCode).toContain("1.2.0");
    expect(bundledCode).toContain("Work Sessions are here");
    expect(bundledCode).not.toContain("acquireVsCodeApi");
    expect(bundledCode).not.toContain("react-markdown");
    expect(bundledCode).not.toContain('from "vscode"');
  });
});

