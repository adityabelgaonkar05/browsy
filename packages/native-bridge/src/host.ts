import { createServer } from "node:net";
import type { Socket } from "node:net";
import { mkdir, chmod, lstat, open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  isToolName,
  isToolResponse,
} from "@agent-native/shared";
import type { ToolResponse, ErrorCode } from "@agent-native/shared";
import { FrameDecoder, writeFrame } from "./framing";
import { bridgePaths } from "./paths";

interface Pending {
  socket: Socket;
  id: string;
  timer: ReturnType<typeof setTimeout>;
}

async function claimLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
      } catch (error) {
        await unlink(path).catch(() => {});
        throw error;
      } finally {
        await handle.close();
      }
      return async () => {
        await unlink(path).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let pid: number;
      try {
        pid = JSON.parse(await readFile(path, "utf8")).pid;
      } catch {
        throw new Error(
          "Bridge lock is being initialized or is invalid. Retry, or inspect it with agent-native doctor.",
        );
      }
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Invalid bridge lock. Inspect it with agent-native doctor.");
      try {
        process.kill(pid, 0);
        throw new Error(
          "Another Chrome profile already owns this bridge. Use one profile at a time.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
      await unlink(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  throw new Error("Unable to acquire bridge lock.");
}

export async function startNativeHost(options: {
  home?: string;
  extensionId: string;
  origin: string;
  input?: Readable;
  output?: Writable;
  requestTimeout?: number;
}) {
  if (options.origin !== `chrome-extension://${options.extensionId}/`)
    throw new Error("Native host caller does not match the registered extension.");
  const paths = bridgePaths(options.home);
  await mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const directory = await lstat(paths.directory);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Bridge home must be a real directory.");
  await chmod(paths.directory, 0o700);
  const unlock = await claimLock(paths.lock);
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const clients = new Set<Socket>();
  const pending = new Map<string, Pending>();
  let connected = false;
  let stopped = false;
  let ownsSocket = false;
  let stopPromise: Promise<void> | undefined;
  const requestTimeout = options.requestTimeout ?? 45_000;

  function respond(socket: Socket, response: ToolResponse) {
    try {
      writeFrame(socket, response, MAX_RESPONSE_BYTES);
    } catch {
      socket.destroy();
    }
  }
  function fail(socket: Socket, id: string, code: ErrorCode, message: string) {
    respond(socket, { id, error: { code, message } });
  }

  const server = createServer((socket) => {
    if (clients.size >= 16) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      clients.delete(socket);
      for (const [key, work] of pending) {
        if (work.socket === socket) {
          clearTimeout(work.timer);
          pending.delete(key);
        }
      }
    });
    const decoder = new FrameDecoder(MAX_REQUEST_BYTES, (input) => {
      const request = input as { id?: unknown; method?: unknown; params?: unknown };
      if (!request || typeof request.id !== "string" || !request.id || request.id.length > 100) {
        socket.destroy();
        return;
      }
      const id = request.id;
      if (request.method === "bridge.ping") {
        respond(socket, {
          id,
          result: {
            connected,
            version: BRIDGE_PROTOCOL_VERSION,
            extensionId: options.extensionId,
            pid: process.pid,
          },
        });
        return;
      }
      if (!isToolName(request.method)) {
        fail(socket, id, "UNKNOWN_TOOL", "Unknown browser tool.");
        return;
      }
      if (!connected) {
        fail(
          socket,
          id,
          "BRIDGE_UNAVAILABLE",
          "Chrome extension is not ready. Reload it and run agent-native doctor.",
        );
        return;
      }
      if (pending.size >= 64) {
        fail(socket, id, "BUSY", "Too many outstanding browser requests.");
        return;
      }
      const forwardedId = randomUUID();
      const timer = setTimeout(() => {
        pending.delete(forwardedId);
        fail(
          socket,
          id,
          "TIMEOUT",
          "Browser request timed out. Its outcome may be unknown; inspect the page before retrying.",
        );
      }, requestTimeout);
      pending.set(forwardedId, { socket, id, timer });
      try {
        writeFrame(
          output,
          {
            channel: "browser-tools",
            id: forwardedId,
            method: request.method,
            params: request.params,
          },
          MAX_REQUEST_BYTES,
        );
      } catch {
        clearTimeout(timer);
        pending.delete(forwardedId);
        fail(socket, id, "MESSAGE_TOO_LARGE", "Request cannot be sent through Native Messaging.");
      }
    });
    socket.on("data", (chunk) => {
      try {
        decoder.push(chunk);
      } catch {
        socket.destroy();
      }
    });
  });

  async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      stopped = true;
      clearTimeout(handshakeTimer);
      input.off("data", receive);
      input.pause();
      for (const work of pending.values()) clearTimeout(work.timer);
      pending.clear();
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (ownsSocket) await unlink(paths.socket).catch(() => {});
      await unlock();
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
    })();
    return stopPromise;
  }
  function onSignal() {
    void stop();
  }
  const decoder = new FrameDecoder(MAX_RESPONSE_BYTES, (value) => {
    const message = value as { kind?: string; version?: number; extensionId?: string; id?: string };
    if (!connected) {
      if (
        message?.kind !== "bridge.hello" ||
        message.version !== BRIDGE_PROTOCOL_VERSION ||
        message.extensionId !== options.extensionId
      )
        throw new Error("Incompatible extension handshake.");
      connected = true;
      clearTimeout(handshakeTimer);
      writeFrame(
        output,
        { kind: "bridge.ready", version: BRIDGE_PROTOCOL_VERSION },
        MAX_REQUEST_BYTES,
      );
      return;
    }
    if (!isToolResponse(value)) throw new Error("Malformed extension response.");
    const work = pending.get(value.id);
    if (!work) return;
    clearTimeout(work.timer);
    pending.delete(value.id);
    respond(work.socket, { ...value, id: work.id });
  });
  function receive(chunk: Buffer) {
    try {
      decoder.push(chunk);
    } catch {
      process.stderr.write("Invalid Native Messaging frame; disconnecting.\n");
      void stop();
    }
  }
  const handshakeTimer = setTimeout(() => {
    process.stderr.write("Extension handshake timed out.\n");
    void stop();
  }, 10_000);

  try {
    // The exclusive lock owns cleanup. Never replace an arbitrary file at the socket path.
    const existing = await lstat(paths.socket).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (existing) {
      if (!existing.isSocket())
        throw new Error("A non-socket file exists at the bridge socket path.");
      await unlink(paths.socket);
    }
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.socket, resolve);
    });
    ownsSocket = true;
    await chmod(paths.socket, 0o600);
    server.on("error", () => {
      void stop();
    });
    input.on("data", receive);
    input.once("end", () => {
      void stop();
    });
    input.once("error", () => {
      void stop();
    });
    output.once("error", () => {
      void stop();
    });
    process.on("SIGTERM", onSignal);
    process.on("SIGINT", onSignal);
    if (stopped) await stop();
    return { stop, paths };
  } catch (error) {
    await stop();
    throw error;
  }
}
