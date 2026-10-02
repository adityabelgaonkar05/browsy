import { defineConfig } from "vite";
import { copyFileSync, cpSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { thirdPartyNotices } from "../../scripts/third-party-notices.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    {
      name: "extension-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "THIRD_PARTY_NOTICES.txt",
          source: thirdPartyNotices(this.getModuleIds()),
        });
      },
      closeBundle() {
        copyFileSync(resolve(root, "manifest.json"), resolve(root, "dist/manifest.json"));
        copyFileSync(resolve(root, "../../LICENSE"), resolve(root, "dist/LICENSE"));
        cpSync(resolve(root, "icons"), resolve(root, "dist/icons"), { recursive: true });
      },
    },
  ],
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
