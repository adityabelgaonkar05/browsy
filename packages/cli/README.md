# Agent Native Browser CLI

Local macOS Native Messaging bridge and stdio MCP server for an existing Chrome session. Open source under MIT.

This package must be built before installation from the repository. From the repository root:

```sh
pnpm install
pnpm build
node packages/cli/dist/index.js install
node packages/cli/dist/index.js doctor
```

Load `apps/extension/dist` unpacked in Chrome. `install` registers the local host and prints exact Codex, Claude Code, and OpenCode configuration. It does not edit those agents' configuration files.

The executable is `agent-native`. Commands: `install`, `doctor`, `config`, `mcp`. Use `--home DIRECTORY` to choose a local bridge directory (default `~/.agent-native`). For an extension with another ID, pass `install --extension-id ID`.

Chrome starts the native host automatically. MCP connects through a private Unix socket; no network control server or API key is required. The bundle includes runtime dependencies and uses the Node executable recorded during installation. Reinstall if you move this package or replace that Node installation.

Use `config --json` for machine-readable agent configuration and `doctor --json` for diagnostics. Windows/Linux installation support is deferred.
