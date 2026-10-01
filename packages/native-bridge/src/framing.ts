import type { Writable } from "node:stream";

// Both local transports use length-prefixed UTF-8 JSON. macOS uses little endian.
export class FrameDecoder {
  private header = Buffer.alloc(4);
  private headerBytes = 0;
  private payload?: Buffer;
  private payloadBytes = 0;

  constructor(
    private maxBytes: number,
    private receive: (message: unknown) => void,
  ) {}

  push(chunk: Buffer) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.payload) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        offset += count;
        this.headerBytes += count;
        if (this.headerBytes < 4) continue;
        const length = this.header.readUInt32LE(0);
        if (!length || length > this.maxBytes) throw new Error("Invalid or oversized JSON frame.");
        this.payload = Buffer.allocUnsafe(length);
        this.payloadBytes = 0;
      }
      const count = Math.min(this.payload.length - this.payloadBytes, chunk.length - offset);
      chunk.copy(this.payload, this.payloadBytes, offset, offset + count);
      offset += count;
      this.payloadBytes += count;
      if (this.payloadBytes === this.payload.length) {
        const payload = this.payload;
        this.payload = undefined;
        this.headerBytes = 0;
        this.receive(JSON.parse(payload.toString("utf8")));
      }
    }
  }

  finish() {
    if (this.headerBytes || this.payload) throw new Error("Truncated JSON frame.");
  }
}

export function encodeFrame(message: unknown, maxBytes: number): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (!body.length || body.length > maxBytes)
    throw new Error("Message exceeds transport size limit.");
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

export function writeFrame(stream: Writable, message: unknown, maxBytes: number) {
  if (stream.destroyed || stream.writableEnded) throw new Error("Transport is closed.");
  stream.write(encodeFrame(message, maxBytes));
}
