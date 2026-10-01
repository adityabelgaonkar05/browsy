# Agent Native Browser

A Chrome extension that controls tabs in your existing browser session. **Milestone 1** implements local browser tools and a manual sidebar. Chrome remains the browser.

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

## Current browser tools

| Tool | Parameters | Result |
| --- | --- | --- |
| `browser_list_tabs` | none | All open tabs: ID, title, URL, active status, window ID |
| `browser_snapshot` | `tabId` | Compact accessibility roles, computed names, page text, element refs |
| `browser_get_html` | `tabId`, optional `selector`, `maxLength` | Main document/element HTML, total length, truncation flag |
| `browser_screenshot` | `tabId` | Visible viewport PNG: `{ mimeType, data }` with base64 image data |
| `browser_click` | `tabId`, `ref` | Trusted mouse input at the referenced element |
| `browser_type` | `tabId`, `ref`, `text`, optional `replaceExisting` | Text insertion into inputs, textareas, or editable content |
| `browser_navigate` | `tabId`, `url` | Starts navigation in that tab |
| `browser_release` | `tabId` | Detaches the debugger and clears refs |

Snapshots use the browser's accessibility tree, including semantic controls inside shadow DOM. Each ref remains usable until a newer snapshot, navigation, debugger detach, or a change in the element's identity. Removed or renamed elements return `STALE_REF`; take a fresh snapshot. Ref nonces prevent old references from silently selecting new elements after a worker restart.

Snapshots are limited to 400 lines / 32,000 characters and omit form values. HTML defaults to 100,000 characters and supports limits up to 2,000,000. HTML is returned only when explicitly requested and can contain private page data. Screenshots are captured only on request.

## Architecture

```text
React manual sidebar
       ↓ typed Chrome runtime messages
MV3 background → dispatchTool → BrowserController
                                   ↓
                         ChromeBrowserController
                                   ↓
                      Chrome tabs / debugger / CDP
```

`packages/shared` owns the controller interface, tool parameters/results, and response/error types. `apps/extension/browser-tools` owns browser behavior and runtime validation. The sidebar only calls tools; it contains no browser control implementation. Future MCP and built-in chat will use this same dispatcher and controller.

Debugger connections are reused per tab. Operations on one tab execute in order, while different tabs can run concurrently. The extension has no remote server, content scripts, API keys, provider calls, or externally exposed message handler.

## Verification

```sh
pnpm typecheck
pnpm build
pnpm exec playwright install chromium --no-shell
pnpm test:extension
```

The integration check loads the actual built MV3 extension in isolated Chrome for Testing with a temporary profile and a local HTTP fixture. It exercises all eight initial success requirements, the React control panel, HTML selection/truncation, stale refs, shadow DOM actions, and invalid parameters. It does not touch your personal Chrome profile. The PNG is saved as `agent-native-viewport.png` in the OS temporary directory.

To use another Playwright browser cache, set `PLAYWRIGHT_BROWSERS_PATH` for both installation and testing.

## Current limits

- Inspection and element actions target the main frame; iframe traversal is deferred.
- Chrome internal pages, extension pages, file URLs, and browser-protected sites cannot be inspected. All tabs are still listed, and navigation from a new tab is supported.
- Native select menus, drag/drop, coordinate actions, and keyboard shortcuts are outside this milestone. Text entry supports text-like inputs, textareas, and editable content.
- Navigation reports that it started; wait for the page to finish loading before taking a snapshot.
- Snapshots of very large pages are truncated. Use selected HTML or a screenshot when the compact snapshot is insufficient.
- The browser test uses an isolated profile. Loading into your signed-in Chrome session remains a manual check.

Milestone 2 is the Native Messaging bridge. CLI registration, MCP, providers/chat, and context compaction will follow in later milestones.

Development context is kept in `.codex/context.md` and excluded from Git.
