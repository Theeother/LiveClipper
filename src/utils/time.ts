const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** `01:42:37` — hours are never wrapped (8h+ recordings are fine). */
export function formatHms(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds + 1e-6));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/** `01:42:37.4` — tenths, for precise editor readouts. */
export function formatHmsTenths(seconds: number): string {
  const s = Math.max(0, seconds);
  const tenths = Math.floor((s + 1e-6) * 10) % 10;
  return `${formatHms(s)}.${tenths}`;
}

/** Compact duration: `1:00`, `12:05`, `1:02:03`. */
export function formatDuration(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Parse `hh:mm:ss(.d)`, `mm:ss` or plain seconds. Returns null on invalid input.
 */
export function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** `23 September 2026` */
export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Seconds elapsed since an ISO timestamp. */
export function secondsSince(iso: string | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (now - t) / 1000);
}

export function fileName(path: string | undefined | null): string {
  if (!path) return "";
  return path.split(/[\\/]/).pop() ?? path;
}

/** `1 clip`, `3 clips` */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
