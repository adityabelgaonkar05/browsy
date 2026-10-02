import { parseArgs } from "node:util";
import { startNativeHost } from "@agent-native/native-bridge";
import { DEVELOPMENT_EXTENSION_ID } from "@agent-native/shared";
import { startMcp } from "@agent-native/mcp";
import { parseAgent, prepareAgent } from "./agents";
import {
  cliCommand,
  doctor,
  install,
  mcpConfiguration,
  readInstallation,
  uninstall,
} from "./installation";

const HELP = `Browsy — local Chrome tools for terminal agents

Commands:
  browsy setup --agent codex|claude|opencode [--home DIRECTORY]
  browsy install [--extension-id ID] [--home DIRECTORY]
  browsy doctor [--home DIRECTORY] [--json]
  browsy config [--home DIRECTORY] [--json]
  browsy mcp [--home DIRECTORY]
  browsy uninstall [--home DIRECTORY] [--json]

install registers the Native Messaging host on macOS, Linux, or Windows and prints agent configuration.
setup --agent also adds the MCP server to your selected agent. Start a new agent session afterward.
setup without --agent prints configuration for manual registration.
The extension is installed separately from apps/extension/dist.
Default extension ID: ${DEVELOPMENT_EXTENSION_ID}
Default bridge directory: ~/.agent-native
Additional installation options: --browser chrome|chrome-for-testing|chromium,
--manifest-dir DIRECTORY (for isolated Chrome profiles).
Use --chrome-path EXECUTABLE for Chrome installed outside the standard locations.
`;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      home: { type: "string" },
      "extension-id": { type: "string" },
      browser: { type: "string" },
      "manifest-dir": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      "chrome-path": { type: "string" },
      "parent-window": { type: "string" },
      agent: { type: "string" },
      "agent-config": { type: "string" },
    },
  });
  if (!command || values.help || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (command !== "native-host" && positionals.length)
    throw new Error("Unexpected positional arguments.");
  if ((values.agent || values["agent-config"]) && command !== "setup" && command !== "install")
    throw new Error("--agent and --agent-config are setup/install options.");
  if (values["agent-config"] && !values.agent) throw new Error("--agent-config requires --agent.");
  switch (command) {
    case "setup":
    case "install": {
      const configureAgent = values.agent
        ? await prepareAgent(parseAgent(values.agent), values["agent-config"])
        : undefined;
      const installation = await install({
        home: values.home,
        extensionId: values["extension-id"],
        browser: values.browser,
        manifestDir: values["manifest-dir"],
        chromePath: values["chrome-path"],
      });
      const config = mcpConfiguration(values.home, installation);
      const agent = configureAgent ? await configureAgent(config) : undefined;
      if (values.json) {
        process.stdout.write(`${JSON.stringify({ installation, config, agent }, null, 2)}\n`);
        break;
      }
      if (agent) {
        process.stdout.write(
          `Browser bridge registered. ${agent.agent === "claude" ? "Claude Code" : agent.agent === "codex" ? "Codex" : "OpenCode"} configured.\n${"backup" in agent && agent.backup ? `Previous agent configuration saved to ${agent.backup}\n` : ""}\nKeep Chrome open; the extension reconnects automatically. Start a new agent session.\nTry: Inspect my active Chrome tab and describe what I am seeing.\n`,
        );
        if (!installation.chrome)
          process.stdout.write(
            `Chrome was not detected. If the connection stays offline, run setup with --chrome-path pointing to its executable.\n`,
          );
        break;
      }
      process.stdout.write(
        `Native host registered: ${installation.manifest}\nExtension ID: ${installation.extensionId}\nChrome: ${installation.chrome ?? "not detected; reinstall with --chrome-path pointing to its executable"}\n\nReload the extension, then run:\n${cliCommand("doctor", values.home, installation)}\n\nCodex:\n${config.codexCommand}\n\nClaude Code:\n${config.claudeCommand}\n\nOpenCode (merge into opencode.json):\n${JSON.stringify(config.opencode, null, 2)}\n`,
      );
      break;
    }
    case "config": {
      const installed = await readInstallation(values.home).catch(() => undefined);
      const config = mcpConfiguration(values.home, installed);
      process.stdout.write(
        values.json
          ? `${JSON.stringify(config, null, 2)}\n`
          : `Codex:\n${config.codexCommand}\n\nCodex config.toml:\n${config.codexToml}\n\nClaude Code:\n${config.claudeCommand}\n\nOpenCode:\n${JSON.stringify(config.opencode, null, 2)}\n`,
      );
      break;
    }
    case "doctor": {
      const report = await doctor(values.home);
      process.stdout.write(
        values.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${report.checks.map((check) => `${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.detail}`).join("\n")}\nSocket: ${report.socket}\n`,
      );
      if (!report.ok) process.exitCode = 1;
      break;
    }
    case "uninstall": {
      const result = await uninstall(values.home);
      process.stdout.write(
        values.json
          ? `${JSON.stringify(result)}\n`
          : `${result.removed ? "Native host registration and local configuration removed." : "No installation found."}\nRemove the extension in Chrome and remove agent_native_browser from your agent configuration if no longer needed.\n`,
      );
      break;
    }
    case "mcp":
      await startMcp(values.home);
      break;
    case "native-host": {
      const installed = await readInstallation(values.home);
      if (values["extension-id"] && values["extension-id"] !== installed.extensionId)
        throw new Error("Launcher extension ID differs from installation; reinstall.");
      if (positionals.length !== 1)
        throw new Error("Native host must be launched by Chrome with its extension origin.");
      await startNativeHost({
        home: values.home,
        extensionId: installed.extensionId,
        origin: positionals[0],
      });
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}. Run browsy --help.`);
  }
}

void main().catch((error: unknown) => {
  // stdout is reserved exclusively for Native Messaging/MCP protocol frames.
  process.stderr.write(`browsy: ${error instanceof Error ? error.message : "Command failed."}\n`);
  process.exitCode = 1;
});
