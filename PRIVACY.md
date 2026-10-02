# Privacy policy

Effective date: 2026-10-02.

This policy covers the Chrome extension and its companion local browser bridge in this repository.

## Browser access

The extension lets your chosen AI assistant inspect and act inside your existing Chrome session. Tools can list open tab titles and URLs, inspect page text and HTML, capture viewport screenshots, enter text, click controls and navigate. These tools use your existing website login sessions. Page content may contain personal or sensitive information.

The extension does not extract website cookies or website passwords as a separate feature. Structured snapshots omit input value fields, but HTML, screenshots and ordinary page text can contain private data. Browser actions affect your real session.

## Local storage

AI provider settings and API keys are stored on your device in extension-local storage, not Chrome Sync. Chat messages, tool results, screenshots, pinned instructions and compacted task state are stored in extension-origin IndexedDB. This storage is not encrypted by the extension.

The companion bridge stores its installation configuration locally and communicates over a private local Unix socket or Windows named pipe. It does not open a public browser-control server.

## AI providers and terminal agents

Built-in chat sends your messages, active-tab metadata such as its title and URL, conversation context, and requested browser-tool results directly to the provider or compatible endpoint you select. Vision-enabled models can receive screenshots requested during a task. Requests may therefore include sensitive page content.

API keys are sent in authentication headers to your configured provider. They are not put into webpages, model prompts or browser-tool messages. Provider requests use HTTPS, except that a local loopback server can use HTTP.

Your provider operates under its own privacy policy and retention rules. The extension does not control those rules. A compatible local endpoint can keep inference requests on your computer, subject to that server's configuration.

Terminal agents receive browser-tool results through the local bridge. Those agents may send results to their model providers according to their own settings and privacy policies.

## Developer data practices

The project contains no analytics, advertising or developer-operated data collection server. The developer does not receive browsing data, conversations or API keys through the extension or bridge. The project does not sell user data or use it for advertising.

If you voluntarily submit an issue or support request, its contents are sent to that support platform. Do not include API keys, private page content or unredacted account information in public reports.

## Your controls

- **New chat** clears the current stored conversation, screenshots and task state; pinned instructions remain until edited.
- **Settings → Advanced connection settings → Remove saved API key** deletes that provider's saved key. An already-running request may finish before deletion or stopping takes effect.
- Removing the extension removes its extension-local storage and chat database.
- The CLI's `uninstall` command removes its recorded host registration and local configuration. It leaves the bridge directory itself in place.

Local deletion does not remove data already received by an AI provider, terminal agent, website or support platform. Contact those services for their deletion options.

## Contact and changes

For privacy questions, contact the maintainer through the [repository's support page](https://github.com/adityabelgaonkar05/browsy/issues). Request a private contact channel before sharing sensitive details. Suspected vulnerabilities should follow [SECURITY.md](SECURITY.md).

Policy changes will be published in this file with an updated effective date.
