# Agent Native Browser

A Chrome extension and local CLI that let MCP terminal agents control your existing authenticated browser session. Chrome remains the browser. Milestones 1–3 include browser tools, a Native Messaging bridge, a stdio MCP server, and a manual sidebar. AI chat/providers come later.

Open source under the [MIT license](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Build and load

Requires Node.js 22+ and pnpm 10. If pnpm is not installed, use `npx --yes pnpm@10.30.3` in place of `pnpm`.

```sh
pnpm install
pnpm build
```

1. Open `chrome://extensions` in Chrome 118 or newer.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `apps/extension/dist` (the built directory).
4. Pin **Agent Native Browser**, then click its toolbar icon to open the side panel.
5. Select an open tab by its ID and title. Use **Snapshot**, **HTML**, or **Screenshot**.
6. Choose a snapshot reference to **Click element** or **Type text**. Typing replaces existing content by default; uncheck that option to append. An empty replacement clears the input.
7. Enter an absolute HTTP/HTTPS URL and press **Go** to navigate the selected tab.

Chrome displays its debugger banner while a controlled tab is attached. **Release tab** detaches it. Opening DevTools or canceling the banner can detach the debugger; take a new snapshot afterward.

For development, `pnpm dev` rebuilds on changes. Reload the extension on `chrome://extensions` and reopen the panel after rebuilding.

## Connect terminal agents (macOS)

After building and loading the extension:

```sh
node packages/cli/dist/index.js install
node packages/cli/dist/index.js doctor
```

`install` registers Chrome's Native Messaging host, creates `~/.agent-native`, detects Chrome, and prints exact commands/configuration for **Codex**, **Claude Code**, and **OpenCode**. Copy the command for your agent, then start a new agent session. It does not edit your agent's configuration automatically.

The sidebar's **Terminal agents** indicator should read **Connected**. If it doesn't, reload the extension or click **Reconnect**, then run `doctor` again. Chrome starts the host itself; no separate daemon or repeated pairing is needed.

For Codex, the printed command looks like this (use the actual absolute Node/CLI paths printed by `install`):

```sh
codex mcp add agent_native_browser -- /absolute/path/to/node /absolute/path/to/packages/cli/dist/index.js mcp --home /absolute/path/to/.agent-native
```

Start Codex and try:

> Look through my Chrome tabs and tell me which GitHub issue discusses authentication. Inspect the relevant page before answering.

Use `node packages/cli/dist/index.js config` to print configuration again, or `config --json` for machine-readable configuration. `doctor --json` provides machine-readable diagnostics and exits with status 1 when a check fails. Configuration formats follow the official [Codex MCP](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), and [OpenCode MCP](https://opencode.ai/docs/mcp-servers/) documentation.

The unpacked extension uses development ID `dgejfddjompnibfocdkcjhjaifnogmeo`, fixed by its public manifest key. If upgrading from the original Milestone 1 version, remove the old unpacked extension and load the rebuilt `dist` once. For another build/store ID, use `install --extension-id ID` matching `chrome://extensions`. This public key is only an ID anchor; no private signing key is stored in the repository.

Other installer options:

```sh
# Alternate bridge location (pass the same --home to install, doctor, config and mcp)
node packages/cli/dist/index.js install --home /short/absolute/path

# Chrome for Testing / Chromium registration
node packages/cli/dist/index.js install --browser chrome-for-testing

# Isolated browser profiles used by the integration test
node packages/cli/dist/index.js install --manifest-dir /path/to/profile/NativeMessagingHosts
```

Only one Chrome profile can own a bridge directory at a time. Reinstall after moving the CLI bundle or replacing the recorded Node installation. Closing Chrome disconnects MCP; reopening Chrome and the extension reconnects automatically. Requests interrupted after being sent are reported as having an unknown outcome and are never automatically replayed.

The npm CLI package is prepared locally and is **not published**. To install the built source package globally:

```sh
npm install -g ./packages/cli
agent-native install
agent-native doctor
```

## Current browser tools

| Tool | Parameters | Result |
| --- | --- | --- |
| `browser_list_tabs` | none | All open tabs: ID, title, URL, active status, window ID |
| `browser_open_tab` | `url` | Opens a new HTTP/HTTPS tab and returns metadata |
| `browser_focus_tab` / `browser_close_tab` | `tabId` | Focuses its window / closes the tab |
| `browser_snapshot` | `tabId` | Compact accessibility roles, computed names, page text, element refs |
| `browser_get_html` | `tabId`, optional `selector`, `maxLength` | Main document/element HTML, total length, truncation flag |
| `browser_screenshot` | `tabId` | Visible viewport PNG: `{ mimeType, data }` with base64 image data |
| `browser_click` | `tabId`, `ref` | Trusted mouse input at the referenced element |
| `browser_type` | `tabId`, `ref`, `text`, optional `replaceExisting` | Text insertion into inputs, textareas, or editable content |
| `browser_navigate` | `tabId`, `url` | Starts navigation in that tab |
| `browser_scroll` | `tabId`, `direction`, optional `amount` | Scrolls the main document; default 600 pixels |
| `browser_press_key` | `tabId`, `key` | Keys/chords, e.g. `Enter`, `Shift+Tab`, `Meta+a` |
| `browser_back` / `browser_forward` / `browser_reload` | `tabId` | History navigation or reload |
| `browser_wait` | `tabId`, optional `milliseconds` | Delay, default 500 ms, maximum 10 seconds |
| `browser_release` | `tabId` | Detaches the debugger and clears refs |

Snapshots use the browser's accessibility tree, including semantic controls inside shadow DOM. Each ref remains usable until a newer snapshot, navigation, debugger detach, or a change in the element's identity. Removed or renamed elements return `STALE_REF`; take a fresh snapshot. Ref nonces prevent old references from silently selecting new elements after a worker restart.

Snapshots are limited to 400 lines / 32,000 characters and omit form values. HTML defaults to 100,000 characters and supports limits up to 2,000,000. HTML is returned only when explicitly requested and can contain private page data. Screenshots are captured only on request.

## Architecture

```text
Codex / Claude Code / OpenCode
       ↓ stdio MCP
@agent-native/mcp → Unix socket → Chrome-launched Native Messaging host
                                      ↓ Native Messaging
React manual sidebar ───────────→ MV3 background
                                      ↓
                            dispatchTool → BrowserController
                                               ↓
                                     ChromeBrowserController
                                               ↓
                                  Chrome tabs / debugger / CDP
```

`packages/shared` owns the controller interface, tool parameters/results, response/error types, and transport constants. `apps/extension/browser-tools` owns browser behavior and runtime validation. `packages/native-bridge` owns framing, socket clients, routing, and host lifecycle. `packages/mcp` maps tools into MCP text/image content. `packages/cli` bundles registration, diagnostics, native host, and MCP entry points. Sidebar and MCP both reach the same dispatcher/controller; future chat will use it too.

Debugger connections are reused per tab. Operations on one tab execute in order, while different tabs can run concurrently. The extension has no remote server, content scripts, API keys, provider calls, or externally exposed message handler.

The socket is `~/.agent-native/browser.sock` with mode `0600` inside a `0700` directory. No TCP control endpoint is opened. Length-prefixed JSON frames support fragmented/coalesced messages and preserve per-client request IDs. The host validates its extension origin and protocol handshake. Requests are capped below Chrome's 1 MiB host-to-extension limit; responses below its 64 MiB extension-to-host limit. Queues are bounded, with 45-second request timeouts. Stderr contains diagnostics; stdout is reserved for Native Messaging/MCP frames. See [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) for the protocol and registration locations.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm exec playwright install chromium --no-shell
pnpm test:extension
pnpm test:terminal
```

The integration check loads the actual built MV3 extension in isolated Chrome for Testing with a temporary profile and a local HTTP fixture. It exercises all eight initial success requirements, the React control panel, HTML selection/truncation, stale refs, shadow DOM actions, and invalid parameters. It does not touch your personal Chrome profile. The PNG is saved as `agent-native-viewport.png` in the OS temporary directory.

To use another Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH` for both installation and testing.

`test:terminal` additionally registers the native host inside an isolated Chrome profile and exercises actual Native Messaging and two concurrent stdio MCP clients. It checks authenticated page access, ref actions, multimodal screenshots, keyboard/scroll, navigation, tab management, diagnostics, ownership, timeout handling, malformed frames, and crash recovery. It does not change your regular Chrome/agent configuration. On macOS, add `--codex` to run an optional read-only model-backed Codex check using your existing Codex authentication:

```sh
node scripts/test-terminal.mjs --codex
```

This optional check invokes your configured account's model and uses temporary MCP configuration limited to listing tabs and snapshots. The normal integration tests make no model calls.

## Current limits

- Inspection and element actions target the main frame; iframe traversal is deferred.
- Chrome internal pages, extension pages, file URLs, and browser-protected sites cannot be inspected. All tabs are still listed, and navigation from a new tab is supported.
- Native select menus, drag/drop, uploads/downloads, developer tools, and coordinate actions are deferred. Text entry supports text-like inputs, textareas, and editable content. Keyboard tools support the keys/chords described in their MCP schema.
- Navigation reports that it started; wait for the page to finish loading before taking a snapshot.
- Snapshots of very large pages are truncated. Use selected HTML or a screenshot when the compact snapshot is insufficient.
- The browser test uses an isolated profile. Loading into your signed-in Chrome session remains a manual check.

Native host registration currently targets macOS. Built-in AI chat, provider configuration, and context compaction remain later milestones.

Development context is kept in `.codex/context.md` and excluded from Git.
