# Agent Native Browser

Use Codex, Claude Code, OpenCode, or another MCP agent inside your existing authenticated Chrome session. Sign into websites normally; the extension exposes local browser tools to your terminal agent.

Chrome remains your browser. Browser control runs locally through a Chrome extension, Native Messaging host, and local IPC. There is no hosted control server or remote debugging port.

**Platforms:** macOS, Linux, and Windows 10/11; Chrome 118+, Node.js 22.12+ and pnpm 10. The CLI is installed from source; an npm registry release and Chrome Web Store listing are not available yet.

## Quick start

### 1. Build

```sh
git clone https://github.com/adityabelgaonkar05/ai-native-browser.git
cd ai-native-browser
npx --yes pnpm@10.30.3 install --frozen-lockfile
npx --yes pnpm@10.30.3 build
```

If pnpm is already installed, use `pnpm` instead of `npx --yes pnpm@10.30.3`.

### 2. Load the extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `apps/extension/dist` directory.
3. Pin **Agent Native Browser** and click its toolbar icon to open the control panel.

The extension can inspect normal HTTP/HTTPS website tabs. Chrome internal pages such as `chrome://extensions` are listed but cannot be inspected.

### 3. Connect your agent

From the repository root:

```sh
node packages/cli/dist/index.js setup --agent codex
```

Use `--agent claude` or `--agent opencode` for those agents. This command registers the bridge and adds its MCP server to the selected agent. No separate MCP command or configuration editing is needed.

On Windows, run these commands in PowerShell using a Windows Node.js installation, rather than WSL. The installer prints PowerShell commands on Windows.

For another MCP client, run `node packages/cli/dist/index.js setup` without `--agent`. It prints commands for Codex/Claude Code and configuration for OpenCode and other clients.

The extension reconnects automatically while Chrome is open. **Terminal agents** should show **Connected**. If you need connection diagnostics:

```sh
node packages/cli/dist/index.js doctor
```

### 4. Use your agent

Start a new agent session after setup. Keep Chrome open and select a normal website tab.

Try:

> Inspect my active Chrome tab. Take a snapshot, then a screenshot, and describe what I am seeing.

Or:

> Find the open GitHub tab containing an issue about authentication and summarize it.

Browser tools use your existing website sessions. The agent controls its own model, API credentials, and conversation context. The extension currently provides a manual control panel; built-in AI chat is not included.

## npm CLI flow

After building, the packaged CLI gives the two-command setup flow:

```sh
npm install -g ./packages/cli
agent-native setup --agent codex
```

Install the Chrome extension separately and keep Chrome open. Choose `codex`, `claude`, or `opencode`; setup adds the browser tools for that agent. When the npm package is published, the registry package name replaces `./packages/cli`. Its final product name is still undecided. Setup runs explicitly and does not depend on npm lifecycle scripts.

## Browser tools

There are 17 tools, shared by the control panel and MCP transport:

| Area        | Tools                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| Tabs        | `browser_list_tabs`, `browser_open_tab`, `browser_focus_tab`, `browser_close_tab`       |
| Inspection  | `browser_snapshot`, `browser_get_html`, `browser_screenshot`                            |
| Interaction | `browser_click`, `browser_type`, `browser_press_key`, `browser_scroll`                  |
| Navigation  | `browser_navigate`, `browser_back`, `browser_forward`, `browser_reload`, `browser_wait` |
| Connection  | `browser_release`                                                                       |

Snapshots are the default page representation: compact accessibility roles, labels, page text, and element references. Screenshots return MCP image content for multimodal agents. HTML and screenshots are requested explicitly.

See the [tool reference](docs/browser-tools.md) for parameters, limits, and error behavior.

## Setup and troubleshooting

- [Agent configuration, alternate installations, updates, and removal](docs/setup.md)
- [Connection and browser-tool troubleshooting](docs/troubleshooting.md)
- [Architecture and transport details](docs/architecture.md)
- [Security and data handling](SECURITY.md)

Chrome shows its debugger banner while a tab is controlled. **Release tab** removes that connection. Opening DevTools or canceling the banner can detach the debugger; take a new snapshot before continuing.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium --no-shell
pnpm test
```

`pnpm check` runs formatting checks, TypeScript checks, and the production builds. `pnpm test` runs the extension, Native Messaging/MCP, and packaged CLI checks in temporary profiles and directories. Tests use local fixtures and make no model calls. They do not change your agent configuration. Windows tests temporarily register a native host for their isolated browser and restore the previous registry value afterward. Close other Chrome profiles before running the terminal suite.

The macOS, Linux, and Windows CI workflow runs the same checks on Node.js 22 and 24. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and the optional Codex integration check.

## Scope

Current browser tools inspect and interact with the main document, including semantic controls inside shadow DOM. Iframe traversal, full-page screenshots, uploads/downloads, developer tools, and built-in AI chat are not implemented. Registration supports all three desktop platforms, with one Chrome profile owning a bridge directory at a time.

## License

[MIT](LICENSE). Contributions are welcome through issues and pull requests.
