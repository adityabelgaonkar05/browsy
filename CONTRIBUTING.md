# Contributing

Follow the build and unpacked installation instructions in [README.md](README.md). The current scope is Milestone 1: Chrome extension control. Please discuss changes to transports, providers, or later milestones before implementing them.

## Working on the extension

- Put browser behavior in `apps/extension/browser-tools`, behind the shared `BrowserController` interface.
- Keep the sidebar focused on displaying results and calling the shared tools.
- Add protocol types to `packages/shared`; validate tool inputs at the dispatcher boundary.
- Preserve compact default snapshots and explicit HTML/screenshot requests.
- Keep credentials, browsing data, local profiles, and machine-specific paths out of commits. `.codex/context.md` is local development context and ignored by Git.

Before submitting a change, run `pnpm typecheck`, `pnpm build`, and `pnpm test:extension`. The browser check requires `pnpm exec playwright install chromium --no-shell` once. Describe the resulting behavior, how you checked it, and any remaining limitations in the pull request.

For browser bugs, include the Chrome version, reproduction steps, the tool/error involved, and a minimal page if possible. Remove private page data from screenshots and tool results before sharing them.

Contributions are licensed under the repository's [MIT license](LICENSE).
