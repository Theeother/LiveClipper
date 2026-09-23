import Box from "@mui/material/Box";
import { useMemo, useRef, type PointerEvent } from "react";
import { colors, fonts } from "../../theme";
import { fromFraction, tickStep, toPercent, type Range } from "../../utils/clipMath";
import { formatHms } from "../../utils/time";

type DragTarget = "start" | "end" | "seek";

interface Props {
  /** Visible time window. */
  win: Range;
  /** Selected clip range. */
  range: Range;
  current: number;
  marker: number;
  /** Portion of the recording that can actually be previewed (preview proxies are partial). */
  playable?: Range;
  onStartChange: (t: number) => void;
  onEndChange: (t: number) => void;
  onSeek: (t: number) => void;
  onDragChange?: (dragging: boolean) => void;
}

const TRACK_H = 64;

/**
 * Start/end handles are dragged directly; clicking or dragging anywhere else
 * on the track scrubs the playhead.
 */
export function Timeline({ win, range, current, marker, playable, onStartChange, onEndChange, onSeek, onDragChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragTarget | null>(null);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return fromFraction((clientX - rect.left) / rect.width, win);
  };

  const apply = (target: DragTarget, t: number) => {
    if (target === "start") onStartChange(t);
    else if (target === "end") onEndChange(t);
    else onSeek(t);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle as DragTarget | undefined;
    drag.current = handle ?? "seek";
    trackRef.current!.setPointerCapture(e.pointerId);
    onDragChange?.(true);
    if (!handle) apply("seek", timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) apply(drag.current, timeAt(e.clientX));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    trackRef.current?.releasePointerCapture(e.pointerId);
    onDragChange?.(false);
  };

  const ticks = useMemo(() => {
    const step = tickStep(win.end - win.start);
    const first = Math.ceil(win.start / step) * step;
    const out: number[] = [];
    for (let t = first; t <= win.end; t += step) out.push(t);
    return out;
  }, [win.start, win.end]);

  const pct = (t: number) => `${Math.min(100, Math.max(0, toPercent(t, win)))}%`;
  const startPct = toPercent(range.start, win);
  const endPct = toPercent(range.end, win);
  const inView = (t: number) => t >= win.start && t <= win.end;

  return (
    <Box sx={{ userSelect: "none" }}>
      {/* Tick labels */}
      <Box sx={{ position: "relative", height: 18, mx: "8px" }}>
        {ticks.map((t) => (
          <Box
            key={t}
            sx={{
              position: "absolute",
              left: pct(t),
              transform: "translateX(-50%)",
              fontSize: 10.5,
              fontFamily: fonts.mono,
              color: colors.faint,
              whiteSpace: "nowrap",
            }}
          >
            {formatHms(t)}
          </Box>
        ))}
      </Box>

      <Box sx={{ px: "8px" }}>
        <Box
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          sx={{
            position: "relative",
            height: TRACK_H,
            borderRadius: 1,
            bgcolor: colors.bg,
            border: `1px solid ${colors.border}`,
            cursor: "text",
            touchAction: "none",
          }}
        >
          {/* tick lines */}
          {ticks.map((t) => (
            <Box key={t} sx={{ position: "absolute", left: pct(t), top: 0, bottom: 0, width: "1px", bgcolor: "rgba(255,255,255,0.04)" }} />
          ))}

          {/* not previewable (outside a preview proxy) */}
          {playable && playable.start > win.start && (
            <Box sx={{ position: "absolute", left: 0, width: pct(playable.start), top: 0, bottom: 0, bgcolor: "rgba(0,0,0,0.45)", backgroundImage: "repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.03) 6px 12px)" }} />
          )}
          {playable && playable.end < win.end && (
            <Box sx={{ position: "absolute", left: pct(playable.end), right: 0, top: 0, bottom: 0, bgcolor: "rgba(0,0,0,0.45)", backgroundImage: "repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.03) 6px 12px)" }} />
          )}

          {/* selection */}
          <Box
            sx={{
              position: "absolute",
              left: pct(range.start),
              width: `${Math.max(0, Math.min(100, endPct) - Math.max(0, startPct))}%`,
              top: 0,
              bottom: 0,
              bgcolor: colors.accentDim,
              borderTop: `2px solid ${colors.accent}`,
              borderBottom: `2px solid ${colors.accent}`,
            }}
          />

          {/* original marker */}
          {inView(marker) && (
            <Box sx={{ position: "absolute", left: pct(marker), top: 0, bottom: 0, pointerEvents: "none" }}>
              <Box sx={{ position: "absolute", top: 0, bottom: 0, left: 0, borderLeft: `1px dashed ${colors.muted}` }} />
              <Box sx={{ position: "absolute", top: -1, left: -5, fontSize: 11, lineHeight: 1 }}>🔖</Box>
            </Box>
          )}

          {/* handles */}
          {(["start", "end"] as const).map((which) => {
            const t = which === "start" ? range.start : range.end;
            if (!inView(t)) return null;
            return (
              <Box
                key={which}
                data-handle={which}
                sx={{
                  position: "absolute",
                  left: pct(t),
                  top: -6,
                  bottom: -6,
                  width: 16,
                  ml: "-8px",
                  cursor: "ew-resize",
                  display: "flex",
                  justifyContent: "center",
                  zIndex: 2,
                  "&:hover > div": { bgcolor: "#8dff5f" },
                }}
              >
                <Box
                  sx={{
                    width: 6,
                    height: "100%",
                    borderRadius: 1,
                    bgcolor: colors.accent,
                    boxShadow: "0 0 0 2px rgba(0,0,0,0.6)",
                    transition: "background-color 120ms",
                  }}
                />
              </Box>
            );
          })}

          {/* playhead */}
          {inView(current) && (
            <Box sx={{ position: "absolute", left: pct(current), top: -4, bottom: -4, width: 2, ml: "-1px", bgcolor: "#fff", zIndex: 3, pointerEvents: "none", borderRadius: 1 }}>
              <Box sx={{ position: "absolute", top: -4, left: -4, width: 10, height: 10, bgcolor: "#fff", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
            </Box>
          )}
        </Box>
      </Box>

      {/* START / END labels under the handles */}
      <Box sx={{ position: "relative", height: 20, mx: "8px", mt: 0.75 }}>
        {inView(range.start) && (
          <Box sx={{ position: "absolute", left: pct(range.start), transform: "translateX(-50%)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", color: colors.accent }}>
            START
          </Box>
        )}
        {inView(range.end) && (
          <Box sx={{ position: "absolute", left: pct(range.end), transform: "translateX(-50%)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", color: colors.accent }}>
            END
          </Box>
        )}
      </Box>
    </Box>
  );
}
