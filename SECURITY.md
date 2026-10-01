# Security and data handling

Agent Native Browser trusts software running as the current OS user to control the browser. Browser actions intentionally use the user's existing authenticated website sessions. An agent can interact with pages, submit forms, navigate, and close tabs through the tools it is given.

## Local control boundary

- Control uses a Unix socket inside a private `0700` directory; the socket uses `0600`.
- No TCP/LAN/public control server or remote debugging port is opened.
- Chrome's native registration permits the configured extension origin, and the host validates its handshake.
- Extension runtime calls are accepted from this extension's own pages. No content scripts or external message handler are exposed.
- Requests and responses have frame limits, queues have bounds, and interrupted actions are not automatically replayed.

## Page data

The extension contains no AI provider API keys, analytics, or Chrome Sync storage. Normal test fixtures and browser control run locally. Tool results are passed to the selected terminal agent, which may send those results to its model provider according to that agent's configuration.

Snapshots omit input value fields. Raw HTML and screenshots can contain private page data and are captured only on explicit tool requests. Transport diagnostics do not log request/page contents. Do not include real credentials or private browsing data in public issue reports.

## Current scope

Registration supports macOS. Browser inspection is limited to HTTP/HTTPS main documents, including accessible shadow DOM controls; internal Chrome pages and file URLs are unsupported. The project does not provide isolation from other trusted programs running as the same user or a granular per-website permission system.

Report implementation problems with a minimal reproduction using test data. Keep real credentials, private page content, and third-party exploit details out of public reports.
