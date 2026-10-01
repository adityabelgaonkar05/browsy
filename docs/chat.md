# Built-in chat

The extension's **Chat** view can inspect and act in your existing Chrome session. It uses the same 17 tools as the manual control panel and external MCP agents. The npm bridge is optional for built-in chat.

## Configure a provider

After building, reload the extension in `chrome://extensions`. Open its sidebar, select **Chat**, and open **Settings**.

| Provider          | API                                     | Model selection                                                               |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| OpenRouter        | `https://openrouter.ai/api/v1`          | Authenticated user-filtered model list, with tool/vision/context metadata     |
| OpenAI            | `https://api.openai.com/v1` Responses   | Account model list; confirm capabilities/context when metadata is unavailable |
| Anthropic         | `https://api.anthropic.com/v1` Messages | Account model list, with capabilities/context where available                 |
| OpenAI-compatible | Your server's API base URL              | `/models` when supported, or a manually entered model ID                      |

Enter a key, choose **Load models**, select or enter the model ID, and save. Chrome asks for access to that provider origin. Manually entered model IDs require explicit tool and vision settings; unknown capabilities are not assumed. Enabling a capability does not add it to a model: the selected model/server must support it.

For LM Studio, a typical base URL is `http://127.0.0.1:1234/v1`. Use the address and model ID your local server actually exposes. The compatible adapter requires streamed Chat Completions and standard function/tool calls for browser actions. HTTP endpoints are limited to loopback (`localhost`, `127.0.0.1`, or `[::1]`); remote endpoints require HTTPS. A local server may accept an empty API key.

OpenRouter discovers models using [the user-filtered models API](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails). OpenAI tool calls follow [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling); Anthropic follows [streamed Messages](https://platform.claude.com/docs/en/build-with-claude/streaming).

## Use chat

- Ask “Summarize my active tab” or “Find the GitHub tab about authentication.”
- Replies stream as text. Expand tool results to see observations, errors, and requested screenshots.
- The assistant receives active-tab metadata. Page contents enter context only through requested inspection tools.
- Snapshots are the default. Screenshots are explicit tools and require vision; a non-vision model receives `VISION_UNSUPPORTED` without a screenshot being captured or a claim of visual understanding.
- Models without tools can discuss text but cannot inspect or control Chrome.
- **Stop** cancels generation and further tools. An action already sent to Chrome may still finish; inspect the page before repeating it.
- **New chat** clears the stored conversation and task state while preserving pinned instructions. Changing provider/model starts a fresh chat because provider reasoning formats and capabilities differ.

Keep the sidebar open during a task. Closing it interrupts the task; reopening restores stored history and marks any unresolved action's outcome as unknown. The assistant does not continue automatically. Only one sidebar can run a chat turn at a time.

## Context

The logical budget is 128K tokens. Compaction begins at the lower of 100K or 80% of the model's configured context, with room reserved for tool schemas and output. The sidebar shows an estimate; actual provider usage is displayed when reported. This is a conservative byte/image estimate, not model-specific tokenization. Set the actual context size for a custom model.

Compaction retains:

1. Pinned instructions.
2. Persistent goal, facts, decisions, URLs, and artifacts.
3. Chronological notes from older messages.
4. The two most recent user turns and their tool sequences verbatim.
5. Current browser metadata and recent tool results.

Older screenshots are omitted from the compaction request and represented as prior observations; capture a fresh screenshot if needed. Compaction uses the selected provider and can incur a model call. Invalid compaction leaves the original history intact. If recent context alone exceeds the available budget, chat stops with an actionable error rather than silently deleting recent messages. Large tool results are explicitly truncated for chat context; MCP responses are unaffected.

External agents such as Codex manage their own context. This system applies only to extension chat.

## Data and troubleshooting

Keys remain in local extension storage and can be removed with **Forget key**. Conversations and screenshots stay in local IndexedDB until cleared. Requests go directly to the selected provider. See [SECURITY.md](../SECURITY.md) for the data boundary.

For authentication failures, check the saved key and account access. For connection failures, confirm the base URL, Chrome's granted origin access, and whether your local server is running. If `/models` is unsupported, enter the model ID directly. For tool/image errors, confirm both the model and server support the capability. Chrome internal pages remain restricted.
