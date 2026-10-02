import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { windowsPowerShellEnvironment } from "@agent-native/native-bridge";
import { applyEdits, findNodeAtLocation, modify, parseTree } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import { mcpConfiguration } from "./installation";

const exec = promisify(execFile);
const serverName = "agent_native_browser";
type Configuration = ReturnType<typeof mcpConfiguration>;
export type Agent = "codex" | "claude" | "opencode";

export function parseAgent(value: string): Agent {
  if (value !== "codex" && value !== "claude" && value !== "opencode")
    throw new Error(
      "--agent must be codex, claude, or opencode. Omit it to print configuration for any MCP client.",
    );
  return value;
}

async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function executable(name: string) {
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const suffix of process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]) {
      const path = resolve(directory, name + suffix);
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        /* Try the next PATH entry. */
      }
    }
  }
  throw new Error(
    `${name} was not found on PATH. Install it first, or run setup without --agent to get the registration command.`,
  );
}

export async function prepareAgent(agent: Agent, configFile?: string) {
  if (agent === "codex") {
    if (configFile)
      throw new Error(
        "Codex uses its own configuration location; --agent-config applies to Claude Code and OpenCode.",
      );
    const command = await executable("codex");
    return async (config: Configuration) => {
      const args = ["mcp", "add", serverName, "--", config.command, ...config.args];
      try {
        if (process.platform === "win32") {
          const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
          const script = `& ${[command, ...args].map(quote).join(" ")}; exit $LASTEXITCODE`;
          const powershell = join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          );
          await exec(
            powershell,
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              Buffer.from(script, "utf16le").toString("base64"),
            ],
            { timeout: 15000, windowsHide: true, env: windowsPowerShellEnvironment() },
          );
        } else await exec(command, args, { timeout: 15000 });
      } catch {
        throw new Error(
          "Codex registration failed. The browser bridge is installed; run agent-native config to retrieve the command and try it directly.",
        );
      }
      return { agent, configured: true as const };
    };
  }

  const directory =
    agent === "claude"
      ? process.env.CLAUDE_CONFIG_DIR || homedir()
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  let path = configFile
    ? resolve(configFile)
    : agent === "claude"
      ? join(directory, ".claude.json")
      : process.env.OPENCODE_CONFIG
        ? resolve(process.env.OPENCODE_CONFIG)
        : join(directory, "opencode", "opencode.json");
  if (
    agent === "opencode" &&
    !configFile &&
    !process.env.OPENCODE_CONFIG &&
    (await readOptional(path + "c")) !== undefined
  )
    path += "c";
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error(
      "Agent configuration must be a regular file. Use setup without --agent for manual configuration.",
    );
  const original = await readOptional(path);
  const source = original ?? "{}\n";
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, {
    allowTrailingComma: agent === "opencode",
    disallowComments: agent === "claude",
  });
  const key = agent === "claude" ? "mcpServers" : "mcp";
  const servers = root && findNodeAtLocation(root, [key]);
  if (errors.length || root?.type !== "object" || (servers && servers.type !== "object"))
    throw new Error(
      `Invalid agent configuration at ${path}. Fix it before running setup; no agent settings were changed.`,
    );
  for (const node of [root, servers]) {
    const keys = node?.children?.map((property) => property.children?.[0]?.value) ?? [];
    if (new Set(keys).size !== keys.length)
      throw new Error("Agent configuration has duplicate keys; resolve them before running setup.");
  }
  return async (config: Configuration) => {
    const entry =
      agent === "claude"
        ? { type: "stdio", ...config.claude.mcpServers.agent_native_browser }
        : config.opencode.mcp.agent_native_browser;
    const contents = applyEdits(
      source,
      modify(source, [key, serverName], entry, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: source.includes("\r\n") ? "\r\n" : "\n",
        },
      }),
    );
    if (contents === source && original !== undefined)
      return { agent, configured: true as const, path };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    if ((await readOptional(path)) !== original)
      throw new Error(
        "Agent configuration changed during setup. Retry; no agent settings were overwritten.",
      );
    const backup = original === undefined ? undefined : `${path}.${randomUUID()}.bak`;
    if (backup) await writeFile(backup, original!, { flag: "wx", mode: 0o600 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { agent, configured: true as const, path, backup };
  };
}
