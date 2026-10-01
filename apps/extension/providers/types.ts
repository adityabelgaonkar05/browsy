export type ProviderKind = "openrouter" | "openai" | "anthropic" | "compatible";
export interface Model {
  id: string;
  name: string;
  tools?: boolean;
  vision?: boolean;
  context?: number;
}
export interface ProviderSettings {
  kind: ProviderKind;
  endpoint: string;
  apiKey: string;
  model: string;
  tools: boolean;
  vision: boolean;
  context: number;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export type Content =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" };
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: Content[];
  calls?: ToolCall[];
  callId?: string;
  name?: string;
  error?: boolean;
  wire?: { provider: ProviderKind; data: Record<string, unknown>[]; tokens?: number };
  interrupted?: boolean;
}
export interface Usage {
  input: number;
  output: number;
}
export interface Completion {
  text: string;
  calls: ToolCall[];
  usage?: Usage;
  wire?: Message["wire"];
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface CompletionRequest {
  system: string;
  messages: Message[];
  tools: ToolDefinition[];
  maxOutput: number;
  signal: AbortSignal;
  onText: (text: string) => void;
}
export interface AIProvider {
  listModels(signal: AbortSignal): Promise<Model[]>;
  streamCompletion(request: CompletionRequest): Promise<Completion>;
  supportsTools(): boolean;
  supportsVision(): boolean;
  maxContext(): number;
}
export const providerDefaults: Record<ProviderKind, { name: string; endpoint: string }> = {
  openrouter: { name: "OpenRouter", endpoint: "https://openrouter.ai/api/v1" },
  openai: { name: "OpenAI", endpoint: "https://api.openai.com/v1" },
  anthropic: { name: "Anthropic", endpoint: "https://api.anthropic.com/v1" },
  compatible: { name: "OpenAI-compatible", endpoint: "http://127.0.0.1:1234/v1" },
};
export function defaultSettings(kind: ProviderKind): ProviderSettings {
  return {
    kind,
    endpoint: providerDefaults[kind].endpoint,
    apiKey: "",
    model: "",
    tools: false,
    vision: false,
    context: 128_000,
  };
}
export function validateSettings(settings: ProviderSettings, requireModel = true) {
  if (!Object.hasOwn(providerDefaults, settings.kind))
    throw new Error("Choose a supported provider.");
  const endpoint = new URL(settings.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error("Use a base URL without credentials, query parameters, or a fragment.");
  if (
    endpoint.protocol !== "https:" &&
    !(
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
    )
  )
    throw new Error("Use HTTPS, or HTTP for a local loopback server.");
  if (
    settings.kind !== "compatible" &&
    settings.endpoint.replace(/\/$/, "") !== providerDefaults[settings.kind].endpoint
  )
    throw new Error(
      "Use the provider's official endpoint, or choose OpenAI-compatible for a custom server.",
    );
  if (settings.kind !== "compatible" && !settings.apiKey.trim())
    throw new Error("Enter your provider API key.");
  if (requireModel && !settings.model.trim()) throw new Error("Choose or enter a model ID.");
  if (
    !Number.isSafeInteger(settings.context) ||
    settings.context < 4096 ||
    settings.context > 4_000_000
  )
    throw new Error("Model context must be between 4,096 and 4,000,000 tokens.");
  if (typeof settings.tools !== "boolean" || typeof settings.vision !== "boolean")
    throw new Error("Set the model's tool and vision capabilities.");
  return `${endpoint.origin}/*`;
}
export function textOf(message: Message) {
  return message.content
    .filter((item): item is Extract<Content, { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}
