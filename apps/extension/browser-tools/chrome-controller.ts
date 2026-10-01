import { BrowserError } from "@agent-native/shared";
import type {
  BrowserController,
  BrowserTab,
  HtmlResult,
  PageSnapshot,
  ScreenshotResult,
} from "@agent-native/shared";
import { keyEvent } from "./keys";

interface AXNode {
  nodeId: string;
  ignored: boolean;
  backendDOMNodeId?: number;
  role?: { value: string };
  name?: { value: string };
  value?: { value: string | number };
  properties?: { name: string; value: { value: unknown } }[];
}

interface ElementRef {
  backendNodeId: number;
  role: string;
  name: string;
}
interface RemoteResult {
  result: { objectId?: string; value?: unknown };
  exceptionDetails?: unknown;
}

const meaningfulRoles = new Set([
  "heading",
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "listbox",
  "treeitem",
  "summary",
  "DisclosureTriangle",
  "img",
]);
const normalize = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const short = (value: unknown, limit = 180) => {
  const text = normalize(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

export class ChromeBrowserController implements BrowserController {
  private attached = new Set<number>();
  private refs = new Map<number, Map<string, ElementRef>>();
  private queues = new Map<number, Promise<unknown>>();
  private queueSizes = new Map<number, number>();
  private epochs = new Map<number, number>();

  constructor() {
    chrome.debugger.onDetach.addListener(({ tabId }) => {
      if (tabId !== undefined) {
        this.attached.delete(tabId);
        this.invalidate(tabId);
      }
    });
    chrome.debugger.onEvent.addListener(({ tabId }, method, params) => {
      const frame = (params as { frame?: { parentId?: string } } | undefined)?.frame;
      if (tabId !== undefined && method === "Page.frameNavigated" && frame && !frame.parentId)
        this.invalidate(tabId);
    });
    chrome.tabs.onUpdated.addListener((tabId, change) => {
      if (change.status === "loading" || change.url) this.invalidate(tabId);
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.attached.delete(tabId);
      this.refs.delete(tabId);
      this.epochs.delete(tabId);
    });
  }

  private invalidate(tabId: number) {
    this.refs.delete(tabId);
    this.epochs.set(tabId, (this.epochs.get(tabId) ?? 0) + 1);
  }

  // Mutating and inspecting a given tab are ordered; independent tabs remain concurrent.
  private serial<T>(tabId: number, work: () => Promise<T>): Promise<T> {
    const size = this.queueSizes.get(tabId) ?? 0;
    if (size >= 64)
      return Promise.reject(
        new BrowserError(
          "BUSY",
          "Too many queued operations for this tab. Wait for current work to finish.",
        ),
      );
    this.queueSizes.set(tabId, size + 1);
    const prior = this.queues.get(tabId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(work);
    this.queues.set(tabId, next);
    void next
      .finally(() => {
        const remaining = (this.queueSizes.get(tabId) ?? 1) - 1;
        if (remaining) this.queueSizes.set(tabId, remaining);
        else this.queueSizes.delete(tabId);
        if (this.queues.get(tabId) === next) this.queues.delete(tabId);
      })
      .catch(() => {});
    return next;
  }

  private async tab(tabId: number): Promise<chrome.tabs.Tab> {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new BrowserError("TAB_NOT_FOUND", `Tab ${tabId} is no longer open.`);
    }
    const url = tab.pendingUrl ?? tab.url ?? "";
    if (!/^https?:\/\//i.test(url)) {
      throw new BrowserError(
        "RESTRICTED_PAGE",
        "Open an HTTP or HTTPS page. Chrome internal pages, extension pages, and file URLs are not supported.",
      );
    }
    return tab;
  }

  private async connect(tabId: number) {
    await this.tab(tabId);
    if (this.attached.has(tabId)) return;
    try {
      await chrome.debugger.attach({ tabId }, "1.3");
    } catch (error) {
      throw new BrowserError(
        "DEBUGGER_UNAVAILABLE",
        `Cannot attach to tab ${tabId}. Close its DevTools or other debugger and retry. ${String(error)}`,
      );
    }
    this.attached.add(tabId);
    try {
      await this.command(tabId, "Page.enable");
    } catch (error) {
      this.attached.delete(tabId);
      await chrome.debugger.detach({ tabId }).catch(() => {});
      throw error;
    }
  }

  private async command<T>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  }

  async listTabs(): Promise<BrowserTab[]> {
    return (await chrome.tabs.query({}))
      .filter((tab) => tab.id !== undefined)
      .map((tab) => ({
        id: tab.id!,
        title: tab.title ?? "Untitled",
        url: tab.url ?? tab.pendingUrl ?? "",
        active: tab.active,
        windowId: tab.windowId,
      }));
  }

  async openTab(url: string): Promise<BrowserTab> {
    const tab = await chrome.tabs.create({ url });
    return {
      id: tab.id!,
      title: tab.title ?? "",
      url: tab.pendingUrl ?? tab.url ?? url,
      active: tab.active,
      windowId: tab.windowId,
    };
  }

  focusTab(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => {
        throw new BrowserError("TAB_NOT_FOUND", `Tab ${tabId} is no longer open.`);
      });
      await chrome.tabs.update(tabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    });
  }

  closeTab(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      await chrome.tabs.get(tabId).catch(() => {
        throw new BrowserError("TAB_NOT_FOUND", `Tab ${tabId} is no longer open.`);
      });
      await chrome.tabs.remove(tabId);
    });
  }

  snapshot(tabId: number): Promise<PageSnapshot> {
    return this.serial(tabId, async () => {
      await this.connect(tabId);
      this.invalidate(tabId);
      const epoch = this.epochs.get(tabId);
      const { frameTree } = await this.command<{
        frameTree: { frame: { id: string; url: string } };
      }>(tabId, "Page.getFrameTree");
      const { nodes } = await this.command<{ nodes: AXNode[] }>(
        tabId,
        "Accessibility.getFullAXTree",
        { frameId: frameTree.frame.id },
      );
      const refs = new Map<string, ElementRef>();
      const elements: PageSnapshot["elements"] = [];
      const lines: string[] = [];
      const nonce = crypto.randomUUID().slice(0, 6);
      let size = 0;
      let truncated = false;
      for (const node of nodes) {
        if (node.ignored) continue;
        const role = node.role?.value ?? "";
        const name = normalize(node.name?.value);
        const editable = node.properties?.some(
          (property) => property.name === "editable" && Boolean(property.value.value),
        );
        // Include concise page text so an agent can read an issue or article, too.
        if (!meaningfulRoles.has(role) && role !== "StaticText" && !editable) continue;
        if (role === "StaticText" && !name) continue;
        if (role === "img" && !name) continue;
        const actionable = role !== "StaticText" && node.backendDOMNodeId !== undefined;
        const ref = actionable ? `e${elements.length + 1}-${nonce}` : undefined;
        const properties = (node.properties ?? [])
          .filter((p) =>
            ["checked", "disabled", "expanded", "selected", "level", "required"].includes(p.name),
          )
          .map((p) => `${p.name}=${p.value.value}`)
          .join(" ");
        // Do not include input values (passwords and other private form data).
        const line = `${ref ? `[ref=${ref}] ` : ""}${role === "StaticText" ? "text" : role} ${JSON.stringify(short(name))}${properties ? ` ${properties}` : ""}`;
        if (lines.length >= 400 || size + line.length > 32_000) {
          truncated = true;
          break;
        }
        if (ref) {
          refs.set(ref, { backendNodeId: node.backendDOMNodeId!, role, name });
          elements.push({ ref, role, name: short(name) });
        }
        lines.push(line);
        size += line.length + 1;
      }
      if (this.epochs.get(tabId) !== epoch)
        throw new BrowserError(
          "STALE_REF",
          "Page navigated during the snapshot. Take another snapshot.",
        );
      this.refs.set(tabId, refs);
      const tab = await this.tab(tabId);
      return {
        tabId,
        title: tab.title ?? "",
        url: frameTree.frame.url,
        text: lines.join("\n"),
        elements,
        truncated,
        scope: "main-frame",
      };
    });
  }

  getHtml(
    tabId: number,
    options: { selector?: string; maxLength?: number } = {},
  ): Promise<HtmlResult> {
    return this.serial(tabId, async () => {
      await this.connect(tabId);
      const maxLength = options.maxLength ?? 100_000;
      const { result, exceptionDetails } = await this.command<RemoteResult>(
        tabId,
        "Runtime.evaluate",
        {
          expression: `(() => {
          const element = ${options.selector === undefined ? "document.documentElement" : `document.querySelector(${JSON.stringify(options.selector)})`};
          if (!element) return null;
          const html = element.outerHTML;
          return { html: html.slice(0, ${maxLength}), truncated: html.length > ${maxLength}, totalLength: html.length };
        })()`,
          returnByValue: true,
        },
      );
      if (exceptionDetails)
        throw new BrowserError("INVALID_PARAMS", "Invalid CSS selector or unavailable document.");
      if (result.value === null)
        throw new BrowserError("SELECTOR_NOT_FOUND", "No element matches that selector.");
      return result.value as HtmlResult;
    });
  }

  screenshot(tabId: number): Promise<ScreenshotResult> {
    return this.serial(tabId, async () => {
      await this.connect(tabId);
      const { data } = await this.command<{ data: string }>(tabId, "Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      return { mimeType: "image/png", data };
    });
  }

  private async withElement<T>(
    tabId: number,
    ref: string,
    work: (objectId: string) => Promise<T>,
  ): Promise<T> {
    await this.connect(tabId);
    const entry = this.refs.get(tabId)?.get(ref);
    if (!entry)
      throw new BrowserError("STALE_REF", "Unknown or expired ref. Take another snapshot.");
    const epoch = this.epochs.get(tabId);
    let objectId: string | undefined;
    try {
      const { nodes } = await this.command<{ nodes: AXNode[] }>(
        tabId,
        "Accessibility.getPartialAXTree",
        {
          backendNodeId: entry.backendNodeId,
          fetchRelatives: false,
        },
      );
      const node = nodes.find((n) => n.backendDOMNodeId === entry.backendNodeId && !n.ignored);
      if (!node || node.role?.value !== entry.role || normalize(node.name?.value) !== entry.name)
        throw new Error("Element changed");
      const resolved = await this.command<{ object: { objectId?: string } }>(
        tabId,
        "DOM.resolveNode",
        { backendNodeId: entry.backendNodeId },
      );
      objectId = resolved.object.objectId;
      if (!objectId || this.epochs.get(tabId) !== epoch) throw new Error("Document changed");
      const connected = await this.call<{ connected: boolean }>(
        tabId,
        objectId,
        "function() { return { connected: this.isConnected && this.ownerDocument === document }; }",
      );
      if (!connected.connected) throw new Error("Element detached");
    } catch {
      if (objectId)
        await this.command(tabId, "Runtime.releaseObject", { objectId }).catch(() => {});
      this.refs.get(tabId)?.delete(ref);
      throw new BrowserError(
        "STALE_REF",
        "Element was removed, renamed, or changed. Take another snapshot.",
      );
    }
    try {
      return await work(objectId);
    } finally {
      await this.command(tabId, "Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }

  private async call<T>(
    tabId: number,
    objectId: string,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<T> {
    const response = await this.command<RemoteResult>(tabId, "Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    if (response.exceptionDetails)
      throw new BrowserError(
        "BROWSER_ERROR",
        "Page changed during the action. Retry with a new snapshot.",
      );
    return response.result.value as T;
  }

  click(tabId: number, ref: string): Promise<void> {
    return this.serial(tabId, () =>
      this.withElement(tabId, ref, async (objectId) => {
        const point = await this.call<{ x?: number; y?: number; error?: string }>(
          tabId,
          objectId,
          `function() {
        if (this.matches(':disabled, [aria-disabled="true"]')) return { error: 'disabled' };
        this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const style = getComputedStyle(this);
        if (style.visibility !== 'visible' || style.display === 'none') return { error: 'hidden' };
        for (const rect of this.getClientRects()) {
          const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
          const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
          if (right <= left || bottom <= top) continue;
          const x = (left + right) / 2, y = (top + bottom) / 2;
          let hit = document.elementFromPoint(x, y);
          while (hit && hit.shadowRoot) {
            const inner = hit.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === hit) break;
            hit = inner;
          }
          for (let candidate = hit; candidate; candidate = candidate.parentNode || candidate.host) {
            if (candidate === this) return { x, y };
          }
        }
        return { error: 'obscured' };
      }`,
        );
        if (point.error)
          throw new BrowserError(
            point.error === "obscured" ? "ELEMENT_OBSCURED" : "ELEMENT_NOT_INTERACTABLE",
            `Element is ${point.error}. Inspect the page again or take a screenshot.`,
          );
        await this.command(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: point.x,
          y: point.y,
        });
        await this.command(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
        await this.command(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
      }),
    );
  }

  type(tabId: number, ref: string, text: string, replaceExisting = true): Promise<void> {
    return this.serial(tabId, () =>
      this.withElement(tabId, ref, async (objectId) => {
        const status = await this.call<{ error?: string }>(
          tabId,
          objectId,
          `function(replace) {
        const editable = this instanceof HTMLTextAreaElement ||
          (this instanceof HTMLInputElement && ['text','search','email','url','tel','password'].includes(this.type)) || this.isContentEditable;
        if (!editable || this.disabled || this.readOnly || this.getAttribute('aria-disabled') === 'true') return { error: 'Element is not an editable input.' };
        this.scrollIntoView({ block: 'center', behavior: 'instant' });
        this.focus();
        let active = document.activeElement;
        while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
        if (active !== this) return { error: 'Element could not be focused.' };
        if (this.isContentEditable) {
          const range = document.createRange(); range.selectNodeContents(this);
          if (!replace) range.collapse(false);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        } else if (replace) this.select();
        else if (!this.isContentEditable && typeof this.selectionStart === 'number') this.setSelectionRange(this.value.length, this.value.length);
        return {};
      }`,
          [replaceExisting],
        );
        if (status.error) throw new BrowserError("ELEMENT_NOT_INTERACTABLE", status.error);
        if (replaceExisting && !text) {
          await this.command(tabId, "Input.dispatchKeyEvent", {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
          await this.command(tabId, "Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          });
        } else if (text) await this.command(tabId, "Input.insertText", { text });
      }),
    );
  }

  navigate(tabId: number, url: string): Promise<void> {
    return this.serial(tabId, async () => {
      // Navigate works from Chrome's new-tab page, where debugger attachment is unavailable.
      try {
        await chrome.tabs.get(tabId);
      } catch {
        throw new BrowserError("TAB_NOT_FOUND", `Tab ${tabId} is no longer open.`);
      }
      this.invalidate(tabId);
      await chrome.tabs.update(tabId, { url });
    });
  }

  scroll(tabId: number, direction: "up" | "down" | "left" | "right", amount = 600): Promise<void> {
    return this.serial(tabId, async () => {
      await this.connect(tabId);
      const x = direction === "left" ? -amount : direction === "right" ? amount : 0;
      const y = direction === "up" ? -amount : direction === "down" ? amount : 0;
      await this.command(tabId, "Runtime.evaluate", {
        expression: `window.scrollBy({left:${x},top:${y},behavior:'instant'})`,
      });
    });
  }

  pressKey(tabId: number, key: string): Promise<void> {
    return this.serial(tabId, async () => {
      const event = keyEvent(key);
      await this.connect(tabId);
      await this.command(tabId, "Input.dispatchKeyEvent", { ...event, type: "keyDown" });
      const { text: _text, ...release } = event;
      await this.command(tabId, "Input.dispatchKeyEvent", { ...release, type: "keyUp" });
    });
  }

  back(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      await this.tab(tabId);
      this.invalidate(tabId);
      await chrome.tabs.goBack(tabId);
    });
  }

  forward(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      await this.tab(tabId);
      this.invalidate(tabId);
      await chrome.tabs.goForward(tabId);
    });
  }

  reload(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      await this.tab(tabId);
      this.invalidate(tabId);
      await chrome.tabs.reload(tabId);
    });
  }

  wait(tabId: number, milliseconds = 500): Promise<void> {
    return this.serial(tabId, async () => {
      await this.tab(tabId);
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    });
  }

  release(tabId: number): Promise<void> {
    return this.serial(tabId, async () => {
      if (this.attached.has(tabId)) await chrome.debugger.detach({ tabId });
      this.attached.delete(tabId);
      this.invalidate(tabId);
    });
  }
}
