# Public release audit

Review date: 2026-10-02.

## Assessment

Suitable for a public **early preview** source release under MIT. No unresolved critical or high severity issue was identified in this review. This is a source review and local verification, not an independent penetration test or a guarantee that vulnerabilities are absent.

The source release supports building and loading an unpacked extension. The npm companion was subsequently published as `@adityabelgaonkar/browsy@0.1.0`. Chrome Web Store distribution is deferred; the extension is distributed unpacked. The project intentionally trusts software running as the current OS user to control their authenticated browser session.

## Scope

Reviewed the extension manifest and message boundary, CDP browser controller, shared tool schemas, chat/provider code, local storage, Native Messaging framing and routing, Unix socket permissions, Windows pipe/registration code, CLI setup/configuration/uninstall, build/package contents, CI and public documentation.

A pattern scan inspected all eight reachable git commits and 159 unique file blobs for common provider keys, GitHub tokens, AWS access keys and private-key blocks; no matches were found. The scan is heuristic and does not recognize every possible secret format. Generated builds, local profiles, environment files and development context are excluded from git.

`pnpm audit --json` queried the npm advisory database and reported zero known vulnerabilities across 201 dependencies. Advisory coverage can change and does not detect every defect or malicious package.

## Findings resolved

| Finding                                              | Impact                                                                                                   | Resolution                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Stale sidebar settings and key removal               | Another open sidebar could retain a removed key, restore it when saving, or send to an outdated provider | Settings/key writes use the chat lock and current stored data. Stale settings and conversation state are rejected before a turn starts |
| Provider responses only bounded per SSE event        | A provider could return many individually small events and exhaust sidebar memory                        | Total stream responses limited to 32 MiB; model discovery limited to 8 MiB per page                                                    |
| IPC writes ignored accumulated buffering             | A receiver that stopped reading could accumulate large queued results                                    | Native frame writes enforce a buffer budget; the Windows relay has a separate queue budget and handles write failure                   |
| Dependency licenses absent from standalone artifacts | Distributed artifacts omitted complete license text for bundled packages                                 | Both build pipelines generate dependency notices from their module graphs. Project MIT license included in extension and CLI artifacts |
| CI actions referenced mutable version tags           | A tag change could change executable CI code without a repository change                                 | Actions pinned to verified upstream commits; Dependabot checks weekly                                                                  |

The preceding MCP startup fix is retained: esbuild prefers the ESM entry of `jsonc-parser` so its internal modules are included in the standalone CLI.

## Verification

- Formatting, strict TypeScript and production builds.
- Synthetic chat checks: interrupted tool streams execute no actions, completed streams preserve call arguments, response limits reject oversized results, and stalled frame writers are bounded.
- Actual unpacked MV3 extension: tab inspection, HTML, PNG viewport capture, trusted typing/clicking, shadow DOM, stale refs, navigation and manual UI.
- Two sidebar instances: removing a saved key blocks stale requests and stale saves cannot restore it. Provider traffic is intercepted; the save fixture supplies a synthetic permission grant.
- Actual Chrome Native Messaging and two stdio MCP clients: authenticated local fixture, routing, tool discovery, interaction, host crash recovery, diagnostics and uninstall.
- npm archive installed into an isolated prefix: runtime independence, space-containing paths, CLI commands, MCP startup and packaged license notices.

Local execution used macOS with Node.js 24. CI defines macOS, Linux and Windows jobs with Node.js 22 and 24; successful execution of every remote matrix job was not verified during this review.

## Remaining limits

- Live OpenAI, OpenRouter, Anthropic and local-server compatibility was not exercised with a real account or running model server. Synthetic fixtures do not establish that every provider/model combination works.
- Windows ACL, PowerShell relay and native registration were reviewed in source but require Windows runtime verification. This review cannot certify Windows behavior from macOS.
- Page content and model output can contain prompt injection. Instructions mark browser content as untrusted, but do not provide an isolation boundary against model mistakes. The tools affect real authenticated sessions.
- Keys and chat history are local and unencrypted by design; trusted same-user processes remain inside the threat model. Removing a key does not retroactively cancel an already-running request.
- Iframes, full-page screenshots, uploads/downloads and developer tools remain outside implemented scope.
- Repository visibility, branch protection and private vulnerability reporting are GitHub settings; their current state was not verified or changed. The security policy describes private disclosure when available.

These limits are documented in the README and security policy. They should remain visible while the project is distributed as an early preview.
