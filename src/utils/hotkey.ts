// Convert a DOM keyboard event into a Tauri global-shortcut accelerator ("Ctrl+Shift+M", "F8").

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type AcceleratorResult =
  | { kind: "ok"; accelerator: string }
  | { kind: "incomplete" }
  | { kind: "invalid"; reason: string };

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** Keys that are safe to bind without modifiers. */
const STANDALONE = /^(F([1-9]|1[0-9]|2[0-4])|Pause|ScrollLock|PrintScreen|Insert|Numpad[0-9]|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal)$/;

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad/.test(code)) return code;
  const allowed = ["Space", "Insert", "Delete", "Home", "End", "PageUp", "PageDown", "Pause", "ScrollLock", "PrintScreen",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backquote", "Minus", "Equal", "BracketLeft", "BracketRight",
    "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash"];
  return allowed.includes(code) ? code : null;
}

export function acceleratorFromEvent(e: KeyEventLike): AcceleratorResult {
  if (MODIFIER_CODES.has(e.code)) return { kind: "incomplete" };
  const key = keyName(e.code);
  if (!key) return { kind: "invalid", reason: `"${e.code}" can't be used as a hotkey.` };
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  if (mods.length === 0 && !STANDALONE.test(key)) {
    return { kind: "invalid", reason: `Add a modifier (Ctrl / Alt / Shift) to "${key}", or use an F-key.` };
  }
  return { kind: "ok", accelerator: [...mods, key].join("+") };
}
