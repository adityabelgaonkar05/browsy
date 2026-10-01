# Setup reference

Follow the [quick start](../README.md#quick-start) for the default installation on macOS, Linux, or Windows.

## Agent configuration

For automatic registration:

```sh
agent-native setup --agent codex
# Or: agent-native setup --agent claude
# Or: agent-native setup --agent opencode
```

From a source checkout, use `node packages/cli/dist/index.js` in place of `agent-native`. Setup registers the bridge and configures the selected agent. Keep Chrome open and start a new agent session. You can also pass `--agent` to `install`.

Codex registration uses the installed `codex mcp add` command and requires Codex on PATH. Claude Code setup adds a user-scoped entry to `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`). OpenCode setup edits `$OPENCODE_CONFIG` when set, otherwise an existing `opencode.jsonc` or `opencode.json` under `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`). Use `--agent-config FILE` for a specific Claude Code/OpenCode file. Only the `agent_native_browser` entry is updated. Existing settings and comments are preserved, changed files receive a private `.bak` copy, and malformed files are refused.

For manual registration or other MCP clients, run setup without `--agent`. The installer prints the appropriate command or JSON block for each agent. To retrieve it again:

```sh
node packages/cli/dist/index.js config
node packages/cli/dist/index.js config --json
```

The JSON output contains `codexCommand`, `codexToml`, `claudeCommand`, `claude`, and `opencode`. Commands use absolute paths to the current Node executable, CLI bundle, and bridge directory. No `npx` download is needed when the agent starts MCP.

- **Codex:** run the printed `codexCommand`, then start a new session. See [Codex MCP documentation](https://developers.openai.com/codex/mcp).
- **Claude Code:** run the printed `claudeCommand`, which registers a user-scoped stdio server. See [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).
- **OpenCode:** merge the printed `opencode` block into your `opencode.json` and restart the agent. See [OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/).
- **Other MCP clients:** use the JSON output's `command` and `args` as a stdio server definition.

Agent settings change only when `--agent` is supplied. `config` always prints configuration without changing settings.

## What installation writes

| Location                                                                                         | Purpose                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `~/.agent-native/config.json`                                                                    | Recorded executable paths, extension ID, and registration location |
| `~/.agent-native/native-host` (Windows: `native-host.cmd`)                                       | Executable launcher used by Chrome                                 |
| `~/.agent-native/browser.sock`                                                                   | Unix socket, created while the native host is running              |
| `~/.agent-native/bridge.lock`                                                                    | Native host process ownership                                      |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agent_native.browser.json` | Chrome's native host registration (macOS example)                  |

On macOS/Linux, the bridge directory uses mode `0700`; its configuration, socket, and registration use `0600`; its launcher uses `0700`. Chrome starts and stops the native host. Keep the CLI bundle and recorded Node installation at their registered locations.

### Platform differences

| Platform      | Native host discovery                                                                                                                       | Local transport                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| macOS         | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`                                                                         | `~/.agent-native/browser.sock`      |
| Linux         | `$XDG_CONFIG_HOME/google-chrome/NativeMessagingHosts/` (defaults to `~/.config`)                                                            | `~/.agent-native/browser.sock`      |
| Windows 10/11 | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.agent_native.browser`, pointing to the JSON manifest in `%USERPROFILE%\.agent-native` | `\\.\pipe\agent-native-<home hash>` |

Windows uses `native-host.cmd`, a protected bridge directory, and a protected named pipe. No administrator rights are required. Use Windows Node.js and PowerShell, not WSL, for a Windows Chrome session. Printed Windows agent commands use PowerShell quoting. The system Windows PowerShell 5.1 installation is required for the pipe helper.

Linux uses a shell launcher and needs no background service. Snap/Flatpak browser sandboxes can block a host outside the browser sandbox; use a regular Chrome/Chromium installation with Native Messaging support. `--chrome-path` can select a custom binary but cannot bypass a browser’s sandbox restrictions.

Chromium uses its own registration directory/key. Chrome for Testing uses `google-chrome-for-testing` on Linux and `ChromeForTesting` on macOS with Chrome 146+; older versions share normal Chrome’s locations. On Windows it uses Chrome’s registry key.

## Alternate installations

All commands accept `--home` to use a different bridge directory. Use the same value for `install`, `config`, `doctor`, `mcp`, and `uninstall`. The installer includes it in the generated agent commands.

For a browser outside the standard installation locations, pass `--chrome-path` pointing to its executable (inside the application bundle on macOS). `install --help` lists the options.

`--browser chrome-for-testing` and `--browser chromium` select those browsers' registration locations. `--manifest-dir` overrides the manifest directory. On Windows, registration still uses the current user’s registry; it is not isolated by Chrome profile. Only one running profile can own a bridge home.

The default extension ID is `dgejfddjompnibfocdkcjhjaifnogmeo`, anchored by the public key in its manifest. Different builds can use `install --extension-id` with the ID shown in `chrome://extensions`. The repository contains no private signing key.

## Updates

```sh
git pull
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js install
```

Reload the unpacked extension and start a new agent session. If upgrading from a build whose extension ID differs, remove the old unpacked extension and load `apps/extension/dist` again. Reinstall after moving the repository or changing the recorded Node installation.

## Optional global CLI

After building:

```sh
npm install -g ./packages/cli
agent-native setup --agent codex
agent-native doctor
```

The built package includes its runtime dependencies. The global command can be used in place of `node packages/cli/dist/index.js` for all commands.

## Removal

```sh
node packages/cli/dist/index.js uninstall
```

This removes the recorded native registration, launcher, and configuration, and stops a connected matching host. It preserves unrelated files and leaves the bridge directory itself in place.

Remove the Chrome extension in `chrome://extensions`. Remove `agent_native_browser` from your agent configuration: `codex mcp remove agent_native_browser`, `claude mcp remove agent_native_browser`, or delete the matching OpenCode entry. If you installed the global CLI, remove it with `npm uninstall -g @agent-native/cli`.
