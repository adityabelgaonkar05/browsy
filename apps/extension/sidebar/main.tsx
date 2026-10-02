import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  BrowserTab,
  NativeConnectionStatus,
  PageSnapshot,
  ToolName,
  ToolParams,
  ToolResponse,
  ToolResults,
} from "@agent-native/shared";
import "./styles.css";
const Chat = lazy(() => import("./chat").then((module) => ({ default: module.Chat })));

async function tool<K extends ToolName>(method: K, params: ToolParams[K]): Promise<ToolResults[K]> {
  const response: ToolResponse<ToolResults[K]> | undefined = await chrome.runtime.sendMessage({
    channel: "browser-tools",
    id: crypto.randomUUID(),
    method,
    params,
  });
  if (!response)
    throw new Error(
      "Extension background is unavailable. Reload the extension and reopen this panel.",
    );
  if ("error" in response) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.result;
}

function App() {
  const [screen, setScreen] = useState<"chat" | "control">("chat");
  const [chatOpened, setChatOpened] = useState(true);
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [tabId, setTabId] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("Choose a tab to get started.");
  const [snapshot, setSnapshot] = useState<PageSnapshot>();
  const [html, setHtml] = useState("");
  const [image, setImage] = useState("");
  const [view, setView] = useState<"snapshot" | "html" | "image">("snapshot");
  const [ref, setRef] = useState("");
  const [text, setText] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [url, setUrl] = useState("");
  const [selector, setSelector] = useState("");
  const [maxLength, setMaxLength] = useState(100_000);
  const [elapsed, setElapsed] = useState<number>();
  const [bridge, setBridge] = useState<NativeConnectionStatus>();
  const selection = useRef(tabId);
  selection.current = tabId;
  const tab = tabs.find((t) => t.id === tabId);

  async function refreshTabs() {
    const current = await tool("browser_list_tabs", {});
    setTabs(current);
    if (selection.current === undefined || !current.some((t) => t.id === selection.current)) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTabId(current.find((t) => t.id === active?.id)?.id ?? current[0]?.id);
    }
  }

  useEffect(() => {
    void refreshTabs().catch((e: Error) => setError(e.message));
    const changed = (_id: number, info: { status?: string; url?: string; title?: string }) => {
      if (info.status === "loading" && _id === selection.current) {
        setSnapshot(undefined);
        setRef("");
        setHtml("");
        setImage("");
      }
      if (info.status === "complete" || info.url || info.title)
        void refreshTabs().catch((e: Error) => setError(e.message));
    };
    const refresh = () => {
      void refreshTabs().catch((e: Error) => setError(e.message));
    };
    chrome.tabs.onUpdated.addListener(changed);
    chrome.tabs.onCreated.addListener(refresh);
    chrome.tabs.onRemoved.addListener(refresh);
    return () => {
      chrome.tabs.onUpdated.removeListener(changed);
      chrome.tabs.onCreated.removeListener(refresh);
      chrome.tabs.onRemoved.removeListener(refresh);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void chrome.runtime
        .sendMessage({ channel: "bridge-status" })
        .then((status: NativeConnectionStatus) => {
          if (mounted) setBridge(status);
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 2_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setSnapshot(undefined);
    setHtml("");
    setImage("");
    setRef("");
    setError("");
    setUrl(tab?.url ?? "");
    setNotice("Ready to inspect this tab.");
  }, [tabId, tab?.url]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(true);
    setError("");
    const start = performance.now();
    try {
      await action();
      setNotice(label);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (message.startsWith("STALE_REF")) {
        setSnapshot(undefined);
        setRef("");
      }
    } finally {
      setElapsed(Math.round(performance.now() - start));
      setBusy(false);
    }
  }

  async function inspect() {
    if (tabId === undefined) return;
    setSnapshot(await tool("browser_snapshot", { tabId }));
    setRef("");
    setView("snapshot");
  }

  return (
    <main>
      <header>
        <div className="brand">
          <span className="mark">
            b<span>↗</span>
          </span>
          <div>
            <h1>Browsy</h1>
            <p>Your browser. Within reach.</p>
          </div>
        </div>
        <span className="local">
          <i />
          LOCAL BROWSER
        </span>
      </header>
      <nav className="view-switch" aria-label="Sidebar view">
        <button
          aria-pressed={screen === "chat"}
          className={screen === "chat" ? "selected" : ""}
          onClick={() => {
            setChatOpened(true);
            setScreen("chat");
          }}
        >
          ✦ Chat
        </button>
        <button
          aria-pressed={screen === "control"}
          className={screen === "control" ? "selected" : ""}
          onClick={() => setScreen("control")}
        >
          Browser tools
        </button>
      </nav>
      <div hidden={screen !== "chat"}>
        {chatOpened && (
          <Suspense
            fallback={
              <p className="status" role="status">
                Opening chat…
              </p>
            }
          >
            <Chat />
          </Suspense>
        )}
      </div>
      <div hidden={screen !== "control"}>
        <section className={`card bridge ${bridge?.connected ? "connected" : ""}`}>
          <div className="row">
            <label>Terminal agents</label>
            <span>
              <i />
              {bridge?.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <div className="row">
            <p>
              {bridge?.connected
                ? "Your browser is available to local MCP agents."
                : "Register the local bridge with the CLI, then reconnect."}
            </p>
            <button
              className="quiet"
              disabled={busy}
              onClick={() =>
                void run("Bridge connection requested.", async () => {
                  setBridge(
                    await chrome.runtime.sendMessage({ channel: "bridge-status", reconnect: true }),
                  );
                })
              }
            >
              Reconnect ↻
            </button>
          </div>
          {!bridge?.connected && bridge?.error && (
            <details>
              <summary>Connection details</summary>
              <p>{bridge.error}</p>
              <p>Extension ID: {chrome.runtime.id}</p>
            </details>
          )}
        </section>
        <div className="section-label">
          BROWSER CONTROL <span>LOCAL TOOLS</span>
        </div>
        <section className="card target">
          <div className="row">
            <label htmlFor="tab">
              Open tabs <span className="count">{tabs.length}</span>
            </label>
            <button
              className="quiet"
              disabled={busy}
              onClick={() => void run("Tabs refreshed.", refreshTabs)}
            >
              Refresh ↻
            </button>
          </div>
          <select
            id="tab"
            value={tabId ?? ""}
            disabled={busy}
            onChange={(e) => setTabId(Number(e.target.value))}
          >
            {!tabs.length && <option value="">No open tabs</option>}
            {tabs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
          </select>
          <p className="tab-url" title={tab?.url}>
            {tab?.url ?? "Waiting for Chrome…"}
          </p>
          <form
            className="navigate"
            onSubmit={(e) => {
              e.preventDefault();
              if (tabId !== undefined)
                void run("Navigation started. Snapshot when the page is ready.", async () => {
                  await tool("browser_navigate", { tabId, url });
                  setSnapshot(undefined);
                  setRef("");
                  setHtml("");
                  setImage("");
                });
            }}
          >
            <input
              aria-label="Destination URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              type="url"
              required
              disabled={busy}
            />
            <button title="Navigate tab" disabled={busy || tabId === undefined}>
              Go ↗
            </button>
          </form>
        </section>
        <section className="inspection">
          <div className="section-label">
            INSPECT <span>ON DEMAND</span>
          </div>
          <div className="tools">
            <button
              className="primary"
              disabled={busy || tabId === undefined}
              onClick={() =>
                void run("Snapshot captured. Select an element to act on it.", inspect)
              }
            >
              <span>≡</span> Snapshot
            </button>
            <button
              disabled={busy || tabId === undefined}
              onClick={() =>
                void run("HTML captured.", async () => {
                  const result = await tool("browser_get_html", {
                    tabId: tabId!,
                    selector: selector || undefined,
                    maxLength,
                  });
                  setHtml(
                    `${result.html}${result.truncated ? `\n\n[Truncated: ${result.totalLength.toLocaleString()} total characters]` : ""}`,
                  );
                  setView("html");
                })
              }
            >
              ⟨/⟩ HTML
            </button>
            <button
              disabled={busy || tabId === undefined}
              onClick={() =>
                void run("Viewport captured.", async () => {
                  const result = await tool("browser_screenshot", { tabId: tabId! });
                  setImage(`data:${result.mimeType};base64,${result.data}`);
                  setView("image");
                })
              }
            >
              ▣ Screenshot
            </button>
          </div>
          <details className="html-options">
            <summary>HTML options</summary>
            <div className="row">
              <input
                aria-label="HTML CSS selector"
                placeholder="CSS selector (optional)"
                value={selector}
                disabled={busy}
                onChange={(e) => setSelector(e.target.value)}
              />
              <input
                aria-label="HTML character limit"
                type="number"
                min="1"
                max="2000000"
                value={maxLength}
                disabled={busy}
                onChange={(e) => setMaxLength(Number(e.target.value))}
              />
            </div>
          </details>
        </section>
        <section className="card result">
          <div className="result-tabs" role="tablist" aria-label="Inspection result">
            {(["snapshot", "html", "image"] as const).map((v) => (
              <button
                role="tab"
                aria-selected={view === v}
                key={v}
                className={view === v ? "selected" : ""}
                onClick={() => setView(v)}
              >
                {v === "image" ? "Screenshot" : v === "html" ? "HTML" : "Snapshot"}
              </button>
            ))}
            {elapsed !== undefined && <span className="timing">{elapsed} ms</span>}
          </div>
          <div className="result-body" role="tabpanel">
            {view === "snapshot" &&
              (snapshot ? (
                <>
                  <div className="snapshot-meta">
                    {snapshot.elements.length} elements · Main frame
                    {snapshot.truncated ? " · Truncated" : ""}
                  </div>
                  <pre>
                    {snapshot.text || "No readable text or interactive elements. Try a screenshot."}
                  </pre>
                </>
              ) : (
                <div className="empty">
                  <div className="empty-icon">≡</div>
                  <h2>See what’s on the page</h2>
                  <p>Take a snapshot for a compact view of text, links, and controls.</p>
                </div>
              ))}
            {view === "html" &&
              (html ? (
                <pre>{html}</pre>
              ) : (
                <div className="empty">
                  <h2>Page source, when you need it</h2>
                  <p>Get HTML to inspect the main document or a CSS selector.</p>
                </div>
              ))}
            {view === "image" &&
              (image ? (
                <a href={image} download={`tab-${tabId}.png`} title="Download screenshot">
                  <img className="screenshot" src={image} alt="Captured browser viewport" />
                </a>
              ) : (
                <div className="empty">
                  <h2>A visual view of your tab</h2>
                  <p>Capture the viewport to inspect layouts, images, and canvas content.</p>
                </div>
              ))}
          </div>
        </section>
        <section className="card actions">
          <div className="section-label">ACT ON AN ELEMENT</div>
          <label htmlFor="ref">Snapshot reference</label>
          <input
            id="ref"
            list="refs"
            value={ref}
            disabled={busy}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Choose or paste a ref"
            autoComplete="off"
          />
          <datalist id="refs">
            {snapshot?.elements.map((element) => (
              <option key={element.ref} value={element.ref}>
                {element.role} · {element.name}
              </option>
            ))}
          </datalist>
          <button
            className="click-button"
            disabled={busy || !ref || tabId === undefined}
            onClick={() =>
              void run("Click sent. Take another snapshot to inspect the result.", async () => {
                await tool("browser_click", { tabId: tabId!, ref });
              })
            }
          >
            Click element ↗
          </button>
          <label htmlFor="text">Text to enter</label>
          <textarea
            id="text"
            rows={2}
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type into the selected input…"
          />
          <div className="row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={replaceExisting}
                disabled={busy}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              Replace existing text
            </label>
            <button
              disabled={busy || !ref || tabId === undefined}
              onClick={() =>
                void run("Text entered.", async () => {
                  await tool("browser_type", { tabId: tabId!, ref, text, replaceExisting });
                })
              }
            >
              Type text →
            </button>
          </div>
        </section>
        <div
          className={`status ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          <i />
          {busy ? "Working in Chrome…" : error || notice}
        </div>
        <footer>
          <span>Connected to your Chrome session</span>
          <button
            className="quiet"
            disabled={busy || tabId === undefined}
            onClick={() =>
              void run("Debugger released. References cleared.", async () => {
                await tool("browser_release", { tabId: tabId! });
                setSnapshot(undefined);
                setRef("");
              })
            }
          >
            Release tab
          </button>
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
