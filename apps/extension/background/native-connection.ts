import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_RESPONSE_BYTES,
  NATIVE_HOST_NAME,
} from "@agent-native/shared";
import type { BrowserController, NativeConnectionStatus } from "@agent-native/shared";
import { dispatchTool } from "../browser-tools/dispatcher";

const RETRY_ALARM = "native-bridge-reconnect";

export class NativeConnection {
  private port?: chrome.runtime.Port;
  private timer?: ReturnType<typeof setTimeout>;
  private delay = 1_000;
  private status: NativeConnectionStatus = { connected: false, host: NATIVE_HOST_NAME };

  constructor(private controller: BrowserController) {
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === RETRY_ALARM) this.connect();
    });
    // Alarms survive service worker suspension when the host is not installed yet.
    void chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
    this.connect();
  }

  getStatus() {
    return { ...this.status };
  }

  reconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.delay = 1_000;
    if (!this.port) this.connect();
    return this.getStatus();
  }

  private connect() {
    if (this.port) return;
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.port = port;
      port.onMessage.addListener((message) => {
        if (message?.kind === "bridge.ready" && message.version === BRIDGE_PROTOCOL_VERSION) {
          this.status = { connected: true, host: NATIVE_HOST_NAME };
          this.delay = 1_000;
          return;
        }
        if (message?.channel !== "browser-tools") return;
        void dispatchTool(this.controller, message).then((response) => {
          // Never send an old connection's response through a new host.
          if (this.port !== port) return;
          const payload = JSON.stringify(response);
          const outbound =
            new TextEncoder().encode(payload).byteLength > MAX_RESPONSE_BYTES
              ? {
                  id: response.id,
                  error: {
                    code: "MESSAGE_TOO_LARGE",
                    message:
                      "Result exceeds Chrome's Native Messaging response limit. Request less HTML or a smaller viewport.",
                  },
                }
              : response;
          try {
            port.postMessage(outbound);
          } catch {
            /* onDisconnect schedules reconnect */
          }
        });
      });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message ?? "Native host disconnected.";
        if (this.port !== port) return;
        this.port = undefined;
        this.status = { connected: false, host: NATIVE_HOST_NAME, error };
        this.scheduleRetry();
      });
      port.postMessage({
        kind: "bridge.hello",
        version: BRIDGE_PROTOCOL_VERSION,
        extensionId: chrome.runtime.id,
      });
    } catch (error) {
      this.port = undefined;
      this.status = {
        connected: false,
        host: NATIVE_HOST_NAME,
        error: error instanceof Error ? error.message : "Native host unavailable.",
      };
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 30_000);
  }
}
