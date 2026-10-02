import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Provider fixtures run entirely in memory. No credentials or network calls.
const root = await mkdtemp(join(tmpdir(), "an-chat-"));
const originalFetch = globalThis.fetch;
try {
  const path = join(root, "chat.mjs");
  await build({
    stdin: {
      contents: `export { Provider } from './apps/extension/providers/provider';
        export { events } from './apps/extension/providers/stream';
        export { defaultSettings, validateSettings } from './apps/extension/providers/types';
        export { newChat } from './apps/extension/chat/context';
        export { runTurn } from './apps/extension/chat/engine';
        export { writeFrame } from './packages/native-bridge/src/framing';`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    outfile: path,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const { Provider, events, defaultSettings, validateSettings, newChat, runTurn, writeFrame } =
    await import(pathToFileURL(path));
  const signal = new AbortController().signal;
  const settings = {
    ...defaultSettings("compatible"),
    model: "fixture-model",
    tools: true,
  };
  for (const endpoint of ["http://example.com/v1", "https://user:password@example.com/v1"])
    assert.throws(() => validateSettings({ ...settings, endpoint }));
  assert.equal(validateSettings(settings), "http://127.0.0.1:1234/*");

  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"browser_close_tab","arguments":"{\\\"tabId\\\":1}"}}]}}]}\n\n',
  ];
  let dispatches = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    return new Response(chunks.join(""));
  };
  const chat = newChat();
  chat.messages.push({ id: "user-1", role: "user", content: [{ type: "text", text: "Fixture" }] });
  await assert.rejects(
    runTurn(
      chat,
      settings,
      "",
      async () => {
        dispatches++;
      },
      signal,
      {
        changed() {},
        async checkpoint() {},
        status() {},
      },
    ),
    /ended unexpectedly/,
  );
  assert.equal(dispatches, 0);
  console.log("PASS incomplete provider streams never execute browser actions");

  chunks.push('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
  const completed = await new Provider(settings).streamCompletion({
    system: "Fixture",
    messages: chat.messages,
    tools: [],
    maxOutput: 1024,
    signal,
    onText() {},
  });
  assert.equal(completed.calls[0].name, "browser_close_tab");
  assert.deepEqual(JSON.parse(completed.calls[0].arguments), { tabId: 1 });
  console.log("PASS completed tool streams preserve names and JSON arguments");

  let emitted = 0;
  const oversized = new Response(
    new ReadableStream({
      pull(controller) {
        if (++emitted > 34) controller.close();
        else
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ text: "x".repeat(1024 * 1024) })}\n\n`,
            ),
          );
      },
    }),
  );
  await assert.rejects(async () => {
    for await (const _event of events(oversized, signal)) {
      /* consume */
    }
  }, /stream size limit/);
  globalThis.fetch = async () => new Response("x".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(new Provider(settings).listModels(signal), /model list is too large/);
  console.log("PASS provider streams and model discovery enforce total response limits");

  let writes = 0;
  assert.throws(
    () =>
      writeFrame(
        {
          writableLength: 101,
          write() {
            writes++;
          },
        },
        { id: "fixture" },
        100,
      ),
    /write buffer/,
  );
  assert.equal(writes, 0);
  console.log("PASS stalled transport receivers cannot accumulate unlimited frames");
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}
