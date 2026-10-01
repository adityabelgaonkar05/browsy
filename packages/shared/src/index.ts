export type ErrorCode =
  | "INVALID_PARAMS" | "UNKNOWN_TOOL" | "TAB_NOT_FOUND" | "RESTRICTED_PAGE"
  | "DEBUGGER_UNAVAILABLE" | "STALE_REF" | "ELEMENT_NOT_INTERACTABLE"
  | "ELEMENT_OBSCURED" | "SELECTOR_NOT_FOUND" | "BROWSER_ERROR"
  | "BRIDGE_UNAVAILABLE" | "BRIDGE_DISCONNECTED" | "TIMEOUT" | "BUSY" | "MESSAGE_TOO_LARGE";

export class BrowserError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = "BrowserError";
  }
}

export interface BrowserTab {
  id: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
}

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
}

export interface PageSnapshot {
  tabId: number;
  title: string;
  url: string;
  text: string;
  elements: SnapshotElement[];
  truncated: boolean;
  scope: "main-frame";
}

export interface HtmlResult {
  html: string;
  truncated: boolean;
  totalLength: number;
}

export interface ScreenshotResult {
  mimeType: "image/png";
  data: string;
}

// This interface is the browser boundary. Future transports and chat use it unchanged.
export interface BrowserController {
  listTabs(): Promise<BrowserTab[]>;
  openTab(url: string): Promise<BrowserTab>;
  focusTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
  snapshot(tabId: number): Promise<PageSnapshot>;
  getHtml(tabId: number, options?: { selector?: string; maxLength?: number }): Promise<HtmlResult>;
  screenshot(tabId: number): Promise<ScreenshotResult>;
  click(tabId: number, ref: string): Promise<void>;
  type(tabId: number, ref: string, text: string, replaceExisting?: boolean): Promise<void>;
  navigate(tabId: number, url: string): Promise<void>;
  scroll(tabId: number, direction: "up" | "down" | "left" | "right", amount?: number): Promise<void>;
  pressKey(tabId: number, key: string): Promise<void>;
  back(tabId: number): Promise<void>;
  forward(tabId: number): Promise<void>;
  reload(tabId: number): Promise<void>;
  wait(tabId: number, milliseconds?: number): Promise<void>;
  release(tabId: number): Promise<void>;
}

export interface ToolParams {
  browser_list_tabs: Record<string, never>;
  browser_open_tab: { url: string };
  browser_focus_tab: { tabId: number };
  browser_close_tab: { tabId: number };
  browser_snapshot: { tabId: number };
  browser_get_html: { tabId: number; selector?: string; maxLength?: number };
  browser_screenshot: { tabId: number };
  browser_click: { tabId: number; ref: string };
  browser_type: { tabId: number; ref: string; text: string; replaceExisting?: boolean };
  browser_navigate: { tabId: number; url: string };
  browser_scroll: { tabId: number; direction: "up" | "down" | "left" | "right"; amount?: number };
  browser_press_key: { tabId: number; key: string };
  browser_back: { tabId: number };
  browser_forward: { tabId: number };
  browser_reload: { tabId: number };
  browser_wait: { tabId: number; milliseconds?: number };
  browser_release: { tabId: number };
}

export interface ToolResults {
  browser_list_tabs: BrowserTab[];
  browser_open_tab: BrowserTab;
  browser_focus_tab: { ok: true };
  browser_close_tab: { ok: true };
  browser_snapshot: PageSnapshot;
  browser_get_html: HtmlResult;
  browser_screenshot: ScreenshotResult;
  browser_click: { ok: true };
  browser_type: { ok: true };
  browser_navigate: { ok: true };
  browser_scroll: { ok: true };
  browser_press_key: { ok: true };
  browser_back: { ok: true };
  browser_forward: { ok: true };
  browser_reload: { ok: true };
  browser_wait: { ok: true };
  browser_release: { ok: true };
}

export type ToolName = keyof ToolParams;
export type ToolRequest = {
  [K in ToolName]: { channel: "browser-tools"; id: string; method: K; params: ToolParams[K] }
}[ToolName];

export type ToolResponse<T = unknown> =
  | { id: string; result: T }
  | { id: string; error: { code: ErrorCode; message: string } };

export const toolNames: readonly ToolName[] = [
  "browser_list_tabs", "browser_snapshot", "browser_get_html", "browser_screenshot",
  "browser_click", "browser_type", "browser_navigate", "browser_release",
  "browser_open_tab", "browser_focus_tab", "browser_close_tab", "browser_scroll",
  "browser_press_key", "browser_back", "browser_forward", "browser_reload", "browser_wait",
];

export const NATIVE_HOST_NAME = "com.agent_native.browser";
export const DEVELOPMENT_EXTENSION_ID = "dgejfddjompnibfocdkcjhjaifnogmeo";
export const BRIDGE_PROTOCOL_VERSION = 1;
export const MAX_REQUEST_BYTES = 1024 * 1024 - 1;
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024 - 1;

export interface BridgeHello {
  kind: "bridge.hello";
  version: number;
  extensionId: string;
}
export interface BridgeStatus {
  connected: boolean;
  version: number;
  extensionId: string;
  pid: number;
}
export interface NativeConnectionStatus {
  connected: boolean;
  host: string;
  error?: string;
}
