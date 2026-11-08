import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The app bundles evidence files from the repo root (sim, docs, deployments).
const repo = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  server: { fs: { allow: [repo] } },
  build: { target: "es2022", outDir: "dist" },
});
