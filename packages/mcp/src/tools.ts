import * as z from "zod/v4";
import type { ToolName } from "@agent-native/shared";

const tabId = z.number().int().min(0).describe("Chrome tab ID from browser_list_tabs.");
const ref = z
  .string()
  .min(1)
  .max(100)
  .describe("Reference from the most recent snapshot of this tab.");
const url = z
  .string()
  .max(8192)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Only HTTP/HTTPS URLs are supported.");
const tab = { tabId };

export const browserTools = {
  browser_list_tabs: {
    description:
      "List every open Chrome tab, including its ID, title, and URL. Uses the user's existing browser session.",
    schema: z.object({}),
    readOnly: true,
  },
  browser_open_tab: {
    description:
      "Open an HTTP/HTTPS URL in a new Chrome tab. Returns its ID; navigation may still be loading.",
    schema: z.object({ url }),
    readOnly: false,
  },
  browser_focus_tab: {
    description: "Activate a tab and focus its Chrome window.",
    schema: z.object(tab),
    readOnly: false,
  },
  browser_close_tab: { description: "Close a Chrome tab.", schema: z.object(tab), readOnly: false },
  browser_snapshot: {
    description:
      "DEFAULT page inspection: compact accessibility roles, names, text, and short-lived element refs. Inspect before acting. Main frame only. On STALE_REF, take another snapshot. Prefer this over raw HTML.",
    schema: z.object(tab),
    readOnly: true,
  },
  browser_get_html: {
    description:
      "Explicitly retrieve HTML for debugging or extraction; not the default context. Optional CSS selector and length limit; main document only. Returns truncation metadata.",
    schema: z.object({
      ...tab,
      selector: z.string().max(2000).optional(),
      maxLength: z.number().int().min(1).max(2_000_000).optional(),
    }),
    readOnly: true,
  },
  browser_screenshot: {
    description:
      "Capture the visible viewport as a PNG image. Use for ambiguous elements, canvas, visual content, or layout verification when snapshot information is insufficient. Do not capture automatically for every page.",
    schema: z.object(tab),
    readOnly: true,
  },
  browser_click: {
    description:
      "Click an element using a ref from this tab's latest snapshot. If stale or obscured, inspect again before retrying.",
    schema: z.object({ ...tab, ref }),
    readOnly: false,
  },
  browser_type: {
    description:
      "Enter text into an input, textarea, or editable element using its snapshot ref. Replaces existing text by default; false appends. Empty replacement clears the input.",
    schema: z.object({
      ...tab,
      ref,
      text: z.string().max(100_000),
      replaceExisting: z.boolean().optional(),
    }),
    readOnly: false,
  },
  browser_navigate: {
    description:
      "Navigate an existing tab to an HTTP/HTTPS URL. Navigation starts asynchronously and invalidates refs. Wait for loading before taking a new snapshot.",
    schema: z.object({ ...tab, url }),
    readOnly: false,
  },
  browser_scroll: {
    description:
      "Scroll the main document in a direction. Amount is pixels (default 600); take another snapshot if needed.",
    schema: z.object({
      ...tab,
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().min(1).max(10_000).optional(),
    }),
    readOnly: false,
  },
  browser_press_key: {
    description:
      "Send a key to the focused element. Supports Enter, Tab, Escape, ArrowUp/Down/Left/Right, Backspace, Delete, Home, End, PageUp/Down, Space and letters/digits. Chords: Meta+a (macOS select all), Ctrl+a, Shift+Tab. Focus an element by clicking or typing first.",
    schema: z.object({ ...tab, key: z.string().min(1).max(100) }),
    readOnly: false,
  },
  browser_back: {
    description: "Go back in a tab's navigation history; invalidates refs.",
    schema: z.object(tab),
    readOnly: false,
  },
  browser_forward: {
    description: "Go forward in a tab's navigation history; invalidates refs.",
    schema: z.object(tab),
    readOnly: false,
  },
  browser_reload: {
    description: "Reload a tab; invalidates refs. Wait for loading before inspecting.",
    schema: z.object(tab),
    readOnly: false,
  },
  browser_wait: {
    description:
      "Wait briefly before inspecting a changing page. Default 500 ms, maximum 10000 ms. This is a delay, not a guarantee that navigation or dynamic content is complete.",
    schema: z.object({ ...tab, milliseconds: z.number().int().min(0).max(10_000).optional() }),
    readOnly: true,
  },
  browser_release: {
    description:
      "Release the extension debugger connection for a tab and expire its refs. Subsequent inspection reconnects automatically.",
    schema: z.object(tab),
    readOnly: false,
  },
} satisfies Record<ToolName, { description: string; schema: z.ZodObject; readOnly: boolean }>;
