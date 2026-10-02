# Browsy CLI

Connect MCP terminal agents to your existing authenticated Chrome session through a local Native Messaging host. macOS, Linux, Windows 10/11, Node.js 22.12+, MIT licensed.

Install Browsy in Chrome, then install the companion and connect your agent:

```sh
npm install -g @adityabelgaonkar/browsy
browsy setup --agent codex
```

Chrome stays open and signed into your websites. Built-in sidebar chat works without this CLI. The [source repository](https://github.com/adityabelgaonkar05/browsy) also documents unpacked extension installation.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js setup --agent codex
```

On Windows use PowerShell and Windows Node.js, not WSL.

Load `apps/extension/dist` unpacked in Chrome. Setup registers the bridge and adds its MCP server to the chosen agent. Use `--agent claude` or `--agent opencode` instead; start a new agent session afterward. The extension reconnects automatically. See the repository [quick start](https://github.com/adityabelgaonkar05/browsy#quick-start).

After building:

```sh
npm install -g ./packages/cli
browsy setup --agent codex
```

For another MCP client, `browsy setup` prints configuration to add manually.

| Command     | Purpose                                                                           |
| ----------- | --------------------------------------------------------------------------------- |
| `setup`     | Register the bridge and configure the selected agent with `--agent`               |
| `install`   | Register the native host and print Codex, Claude Code, and OpenCode configuration |
| `doctor`    | Check executable paths, registration, permissions, and extension connection       |
| `config`    | Print agent configuration again                                                   |
| `mcp`       | Start the stdio MCP server                                                        |
| `uninstall` | Remove this installation's host registration and configuration                    |

Use `--home DIRECTORY` consistently to select a bridge home (default `~/.agent-native`). `setup` and `install` support `--extension-id`, `--browser`, `--chrome-path`, and `--manifest-dir`. `setup`, `install`, `doctor`, `config`, and `uninstall` support `--json`.

`--agent-config FILE` selects a Claude Code or OpenCode configuration file. Existing JSON/JSONC settings and OpenCode comments are preserved; changed existing files receive a backup. Codex uses its own CLI to register the server. Running without `--agent` leaves agent settings untouched.

The bundle includes runtime dependencies. Chrome starts the host with recorded absolute executable paths; no separate daemon or public network control endpoint is needed. Reinstall after moving the bundle or changing the recorded Node installation. Browser requests interrupted after sending are never replayed automatically.
