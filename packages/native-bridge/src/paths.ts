import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { NATIVE_HOST_NAME } from "@agent-native/shared";

export function bridgePaths(home = join(homedir(), ".agent-native")) {
  const directory = resolve(home);
  const socket = join(directory, "browser.sock");
  // macOS sockaddr_un.sun_path is 104 bytes including its terminating null.
  if (Buffer.byteLength(socket) > 103)
    throw new Error(
      "Bridge directory is too long for a Unix socket. Use --home with a shorter absolute path.",
    );
  return {
    directory,
    socket,
    lock: join(directory, "bridge.lock"),
    config: join(directory, "config.json"),
    launcher: join(directory, "native-host"),
  };
}

export function nativeManifestPath(
  browser: "chrome" | "chrome-for-testing" | "chromium" = "chrome",
) {
  if (process.platform !== "darwin")
    throw new Error("Native host registration currently supports macOS only.");
  const directory =
    browser === "chromium"
      ? "Chromium"
      : `Google/${browser === "chrome" ? "Chrome" : "ChromeForTesting"}`;
  return join(
    homedir(),
    "Library",
    "Application Support",
    directory,
    "NativeMessagingHosts",
    `${NATIVE_HOST_NAME}.json`,
  );
}
