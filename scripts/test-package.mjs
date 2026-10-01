import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const exec = promisify(execFile);
const root = await mkdtemp(resolve("/tmp", "an-package-"));
const prefix = join(root, "package install");
const home = join(root, "bridge");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cache = join(root, "npm-cache");
let client;

try {
  const packed = JSON.parse(
    (
      await exec(npm, [
        "pack",
        "./packages/cli",
        "--pack-destination",
        root,
        "--cache",
        cache,
        "--json",
      ])
    ).stdout,
  )[0];
  const files = packed.files.map((file) => file.path);
  assert.ok(files.includes("dist/index.js"));
  assert.ok(files.includes("LICENSE"));
  assert.ok(files.includes("README.md"));
  assert.ok(!files.some((file) => /(^|\/)(src|node_modules|\.codex|\.env)(\/|$)/.test(file)));
  await exec(npm, [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--cache",
    cache,
    "--ignore-scripts",
    join(root, packed.filename),
  ]);
  const cli = await realpath(
    join(prefix, "lib", "node_modules", "@agent-native", "cli", "dist", "index.js"),
  );
  const bundle = await readFile(cli, "utf8");
  assert.ok(
    !bundle.includes(process.cwd()),
    "Published bundle must not contain this checkout's absolute path",
  );
  const help = (await exec(process.execPath, [cli, "--help"])).stdout;
  assert.match(help, /agent-native uninstall/);
  const config = JSON.parse(
    (await exec(process.execPath, [cli, "config", "--home", home, "--json"])).stdout,
  );
  assert.deepEqual(config.args, [cli, "mcp", "--home", home]);
  await assert.rejects(
    exec(process.execPath, [cli, "doctor", "--home", home, "--json"]),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).ok, false);
      return true;
    },
  );
  client = new Client({ name: "package-smoke-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--home", home],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 17);
  const result = await client.callTool({ name: "browser_list_tabs", arguments: {} });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).code, "BRIDGE_UNAVAILABLE");
  assert.equal(stderr, "");
  console.log(
    "PASS npm archive contains only release files and installs without workspace/runtime dependencies",
  );
  console.log(
    "PASS installed CLI handles spaces, config, diagnostics and stdio MCP startup without Chrome",
  );
} finally {
  await client?.close();
  await rm(root, { recursive: true, force: true });
}
