import { describe, expect, it } from "vitest";
import {
  actionForKey,
  clampRange,
  ensureVisible,
  fromFraction,
  setEnd,
  setStart,
  tickStep,
  timelineWindow,
  toPercent,
  type KeyLike,
} from "./clipMath";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("clampRange", () => {
  it("clamps start to 0 and end to duration", () => {
    expect(clampRange(-20, 40, 7200)).toEqual({ start: 0, end: 40 });
    expect(clampRange(7160, 7220, 7200)).toEqual({ start: 7160, end: 7200 });
  });
  it("swaps inverted ranges and enforces a minimum length", () => {
    expect(clampRange(50, 20)).toEqual({ start: 20, end: 50 });
    expect(clampRange(10, 10)).toEqual({ start: 10, end: 10.5 });
    expect(clampRange(100, 100, 100)).toEqual({ start: 99.5, end: 100 });
  });
});

describe("handles", () => {
  const r = { start: 100, end: 160 };
  it("start cannot cross end", () => {
    expect(setStart(r, 200)).toEqual({ start: 159.5, end: 160 });
    expect(setStart(r, -5)).toEqual({ start: 0, end: 160 });
  });
  it("end cannot cross start or exceed duration", () => {
    expect(setEnd(r, 50)).toEqual({ start: 100, end: 100.5 });
    expect(setEnd(r, 9999, 7200)).toEqual({ start: 100, end: 7200 });
  });
});

describe("timeline window", () => {
  it("pads around the clip", () => {
    expect(timelineWindow({ start: 100, end: 160 }, 30)).toEqual({ start: 70, end: 190 });
  });
  it("shifts instead of going below zero or past the end", () => {
    expect(timelineWindow({ start: 0, end: 40 }, 30, 7200)).toEqual({ start: 0, end: 100 });
    expect(timelineWindow({ start: 7160, end: 7200 }, 30, 7200)).toEqual({ start: 7100, end: 7200 });
  });
  it("ensureVisible scrolls to include points", () => {
    const win = { start: 70, end: 190 };
    expect(ensureVisible(win, [100, 150])).toBe(win);
    const moved = ensureVisible(win, [200]);
    expect(moved.end).toBeGreaterThanOrEqual(200);
    expect(moved.end - moved.start).toBeCloseTo(120);
  });
  it("converts between time and position", () => {
    const win = { start: 100, end: 200 };
    expect(toPercent(150, win)).toBe(50);
    expect(fromFraction(0.25, win)).toBe(125);
    expect(fromFraction(2, win)).toBe(200);
  });
  it("picks readable tick steps", () => {
    expect(tickStep(120)).toBe(10);
    expect(tickStep(20)).toBe(2);
    expect(tickStep(660)).toBe(60);
  });
});

describe("keyboard map", () => {
  it("maps the documented shortcuts", () => {
    expect(actionForKey(key(" "))).toEqual({ type: "togglePlay" });
    expect(actionForKey(key("ArrowLeft"))).toEqual({ type: "seekBy", delta: -1 });
    expect(actionForKey(key("ArrowRight"))).toEqual({ type: "seekBy", delta: 1 });
    expect(actionForKey(key("ArrowLeft", { shiftKey: true }))).toEqual({ type: "startBy", delta: -1 });
    expect(actionForKey(key("ArrowRight", { shiftKey: true }))).toEqual({ type: "startBy", delta: 1 });
    expect(actionForKey(key("ArrowLeft", { ctrlKey: true }))).toEqual({ type: "endBy", delta: -1 });
    expect(actionForKey(key("ArrowRight", { ctrlKey: true }))).toEqual({ type: "endBy", delta: 1 });
    expect(actionForKey(key("i"))).toEqual({ type: "setStartHere" });
    expect(actionForKey(key("O", { shiftKey: true }))).toEqual({ type: "setEndHere" });
    expect(actionForKey(key("e"))).toEqual({ type: "export" });
  });
  it("alt gives fine-grained steps", () => {
    expect(actionForKey(key("ArrowRight", { altKey: true, shiftKey: true }))).toEqual({ type: "startBy", delta: 0.1 });
  });
  it("ignores unrelated or conflicting combos", () => {
    expect(actionForKey(key("a"))).toBeNull();
    expect(actionForKey(key("e", { ctrlKey: true }))).toBeNull();
    expect(actionForKey(key("ArrowLeft", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
