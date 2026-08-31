import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist/webview",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/webview/main.tsx"),
      formats: ["iife"],
      name: "CodexArtifactsReview",
      fileName: () => "review.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "review.[ext]",
      },
    },
    minify: "esbuild",
  },
});
