# Architecture

```text
Terminal agent → stdio MCP → Local IPC → Native Messaging host
                                                    ↓
Control panel → Chrome runtime messages → Extension background
                                                    ↓
                                      dispatchTool → BrowserController
                                                          ↓
                                                Chrome tabs / debugger / CDP
```

## Workspaces

| Directory                      | Responsibility                                                            |
| ------------------------------ | ------------------------------------------------------------------------- |
| `apps/extension/background`    | MV3 lifecycle, UI messaging, native connection/retry                      |
| `apps/extension/browser-tools` | Shared dispatcher and Chrome browser controller                           |
| `apps/extension/sidebar`       | React manual control panel                                                |
| `packages/shared`              | Controller interface, request/result types, protocol constants and guards |
| `packages/native-bridge`       | Native host lifecycle, Local IPC clients, framing and request routing     |
| `packages/mcp`                 | MCP schemas, descriptions, text/image results and stdio transport         |
| `packages/cli`                 | Registration, diagnostics, removal and executable entry points            |
| `scripts`                      | Builds and automated integration/package verification                     |

Browser behavior does not depend on MCP. Both transports use the same `dispatchTool` function and controller instance. A future browser implementation can replace `ChromeBrowserController` behind the interface.

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
