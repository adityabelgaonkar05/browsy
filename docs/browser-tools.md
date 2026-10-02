# Browser tool reference

Browser tools are shared by the extension control panel and MCP agents. MCP exposes tool schemas and descriptions to the agent automatically.

## Parameters and results

| Tool                 | Parameters                                         | Result                                                              |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------- |
| `browser_list_tabs`  | none                                               | Tabs with `id`, `title`, `url`, `active`, `windowId`                |
| `browser_open_tab`   | `url`                                              | New tab metadata                                                    |
| `browser_focus_tab`  | `tabId`                                            | Activates the tab and focuses its window                            |
| `browser_close_tab`  | `tabId`                                            | Closes the tab                                                      |
| `browser_snapshot`   | `tabId`                                            | Compact accessibility snapshot and element refs                     |
| `browser_get_html`   | `tabId`, optional `selector`, `maxLength`          | `{ html, totalLength, truncated }`                                  |
| `browser_screenshot` | `tabId`                                            | PNG image content in MCP; `{ mimeType, data, viewport }` internally |
| `browser_click`      | `tabId`, either `ref` or `x`, `y`                  | Trusted mouse click                                                 |
| `browser_type`       | `tabId`, `text`, optional `ref`, `replaceExisting` | Inserts text; ref mode replaces, focused mode preserves             |
| `browser_press_key`  | `tabId`, `key`                                     | Sends a key to the focused element                                  |
| `browser_scroll`     | `tabId`, `direction`, optional `amount`            | Scrolls the main document by pixels                                 |
| `browser_navigate`   | `tabId`, `url`                                     | Starts navigation                                                   |
| `browser_back`       | `tabId`                                            | Goes back in history                                                |
| `browser_forward`    | `tabId`                                            | Goes forward in history                                             |
| `browser_reload`     | `tabId`                                            | Starts a reload                                                     |
| `browser_wait`       | `tabId`, optional `milliseconds`                   | Brief delay                                                         |
| `browser_release`    | `tabId`                                            | Detaches the debugger and expires refs                              |

`tabId` comes from tab listing. `active` means active within its window; multiple windows can have active tabs. URLs for opening/navigating must be absolute HTTP or HTTPS URLs.

## Inspection

Start with a snapshot. It includes headings, links, controls, accessibility labels/states, and concise page text, with up to 400 lines and 32,000 characters. Individual labels/text lines are shortened to 180 characters. Input value fields are omitted.

Example:

```text
[ref=e1-abc123] heading "Issue details" level=1
[ref=e2-abc123] textbox "Search"
[ref=e3-abc123] button "Save"
```

Refs belong to the most recent snapshot of that tab. A new snapshot from any client replaces the old refs. Navigation, debugger detach, removed elements, or changed element identities invalidate them. Request another snapshot after `STALE_REF`; never guess a ref.

Use screenshots when accessibility information does not explain the visible page, including canvas, layout, or ambiguous controls. Screenshots cover the visible viewport and include its CSS-pixel dimensions for coordinate targeting; PNG pixel density may differ. They are not taken automatically. Their usefulness depends on the external agent's vision support.

Use HTML explicitly for extraction or debugging. `selector` is a CSS selector in the main document. `maxLength` defaults to 100,000 characters and accepts 1–2,000,000. Results indicate truncation. HTML does not traverse shadow roots or iframe documents.

## Interaction

Typing with a snapshot ref supports text-like inputs, textareas, and editable content. `replaceExisting=true` replaces all content, and an empty replacement clears it. `false` appends. Select controls, file inputs, and number/date inputs are not supported by `browser_type`.

For canvas editors such as Google Docs, take a screenshot and click the document editing area with `browser_click({ tabId, x, y })`. Coordinates are CSS pixels relative to the visible viewport; use either coordinates or a ref. Then call `browser_type({ tabId, text })` **without a ref** to type at the focused editor’s current caret. Focused typing preserves existing content by default and follows same-origin iframe and shadow-root focus. It rejects a missing, read-only, or inaccessible editor. Cross-origin iframe input is not supported.

In focused mode, explicit `replaceExisting=true` selects all content in ordinary editors before replacing it. Google Docs manages its own document selection, so it rejects that flag: open **Edit → Select all** using snapshot refs, then type without the flag to replace the selection, or press Backspace to clear it. Google Docs accepts up to 2,000 characters per call; continue longer text in chunks without replacement. It receives trusted character events, with newlines sent as Enter; tab characters are rejected before editing (use `browser_press_key` separately for keyboard navigation or indentation). If a write is interrupted, inspect before continuing; never blindly replay text.

Keyboard input supports `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Space`, and alphanumeric keys. Modifiers are `Ctrl`/`Control`, `Alt`, `Shift`, and `Meta`/`Cmd`/`Command`; examples are `Shift+Tab` and `Meta+a` on macOS. Click or type into a control before sending keys to it.

Scroll direction is `up`, `down`, `left`, or `right`. Amount defaults to 600 pixels and accepts 1–10,000. Scrolling targets the main document, not nested scroll containers.

Navigation/reload return when started. A snapshot taken while loading can fail or reflect an intermediate page. `browser_wait` provides a delay of 0–10,000 ms (default 500), not a guarantee that dynamic content has finished loading.

## Errors

| Code                              | Meaning / recovery                                                              |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `STALE_REF`                       | Take a fresh snapshot before acting                                             |
| `RESTRICTED_PAGE`                 | Choose an HTTP/HTTPS website tab; internal/extension/file pages are unsupported |
| `ELEMENT_OBSCURED`                | Inspect the overlay/layout with a screenshot before retrying                    |
| `ELEMENT_NOT_INTERACTABLE`        | Element is hidden, disabled, or not editable                                    |
| `SELECTOR_NOT_FOUND`              | No element matches the supplied CSS selector                                    |
| `DEBUGGER_UNAVAILABLE`            | Close another debugger/DevTools or inspect browser policy restrictions          |
| `TAB_NOT_FOUND`                   | List tabs again; the tab has closed                                             |
| `INVALID_PARAMS` / `UNKNOWN_TOOL` | Correct the request using the exposed schema                                    |
| `BRIDGE_UNAVAILABLE`              | Open Chrome and run CLI diagnostics                                             |
| `BRIDGE_DISCONNECTED` / `TIMEOUT` | The action may have occurred; inspect before repeating it                       |
| `BUSY`                            | Wait for outstanding browser work to finish                                     |
| `MESSAGE_TOO_LARGE`               | Request less HTML or reduce the viewport/result size                            |
| `BROWSER_ERROR`                   | Read the error and inspect the page before retrying                             |

MCP returns tool errors as `isError: true` with a JSON error object in text content. Actions that have been sent are never automatically replayed after a disconnect or timeout.
