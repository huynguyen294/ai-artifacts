import mermaid from "mermaid";
import type { MermaidEnhancement } from "../enhancement-api";

let renderQueue = Promise.resolve();
let sequence = 0;

const api: MermaidEnhancement = {
  async render(source, theme, colors) {
    let svg = "";
    const task = async (): Promise<void> => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: theme === "dark" ? "dark" : "base",
        themeVariables: {
          background: colors.background,
          primaryColor: colors.background,
          primaryTextColor: colors.foreground,
          lineColor: colors.foreground,
          textColor: colors.foreground,
        },
      });
      const result = await mermaid.render(`codex-artifact-diagram-${Date.now()}-${sequence++}`, source);
      svg = result.svg;
    };
    renderQueue = renderQueue.then(task, task);
    await renderQueue;
    return svg;
  },
};

window.codexArtifactsEnhancements = { ...window.codexArtifactsEnhancements, mermaid: api };
