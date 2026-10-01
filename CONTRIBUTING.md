# Contributing

Follow the build and installation instructions in [README.md](README.md). The current scope is browser control, macOS Native Messaging, and terminal MCP agents. Please discuss providers/chat or later milestones before implementing them.

## Working on the extension

- Put browser behavior in `apps/extension/browser-tools`, behind the shared `BrowserController` interface.
- Keep the sidebar focused on displaying results and calling the shared tools.
- Add protocol types to `packages/shared`; validate tool inputs at the dispatcher boundary.
- Preserve compact default snapshots and explicit HTML/screenshot requests.
- Keep credentials, browsing data, local profiles, and machine-specific paths out of commits. `.codex/context.md` is local development context and ignored by Git.

Before submitting a change, run `pnpm typecheck`, `pnpm build`, `pnpm test:extension`, and `pnpm test:terminal` (macOS). The browser checks require `pnpm exec playwright install chromium --no-shell` once. The optional `--codex` check makes a model call; normal tests do not. Describe the resulting behavior, how you checked it, and any remaining limitations in the pull request.

Keep Native Messaging/MCP stdout limited to protocol frames and use stderr for diagnostics. Avoid logging request contents or page data. Preserve request IDs across clients, respect frame limits, and fail interrupted actions without automatically replaying them. Build the CLI with `pnpm build`; runtime dependencies are bundled so Chrome can launch it without package resolution or a shell PATH dependency.

For browser bugs, include the Chrome version, reproduction steps, the tool/error involved, and a minimal page if possible. Remove private page data from screenshots and tool results before sharing them.

Contributions are licensed under the repository's [MIT license](LICENSE).
