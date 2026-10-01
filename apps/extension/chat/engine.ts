import { browserTools, browserToolDefinitions } from "@agent-native/shared/browser-tools";
import { isToolName } from "@agent-native/shared";
import type { PageSnapshot, ScreenshotResult, ToolResponse } from "@agent-native/shared";
import { Provider } from "../providers/provider";
import type { Content, Message, ProviderSettings, ToolDefinition } from "../providers/types";
import { compact, contextTokens, logicalContext, systemPrompt } from "./context";
import type { ChatState } from "./context";

export type BrowserTransport = (
  name: string,
  params: Record<string, unknown>,
) => Promise<ToolResponse>;
export interface TurnCallbacks {
  changed: (state: ChatState) => void;
  checkpoint: (state: ChatState) => Promise<void>;
  status: (text: string) => void;
}
const definitions: ToolDefinition[] = browserToolDefinitions();
// Share immutable image strings and provider wire data with the UI. Copy only
// view objects, rather than re-cloning screenshots on every streamed token.
function viewState(state: ChatState): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) => ({
      ...message,
      content: message.content.map((content) => ({ ...content })),
    })),
  };
}

export async function runTurn(
  state: ChatState,
  settings: ProviderSettings,
  browser: string | (() => string),
  dispatch: BrowserTransport,
  signal: AbortSignal,
  callbacks: TurnCallbacks,
) {
  const provider = new Provider(settings);
  const tools = provider.supportsTools() ? definitions : [];
  const schemaTokens = Math.ceil(JSON.stringify(tools).length / 3);
  let count = 0;
  const publish = () => callbacks.changed(viewState(state));
  for (let round = 0; round < 20; round++) {
    signal.throwIfAborted();
    const activeBrowser = typeof browser === "function" ? browser() : browser;
    const maxOutput = Math.min(4096, Math.floor(provider.maxContext() * 0.15));
    callbacks.status("Preparing context…");
    if (await compact(state, provider, activeBrowser, signal, schemaTokens + maxOutput + 128)) {
      publish();
      await callbacks.checkpoint(state);
    }
    if (
      contextTokens(state, activeBrowser) + schemaTokens + maxOutput + 128 >
      Math.min(logicalContext, provider.maxContext())
    )
      throw new Error(
        "This conversation is too large for the selected context window while preserving recent messages. Start a new chat or choose a larger-context model.",
      );
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: [{ type: "text", text: "" }],
    };
    callbacks.status("Thinking…");
    let lastPaint = 0;
    const response = await provider
      .streamCompletion({
        system: `${systemPrompt(state, activeBrowser)}\nModel capabilities: tools=${provider.supportsTools()}, vision=${provider.supportsVision()}. Do not request screenshots when vision is false.`,
        messages: state.messages,
        tools,
        maxOutput,
        signal,
        onText(text) {
          (assistant.content[0] as Extract<Content, { type: "text" }>).text += text;
          if (performance.now() - lastPaint > 40) {
            callbacks.changed(viewState({ ...state, messages: [...state.messages, assistant] }));
            lastPaint = performance.now();
          }
        },
      })
      .catch((error) => {
        assistant.interrupted = true;
        if ((assistant.content[0] as Extract<Content, { type: "text" }>).text)
          state.messages.push(assistant);
        throw error;
      });
    if (response.calls.length > 16)
      throw new Error(
        "The model requested too many tools at once. No tools in this response were executed.",
      );
    const ids = new Set<string>();
    for (const call of response.calls) {
      if (!call.id || !call.name || call.arguments.length > 100000 || ids.has(call.id))
        throw new Error(
          "The model returned invalid tool calls. No tools in this response were executed.",
        );
      ids.add(call.id);
    }
    assistant.content = response.text ? [{ type: "text", text: response.text }] : [];
    assistant.calls = response.calls;
    assistant.wire = response.wire;
    state.messages.push(assistant);
    if (response.usage) {
      state.usage = response.usage;
      state.totalOutput += response.usage.output;
    }
    publish();
    await callbacks.checkpoint(state);
    if (!response.calls.length) return;
    for (const call of response.calls) {
      const result: Message = {
        id: crypto.randomUUID(),
        role: "tool",
        content: [],
        callId: call.id,
        name: call.name,
      };
      let response: ToolResponse;
      if (signal.aborted || ++count > 48)
        response = {
          id: call.id,
          error: {
            code: "BUSY",
            message:
              "Tool execution stopped. Earlier actions may have completed; inspect before repeating them.",
          },
        };
      else if (!provider.supportsTools())
        response = {
          id: call.id,
          error: {
            code: "TOOL_USE_UNSUPPORTED",
            message: "TOOL_USE_UNSUPPORTED: Enable tool support only for a model that supports it.",
          },
        };
      else if (call.name === "browser_screenshot" && !provider.supportsVision())
        response = {
          id: call.id,
          error: {
            code: "VISION_UNSUPPORTED",
            message:
              "VISION_UNSUPPORTED: This model cannot inspect screenshots. Use a structured snapshot or choose a vision model.",
          },
        };
      else {
        callbacks.status(`Using ${call.name.replace(/^browser_/, "")}…`);
        try {
          if (!isToolName(call.name)) throw new Error("Unknown browser tool.");
          const params: unknown = JSON.parse(call.arguments);
          const parsed = browserTools[call.name].schema.safeParse(params);
          if (!parsed.success)
            throw new Error("INVALID_PARAMS: Tool arguments do not match the browser schema.");
          // Persist the pending call before sending it. A closed sidebar never
          // resumes/replays the call automatically, even after Chrome restarts.
          await callbacks.checkpoint(state);
          signal.throwIfAborted();
          response = await dispatch(call.name, parsed.data);
        } catch {
          response = {
            id: call.id,
            error: {
              code: "BROWSER_ERROR",
              message: signal.aborted
                ? "Action interrupted. It may have completed; inspect before repeating it."
                : "The browser call failed or its arguments were invalid. Inspect before repeating an action whose outcome is unknown.",
            },
          };
        }
      }
      if ("error" in response) {
        result.error = true;
        result.content = [{ type: "text", text: JSON.stringify(response.error) }];
      } else if (call.name === "browser_screenshot") {
        const image = response.result as ScreenshotResult;
        result.content = [
          { type: "text", text: `Screenshot for ${call.id}.` },
          { type: "image", data: image.data, mimeType: image.mimeType },
        ];
      } else {
        let text: string;
        if (call.name === "browser_snapshot") {
          const snapshot = response.result as PageSnapshot;
          text = `${JSON.stringify({ tabId: snapshot.tabId, title: snapshot.title, url: snapshot.url, scope: snapshot.scope, truncated: snapshot.truncated })}\n${snapshot.text}`;
        } else text = JSON.stringify(response.result);
        const limit = Math.min(80000, Math.floor(provider.maxContext() * 0.6));
        result.content = [
          {
            type: "text",
            text:
              text.length > limit
                ? `${text.slice(0, limit)}\n[Result truncated for chat context. Use a selector or a smaller HTML maxLength for more precise inspection.]`
                : text,
          },
        ];
      }
      state.messages.push(result);
      publish();
      await callbacks.checkpoint(state);
    }
    if (count > 48)
      throw new Error("Stopped after 48 browser calls. Review progress before continuing.");
  }
  throw new Error("Stopped after 20 model rounds. Review progress before continuing.");
}

export function recoverInterrupted(state: ChatState) {
  if (!state.running) return;
  const completed = new Set(
    state.messages.filter((message) => message.role === "tool").map((message) => message.callId),
  );
  for (const message of [...state.messages])
    for (const call of message.calls ?? [])
      if (!completed.has(call.id)) {
        state.messages.push({
          id: crypto.randomUUID(),
          role: "tool",
          callId: call.id,
          name: call.name,
          error: true,
          content: [
            {
              type: "text",
              text: "Interrupted sidebar session. This action's outcome is unknown; inspect the page before repeating it.",
            },
          ],
        });
        completed.add(call.id);
      }
  state.running = false;
}
