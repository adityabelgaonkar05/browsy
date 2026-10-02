// SSE framing is independent of provider JSON. Handles UTF-8 splits, CRLF,
// comments, multiline data and a final frame without a trailing blank line.
export async function* events(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) throw new Error("The provider did not return a response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    dataLength = 0,
    totalBytes = 0;
  const decode = () => {
    const raw = data.join("\n");
    data = [];
    dataLength = 0;
    if (!raw || raw === "[DONE]") return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid provider stream event.");
    return value as Record<string, unknown>;
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      totalBytes += value?.byteLength ?? 0;
      if (totalBytes > 32 * 1024 * 1024)
        throw new Error("The provider response exceeded the stream size limit.");
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 8_000_000) throw new Error("A provider stream event is too large.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (!line) {
          const item = decode();
          if (item) yield item;
        } else if (line.startsWith("data:")) {
          dataLength += line.length;
          if (dataLength > 8_000_000) throw new Error("A provider stream event is too large.");
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) break;
    }
    if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, "").replace(/\r$/, ""));
    const item = decode();
    if (item) yield item;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
