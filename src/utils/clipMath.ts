// Pure clip-editor math (mirrors src-tauri/src/session/clip.rs).

export const MIN_CLIP_LEN = 0.5;

export interface Range {
  start: number;
  end: number;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function clampRange(start: number, end: number, duration?: number): Range {
  let s = Math.min(start, end);
  let e = Math.max(start, end);
  s = Math.max(0, s);
  if (duration && duration > 0) {
    e = Math.min(e, duration);
    s = Math.min(s, duration);
  }
  if (e - s < MIN_CLIP_LEN) {
    e = s + MIN_CLIP_LEN;
    if (duration && duration > 0 && e > duration) {
      e = duration;
      s = Math.max(0, duration - MIN_CLIP_LEN);
    }
  }
  return { start: round3(s), end: round3(e) };
}

/** Move the start handle; it can never cross the end handle. */
export function setStart(range: Range, t: number): Range {
  return { start: round3(Math.min(Math.max(0, t), range.end - MIN_CLIP_LEN)), end: range.end };
}

/** Move the end handle; it can never cross the start handle or pass the end of the recording. */
export function setEnd(range: Range, t: number, duration?: number): Range {
  const max = duration && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return { start: range.start, end: round3(Math.max(Math.min(t, max), range.start + MIN_CLIP_LEN)) };
}

export function clampTime(t: number, duration?: number): number {
  const max = duration && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(0, t), max);
}

/** Zoom levels: seconds of context shown on each side of the clip. */
export const ZOOM_PADDING = [10, 30, 60, 120, 300] as const;
export const DEFAULT_ZOOM = 1;

/** Visible timeline window around a clip. */
export function timelineWindow(range: Range, padding: number, duration?: number): Range {
  let from = range.start - padding;
  let to = range.end + padding;
  if (from < 0) {
    to -= from;
    from = 0;
  }
  if (duration && duration > 0 && to > duration) {
    from = Math.max(0, from - (to - duration));
    to = duration;
  }
  return { start: from, end: Math.max(to, from + 1) };
}

/** Shift the window (keeping its width) so that all `points` are visible. */
export function ensureVisible(win: Range, points: number[], duration?: number): Range {
  const width = win.end - win.start;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  if (lo >= win.start && hi <= win.end) return win;
  if (hi - lo > width) return timelineWindow({ start: lo, end: hi }, width * 0.1, duration);
  let start = lo < win.start ? lo - width * 0.1 : hi + width * 0.1 - width;
  start = Math.max(0, start);
  let end = start + width;
  if (duration && duration > 0 && end > duration) {
    end = duration;
    start = Math.max(0, end - width);
  }
  return { start, end };
}

export const toPercent = (t: number, win: Range) => ((t - win.start) / (win.end - win.start)) * 100;

export function fromFraction(fraction: number, win: Range): number {
  return win.start + Math.min(1, Math.max(0, fraction)) * (win.end - win.start);
}

/** "Nice" tick spacing for a window width in seconds. */
export function tickStep(width: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => width / s <= 12) ?? 3600;
}

// ---------------------------------------------------------------------------
// Keyboard map
// ---------------------------------------------------------------------------

export type EditorAction =
  | { type: "togglePlay" }
  | { type: "seekBy"; delta: number }
  | { type: "startBy"; delta: number }
  | { type: "endBy"; delta: number }
  | { type: "setStartHere" }
  | { type: "setEndHere" }
  | { type: "export" };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Frame step for , and . (assumes ~30 fps; precise enough for trimming). */
export const FRAME = 1 / 30;

/**
 * Space play/pause · ←/→ seek 1s · Shift+←/→ start ±1s · Ctrl+←/→ end ±1s ·
 * I/O set start/end to playhead · E export · ,/. step one frame.
 * Holding Alt makes the arrow keys fine-grained (0.1s).
 */
export function actionForKey(e: KeyLike): EditorAction | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const step = e.altKey ? 0.1 : 1;
  switch (e.key) {
    case " ":
    case "Spacebar":
      return ctrl ? null : { type: "togglePlay" };
    case "ArrowLeft":
    case "ArrowRight": {
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      if (e.shiftKey && !ctrl) return { type: "startBy", delta: dir * step };
      if (ctrl && !e.shiftKey) return { type: "endBy", delta: dir * step };
      if (!e.shiftKey && !ctrl) return { type: "seekBy", delta: dir * step };
      return null;
    }
    case ",":
      return ctrl ? null : { type: "seekBy", delta: -FRAME };
    case ".":
      return ctrl ? null : { type: "seekBy", delta: FRAME };
  }
  if (ctrl || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case "i":
      return { type: "setStartHere" };
    case "o":
      return { type: "setEndHere" };
    case "e":
      return { type: "export" };
  }
  return null;
}

/** True if keyboard shortcuts must be ignored because the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "range", "button", "submit"].includes(type);
  }
  return target.getAttribute("role") === "combobox" || target.getAttribute("role") === "listbox";
}
