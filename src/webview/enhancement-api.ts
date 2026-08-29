export type ViewerTheme = "light" | "dark" | "high-contrast";

export type ShikiEnhancement = {
  highlight(code: string, language: string, theme: Exclude<ViewerTheme, "high-contrast">): Promise<{
    lines: Array<Array<{ content: string; className?: string | undefined }>>;
    css: string;
  }>;
};

export type MermaidEnhancement = {
  render(source: string, theme: ViewerTheme, colors: { background: string; foreground: string }): Promise<string>;
};

declare global {
  interface Window {
    codexArtifactsEnhancements?: {
      shiki?: ShikiEnhancement;
      mermaid?: MermaidEnhancement;
    };
  }
}

export {};
