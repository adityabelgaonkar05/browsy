# Security and data handling

Agent Native Browser trusts software running as the current OS user to control the browser. Browser actions intentionally use the user's existing authenticated website sessions. An agent can interact with pages, submit forms, navigate, and close tabs through the tools it is given.

## Local control boundary

- macOS/Linux control uses a Unix socket inside a private `0700` directory; the socket uses `0600`.
- Windows control uses a named pipe whose protected ACL grants the current user access and explicitly denies the Network SID. The bridge directory grants only the current user and SYSTEM access. Windows PowerShell 5.1 supplies the OS pipe helper; no downloaded helper or listening TCP port is needed.
- No TCP/LAN/public control server or remote debugging port is opened.
- Chrome's native registration permits the configured extension origin, and the host validates its handshake.
- Extension runtime calls are accepted from this extension's own pages. No content scripts or external message handler are exposed.
- Requests and responses have frame limits, queues have bounds, and interrupted actions are not automatically replayed.

## Page data

The extension contains no embedded provider credentials or analytics. User-supplied chat API keys are stored in `chrome.storage.local`, restricted to trusted extension contexts; they never use Chrome Sync. Keys are sent only in authentication headers to the configured provider. They are not injected into webpages, included in prompts/browser messages, or logged. Provider fetches refuse redirects and use HTTPS, except HTTP for loopback local servers.

Built-in chat sends conversation text and requested browser results directly to the chosen provider. Screenshots are requested only as tools and sent as multimodal input only when vision is enabled. Provider access is granted for the selected origin through Chrome's optional host permission prompt. Markdown does not render raw HTML or automatically load remote images.

Chat history, screenshots, pinned instructions, and compacted task state are stored locally in extension-origin IndexedDB. **New chat** removes the current stored conversation; pinned instructions remain until edited. **Forget key** removes a provider's saved API key. Removing the extension removes its local storage. Storage is not an encrypted credential vault; the project trusts software running as the current OS user.

Normal test fixtures and browser control run locally. External MCP tool results are passed to the terminal agent, which may send them to its model provider according to that agent's configuration.

Snapshots omit input value fields. Raw HTML and screenshots can contain private page data and are captured only on explicit tool requests. Transport diagnostics do not log request/page contents. Do not include real credentials or private browsing data in public issue reports.

## Current scope

Registration supports macOS, Linux, and Windows. Browser inspection is limited to HTTP/HTTPS main documents, including accessible shadow DOM controls; internal Chrome pages and file URLs are unsupported. The project does not provide isolation from other trusted programs running as the same user or a granular per-website permission system.

Report implementation problems with a minimal reproduction using test data. Keep real credentials, private page content, and third-party exploit details out of public reports.
