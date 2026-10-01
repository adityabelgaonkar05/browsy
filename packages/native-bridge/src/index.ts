export { BridgeClient } from "./client";
export { startNativeHost } from "./host";
export { bridgePaths, nativeManifestPath } from "./paths";
export { FrameDecoder, encodeFrame } from "./framing";

export {
  protectDirectory,
  directoryIsPrivate,
  pipeIsPrivate,
  registryKey,
  registeredManifest,
  registerManifest,
  unregisterManifest,
} from "./windows";
