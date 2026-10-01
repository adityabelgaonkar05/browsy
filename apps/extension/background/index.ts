import { ChromeBrowserController } from "../browser-tools/chrome-controller";
import { dispatchTool } from "../browser-tools/dispatcher";
import { NativeConnection } from "./native-connection";

// Keys are local and available only to trusted extension contexts.
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {});

const controller = new ChromeBrowserController();
const native = new NativeConnection(controller);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension UI can access this transport. No content-script or external route.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  if (message?.channel === "bridge-status") {
    sendResponse(message.reconnect ? native.reconnect() : native.getStatus());
    return;
  }
  if (message?.channel !== "browser-tools") return;
  void dispatchTool(controller, message).then(sendResponse);
  return true;
});

function configurePanel() {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
}
chrome.runtime.onInstalled.addListener(configurePanel);
chrome.runtime.onStartup.addListener(configurePanel);
configurePanel();
