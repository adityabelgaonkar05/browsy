# Setup reference

Follow the [quick start](../README.md#quick-start) for the default macOS installation.

## Agent configuration

The installer prints the appropriate command or JSON block for each agent. To retrieve it again:

```sh
node packages/cli/dist/index.js config
node packages/cli/dist/index.js config --json
```

The JSON output contains `codexCommand`, `codexToml`, `claudeCommand`, `claude`, and `opencode`. Commands use absolute paths to the current Node executable, CLI bundle, and bridge directory. No `npx` download is needed when the agent starts MCP.

- **Codex:** run the printed `codexCommand`, then start a new session. See [Codex MCP documentation](https://developers.openai.com/codex/mcp).
- **Claude Code:** run the printed `claudeCommand`, which registers a user-scoped stdio server. See [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).
- **OpenCode:** merge the printed `opencode` block into your `opencode.json` and restart the agent. See [OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/).
- **Other MCP clients:** use the JSON output's `command` and `args` as a stdio server definition.

The installer prints configuration and does not modify agent configuration files.

## What installation writes

| Location                                                                                         | Purpose                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `~/.agent-native/config.json`                                                                    | Recorded executable paths, extension ID, and registration location |
| `~/.agent-native/native-host`                                                                    | Executable launcher used by Chrome                                 |
| `~/.agent-native/browser.sock`                                                                   | Unix socket, created while the native host is running              |
| `~/.agent-native/bridge.lock`                                                                    | Native host process ownership                                      |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.agent_native.browser.json` | Chrome's native host registration                                  |

The bridge directory uses mode `0700`; its configuration, socket, and registration use `0600`; its launcher uses `0700`. Chrome starts and stops the native host. Keep the CLI bundle and recorded Node installation at their registered locations.

## Alternate installations

All commands accept `--home` to use a different bridge directory. Use the same value for `install`, `config`, `doctor`, `mcp`, and `uninstall`. The installer includes it in the generated agent commands.

For a browser installed outside `/Applications` or `~/Applications`, pass `--chrome-path` pointing to the executable inside its application bundle. `install --help` lists the options.

`--browser chrome-for-testing` and `--browser chromium` select those browsers' macOS registration locations. `--manifest-dir` selects the NativeMessagingHosts directory of an isolated browser profile. Only one running profile can own a bridge home.

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
agent-native install
agent-native doctor
```

The built package includes its runtime dependencies. The global command can be used in place of `node packages/cli/dist/index.js` for all commands.

## Removal

```sh
node packages/cli/dist/index.js uninstall
```

This removes the recorded native registration, launcher, and configuration, and stops a connected matching host. It preserves unrelated files and leaves the bridge directory itself in place.

Remove the Chrome extension in `chrome://extensions`. Remove `agent_native_browser` from your agent configuration: `codex mcp remove agent_native_browser`, `claude mcp remove agent_native_browser`, or delete the matching OpenCode entry. If you installed the global CLI, remove it with `npm uninstall -g @agent-native/cli`.
