import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [{
    name: "extension-manifest",
    closeBundle() { copyFileSync(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json")); },
  }],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(root, "background/index.ts"),
        sidebar: resolve(root, "sidebar/index.html"),
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "assets/[name]-[hash].js" },
    },
  },
});
