import { useEffect, useState } from "react";
import type { ViewerTheme } from "./enhancement-api";

function currentTheme(): ViewerTheme {
  if (document.body.classList.contains("vscode-high-contrast") || document.body.classList.contains("vscode-high-contrast-light")) {
    return "high-contrast";
  }
  return document.body.classList.contains("vscode-light") ? "light" : "dark";
}

export function useViewerTheme(): ViewerTheme {
  const [theme, setTheme] = useState<ViewerTheme>(() => currentTheme());
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-id"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function themeColors(): { background: string; foreground: string } {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue("--vscode-editor-background").trim() || "#1e1e1e",
    foreground: styles.getPropertyValue("--vscode-editor-foreground").trim() || "#d4d4d4",
  };
}
