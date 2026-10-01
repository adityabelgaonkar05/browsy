import { BrowserError, isToolName } from "@agent-native/shared";
import type { BrowserController, ToolResponse } from "@agent-native/shared";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BrowserError("INVALID_PARAMS", "Expected a params object.");
  return value as Record<string, unknown>;
}
function string(params: Record<string, unknown>, key: string, max = 100_000): string {
  const value = params[key];
  if (typeof value !== "string" || value.length > max)
    throw new BrowserError(
      "INVALID_PARAMS",
      `${key} must be a string of at most ${max} characters.`,
    );
  return value;
}
function httpUrl(params: Record<string, unknown>): string {
  const value = string(params, "url", 8_192);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BrowserError("INVALID_PARAMS", "Enter an absolute HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new BrowserError("INVALID_PARAMS", "Only HTTP and HTTPS navigation is supported.");
  return url.href;
}
function optionalInteger(
  params: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const value = params[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new BrowserError(
      "INVALID_PARAMS",
      `${key} must be an integer between ${min} and ${max}.`,
    );
  return value;
}

// Shared dispatch for the manual panel, built-in chat and MCP transport.
export async function dispatchTool(
  controller: BrowserController,
  input: unknown,
): Promise<ToolResponse> {
  let id = "";
  try {
    const request = object(input);
    id = string(request, "id", 100);
    if (!isToolName(request.method))
      throw new BrowserError("UNKNOWN_TOOL", "Unknown browser tool.");
    const method = request.method;
    const params = object(request.params);
    if (method === "browser_list_tabs") return { id, result: await controller.listTabs() };
    if (method === "browser_open_tab")
      return { id, result: await controller.openTab(httpUrl(params)) };
    const tabId = params.tabId;
    if (typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId < 0)
      throw new BrowserError("INVALID_PARAMS", "tabId must be a nonnegative integer.");
    let result: unknown = { ok: true };
    switch (method) {
      case "browser_focus_tab":
        await controller.focusTab(tabId);
        break;
      case "browser_close_tab":
        await controller.closeTab(tabId);
        break;
      case "browser_snapshot":
        result = await controller.snapshot(tabId);
        break;
      case "browser_screenshot":
        result = await controller.screenshot(tabId);
        break;
      case "browser_get_html": {
        const selector =
          params.selector === undefined ? undefined : string(params, "selector", 2_000);
        const maxLength = params.maxLength;
        if (
          maxLength !== undefined &&
          (typeof maxLength !== "number" ||
            !Number.isInteger(maxLength) ||
            maxLength < 1 ||
            maxLength > 2_000_000)
        )
          throw new BrowserError("INVALID_PARAMS", "maxLength must be between 1 and 2000000.");
        result = await controller.getHtml(tabId, {
          selector,
          maxLength: maxLength as number | undefined,
        });
        break;
      }
      case "browser_click":
        await controller.click(tabId, string(params, "ref", 100));
        break;
      case "browser_type": {
        if (params.replaceExisting !== undefined && typeof params.replaceExisting !== "boolean")
          throw new BrowserError("INVALID_PARAMS", "replaceExisting must be a boolean.");
        await controller.type(
          tabId,
          string(params, "ref", 100),
          string(params, "text"),
          params.replaceExisting as boolean | undefined,
        );
        break;
      }
      case "browser_navigate": {
        await controller.navigate(tabId, httpUrl(params));
        break;
      }
      case "browser_scroll": {
        const direction = string(params, "direction", 5);
        if (!["up", "down", "left", "right"].includes(direction))
          throw new BrowserError("INVALID_PARAMS", "direction must be up, down, left, or right.");
        await controller.scroll(
          tabId,
          direction as "up" | "down" | "left" | "right",
          optionalInteger(params, "amount", 1, 10_000),
        );
        break;
      }
      case "browser_press_key":
        await controller.pressKey(tabId, string(params, "key", 100));
        break;
      case "browser_back":
        await controller.back(tabId);
        break;
      case "browser_forward":
        await controller.forward(tabId);
        break;
      case "browser_reload":
        await controller.reload(tabId);
        break;
      case "browser_wait":
        await controller.wait(tabId, optionalInteger(params, "milliseconds", 0, 10_000));
        break;
      case "browser_release":
        await controller.release(tabId);
        break;
    }
    return { id, result };
  } catch (error) {
    return {
      id,
      error: {
        code: error instanceof BrowserError ? error.code : "BROWSER_ERROR",
        message: error instanceof Error ? error.message : "Browser operation failed.",
      },
    };
  }
}
