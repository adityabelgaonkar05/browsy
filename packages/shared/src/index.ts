export type ErrorCode =
  | "INVALID_PARAMS" | "UNKNOWN_TOOL" | "TAB_NOT_FOUND" | "RESTRICTED_PAGE"
  | "DEBUGGER_UNAVAILABLE" | "STALE_REF" | "ELEMENT_NOT_INTERACTABLE"
  | "ELEMENT_OBSCURED" | "SELECTOR_NOT_FOUND" | "BROWSER_ERROR";

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
  snapshot(tabId: number): Promise<PageSnapshot>;
  getHtml(tabId: number, options?: { selector?: string; maxLength?: number }): Promise<HtmlResult>;
  screenshot(tabId: number): Promise<ScreenshotResult>;
  click(tabId: number, ref: string): Promise<void>;
  type(tabId: number, ref: string, text: string, replaceExisting?: boolean): Promise<void>;
  navigate(tabId: number, url: string): Promise<void>;
  release(tabId: number): Promise<void>;
}

export interface ToolParams {
  browser_list_tabs: Record<string, never>;
  browser_snapshot: { tabId: number };
  browser_get_html: { tabId: number; selector?: string; maxLength?: number };
  browser_screenshot: { tabId: number };
  browser_click: { tabId: number; ref: string };
  browser_type: { tabId: number; ref: string; text: string; replaceExisting?: boolean };
  browser_navigate: { tabId: number; url: string };
  browser_release: { tabId: number };
}

export interface ToolResults {
  browser_list_tabs: BrowserTab[];
  browser_snapshot: PageSnapshot;
  browser_get_html: HtmlResult;
  browser_screenshot: ScreenshotResult;
  browser_click: { ok: true };
  browser_type: { ok: true };
  browser_navigate: { ok: true };
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
];
