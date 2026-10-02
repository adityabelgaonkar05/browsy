import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import {
  BrowserError,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  isToolResponse,
} from "@agent-native/shared";
import type { ToolResponse, BridgeStatus } from "@agent-native/shared";
import { FrameDecoder, encodeFrame } from "./framing";
import { bridgePaths } from "./paths";

interface Pending {
  socket: Socket;
  resolve: (response: ToolResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class BridgeClient {
  private socket?: Socket;
  private connecting?: Promise<Socket>;
  private pending = new Map<string, Pending>();
  private closed = false;

  constructor(
    private path = bridgePaths().socket,
    private connectTimeout = 5_000,
    private requestTimeout = 45_000,
  ) {}

  private async connect(): Promise<Socket> {
    if (this.closed) throw new BrowserError("BRIDGE_DISCONNECTED", "Bridge client is closed.");
    if (this.socket && !this.socket.destroyed) return this.socket;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectWithRetry();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connectWithRetry(): Promise<Socket> {
    const deadline = Date.now() + this.connectTimeout;
    do {
      if (this.closed) throw new BrowserError("BRIDGE_DISCONNECTED", "Bridge client is closed.");
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const candidate = createConnection(this.path);
          candidate.setTimeout(Math.min(1_000, Math.max(1, deadline - Date.now())), () =>
            candidate.destroy(new Error("Socket connection timed out.")),
          );
          const failed = (error: Error) => {
            candidate.destroy();
            reject(error);
          };
          candidate.once("error", failed);
          candidate.once("connect", () => {
            candidate.off("error", failed);
            candidate.setTimeout(0);
            resolve(candidate);
          });
        });
        if (this.closed) {
          socket.destroy();
          throw new Error("Client closed.");
        }
        this.socket = socket;
        const decoder = new FrameDecoder(MAX_RESPONSE_BYTES, (value) => {
          if (!isToolResponse(value)) throw new Error("Malformed bridge response.");
          const response = value;
          const pending = this.pending.get(response.id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          pending.resolve(response);
        });
        socket.on("data", (chunk) => {
          try {
            decoder.push(chunk);
          } catch {
            socket.destroy(new Error("Malformed bridge frame."));
          }
        });
        socket.on("error", () => {
          /* close handles pending work */
        });
        socket.on("close", () => {
          if (this.socket === socket) this.socket = undefined;
          for (const [id, pending] of this.pending) {
            if (pending.socket !== socket) continue;
            clearTimeout(pending.timer);
            pending.reject(
              new BrowserError(
                "BRIDGE_DISCONNECTED",
                "Chrome disconnected. The action's outcome may be unknown; inspect the page before retrying.",
              ),
            );
            this.pending.delete(id);
          }
        });
        return socket;
      } catch {
        if (Date.now() >= deadline) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(200, Math.max(0, deadline - Date.now()))),
        );
      }
    } while (Date.now() < deadline);
    throw new BrowserError(
      "BRIDGE_UNAVAILABLE",
      "Browser bridge is unavailable. Open Chrome, load/reload Browsy, and run browsy doctor.",
    );
  }

  async request(method: string, params: Record<string, unknown> = {}): Promise<ToolResponse> {
    const id = randomUUID();
    let frame: Buffer;
    try {
      frame = encodeFrame({ channel: "browser-tools", id, method, params }, MAX_REQUEST_BYTES);
    } catch {
      throw new BrowserError(
        "MESSAGE_TOO_LARGE",
        "Request exceeds Chrome's Native Messaging request limit.",
      );
    }
    const socket = await this.connect();
    if (this.closed || socket.destroyed || this.socket !== socket)
      throw new BrowserError(
        "BRIDGE_DISCONNECTED",
        "Bridge disconnected before the request was sent. Retry when Chrome reconnects.",
      );
    if (this.pending.size >= 64)
      throw new BrowserError("BUSY", "Too many outstanding browser requests.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BrowserError(
            "TIMEOUT",
            "Browser request timed out. Its outcome may be unknown; inspect the page before retrying.",
          ),
        );
      }, this.requestTimeout);
      this.pending.set(id, { socket, resolve, reject, timer });
      socket.write(frame, (error) => {
        if (error) socket.destroy(error);
      });
    });
  }

  async status(): Promise<BridgeStatus> {
    const response = await this.request("bridge.ping");
    if ("error" in response) throw new BrowserError(response.error.code, response.error.message);
    return response.result as BridgeStatus;
  }

  close() {
    this.closed = true;
    this.socket?.destroy();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BrowserError("BRIDGE_DISCONNECTED", "Bridge client closed."));
    }
    this.pending.clear();
  }
}
