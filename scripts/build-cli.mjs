import { build } from "esbuild";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(`${root}packages/cli/dist`, { recursive: true });
await build({
  entryPoints: [`${root}packages/cli/src/index.ts`],
  outfile: `${root}packages/cli/dist/index.js`,
  bundle: true, platform: "node", target: "node22", format: "esm", sourcemap: true,
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
});
await chmod(`${root}packages/cli/dist/index.js`, 0o755);
await copyFile(`${root}LICENSE`, `${root}packages/cli/LICENSE`);
