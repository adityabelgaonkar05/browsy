import { build } from "esbuild";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { thirdPartyNotices } from "./third-party-notices.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}packages/cli/dist`, { recursive: true });
const result = await build({
  entryPoints: [`${root}packages/cli/src/index.ts`],
  outfile: `${root}packages/cli/dist/index.js`,
  bundle: true,
  platform: "node",
  // jsonc-parser's UMD entry hides relative requires inside its factory.
  // Prefer its ESM entry so every dependency is included in the standalone CLI.
  mainFields: ["module", "main"],
  target: "node22",
  format: "esm",
  sourcemap: true,
  metafile: true,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
await writeFile(
  `${root}packages/cli/dist/THIRD_PARTY_NOTICES.txt`,
  thirdPartyNotices(Object.keys(result.metafile.inputs)),
);
await chmod(`${root}packages/cli/dist/index.js`, 0o755);
await copyFile(`${root}LICENSE`, `${root}packages/cli/LICENSE`);

await copyFile(
  `${root}packages/native-bridge/src/windows-pipe.cs`,
  `${root}packages/cli/dist/windows-pipe.cs`,
);
