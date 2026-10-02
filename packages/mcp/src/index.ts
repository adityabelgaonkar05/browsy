import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { BridgeClient, bridgePaths } from "@agent-native/native-bridge";
import { BrowserError } from "@agent-native/shared";
import type { PageSnapshot, ScreenshotResult } from "@agent-native/shared";
import { browserTools } from "./tools";

export async function startMcp(home?: string) {
  const bridge = new BridgeClient(bridgePaths(home).socket);
  const server = new McpServer(
    { name: "agent-native-browser", version: "0.1.1" },
    {
      instructions:
        "Inspect and control the user's existing authenticated Chrome session locally. When asked to see what the user sees in Chrome, inspect their browser, or find an open tab, use these tools. Start with browser_list_tabs, then browser_snapshot for the active or requested tab. Use browser_screenshot for visual details. Report connection or restricted-page errors accurately. Refs expire on a new snapshot, navigation, or element changes. After a timeout or disconnect, inspect before repeating an action.",
    },
  );

  for (const [name, definition] of Object.entries(browserTools)) {
    server.registerTool(
      name,
      {
        description: definition.description,
        inputSchema: definition.schema,
        annotations: {
          readOnlyHint: definition.readOnly,
          destructiveHint: !definition.readOnly,
          openWorldHint: true,
        },
      },
      async (params: Record<string, unknown>) => {
        try {
          const response = await bridge.request(name, params);
          if ("error" in response)
            return {
              isError: true,
              content: [{ type: "text" as const, text: JSON.stringify(response.error) }],
            };
          if (name === "browser_screenshot") {
            const screenshot = response.result as ScreenshotResult;
            return {
              content: [
                { type: "image" as const, data: screenshot.data, mimeType: screenshot.mimeType },
              ],
            };
          }
          if (name === "browser_snapshot") {
            const snapshot = response.result as PageSnapshot;
            const header = JSON.stringify({
              tabId: snapshot.tabId,
              title: snapshot.title,
              url: snapshot.url,
              scope: snapshot.scope,
              truncated: snapshot.truncated,
            });
            return { content: [{ type: "text" as const, text: `${header}\n${snapshot.text}` }] };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(response.result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  code: error instanceof BrowserError ? error.code : "BROWSER_ERROR",
                  message: error instanceof Error ? error.message : "Browser operation failed.",
                }),
              },
            ],
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  transport.onclose = () => bridge.close();
  const stop = () => {
    bridge.close();
    void server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  await server.connect(transport);
  // SDK connect installs its own close callback; chain cleanup after that installation.
  const onclose = transport.onclose;
  transport.onclose = () => {
    bridge.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    onclose?.();
  };
  return { server, bridge };
}
