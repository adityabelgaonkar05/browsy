import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { NATIVE_HOST_NAME } from "@agent-native/shared";
import { createHash } from "node:crypto";

export function bridgePaths(home = join(homedir(), ".agent-native")) {
  const directory = resolve(home);
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\agent-native-${createHash("sha256").update(directory.toLowerCase()).digest("hex")}`
      : join(directory, "browser.sock");
  // macOS sockaddr_un.sun_path is 104 bytes including its terminating null.
  if (
    process.platform !== "win32" &&
    Buffer.byteLength(socket) > (process.platform === "darwin" ? 103 : 107)
  )
    throw new Error(
      "Bridge directory is too long for a Unix socket. Use --home with a shorter absolute path.",
    );
  return {
    directory,
    socket,
    lock: join(directory, "bridge.lock"),
    config: join(directory, "config.json"),
    launcher: join(directory, process.platform === "win32" ? "native-host.cmd" : "native-host"),
  };
}

export function nativeManifestPath(
  browser: "chrome" | "chrome-for-testing" | "chromium" = "chrome",
) {
  if (process.platform === "linux")
    return join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      browser === "chromium"
        ? "chromium"
        : browser === "chrome-for-testing"
          ? "google-chrome-for-testing"
          : "google-chrome",
      "NativeMessagingHosts",
      `${NATIVE_HOST_NAME}.json`,
    );
  if (process.platform === "win32")
    return join(bridgePaths().directory, `${NATIVE_HOST_NAME}.json`);
  if (process.platform !== "darwin")
    throw new Error("Supported platforms are macOS, Linux, and Windows.");
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
