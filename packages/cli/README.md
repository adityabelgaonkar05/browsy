# Agent Native Browser CLI

Connect MCP terminal agents to your existing authenticated Chrome session through a local Native Messaging host. macOS, Linux, Windows 10/11, Node.js 22.12+, MIT licensed.

The package is built and installed from the [source repository](https://github.com/adityabelgaonkar05/ai-native-browser). It is not yet published to the npm registry.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js install
```

On Windows use PowerShell and Windows Node.js, not WSL.

Load `apps/extension/dist` unpacked in Chrome. Reload the extension after registration, run `doctor`, and use the agent configuration printed by the installer. See the repository [quick start](https://github.com/adityabelgaonkar05/ai-native-browser#quick-start).

After building, `npm install -g ./packages/cli` installs the `agent-native` command.

| Command     | Purpose                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `install`   | Register the native host and print Codex, Claude Code, and OpenCode configuration |
| `doctor`    | Check executable paths, registration, permissions, and extension connection       |
| `config`    | Print agent configuration again                                                   |
| `mcp`       | Start the stdio MCP server                                                        |
| `uninstall` | Remove this installation's host registration and configuration                    |

Use `--home DIRECTORY` consistently to select a bridge home (default `~/.agent-native`). `install` supports `--extension-id`, `--browser`, `--chrome-path`, and `--manifest-dir`. `install`, `doctor`, `config`, and `uninstall` support `--json`.

The bundle includes runtime dependencies. Chrome starts the host with recorded absolute executable paths; no separate daemon or public network control endpoint is needed. Reinstall after moving the bundle or changing the recorded Node installation. Browser requests interrupted after sending are never replayed automatically.
