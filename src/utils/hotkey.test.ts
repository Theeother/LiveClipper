import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, type KeyEventLike } from "./hotkey";

const ev = (code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("acceleratorFromEvent", () => {
  it("accepts F-keys alone", () => {
    expect(acceleratorFromEvent(ev("F8"))).toEqual({ kind: "ok", accelerator: "F8" });
    expect(acceleratorFromEvent(ev("F13"))).toEqual({ kind: "ok", accelerator: "F13" });
  });
  it("builds modifier combos in a stable order", () => {
    expect(acceleratorFromEvent(ev("KeyM", { shiftKey: true, ctrlKey: true }))).toEqual({ kind: "ok", accelerator: "Ctrl+Shift+M" });
    expect(acceleratorFromEvent(ev("Digit1", { altKey: true }))).toEqual({ kind: "ok", accelerator: "Alt+1" });
  });
  it("rejects bare letters so typing isn't hijacked", () => {
    expect(acceleratorFromEvent(ev("KeyA")).kind).toBe("invalid");
  });
  it("waits while only modifiers are held", () => {
    expect(acceleratorFromEvent(ev("ShiftLeft", { shiftKey: true }))).toEqual({ kind: "incomplete" });
  });
});
