import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(import.meta.dirname, "dev"),
  publicDir: resolve(import.meta.dirname, "dist/webview"),
  resolve: {
    alias: {
      "node:crypto": resolve(import.meta.dirname, "dev/crypto-shim.ts"),
    },
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      allow: [".."],
    },
  },
});
