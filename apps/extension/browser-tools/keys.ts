import { BrowserError } from "@agent-native/shared";

const named: Record<string, [string, string, number]> = {
  Enter: ["Enter", "Enter", 13], Tab: ["Tab", "Tab", 9], Escape: ["Escape", "Escape", 27],
  Backspace: ["Backspace", "Backspace", 8], Delete: ["Delete", "Delete", 46],
  ArrowUp: ["ArrowUp", "ArrowUp", 38], ArrowDown: ["ArrowDown", "ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowRight: ["ArrowRight", "ArrowRight", 39],
  Home: ["Home", "Home", 36], End: ["End", "End", 35], PageUp: ["PageUp", "PageUp", 33],
  PageDown: ["PageDown", "PageDown", 34], Space: [" ", "Space", 32],
};

export function keyEvent(input: string): Record<string, unknown> {
  const parts = input.split("+");
  const last = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const flag = ({ alt: 1, control: 2, ctrl: 2, shift: 4, meta: 8, cmd: 8, command: 8 } as Record<string, number>)[part.toLowerCase()];
    if (flag === undefined) throw new BrowserError("INVALID_PARAMS", `Unknown keyboard modifier: ${part}`);
    modifiers |= flag;
  }
  if (named[last]) {
    const [key, code, windowsVirtualKeyCode] = named[last];
    const text = last === "Enter" ? "\r" : last === "Space" ? " " : undefined;
    return { key, code, windowsVirtualKeyCode, modifiers, ...(text !== undefined && !(modifiers & 11) ? { text } : {}) };
  }
  if (/^[a-zA-Z0-9]$/.test(last)) {
    const key = modifiers & 4 ? last.toUpperCase() : last;
    return {
      key, code: /^[0-9]$/.test(last) ? `Digit${last}` : `Key${last.toUpperCase()}`,
      windowsVirtualKeyCode: last.toUpperCase().charCodeAt(0), modifiers,
      ...(!(modifiers & 11) ? { text: key } : {}),
    };
  }
  throw new BrowserError("INVALID_PARAMS", "Use Enter, Tab, Escape, arrows, Backspace, Delete, Home/End, PageUp/PageDown, Space, or an alphanumeric key with Ctrl/Alt/Shift/Meta modifiers.");
}
