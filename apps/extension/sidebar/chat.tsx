import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BrowserTab, ToolResponse } from "@agent-native/shared";
import { Provider } from "../providers/provider";
import { defaultSettings, providerDefaults, textOf, validateSettings } from "../providers/types";
import type { Model, ProviderKind, ProviderSettings } from "../providers/types";
import { compactionThreshold, contextTokens, newChat } from "../chat/context";
import type { ChatState } from "../chat/context";
import {
  defaultChatSettings,
  loadChat,
  loadSettings,
  saveChat,
  saveSettings,
} from "../chat/storage";
import type { ChatSettings } from "../chat/storage";
import { recoverInterrupted, runTurn } from "../chat/engine";

export function Chat() {
  const [settings, setSettings] = useState<ChatSettings>(defaultChatSettings);
  const [draft, setDraft] = useState<ProviderSettings>(defaultSettings("openrouter"));
  const [state, setState] = useState<ChatState>(newChat);
  const current = useRef(state);
  const [ready, setReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<BrowserTab>();
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const discovery = useRef<AbortController | undefined>(undefined);
  const running = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const browserState = useRef("");
  const profile = settings.profiles[settings.selected];
  const hasProvider = Boolean(
    profile.model && (profile.kind === "compatible" || profile.apiKey.trim()),
  );
  const browser = tab
    ? JSON.stringify({ activeTabId: tab.id, title: tab.title, url: tab.url })
    : "Active tab unavailable. Use browser_list_tabs.";
  browserState.current = browser;

  const update = (value: ChatState) => {
    current.current = value;
    setState(value);
  };
  useEffect(() => {
    let alive = true;
    void loadSettings()
      .then(async (saved) => {
        const chat = await navigator.locks.request(
          "agent-native-chat-turn",
          { ifAvailable: true },
          async (lock) => {
            const value = await loadChat();
            if (lock) {
              recoverInterrupted(value);
              await saveChat(value);
            }
            return value;
          },
        );
        if (!alive) return;
        setSettings(saved);
        setDraft(saved.profiles[saved.selected]);
        update(chat);
        setModelReady(Boolean(saved.profiles[saved.selected].model));
        setReady(true);
      })
      .catch(() => {
        if (alive) {
          setError(
            "Local settings or history could not be loaded. Reopen the sidebar before sending a message.",
          );
        }
      });
    return () => {
      alive = false;
      abort.current?.abort();
      discovery.current?.abort();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void chrome.tabs
        .query({ active: true, currentWindow: true })
        .then(([active]) => {
          if (alive && active?.id !== undefined)
            setTab({
              id: active.id,
              title: active.title ?? "Untitled",
              url: active.url ?? "",
              active: true,
              windowId: active.windowId,
            });
        })
        .catch(() => {
          if (alive) setTab(undefined);
        });
    };
    refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(refresh);
    return () => {
      alive = false;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(refresh);
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [state.messages, busy]);

  function changeKind(kind: ProviderKind) {
    discovery.current?.abort();
    setDraft(settings.profiles[kind]);
    setModels([]);
    setModelReady(Boolean(settings.profiles[kind].model));
    setError("");
  }
  function openSettings() {
    setDraft(profile);
    setModels([]);
    setModelReady(Boolean(profile.model));
    setError("");
    setShowSettings(true);
  }
  function selectModel(id: string) {
    const model = models.find((item) => item.id === id);
    setDraft((value) => ({
      ...value,
      model: id,
      tools: model?.tools ?? true,
      vision: model?.vision ?? false,
      context: model?.context ?? 128_000,
    }));
  }
  async function discover() {
    setError("");
    const controller = new AbortController();
    discovery.current?.abort();
    discovery.current = controller;
    setLoadingModels(true);
    try {
      const origin = validateSettings(draft, false);
      if (!(await chrome.permissions.request({ origins: [origin] })))
        throw new Error("Provider access was not granted.");
      controller.signal.throwIfAborted();
      const values = await new Provider(draft).listModels(controller.signal);
      setModels(
        values.sort(
          (a, b) =>
            Number(Boolean(b.tools)) - Number(Boolean(a.tools)) || a.name.localeCompare(b.name),
        ),
      );
      setModelReady(true);
      if (!values.length) setStatus("Enter the model ID supplied by your server.");
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Could not load models.");
    } finally {
      setLoadingModels(false);
    }
  }
  async function storeProvider() {
    setError("");
    setSaving(true);
    try {
      const origin = validateSettings(draft);
      if (!(await chrome.permissions.request({ origins: [origin] })))
        throw new Error("Provider access was not granted.");
      const value = {
        ...settings,
        selected: draft.kind,
        profiles: {
          ...settings.profiles,
          [draft.kind]: {
            ...draft,
            apiKey: draft.apiKey.trim(),
            model: draft.model.trim(),
            endpoint: draft.endpoint.replace(/\/$/, ""),
          },
        },
      };
      await navigator.locks.request(
        "agent-native-chat-turn",
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Chat is running in another sidebar. Stop it there before changing providers.",
            );
          if (JSON.stringify(await loadSettings()) !== JSON.stringify(settings))
            throw new Error(
              "AI settings changed in another sidebar. Reopen this sidebar before saving.",
            );
          await saveSettings(value);
          // Provider reasoning formats differ; start a fresh conversation on switch.
          if (
            profile.kind !== draft.kind ||
            profile.model !== draft.model ||
            profile.endpoint !== draft.endpoint
          ) {
            const chat = { ...newChat(), pinned: (await loadChat()).pinned };
            await saveChat(chat);
            update(chat);
          }
        },
      );
      setSettings(value);
      setDraft(value.profiles[value.selected]);
      setShowSettings(false);
      setStatus("Provider saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save provider settings.");
    } finally {
      setSaving(false);
    }
  }
  async function forgetKey() {
    setSaving(true);
    try {
      await navigator.locks.request(
        "agent-native-chat-turn",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("Chat is running in another sidebar.");
          const value = await loadSettings();
          value.profiles[draft.kind].apiKey = "";
          await saveSettings(value);
          setSettings(value);
          setDraft(value.profiles[draft.kind]);
        },
      );
      setStatus("API key removed from local storage.");
    } catch {
      setError("Could not remove the API key. Stop any chat running in another sidebar first.");
    } finally {
      setSaving(false);
    }
  }
  async function send(text = input) {
    if (running.current || !ready || !text.trim()) return;
    setError("");
    if (!hasProvider) {
      openSettings();
      return;
    }
    try {
      validateSettings(profile);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Configure a provider first.");
      setShowSettings(true);
      return;
    }
    running.current = true;
    setBusy(true);
    setInput("");
    const controller = new AbortController();
    abort.current = controller;
    const previous = current.current;
    const chat = structuredClone(previous);
    chat.running = true;
    if (!chat.task.goal) chat.task.goal = text.trim().slice(0, 4000);
    chat.messages.push({
      id: crypto.randomUUID(),
      role: "user",
      content: [{ type: "text", text: text.trim() }],
    });
    update(structuredClone(chat));
    let locked = false;
    try {
      // Extension-wide lock prevents two sidebar windows from editing the same
      // conversation or sending a user's action twice.
      await navigator.locks.request(
        "agent-native-chat-turn",
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Chat is running in another sidebar. Stop it there before sending here.",
            );
          const latest = await loadChat();
          if (JSON.stringify(latest) !== JSON.stringify(previous))
            throw new Error(
              "This sidebar has an older conversation. Reopen it to load the latest history before continuing.",
            );
          if (JSON.stringify(await loadSettings()) !== JSON.stringify(settings))
            throw new Error(
              "AI settings changed in another sidebar. Reopen this sidebar before sending.",
            );
          locked = true;
          try {
            await saveChat(chat);
            await runTurn(
              chat,
              profile,
              () => browserState.current,
              async (method, params) => {
                const pending = chrome.runtime.sendMessage({
                  channel: "browser-tools",
                  id: crypto.randomUUID(),
                  method,
                  params,
                });
                const response: ToolResponse | undefined = await new Promise((resolve, reject) => {
                  const stopped = () =>
                    reject(new Error("Action interrupted; its outcome may be unknown."));
                  controller.signal.addEventListener("abort", stopped, { once: true });
                  if (controller.signal.aborted) stopped();
                  pending
                    .then(resolve, reject)
                    .finally(() => controller.signal.removeEventListener("abort", stopped))
                    .catch(() => {});
                });
                if (!response) throw new Error("Browser transport disconnected.");
                return response;
              },
              controller.signal,
              { changed: (value) => setState(value), checkpoint: saveChat, status: setStatus },
            );
            setStatus("Done.");
          } finally {
            recoverInterrupted(chat);
            update(chat);
            await saveChat(chat).catch(() =>
              setError(
                "Chat history could not be saved. Keep this sidebar open to retain the current state.",
              ),
            );
          }
        },
      );
    } catch (error) {
      setError(
        controller.signal.aborted
          ? "Stopped. An in-flight browser action may have completed; inspect before repeating it."
          : error instanceof Error
            ? error.message
            : "Chat failed.",
      );
    } finally {
      if (!locked) update(previous);
      running.current = false;
      setBusy(false);
      abort.current = undefined;
    }
  }
  async function resetChat() {
    try {
      await navigator.locks.request(
        "agent-native-chat-turn",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error("Chat is running in another sidebar.");
          const chat = { ...newChat(), pinned: (await loadChat()).pinned };
          await saveChat(chat);
          update(chat);
          setError("");
          setStatus("New chat ready.");
        },
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not clear chat history.");
    }
  }

  if (showSettings)
    return (
      <section className="chat-panel" aria-label="Chat settings">
        <div className="chat-heading row">
          <div>
            <h2>Settings</h2>
            <p>
              {hasProvider
                ? "Your AI connection and preferences."
                : "Connect once, then start chatting."}
            </p>
          </div>
          <button
            className="quiet"
            disabled={saving}
            onClick={() => {
              discovery.current?.abort();
              setShowSettings(false);
              setError("");
            }}
          >
            ← Back to chat
          </button>
        </div>
        <section className="card chat-settings">
          <label htmlFor="chat-provider">AI provider</label>
          <select
            id="chat-provider"
            value={draft.kind}
            disabled={busy || loadingModels || saving}
            onChange={(event) => changeKind(event.target.value as ProviderKind)}
          >
            {Object.entries(providerDefaults).map(([id, value]) => (
              <option key={id} value={id}>
                {value.name}
              </option>
            ))}
          </select>
          {draft.kind === "compatible" && (
            <>
              <label htmlFor="chat-endpoint">Server address</label>
              <input
                id="chat-endpoint"
                type="url"
                value={draft.endpoint}
                disabled={busy || loadingModels || saving}
                onChange={(event) => {
                  setDraft({ ...draft, endpoint: event.target.value });
                  setModels([]);
                  setModelReady(false);
                }}
                placeholder="http://127.0.0.1:1234/v1"
              />
            </>
          )}
          <label htmlFor="chat-key">API key {draft.kind === "compatible" && "(optional)"}</label>
          <input
            id="chat-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft.apiKey}
            disabled={busy || loadingModels || saving}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            placeholder="Paste your API key"
          />
          <p>Saved on this device. Never synced to Chrome.</p>
          {!modelReady && !draft.model && (
            <button
              className="primary"
              disabled={busy || saving || loadingModels}
              onClick={() => void discover()}
            >
              {loadingModels ? "Connecting…" : "Continue →"}
            </button>
          )}
          {(modelReady || draft.model) && (
            <>
              <div className="row">
                <label htmlFor="chat-model-choice">Model</label>
                <button
                  className="quiet"
                  disabled={busy || saving || loadingModels}
                  onClick={() => void discover()}
                >
                  {loadingModels ? "Loading…" : "Refresh models"}
                </button>
              </div>
              {models.length > 0 ? (
                <select
                  id="chat-model-choice"
                  value={draft.model}
                  disabled={busy || saving || loadingModels}
                  onChange={(event) => selectModel(event.target.value)}
                >
                  <option value="">Choose a model…</option>
                  {draft.model && !models.some((model) => model.id === draft.model) && (
                    <option value={draft.model}>{draft.model}</option>
                  )}
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                      {model.tools === false ? " · text only" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="chat-model-choice"
                  value={draft.model}
                  disabled={busy || saving || loadingModels}
                  onChange={(event) =>
                    setDraft({ ...draft, model: event.target.value, tools: true, vision: false })
                  }
                  placeholder="Model ID from your server"
                  spellCheck={false}
                />
              )}
            </>
          )}
          <details className="chat-advanced">
            <summary>Advanced connection settings</summary>
            <label htmlFor="chat-model">Model ID</label>
            <input
              id="chat-model"
              value={draft.model}
              disabled={busy || saving || loadingModels}
              onChange={(event) =>
                setDraft({ ...draft, model: event.target.value, tools: true, vision: false })
              }
              placeholder="Enter a model ID manually"
              spellCheck={false}
            />
            <div className="model-capabilities">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.tools}
                  disabled={busy || saving}
                  onChange={(event) => setDraft({ ...draft, tools: event.target.checked })}
                />
                Allow browser actions
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.vision}
                  disabled={busy || saving}
                  onChange={(event) => setDraft({ ...draft, vision: event.target.checked })}
                />
                Use screenshots with a vision model
              </label>
            </div>
            <label htmlFor="chat-context">Model context window (tokens)</label>
            <input
              id="chat-context"
              type="number"
              min={4096}
              max={4000000}
              value={draft.context}
              disabled={busy || saving}
              onChange={(event) => setDraft({ ...draft, context: Number(event.target.value) })}
            />
            <p>
              Capabilities are filled from model discovery when available. Enable screenshots only
              for a vision model; unsupported browser actions are rejected by the provider.
            </p>
            <button
              className="quiet"
              disabled={busy || saving || loadingModels}
              onClick={() => void forgetKey()}
            >
              Remove saved API key
            </button>
          </details>
          {error && (
            <div className="chat-error" role="alert">
              {error}
            </div>
          )}
          {draft.model && (
            <>
              {hasProvider &&
                (profile.kind !== draft.kind ||
                  profile.model !== draft.model ||
                  profile.endpoint !== draft.endpoint) && (
                  <p>Changing your provider or model starts a new conversation.</p>
                )}
              <button
                className="primary"
                disabled={busy || saving || loadingModels}
                onClick={() => void storeProvider()}
              >
                {saving ? "Saving…" : hasProvider ? "Save changes" : "Start chatting →"}
              </button>
            </>
          )}
        </section>
        <details className="chat-memory">
          <summary>
            Instructions & chat memory{" "}
            <span>
              {Math.round(contextTokens(state, browser) / 1000)}K estimated · compact at{" "}
              {Math.round(compactionThreshold(profile.context) / 1000)}K
            </span>
          </summary>
          <label htmlFor="chat-pinned">Instructions to keep throughout this chat</label>
          <textarea
            id="chat-pinned"
            rows={3}
            maxLength={4000}
            value={state.pinned}
            disabled={busy || !ready}
            onChange={(event) => update({ ...current.current, pinned: event.target.value })}
            onBlur={() =>
              void navigator.locks
                .request("agent-native-chat-turn", { ifAvailable: true }, async (lock) => {
                  if (!lock) throw new Error("Chat is running in another sidebar.");
                  const latest = await loadChat();
                  latest.pinned = current.current.pinned;
                  await saveChat(latest);
                  update(latest);
                })
                .catch(() =>
                  setError("Could not save pinned instructions while another chat is running."),
                )
            }
            placeholder="Your preferences and constraints…"
          />
          {state.task.goal && (
            <p>
              <strong>Goal:</strong> {state.task.goal}
            </p>
          )}
          {[
            ...state.task.facts,
            ...state.task.decisions,
            ...state.task.urls,
            ...state.task.artifacts,
          ].map((value, index) => (
            <p key={index}>{value}</p>
          ))}
          {state.summary.map((value, index) => (
            <p key={`summary-${index}`}>{value}</p>
          ))}
          <p>
            128K logical context. Recent turns remain verbatim; older history is compacted into task
            state and chronological notes.{" "}
            {state.compactions > 0 && `${state.compactions} compaction(s).`}
          </p>
          {state.usage && (
            <p>
              Last provider usage: {state.usage.input.toLocaleString()} input /{" "}
              {state.usage.output.toLocaleString()} output tokens. Total response tokens:{" "}
              {state.totalOutput.toLocaleString()}.
            </p>
          )}
        </details>
      </section>
    );

  return (
    <section className="chat-panel" aria-label="AI chat">
      <div className="chat-heading row">
        <div>
          <h2>Chat</h2>
          {hasProvider && <p>{providerDefaults[profile.kind].name}</p>}
        </div>
        <div className="chat-heading-actions">
          {(hasProvider || state.messages.length > 0) && (
            <button className="quiet" disabled={busy || !ready} onClick={openSettings}>
              Settings
            </button>
          )}
          {state.messages.length > 0 && (
            <button className="quiet" disabled={busy || !ready} onClick={() => void resetChat()}>
              New chat
            </button>
          )}
        </div>
      </div>
      <div className="chat-current-tab" title={tab?.url}>
        <span>Current tab</span>
        <strong>{tab?.title ?? "No active tab"}</strong>
      </div>
      <div className="chat-messages" aria-label="Conversation" aria-live="off">
        {!state.messages.length && (
          <div className="chat-empty">
            <span className="chat-spark">✦</span>
            <h2>What can I help with?</h2>
            <p>
              {hasProvider
                ? "Ask about this page, or give me a browser task."
                : "Connect your AI, then ask about any page."}
            </p>
            {hasProvider ? (
              <div className="chat-starters">
                {["Summarize my active tab", "Find a tab for me"].map((prompt) => (
                  <button key={prompt} disabled={busy || !ready} onClick={() => void send(prompt)}>
                    {prompt} ↗
                  </button>
                ))}
              </div>
            ) : (
              <button className="primary chat-connect" disabled={!ready} onClick={openSettings}>
                Connect AI →
              </button>
            )}
          </div>
        )}
        {state.compactions > 0 && (
          <p className="compaction-note">
            Earlier conversation is saved in Settings → Chat memory.
          </p>
        )}
        {state.messages.map((message) =>
          message.role === "tool" ? (
            <details key={message.id} className={`chat-tool ${message.error ? "failed" : ""}`}>
              <summary>
                <span>{message.error ? "!" : "✓"}</span> {message.name?.replace(/^browser_/, "")}
              </summary>
              {message.content.map((content, index) =>
                content.type === "image" ? (
                  <img
                    key={index}
                    src={`data:${content.mimeType};base64,${content.data}`}
                    alt="Screenshot returned to the chat model"
                  />
                ) : (
                  <pre key={index}>{content.text}</pre>
                ),
              )}
            </details>
          ) : (
            <article key={message.id} className={`chat-message ${message.role}`}>
              <span className="chat-role">
                {message.role === "user" ? "You" : "Assistant"}
                {message.interrupted ? " · interrupted" : ""}
              </span>
              <div className="chat-text">
                {message.role === "assistant" ? (
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    skipHtml
                    components={{
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {children}
                        </a>
                      ),
                      img: ({ alt }) => <span>[Image link omitted: {alt || "image"}]</span>,
                    }}
                  >
                    {textOf(message) || (message.calls?.length ? "Inspecting your browser…" : "…")}
                  </Markdown>
                ) : (
                  textOf(message)
                )}
              </div>
              {message.calls?.map((call) => (
                <span className="chat-call" key={call.id}>
                  {call.name.replace(/^browser_/, "")}
                </span>
              ))}
            </article>
          ),
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <div className="chat-error" role="alert">
          {error}
        </div>
      )}
      <form
        className="chat-composer card"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Message your browser assistant
        </label>
        <textarea
          id="chat-input"
          rows={3}
          maxLength={100000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={busy || !ready}
          placeholder="Ask about a page, or give me a task…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="row">
          <span role="status">{busy ? status : "Enter to send · Shift+Enter for a new line"}</span>
          {busy ? (
            <button
              type="button"
              onClick={() => {
                setStatus("Stopping…");
                abort.current?.abort();
              }}
            >
              Stop
            </button>
          ) : (
            <button className="primary" disabled={!ready || !input.trim()} type="submit">
              {hasProvider ? "Send ↑" : "Connect AI"}
            </button>
          )}
        </div>
      </form>
      <p className="chat-disclosure">
        {hasProvider
          ? `Chat and requested page content go to ${providerDefaults[profile.kind].name}.`
          : "Your browser session stays in Chrome. You choose the AI provider."}
      </p>
    </section>
  );
}
