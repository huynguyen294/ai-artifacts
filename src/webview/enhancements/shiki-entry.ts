import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import css from "shiki/langs/css.mjs";
import diff from "shiki/langs/diff.mjs";
import html from "shiki/langs/html.mjs";
import javascript from "shiki/langs/javascript.mjs";
import json from "shiki/langs/json.mjs";
import jsx from "shiki/langs/jsx.mjs";
import markdown from "shiki/langs/markdown.mjs";
import powershell from "shiki/langs/powershell.mjs";
import python from "shiki/langs/python.mjs";
import sql from "shiki/langs/sql.mjs";
import tsx from "shiki/langs/tsx.mjs";
import typescript from "shiki/langs/typescript.mjs";
import yaml from "shiki/langs/yaml.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";
import type { ShikiEnhancement } from "../enhancement-api";

const highlighterPromise = createHighlighterCore({
  themes: [githubLight, githubDark],
  langs: [bash, css, diff, html, javascript, json, jsx, markdown, powershell, python, sql, tsx, typescript, yaml],
  engine: createJavaScriptRegexEngine(),
});

const aliases: Record<string, string> = {
  cjs: "javascript",
  js: "javascript",
  md: "markdown",
  mjs: "javascript",
  ps1: "powershell",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
};

const api: ShikiEnhancement = {
  async highlight(code, language, theme) {
    const highlighter = await highlighterPromise;
    const requested = aliases[language.toLowerCase()] ?? language.toLowerCase();
    const lang = highlighter.getLoadedLanguages().includes(requested) ? requested : "text";
    const result = highlighter.codeToTokens(code, {
      lang: lang as never,
      theme: theme === "dark" ? "github-dark" : "github-light",
    });
    const classNames = new Map<string, string>();
    const declarations: string[] = [];
    const classFor = (color: string | undefined, fontStyle: number | undefined): string | undefined => {
      if (!color && !fontStyle) return undefined;
      const key = `${color ?? ""}:${fontStyle ?? 0}`;
      const existing = classNames.get(key);
      if (existing) return existing;
      const className = `ca-shiki-token-${classNames.size}`;
      classNames.set(key, className);
      const styles: string[] = [];
      if (color && /^#[0-9a-f]{6,8}$/i.test(color)) styles.push(`color:${color}`);
      if (fontStyle && (fontStyle & 1) !== 0) styles.push("font-style:italic");
      if (fontStyle && (fontStyle & 2) !== 0) styles.push("font-weight:700");
      if (fontStyle && (fontStyle & 4) !== 0) styles.push("text-decoration:underline");
      declarations.push(`.${className}{${styles.join(";")}}`);
      return className;
    };
    return {
      lines: result.tokens.map((line) => line.map((token) => ({
        content: token.content,
        ...(classFor(token.color, token.fontStyle) ? { className: classFor(token.color, token.fontStyle) } : {}),
      }))),
      css: declarations.join("\n"),
    };
  },
};

window.codexArtifactsEnhancements = { ...window.codexArtifactsEnhancements, shiki: api };
