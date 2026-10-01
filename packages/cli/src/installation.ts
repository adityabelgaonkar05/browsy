import { access, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { BridgeClient, bridgePaths, nativeManifestPath } from "@agent-native/native-bridge";
import { BRIDGE_PROTOCOL_VERSION, DEVELOPMENT_EXTENSION_ID, NATIVE_HOST_NAME } from "@agent-native/shared";

export interface Installation {
  version: number;
  extensionId: string;
  node: string;
  cli: string;
  manifest: string;
  chrome?: string;
}
export interface InstallOptions { home?: string; extensionId?: string; browser?: string; manifestDir?: string }

export function shellQuote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'`; }

async function exists(path: string, mode = constants.F_OK) {
  try { await access(path, mode); return true; } catch { return false; }
}

async function atomicWrite(path: string, contents: string, mode: number) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { mode, flag: "wx" });
  await rename(temporary, path);
}

async function detectChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const path of candidates) if (await exists(path, constants.X_OK)) return path;
  return undefined;
}

export async function install(options: InstallOptions): Promise<Installation> {
  if (process.platform !== "darwin") throw new Error("Installation currently supports macOS only.");
  const paths = bridgePaths(options.home);
  const extensionId = options.extensionId ?? DEVELOPMENT_EXTENSION_ID;
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("--extension-id must be a 32-character Chrome extension ID (letters a–p).");
  const browser = options.browser ?? "chrome";
  if (!["chrome", "chrome-for-testing", "chromium"].includes(browser)) throw new Error("--browser must be chrome, chrome-for-testing, or chromium.");
  const manifest = options.manifestDir
    ? join(resolve(options.manifestDir), `${NATIVE_HOST_NAME}.json`)
    : nativeManifestPath(browser as "chrome" | "chrome-for-testing" | "chromium");
  const installation: Installation = {
    version: BRIDGE_PROTOCOL_VERSION, extensionId,
    node: process.execPath, cli: fileURLToPath(import.meta.url), manifest,
    chrome: await detectChrome(),
  };
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  await chmod(paths.directory, 0o700);
  const command = [installation.node, installation.cli, "native-host", "--home", paths.directory, "--extension-id", extensionId].map(shellQuote).join(" ");
  await atomicWrite(paths.launcher, `#!/bin/sh\nexec ${command} "$@"\n`, 0o700);
  await atomicWrite(paths.config, `${JSON.stringify(installation, null, 2)}\n`, 0o600);
  await atomicWrite(manifest, `${JSON.stringify({
    name: NATIVE_HOST_NAME,
    description: "Agent Native Browser local bridge",
    path: paths.launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }, null, 2)}\n`, 0o600);
  return installation;
}

export async function readInstallation(home?: string): Promise<Installation> {
  const value = JSON.parse(await readFile(bridgePaths(home).config, "utf8")) as Installation;
  if (value.version !== BRIDGE_PROTOCOL_VERSION || !/^[a-p]{32}$/.test(value.extensionId) ||
    ![value.node, value.cli, value.manifest].every((path) => typeof path === "string" && path.startsWith("/"))) {
    throw new Error("Invalid installation configuration. Run agent-native install again.");
  }
  return value;
}

export function mcpConfiguration(home?: string, installation?: Installation) {
  const paths = bridgePaths(home);
  const command = installation?.node ?? process.execPath;
  const args = [installation?.cli ?? fileURLToPath(import.meta.url), "mcp", "--home", paths.directory];
  const invocation = [command, ...args].map(shellQuote).join(" ");
  return {
    command, args,
    codexCommand: `codex mcp add agent_native_browser -- ${invocation}`,
    codexToml: `[mcp_servers.agent_native_browser]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\ntool_timeout_sec = 60`,
    claudeCommand: `claude mcp add --transport stdio --scope user agent_native_browser -- ${invocation}`,
    claude: { mcpServers: { agent_native_browser: { command, args } } },
    opencode: { mcp: { agent_native_browser: { type: "local", command: [command, ...args], enabled: true, timeout: 60_000 } } },
  };
}

export async function doctor(home?: string) {
  const paths = bridgePaths(home);
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  let installation: Installation | undefined;
  try { installation = await readInstallation(home); checks.push({ name: "Installation", ok: true, detail: paths.config }); }
  catch { checks.push({ name: "Installation", ok: false, detail: "Run agent-native install to register the native host." }); }
  if (installation) {
    for (const [name, path] of [["Node executable", installation.node], ["CLI bundle", installation.cli], ["Native launcher", paths.launcher]] as const) {
      checks.push({ name, ok: await exists(path, name === "CLI bundle" ? constants.R_OK : constants.X_OK), detail: path });
    }
    try {
      const manifest = JSON.parse(await readFile(installation.manifest, "utf8"));
      const ok = manifest.name === NATIVE_HOST_NAME && manifest.path === paths.launcher && manifest.type === "stdio" &&
        Array.isArray(manifest.allowed_origins) && manifest.allowed_origins.includes(`chrome-extension://${installation.extensionId}/`);
      checks.push({ name: "Chrome registration", ok, detail: installation.manifest });
    } catch { checks.push({ name: "Chrome registration", ok: false, detail: "Native host manifest is missing or invalid. Reinstall." }); }
    checks.push({ name: "Chrome detected", ok: Boolean(installation.chrome && await exists(installation.chrome)), detail: installation.chrome ?? "Chrome was not found in /Applications." });
  }
  const bridge = new BridgeClient(paths.socket, 1_000, 2_000);
  try {
    const status = await bridge.status();
    const ok = status.connected && status.version === BRIDGE_PROTOCOL_VERSION && (!installation || status.extensionId === installation.extensionId);
    checks.push({ name: "Extension connection", ok, detail: ok ? `Connected to ${status.extensionId} (host PID ${status.pid}).` : "Extension handshake is not ready or version/ID differs. Reload the extension." });
  } catch { checks.push({ name: "Extension connection", ok: false, detail: "Open Chrome and load/reload the extension. Its sidebar has connection status and Reconnect." }); }
  finally { bridge.close(); }
  return { ok: checks.every((check) => check.ok), socket: paths.socket, checks };
}
