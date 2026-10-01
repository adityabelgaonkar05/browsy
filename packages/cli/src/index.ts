import { parseArgs } from "node:util";
import { startNativeHost } from "@agent-native/native-bridge";
import { DEVELOPMENT_EXTENSION_ID } from "@agent-native/shared";
import { startMcp } from "@agent-native/mcp";
import { doctor, install, mcpConfiguration, readInstallation } from "./installation";

const HELP = `Agent Native Browser — local Chrome tools for terminal agents

Commands:
  agent-native install [--extension-id ID] [--home DIRECTORY]
  agent-native doctor [--home DIRECTORY] [--json]
  agent-native config [--home DIRECTORY] [--json]
  agent-native mcp [--home DIRECTORY]

install registers the macOS Native Messaging host and prints agent configuration.
The extension is installed separately from apps/extension/dist.
Default extension ID: ${DEVELOPMENT_EXTENSION_ID}
Default bridge directory: ~/.agent-native
Additional installation options: --browser chrome|chrome-for-testing|chromium,
--manifest-dir DIRECTORY (for isolated Chrome profiles).
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    home: { type: "string" }, "extension-id": { type: "string" }, browser: { type: "string" },
    "manifest-dir": { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
  } });
  if (!command || values.help || command === "help" || command === "--help" || command === "-h") { process.stdout.write(HELP); return; }
  if (command !== "native-host" && positionals.length) throw new Error("Unexpected positional arguments.");
  switch (command) {
    case "install": {
      const installation = await install({ home: values.home, extensionId: values["extension-id"], browser: values.browser, manifestDir: values["manifest-dir"] });
      const config = mcpConfiguration(values.home, installation);
      if (values.json) { process.stdout.write(`${JSON.stringify({ installation, config }, null, 2)}\n`); break; }
      process.stdout.write(`Native host registered: ${installation.manifest}\nExtension ID: ${installation.extensionId}\nChrome: ${installation.chrome ?? "not detected; install Chrome separately"}\n\nReload the extension, then run agent-native doctor.\n\nCodex:\n${config.codexCommand}\n\nClaude Code:\n${config.claudeCommand}\n\nOpenCode (merge into opencode.json):\n${JSON.stringify(config.opencode, null, 2)}\n`);
      break;
    }
    case "config": {
      const installed = await readInstallation(values.home).catch(() => undefined);
      const config = mcpConfiguration(values.home, installed);
      process.stdout.write(values.json ? `${JSON.stringify(config, null, 2)}\n` : `Codex:\n${config.codexCommand}\n\nCodex config.toml:\n${config.codexToml}\n\nClaude Code:\n${config.claudeCommand}\n\nOpenCode:\n${JSON.stringify(config.opencode, null, 2)}\n`);
      break;
    }
    case "doctor": {
      const report = await doctor(values.home);
      process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.checks.map((check) => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`).join("\n")}\nSocket: ${report.socket}\n`);
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "mcp": await startMcp(values.home); break;
    case "native-host": {
      const installed = await readInstallation(values.home);
      if (values["extension-id"] && values["extension-id"] !== installed.extensionId) throw new Error("Launcher extension ID differs from installation; reinstall.");
      if (positionals.length !== 1) throw new Error("Native host must be launched by Chrome with its extension origin.");
      await startNativeHost({ home: values.home, extensionId: installed.extensionId, origin: positionals[0] });
      break;
    }
    default: throw new Error(`Unknown command: ${command}. Run agent-native --help.`);
  }
}

void main().catch((error: unknown) => {
  // stdout is reserved exclusively for Native Messaging/MCP protocol frames.
  process.stderr.write(`agent-native: ${error instanceof Error ? error.message : "Command failed."}\n`);
  process.exitCode = 1;
});
