# Architecture

```text
Terminal agent → stdio MCP → Local IPC → Native Messaging host
                                                    ↓
Control panel / AI chat → runtime messages → Extension background
                                                    ↓
                                      dispatchTool → BrowserController
                                                          ↓
                                                Chrome tabs / debugger / CDP
```

## Workspaces

| Directory                      | Responsibility                                                             |
| ------------------------------ | -------------------------------------------------------------------------- |
| `apps/extension/background`    | MV3 lifecycle, UI messaging, native connection/retry                       |
| `apps/extension/browser-tools` | Shared dispatcher and Chrome browser controller                            |
| `apps/extension/sidebar`       | React control panel and streaming AI chat                                  |
| `apps/extension/providers`     | Provider adapters, model discovery, streaming and multimodal serialization |
| `apps/extension/chat`          | Tool loop, local history and structured context compaction                 |
| `packages/shared`              | Controller interface, request/result types, protocol constants and guards  |
| `packages/native-bridge`       | Native host lifecycle, Local IPC clients, framing and request routing      |
| `packages/mcp`                 | MCP schemas, descriptions, text/image results and stdio transport          |
| `packages/cli`                 | Registration, diagnostics, removal and executable entry points             |
| `scripts`                      | Builds and automated integration/package verification                      |

Browser behavior does not depend on MCP. MCP, manual control, and chat use the same `dispatchTool` function and controller instance. MCP and chat also share the tool descriptions and schemas in `packages/shared/src/browser-tools.ts`. A future browser implementation can replace `ChromeBrowserController` behind the interface.

## Lifecycle

Chrome launches the registered host when the extension calls `connectNative`. The extension and host exchange protocol/version and extension-ID information before marking the bridge ready. The host owns the Local IPC for that bridge home.

The extension maintains its native port and reconnects with backoff. A Chrome alarm wakes the service worker to retry if it was suspended while the host was unavailable. MCP initialization is independent of Chrome availability; browser calls connect lazily and return diagnostics when Chrome is offline.

The bridge uses a process lock to avoid replacing another profile's live socket. A dead process's lock/socket are reclaimed on restart. Shutdown closes clients and removes owned runtime files.

## Protocol and limits

Native Messaging and local IPC messages are UTF-8 JSON preceded by a four-byte little-endian length. The decoder supports split/coalesced frames. Requests stay below Chrome's 1 MiB host-to-extension limit; responses stay below its 64 MiB extension-to-host limit. See the [Chrome protocol reference](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

The bridge replaces client IDs with unique routing IDs when forwarding requests, then restores each client's ID on response. At most 16 socket clients and 64 bridge requests are active. The extension bounds each tab's queued operations at 64. Browser work is serialized per tab and independent tabs can proceed concurrently. Request timeouts are 45 seconds.

Connections can retry before a request is sent. In-flight disconnects and timeouts report that the outcome may be unknown. Retrying sent actions automatically could duplicate clicks, submissions, or typing, so clients must inspect the resulting page first.

## Browser backend

The controller reuses Chrome debugger connections. Accessibility snapshots use computed roles/names and backend node IDs, including semantic controls in shadow DOM. Snapshot nonces avoid aliasing old refs after a worker restart. Actions verify current accessibility identity and element connectivity before dispatching trusted input.

HTML and screenshots are explicit tools. MCP snapshots return concise text; screenshots return image content. API-specific response formatting remains inside the MCP workspace.

## Distribution

The build bundles the CLI, native bridge, MCP server, and their dependencies into a standalone Node.js executable. Chrome's launcher records absolute Node and CLI paths, avoiding reliance on the GUI process's PATH. The package archive includes the bundle, source map, MIT license, and package documentation.

## Platform adapters

macOS and Linux use Node Unix sockets with filesystem permissions. Windows uses a named pipe with a protected ACL restricted to the current user and denying network logons. A small C# helper compiled by system Windows PowerShell owns the secured pipe instances and relays byte streams to the Node host over private inherited stdio. Routing, framing, timeouts, MCP, and browser tools remain shared. Closing the host’s helper stdin shuts down the helper; Windows removes pipe instances automatically.

Windows installs a `.cmd` launcher and a current-user registry value. Unix platforms install executable shell launchers and browser-specific JSON manifests. The standalone CLI package includes the Windows helper source.

## Built-in chat

The sidebar hosts provider fetches and the tool loop, avoiding MV3 worker lifetime limits during long streams. OpenAI uses the Responses API with stateless encrypted reasoning retention; OpenRouter and compatible servers use Chat Completions; Anthropic uses Messages. Adapters normalize assistant text, tool calls, image results, usage, and provider-specific reasoning state. Models are chosen by the user rather than hardcoded. OpenRouter uses authenticated user-filtered discovery.

Only the extension background owns browser control. Chat submits validated calls to the same runtime transport as the manual panel. Closed/interrupted sidebars record unresolved calls as unknown outcomes when reopened; actions never resume automatically. An extension-origin Web Lock prevents concurrent sidebar turns. The chat code loads only after selecting Chat.

Chat context is separate from MCP clients. It retains pinned instructions, structured task state, chronological notes from older conversation, the two most recent user turns verbatim, and current browser metadata/results. Compaction begins around `min(100000, modelContext * 0.8)` with a 128K logical budget. Usage comes from provider reports where available; context estimates use a conservative byte heuristic and image allowance, not an exact tokenizer. Tool schema and output space are reserved before generation.

Keys and profiles use trusted local extension storage; the conversation uses IndexedDB so screenshots do not compete with Chrome’s small storage quota. Provider authentication headers never travel through the browser dispatcher or bridge. No provider request is made until the user requests model discovery or sends a chat message.
