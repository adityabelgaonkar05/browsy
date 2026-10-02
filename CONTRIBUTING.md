# Contributing

Use [README.md](README.md) for installation and [docs/architecture.md](docs/architecture.md) for the code structure. Development and CI cover macOS, Linux, and Windows with Node.js 22 and 24.

## Local workflow

Use Node.js 22.12 or newer and the pnpm version pinned in `package.json`. `.nvmrc` selects Node.js 24 for nvm users.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium --no-shell
pnpm test
```

Run `pnpm format` to apply the repository's formatting rules. Run `pnpm dev` to rebuild the extension on changes; reload it in Chrome after rebuilding. Changes to the CLI require `pnpm build`; reload the extension to restart its native host with the new bundle.

## Checks

| Command               | Coverage                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`   | Formatting across source, configuration, and documentation                                                                             |
| `pnpm typecheck`      | Strict TypeScript checks for every workspace                                                                                           |
| `pnpm build`          | Production extension and standalone CLI bundle                                                                                         |
| `pnpm test:chat`      | Incomplete tool streams, provider response limits, endpoint validation and transport buffering using synthetic fixtures                |
| `pnpm test:extension` | Actual MV3 extension, control panel, snapshots, HTML, screenshots, typing/clicking, stale refs                                         |
| `pnpm test:terminal`  | Actual Native Messaging and two stdio MCP clients, authenticated fixtures, routing, navigation, crash recovery, diagnostics, uninstall |
| `pnpm test:package`   | npm archive contents, isolated global installation, CLI commands and MCP startup                                                       |

Browser tests require the Playwright Chromium installed by the command above. Set `PLAYWRIGHT_BROWSERS_PATH` for both installation and testing when using a different browser cache. Fixtures and browser profiles are created and removed automatically. Windows terminal tests temporarily replace the current user’s Chrome native-host registry value and restore it in cleanup; close other Chrome profiles first. On Linux, install browser dependencies with `pnpm exec playwright install chromium --no-shell --with-deps`.

An optional check runs an actual Codex task using your existing Codex authentication:

```sh
node scripts/test-terminal.mjs --codex
```

This invokes a model and limits the temporary MCP configuration to tab listing and snapshots. It is not part of `pnpm test` or CI.

## Code boundaries

- Put browser behavior behind `BrowserController` in `apps/extension/browser-tools`.
- Route control panel and MCP calls through the same dispatcher. The UI displays results and invokes tools.
- Keep shared request/result types and protocol constants in `packages/shared`.
- Keep Native Messaging and MCP stdout restricted to protocol frames. Send diagnostics to stderr and do not log page contents or credentials.
- Preserve per-client request IDs, frame limits, queue limits, and errors for interrupted actions. Never automatically replay a sent action.
- Keep generated builds, local profiles, credentials, and local development context out of commits.

Include the resulting behavior and verification in pull requests. For bugs, provide reproduction steps, environment versions, and the relevant tool/error. Remove private browsing data from attachments. Feature requests for iframe support, providers, or other new capabilities should describe the use case before implementation.

Contributions use the repository's [MIT license](LICENSE).
