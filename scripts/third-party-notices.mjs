import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// Use the bundler's actual module graph so notices follow shipped dependencies.
export function thirdPartyNotices(modules) {
  const packages = new Map();
  const visited = new Set();
  for (const module of modules) {
    if (module.startsWith("\0")) continue;
    let directory = dirname(resolve(module.split("?")[0]));
    if (!directory.includes(`${sep}node_modules${sep}`)) continue;
    while (!visited.has(directory)) {
      visited.add(directory);
      const manifest = join(directory, "package.json");
      if (existsSync(manifest)) {
        const metadata = JSON.parse(readFileSync(manifest, "utf8"));
        if (metadata.name && metadata.version) {
          const files = readdirSync(directory)
            .filter((name) => /^(licen[sc]e|copying|notice)([._-]|$)/i.test(name))
            .sort();
          if (!files.length)
            throw new Error(`Missing license text for bundled dependency ${metadata.name}.`);
          packages.set(
            `${metadata.name}@${metadata.version}`,
            files
              .map((file) => `${file}\n\n${readFileSync(join(directory, file), "utf8")}`)
              .join("\n\n"),
          );
          break;
        }
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  return (
    "Third-party licenses for bundled dependencies. Additional upstream notices may appear in the JavaScript bundles.\n\n" +
    [...packages]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, text]) => `${name}\n${"=".repeat(name.length)}\n\n${text.trim()}\n`)
      .join("\n")
  );
}
