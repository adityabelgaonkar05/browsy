import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "artifacts/release");
const exec = promisify(execFile);
await mkdir(output, { recursive: true });

// A small ZIP writer keeps release packaging independent of system zip tools.
const table = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [],
    central = [];
  let offset = 0;
  for (const [path, bytes] of files) {
    const name = Buffer.from(path),
      compressed = deflateRawSync(bytes),
      crc = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01: deterministic ZIP timestamps.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 30);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, compressed);
    central.push(record, name);
    offset += header.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function files(directory, prefix = "") {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...(await files(join(directory, entry.name), path + "/")));
    else if (entry.isFile() && !entry.name.endsWith(".map"))
      result.push([path, await readFile(join(directory, entry.name))]);
    else if (!entry.isFile())
      throw new Error("Release output must not contain symlinks or special files.");
  }
  return result;
}
const manifest = JSON.parse(
  await readFile(join(root, "apps/extension/dist/manifest.json"), "utf8"),
);
// The free unpacked distribution needs its fixed ID to match the npm bridge.
// A future Web Store artifact must omit this development key before upload.
if (!manifest.icons?.[128]) throw new Error("Build extension icons before packaging.");
const extensionFiles = await files(join(root, "apps/extension/dist"));
for (const icon of Object.values(manifest.icons))
  if (!extensionFiles.some(([path]) => path === icon))
    throw new Error(`Missing extension icon: ${icon}`);
const extensionZip = `browsy-unpacked-${manifest.version}.zip`;
await writeFile(
  join(output, extensionZip),
  zip(
    extensionFiles.map(([path, bytes]) => [
      path,
      path === "manifest.json"
        ? Buffer.from(JSON.stringify(manifest, null, 2) + "\n")
        : path.endsWith(".js")
          ? Buffer.from(bytes.toString().replace(/^\/\/# sourceMappingURL=.*$/gm, ""))
          : bytes,
    ]),
  ),
);

const stage = await mkdtemp(join(output, ".npm-stage-"));
let tarball;
try {
  const metadata = JSON.parse(await readFile(join(root, "packages/cli/package.json"), "utf8"));
  if (metadata.version !== manifest.version)
    throw new Error("Extension and CLI versions must match.");
  delete metadata.devDependencies;
  delete metadata.scripts;
  for (const key of ["dependencies", "optionalDependencies", "peerDependencies"])
    if (metadata[key] && Object.keys(metadata[key]).length)
      throw new Error("Standalone CLI must have no runtime dependencies.");
  await writeFile(join(stage, "package.json"), JSON.stringify(metadata, null, 2) + "\n");
  for (const [path, bytes] of await files(join(root, "packages/cli/dist"))) {
    const target = join(stage, "dist", path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      path.endsWith(".js") ? bytes.toString().replace(/^\/\/# sourceMappingURL=.*$/gm, "") : bytes,
      { mode: path === "index.js" ? 0o755 : 0o644 },
    );
  }
  for (const path of ["README.md", "LICENSE"])
    await writeFile(join(stage, path), await readFile(join(root, "packages/cli", path)));
  const npm = process.platform === "win32" ? process.execPath : "npm";
  const npmArgs =
    process.platform === "win32"
      ? [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")]
      : [];
  const packed = JSON.parse(
    (
      await exec(
        npm,
        [
          ...npmArgs,
          "pack",
          stage,
          "--ignore-scripts",
          "--pack-destination",
          output,
          "--cache",
          join(output, ".npm-cache"),
          "--json",
        ],
        { cwd: root },
      )
    ).stdout,
  )[0];
  tarball = packed.filename;
} finally {
  await rm(stage, { recursive: true, force: true });
}
const metadata = {
  extensionZip,
  tarball,
  defaultExtensionId: (await readFile(join(root, "packages/shared/src/index.ts"), "utf8")).match(
    /DEVELOPMENT_EXTENSION_ID = "([a-p]{32})"/,
  )[1],
  files: await Promise.all(
    [extensionZip, tarball].map(async (file) => ({
      file,
      sha256: createHash("sha256")
        .update(await readFile(join(output, file)))
        .digest("hex"),
    })),
  ),
};
await writeFile(join(output, "release.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify(metadata, null, 2));
