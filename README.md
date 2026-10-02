# Browsy

An AI sidebar for Chrome, with browser tools for your terminal agents too. Chat directly in Browsy or use Codex, Claude Code, OpenCode, or another MCP agent to work inside your existing authenticated Chrome session. Sign into websites normally; both use the same browser tools.

- **Chat in Chrome:** ask Browsy to summarize your current page, find information across open tabs, or interact with a website. Choose your own model through OpenRouter, OpenAI, Anthropic, or an OpenAI-compatible endpoint, including local servers. Replies stream in the sidebar, with expandable tool results and screenshots for models that support vision. No terminal agent or npm bridge is needed for sidebar chat.
- **Connect a terminal agent:** install the npm companion to give your existing MCP agent access to those same tabs, snapshots, screenshots, and browser actions.

Chrome remains your browser. Browser control runs locally in the extension; terminal integration adds a Native Messaging host and local IPC. There is no hosted control server or remote debugging port. Sidebar chat sends messages and requested browser content to your chosen AI provider.

**Platforms:** macOS, Linux, and Windows 10/11; Chrome 118+, Node.js 22.12+ and pnpm 10. The extension is loaded unpacked from this repository; a Chrome Web Store listing is not available.

**Status:** early preview. Browser control and terminal integration pass CI on macOS, Linux, and Windows with Node.js 22 and 24. Provider adapters have synthetic streaming checks; live provider compatibility still needs verification. See the [release audit](docs/release-audit.md) for evidence and limits.

## Installation

You need Chrome 118+ and Node.js 22.12+. Browsy is distributed as an unpacked extension, so Chrome **Developer mode** is required. On Windows, use PowerShell and Windows Node.js rather than WSL.

For sidebar chat only, follow [Build and load the Chrome extension](#2-build-and-load-the-chrome-extension), then [Built-in AI chat](#built-in-ai-chat). To connect a terminal agent as well, complete all three steps below.

### Ask your agent to set it up

Paste this into Codex, OpenCode, or Claude Code:

> Search npm for Browsy by adityabelgaonkar (package: @adityabelgaonkar/browsy). Read the setup guide at https://github.com/adityabelgaonkar05/browsy, install the npm companion, build the Chrome extension, and configure Browsy's MCP server for the agent I'm using. Walk me through loading the extension unpacked in Chrome, run `browsy doctor`, and tell me when to start a new agent session.

Your agent can run the installation and configuration commands. You still need to enable **Developer mode** and select **Load unpacked** in Chrome. For manual setup, follow the steps below.

### 1. Install the npm companion

```sh
npm install -g @adityabelgaonkar/browsy
```

### 2. Build and load the Chrome extension

Get this repository and build the extension:

```sh
git clone https://github.com/adityabelgaonkar05/browsy.git
cd browsy
npx --yes pnpm@10.30.3 install --frozen-lockfile
npx --yes pnpm@10.30.3 --filter @agent-native/extension build
```

If pnpm is already installed, use `pnpm` instead of `npx --yes pnpm@10.30.3`.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `apps/extension/dist` inside your checkout.
3. Pin **Browsy** and click its toolbar icon to open the sidebar.

Keep the checkout on your computer; Chrome loads the extension from that folder. After updating or rebuilding it, click **Reload** in `chrome://extensions`.

### 3. Connect your terminal agent

Choose the agent you already have installed:

```sh
browsy setup --agent codex
```

Use `--agent claude` or `--agent opencode` instead for those agents. Setup registers the local bridge and adds its MCP server to the selected agent. For another MCP client, `browsy setup` prints configuration to add manually.

Keep Chrome open, then start a **new agent session**. To check the connection:

```sh
browsy doctor
```

Ask your agent:

> Inspect my active Chrome tab and describe what I am seeing.

Or:

> Find the open GitHub tab containing an issue about authentication and summarize it.

Select a normal HTTP/HTTPS website tab. Chrome internal pages such as `chrome://extensions` are listed but cannot be inspected. If the agent cannot find its browser tools, check the connection and restart its session.

Browser tools use your existing website sessions. Terminal agents manage their own model, credentials and context. If you only want the built-in sidebar chat, you can skip the npm companion and terminal-agent setup.

## Built-in AI chat

Reload the extension after building. The sidebar opens on **Chat**.

1. Choose **Connect AI**, select a provider, and enter your key (optional for local servers).
2. Choose **Continue**, pick a model, and select **Start chatting**.

Provider details, model overrides, screenshot capabilities, context limits, and chat memory live in **Settings**. **Advanced connection settings** supports manually entered models and local endpoints. Capabilities are filled from discovery when available; unknown vision support remains disabled.

Try “Summarize my active tab” or “Find the GitHub tab about authentication.” Replies stream as they arrive, with expandable browser tool results. **Stop** cancels further work; **New chat** clears history. Provider/model changes start a fresh conversation. The manual panel remains under **Browser tools**.

Built-in chat does not need the npm bridge. Keys stay in local extension storage, never Chrome Sync or webpages. Chat, requested page data, and screenshots go directly to the selected provider; a local endpoint keeps those requests local. See the [chat guide](docs/chat.md) for setup, capabilities, context, and data handling.

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
- [Privacy policy](PRIVACY.md)

Chrome shows its debugger banner while a tab is controlled. **Release tab** removes that connection. Opening DevTools or canceling the banner can detach the debugger; take a new snapshot before continuing.

## Development and source configuration

For contributors or anyone running the CLI from source, use Node.js 22.12+ and pnpm 10.30.3. From a checkout of this repository:

```sh
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js setup --agent codex
```

This builds both the extension and CLI. Load `apps/extension/dist` unpacked as described above. Source setup records the checkout's CLI path; keep the checkout in place and rerun setup after moving it. Use `--agent claude` or `--agent opencode` for those agents. For source diagnostics, run `node packages/cli/dist/index.js doctor`.

```sh
pnpm dev
```

This watches and rebuilds the extension. Reload it in Chrome after changes. Rebuild the CLI with `pnpm build` when changing bridge or MCP code.

To package an unpacked extension ZIP and standalone npm archive after building, run `pnpm release:pack`. Outputs go to ignored `artifacts/release/`; this command does not publish them.

### Checks

```sh
pnpm check
pnpm exec playwright install chromium --no-shell
pnpm test
```

`pnpm check` runs formatting, TypeScript and production builds. `pnpm test` runs chat safety, extension, Native Messaging/MCP and packaged CLI checks in temporary profiles and directories. Fixtures are local and make no model calls. Tests do not change your agent configuration. Windows terminal tests temporarily register a host for their isolated browser and restore the previous registry value afterward; close other Chrome profiles first.

CI defines macOS, Linux and Windows jobs with Node.js 22 and 24. See [CONTRIBUTING.md](CONTRIBUTING.md) for details and the optional Codex integration check.

## Scope

Current browser tools inspect and interact with the main document, including semantic controls inside shadow DOM. Focused typing also supports same-origin iframe editors such as Google Docs; canvas editors can be targeted with screenshot coordinates. General iframe inspection/traversal, uploads/downloads, and developer tools are not implemented. Registration supports all three desktop platforms, with one Chrome profile owning a bridge directory at a time.

## License

[MIT](LICENSE). Production builds include `THIRD_PARTY_NOTICES.txt` for bundled dependency licenses. Contributions are welcome through issues and pull requests.
