import { events } from "./stream";
import { textOf, validateSettings } from "./types";
import type {
  AIProvider,
  Completion,
  CompletionRequest,
  Content,
  Model,
  ProviderSettings,
  ToolCall,
  Usage,
} from "./types";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as ObjectValue) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const dataUrl = (content: Extract<Content, { type: "image" }>) =>
  `data:${content.mimeType};base64,${content.data}`;

function httpError(status: number) {
  const messages: Record<number, string> = {
    400: "The provider rejected this request. Check model capabilities and context size.",
    401: "The API key was rejected.",
    403: "Your key does not have access to this model or endpoint.",
    404: "The model or API endpoint was not found.",
    429: "Provider rate limit or credit limit reached. Wait or check your account.",
  };
  return new Error(messages[status] ?? `Provider request failed (HTTP ${status}).`);
}

async function modelPayload(response: Response) {
  if (!response.body) throw new Error("The provider did not return model information.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 8 * 1024 * 1024) throw new Error("The provider model list is too large.");
      text += decoder.decode(value, { stream: !done });
      if (done) return object(JSON.parse(text));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class Provider implements AIProvider {
  constructor(private readonly settings: ProviderSettings) {
    validateSettings(settings, false);
  }
  supportsTools() {
    return this.settings.tools;
  }
  supportsVision() {
    return this.settings.vision;
  }
  maxContext() {
    return this.settings.context;
  }
  private async request(path: string, signal: AbortSignal, body?: unknown) {
    const { settings } = this;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (settings.kind === "anthropic") {
      headers["x-api-key"] = settings.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    } else if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    let response: Response;
    try {
      response = await fetch(`${settings.endpoint.replace(/\/$/, "")}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch {
      signal.throwIfAborted();
      throw new Error(
        "Could not reach the provider. Check its address, Chrome permission, and whether your local server is running.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(response.status);
    }
    return response;
  }

  async listModels(signal: AbortSignal): Promise<Model[]> {
    const active = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
    const result: Model[] = [];
    let after = "";
    for (let page = 0; page < 20; page++) {
      const path =
        this.settings.kind === "openrouter"
          ? "models/user"
          : `models${after ? `?after_id=${encodeURIComponent(after)}&limit=100` : this.settings.kind === "anthropic" ? "?limit=100" : ""}`;
      const payload = await modelPayload(await this.request(path, active));
      for (const value of list(payload.data)) {
        const item = object(value),
          capabilities = object(item.capabilities);
        if (!string(item.id)) continue;
        const outputs = list(object(item.architecture).output_modalities);
        if (outputs.length && !outputs.includes("text")) continue;
        const isRouter = this.settings.kind === "openrouter";
        const context =
          number(item.context_length) ||
          number(item.max_input_tokens) ||
          number(item.context_window);
        result.push({
          id: string(item.id),
          name: string(item.name) || string(item.display_name) || string(item.id),
          tools: isRouter
            ? list(item.supported_parameters).includes("tools")
            : this.settings.kind === "anthropic"
              ? true
              : undefined,
          vision: isRouter
            ? list(object(item.architecture).input_modalities).includes("image")
            : typeof object(capabilities.image_input).supported === "boolean"
              ? (object(capabilities.image_input).supported as boolean)
              : undefined,
          context: context || undefined,
        });
      }
      if (this.settings.kind !== "anthropic" || !payload.has_more || !string(payload.last_id))
        break;
      after = string(payload.last_id);
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async streamCompletion(request: CompletionRequest): Promise<Completion> {
    validateSettings(this.settings);
    const active = {
      ...request,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(180000)]),
    };
    if (
      !this.supportsVision() &&
      request.messages.some((message) => message.content.some((item) => item.type === "image"))
    )
      throw new Error(
        "VISION_UNSUPPORTED: This model cannot receive screenshots. Choose a vision model or start a new chat.",
      );
    if (this.settings.kind === "openai") return this.responses(active);
    if (this.settings.kind === "anthropic") return this.anthropic(active);
    return this.chatCompletions(active);
  }

  private async responses(request: CompletionRequest): Promise<Completion> {
    const input: ObjectValue[] = [];
    const pendingImages: ObjectValue[] = [];
    const flush = () => {
      if (pendingImages.length) {
        input.push({ role: "user", content: [...pendingImages] });
        pendingImages.length = 0;
      }
    };
    for (const message of request.messages) {
      if (message.role !== "tool") flush();
      if (message.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: message.callId,
          output: textOf(message),
        });
        for (const content of message.content)
          if (content.type === "image")
            pendingImages.push(
              { type: "input_text", text: `Screenshot from tool call ${message.callId}.` },
              { type: "input_image", image_url: dataUrl(content), detail: "auto" },
            );
      } else if (message.role === "assistant" && message.wire?.provider === "openai") {
        input.push(...message.wire.data);
      } else {
        if (message.content.length)
          input.push({
            role: message.role,
            content: message.content.map((content) =>
              content.type === "text"
                ? {
                    type: message.role === "assistant" ? "output_text" : "input_text",
                    text: content.text,
                  }
                : { type: "input_image", image_url: dataUrl(content), detail: "auto" },
            ),
          });
        for (const call of message.calls ?? [])
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
      }
    }
    flush();
    const response = await this.request("responses", request.signal, {
      model: this.settings.model,
      instructions: request.system,
      input,
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      max_output_tokens: request.maxOutput,
      tools: request.tools.map((tool) => ({ type: "function", ...tool, strict: false })),
    });
    let text = "",
      completed: ObjectValue | undefined;
    for await (const event of events(response, request.signal)) {
      if (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") {
        const delta = string(event.delta);
        text += delta;
        request.onText(delta);
      }
      if (event.type === "response.completed") completed = object(event.response);
      if (
        event.type === "error" ||
        event.type === "response.failed" ||
        event.type === "response.incomplete"
      )
        throw new Error(
          "The provider did not complete this response. Check model limits; no incomplete tool calls were executed.",
        );
    }
    if (!completed)
      throw new Error(
        "The response stream ended before completion. No incomplete tool calls were executed.",
      );
    const output = list(completed.output).map(object);
    const calls = output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        id: string(item.call_id),
        name: string(item.name),
        arguments: string(item.arguments),
      }));
    const usage = object(completed.usage);
    return {
      text,
      calls,
      usage: { input: number(usage.input_tokens), output: number(usage.output_tokens) },
      wire: {
        provider: "openai",
        data: output,
        tokens: number(object(usage.output_tokens_details).reasoning_tokens),
      },
    };
  }

  private async chatCompletions(request: CompletionRequest): Promise<Completion> {
    const messages: ObjectValue[] = [{ role: "system", content: request.system }];
    const images: ObjectValue[] = [];
    const flush = () => {
      if (images.length) {
        messages.push({ role: "user", content: [...images] });
        images.length = 0;
      }
    };
    for (const message of request.messages) {
      if (message.role !== "tool") flush();
      if (message.role === "tool") {
        messages.push({ role: "tool", tool_call_id: message.callId, content: textOf(message) });
        for (const content of message.content)
          if (content.type === "image")
            images.push(
              { type: "text", text: `Screenshot from tool call ${message.callId}.` },
              { type: "image_url", image_url: { url: dataUrl(content) } },
            );
      } else if (message.role === "assistant") {
        const wire =
          message.wire?.provider === this.settings.kind ? message.wire.data[0] : undefined;
        messages.push({
          role: "assistant",
          content: textOf(message) || null,
          ...(wire ?? {}),
          ...(message.calls?.length
            ? {
                tool_calls: message.calls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        });
      } else
        messages.push({
          role: "user",
          content: message.content.map((content) =>
            content.type === "text"
              ? content
              : { type: "image_url", image_url: { url: dataUrl(content) } },
          ),
        });
    }
    flush();
    const response = await this.request("chat/completions", request.signal, {
      model: this.settings.model,
      messages,
      stream: true,
      ...(this.settings.kind === "openrouter" ? { stream_options: { include_usage: true } } : {}),
      max_tokens: request.maxOutput,
      ...(request.tools.length
        ? { tools: request.tools.map((tool) => ({ type: "function", function: tool })) }
        : {}),
    });
    let text = "",
      finished = false,
      usage: Usage | undefined;
    const calls = new Map<number, ToolCall>();
    const reasoning = new Map<string, ObjectValue>();
    for await (const event of events(response, request.signal)) {
      if (event.error)
        throw new Error("Provider streaming failed. No incomplete tool calls were executed.");
      if (event.usage) {
        const value = object(event.usage);
        usage = { input: number(value.prompt_tokens), output: number(value.completion_tokens) };
      }
      const choice = object(list(event.choices)[0]),
        delta = object(choice.delta);
      const chunk = string(delta.content);
      text += chunk;
      if (chunk) request.onText(chunk);
      for (const value of list(delta.reasoning_details)) {
        const item = object(value),
          index = number(item.index);
        const key = `${index}:${string(item.type)}`;
        const previous = reasoning.get(key) ?? {};
        for (const [key, value] of Object.entries(item)) {
          previous[key] =
            ["text", "summary", "data"].includes(key) && typeof value === "string"
              ? string(previous[key]) + value
              : value;
        }
        reasoning.set(key, previous);
      }
      for (const value of list(delta.tool_calls)) {
        const item = object(value),
          index = number(item.index),
          fn = object(item.function);
        const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (string(item.id)) call.id = string(item.id);
        if (string(fn.name) && string(fn.name) !== call.name) call.name += string(fn.name);
        call.arguments += string(fn.arguments);
        if (call.arguments.length > 100000)
          throw new Error("The model generated an oversized tool call.");
        calls.set(index, call);
      }
      if (choice.finish_reason) {
        if (!["stop", "tool_calls"].includes(string(choice.finish_reason)))
          throw new Error(
            "The model response was cut short. No incomplete tool calls were executed.",
          );
        finished = true;
      }
    }
    if (!finished)
      throw new Error(
        "The response stream ended unexpectedly. No incomplete tool calls were executed.",
      );
    return {
      text,
      calls: [...calls.values()],
      usage,
      wire: reasoning.size
        ? { provider: this.settings.kind, data: [{ reasoning_details: [...reasoning.values()] }] }
        : undefined,
    };
  }

  private async anthropic(request: CompletionRequest): Promise<Completion> {
    const messages: ObjectValue[] = [];
    for (const message of request.messages) {
      const content = message.content.map((item) =>
        item.type === "text"
          ? item
          : {
              type: "image",
              source: { type: "base64", media_type: item.mimeType, data: item.data },
            },
      );
      let role = message.role === "assistant" ? "assistant" : "user";
      let blocks: unknown[] = content;
      if (message.role === "tool")
        blocks = [
          {
            type: "tool_result",
            tool_use_id: message.callId,
            content,
            is_error: Boolean(message.error),
          },
        ];
      else if (message.role === "assistant")
        blocks =
          message.wire?.provider === "anthropic"
            ? message.wire.data
            : [
                ...content,
                ...(message.calls ?? []).map((call) => ({
                  type: "tool_use",
                  id: call.id,
                  name: call.name,
                  input: JSON.parse(call.arguments),
                })),
              ];
      const last = messages.at(-1);
      if (last?.role === role) last.content = [...list(last.content), ...blocks];
      else messages.push({ role, content: blocks });
    }
    const response = await this.request("messages", request.signal, {
      model: this.settings.model,
      system: request.system,
      messages,
      stream: true,
      max_tokens: request.maxOutput,
      ...(request.tools.length
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
    });
    let text = "",
      finished = false,
      stopReason = "";
    const usage = { input: 0, output: 0 };
    const blocks = new Map<number, ObjectValue>(),
      argumentsByIndex = new Map<number, string>();
    for await (const event of events(response, request.signal)) {
      if (event.type === "error")
        throw new Error("Anthropic streaming failed. No incomplete tool calls were executed.");
      const index = number(event.index);
      if (event.type === "message_start") {
        const value = object(object(event.message).usage);
        usage.input =
          number(value.input_tokens) +
          number(value.cache_read_input_tokens) +
          number(value.cache_creation_input_tokens);
      }
      if (event.type === "content_block_start") blocks.set(index, object(event.content_block));
      if (event.type === "content_block_delta") {
        const delta = object(event.delta),
          block = blocks.get(index);
        if (delta.type === "text_delta") {
          const chunk = string(delta.text);
          text += chunk;
          request.onText(chunk);
          if (block) block.text = string(block.text) + chunk;
        }
        if (delta.type === "input_json_delta") {
          const args = (argumentsByIndex.get(index) ?? "") + string(delta.partial_json);
          if (args.length > 100000) throw new Error("The model generated an oversized tool call.");
          argumentsByIndex.set(index, args);
        }
        if (block && delta.type === "thinking_delta")
          block.thinking = string(block.thinking) + string(delta.thinking);
        if (block && delta.type === "signature_delta")
          block.signature = string(block.signature) + string(delta.signature);
      }
      if (event.type === "content_block_stop" && argumentsByIndex.has(index)) {
        const block = blocks.get(index);
        if (block) block.input = JSON.parse(argumentsByIndex.get(index)!);
      }
      if (event.type === "message_delta") {
        stopReason = string(object(event.delta).stop_reason);
        usage.output = number(object(event.usage).output_tokens);
      }
      if (event.type === "message_stop") finished = true;
    }
    if (!finished || !["end_turn", "tool_use", "stop_sequence"].includes(stopReason))
      throw new Error(
        "The Anthropic response was interrupted or reached its output limit. No incomplete tool calls were executed.",
      );
    const data = [...blocks.values()];
    return {
      text,
      calls: data
        .filter((item) => item.type === "tool_use")
        .map((item) => ({
          id: string(item.id),
          name: string(item.name),
          arguments: JSON.stringify(item.input),
        })),
      usage,
      wire: { provider: "anthropic", data },
    };
  }
}
