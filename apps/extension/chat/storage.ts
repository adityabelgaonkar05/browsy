import { defaultSettings } from "../providers/types";
import type { ProviderKind, ProviderSettings } from "../providers/types";
import { newChat } from "./context";
import type { ChatState } from "./context";

export interface ChatSettings {
  selected: ProviderKind;
  profiles: Record<ProviderKind, ProviderSettings>;
}
export function defaultChatSettings(): ChatSettings {
  return {
    selected: "openrouter",
    profiles: {
      openrouter: defaultSettings("openrouter"),
      openai: defaultSettings("openai"),
      anthropic: defaultSettings("anthropic"),
      compatible: defaultSettings("compatible"),
    },
  };
}
export async function loadSettings(): Promise<ChatSettings> {
  const result = await chrome.storage.local.get("chatSettings");
  const stored = result.chatSettings as Partial<ChatSettings> | undefined;
  if (!stored?.profiles) return defaultChatSettings();
  const defaults = defaultChatSettings();
  for (const kind of Object.keys(defaults.profiles) as ProviderKind[]) {
    defaults.profiles[kind] = { ...defaults.profiles[kind], ...stored.profiles[kind], kind };
  }
  if (stored.selected && Object.hasOwn(defaults.profiles, stored.selected))
    defaults.selected = stored.selected;
  return defaults;
}
export async function saveSettings(settings: ChatSettings) {
  await chrome.storage.local.set({ chatSettings: settings });
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("agent-native-chat", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("chat");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open local chat storage."));
  });
}
export async function loadChat(): Promise<ChatState> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("chat").objectStore("chat").get("current");
      request.onsuccess = () =>
        resolve(request.result?.version === 1 ? (request.result as ChatState) : newChat());
      request.onerror = () => reject(new Error("Could not load local chat history."));
    });
  } finally {
    db.close();
  }
}
export async function saveChat(state: ChatState) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("chat", "readwrite");
      transaction.objectStore("chat").put(state, "current");
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () =>
        reject(new Error("Could not save local chat history."));
    });
  } finally {
    db.close();
  }
}
