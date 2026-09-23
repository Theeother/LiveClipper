import ArrowBack from "@mui/icons-material/ArrowBack";
import ChevronLeft from "@mui/icons-material/ChevronLeft";
import ChevronRight from "@mui/icons-material/ChevronRight";
import FileDownload from "@mui/icons-material/FileDownloadOutlined";
import Pause from "@mui/icons-material/PauseRounded";
import PlayArrow from "@mui/icons-material/PlayArrowRounded";
import Replay from "@mui/icons-material/ReplayRounded";
import ZoomIn from "@mui/icons-material/ZoomIn";
import ZoomOut from "@mui/icons-material/ZoomOut";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useCallback, useEffect, useRef, useState } from "react";
import { Kbd, Label, Mono } from "../../components/common";
import { ExportDialog } from "../../components/ExportDialog/ExportDialog";
import { TAG_SUGGESTIONS } from "../../components/MarkerList/ClipCard";
import { Timeline } from "../../components/Timeline/Timeline";
import { VideoPlayer } from "../../components/VideoPlayer/VideoPlayer";
import { useAppStatus } from "../../hooks/useAppStatus";
import { useExport } from "../../hooks/useExport";
import { useSession } from "../../hooks/useSession";
import { useRouter } from "../../router";
import { api, errorMessage, mediaUrl } from "../../services/api";
import { pickRecording } from "../../services/dialogs";
import { colors } from "../../theme";
import type { ExportPreset, MediaInfo } from "../../types";
import {
  actionForKey,
  clampTime,
  DEFAULT_ZOOM,
  ensureVisible,
  isTypingTarget,
  setEnd,
  setStart,
  timelineWindow,
  ZOOM_PADDING,
  type EditorAction,
  type Range,
} from "../../utils/clipMath";
import { formatHms, formatHmsTenths } from "../../utils/time";

interface Source {
  url: string;
  /** Recording time at video time 0 (non-zero for preview proxies). */
  offset: number;
  preview: boolean;
}

type MediaStatus = "loading" | "ready" | "building" | "missing" | "error";

/** Context kept around the clip when a preview proxy has to be generated. */
const PREVIEW_CONTEXT = 120;
const SAVE_DEBOUNCE_MS = 500;

export function ClipEditorPage({ sessionId, markerId }: { sessionId: string; markerId: string }) {
  const { back, replace } = useRouter();
  const { settings } = useAppStatus();
  const { session, error: loadError } = useSession(sessionId);
  const markers = session?.markers ?? [];
  const index = markers.findIndex((m) => m.id === markerId);
  const marker = index >= 0 ? markers[index] : undefined;

  // --- clip range (local while editing, autosaved) ---------------------------
  const [range, setRangeState] = useState<Range | null>(null);
  const rangeRef = useRef<Range | null>(null);
  rangeRef.current = range;
  useEffect(() => {
    if (marker && !rangeRef.current) setRangeState({ start: marker.clipStart, end: marker.clipEnd });
  }, [marker]);

  const pendingSave = useRef<Range | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const flushSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const r = pendingSave.current;
    pendingSave.current = null;
    if (r) void api.updateMarker(sessionId, markerId, { clipStart: r.start, clipEnd: r.end });
  }, [sessionId, markerId]);
  useEffect(() => flushSave, [flushSave]); // persist on unmount

  const updateRange = (r: Range) => {
    setRangeState(r);
    rangeRef.current = r;
    pendingSave.current = r;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  // --- media -----------------------------------------------------------------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [status, setStatus] = useState<MediaStatus>("loading");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [probe, setProbe] = useState<MediaInfo | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | undefined>();
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const initialSeekDone = useRef(false);

  const recordingPath = session?.recordingPath;
  useEffect(() => {
    if (!session) return;
    if (!recordingPath) {
      setStatus("missing");
      return;
    }
    setStatus("loading");
    initialSeekDone.current = false;
    api
      .prepareMedia(sessionId)
      .then((m) => {
        if (!m.exists) return setStatus("missing");
        setProbe(m.media ?? null);
        setSource({ url: mediaUrl(m.path), offset: 0, preview: false });
      })
      .catch((e) => {
        setStatus("error");
        setMediaError(errorMessage(e));
      });
    // Reload only when the linked file changes, not on every session update.
  }, [sessionId, recordingPath, !!session]);

  const duration = session?.duration ?? probe?.duration ?? (source && !source.preview ? videoDuration : undefined);
  const playable: Range | undefined =
    source?.preview && videoDuration ? { start: source.offset, end: source.offset + videoDuration } : undefined;

  const buildPreview = useCallback(
    async (around?: Range) => {
      const r = around ?? rangeRef.current;
      if (!r) return;
      setStatus("building");
      setSource(null);
      initialSeekDone.current = false;
      try {
        const start = Math.max(0, r.start - PREVIEW_CONTEXT);
        const p = await api.createPreview(sessionId, start, r.end - r.start + 2 * PREVIEW_CONTEXT);
        setSource({ url: mediaUrl(p.path), offset: p.offset, preview: true });
        setStatus("loading");
      } catch (e) {
        setStatus("error");
        setMediaError(errorMessage(e));
      }
    },
    [sessionId],
  );

  const onUnsupported = () => {
    if (source?.preview) {
      setStatus("error");
      setMediaError("The preview could not be played.");
    } else {
      void buildPreview();
    }
  };

  // --- seeking (coalesced: never queue more than one seek on huge files) ------
  const seeking = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const offset = source?.offset ?? 0;

  const seekTo = useCallback(
    (t: number) => {
      const lo = playable?.start ?? 0;
      const hi = playable?.end ?? duration ?? Number.POSITIVE_INFINITY;
      const clamped = Math.min(Math.max(t, lo), hi);
      currentRef.current = clamped;
      setCurrent(clamped);
      const v = videoRef.current;
      if (!v || status !== "ready") return;
      const target = Math.max(0, clamped - offset);
      if (seeking.current) {
        pendingSeek.current = target;
        return;
      }
      seeking.current = true;
      v.currentTime = target;
    },
    [playable?.start, playable?.end, duration, status, offset],
  );

  const onSeeked = () => {
    const v = videoRef.current;
    if (v && pendingSeek.current !== null) {
      v.currentTime = pendingSeek.current;
      pendingSeek.current = null;
    } else {
      seeking.current = false;
    }
  };

  const onLoaded = (v: HTMLVideoElement) => {
    setVideoDuration(v.duration);
    setStatus("ready");
    seeking.current = false;
    pendingSeek.current = null;
    if (!initialSeekDone.current && rangeRef.current) {
      initialSeekDone.current = true;
      const t = Math.max(rangeRef.current.start - offset, 0);
      currentRef.current = t + offset;
      setCurrent(t + offset);
      seeking.current = true;
      v.currentTime = t;
    }
  };

  // Playhead follows playback (~30 fps) and stops at the clip end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      const v = videoRef.current;
      if (v && ts - last > 33) {
        last = ts;
        const t = v.currentTime + offset;
        currentRef.current = t;
        setCurrent(t);
        if (rangeRef.current && t >= rangeRef.current.end) v.pause();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, offset]);

  const togglePlay = () => {
    const v = videoRef.current;
    const r = rangeRef.current;
    if (!v || !r || status !== "ready") return;
    if (v.paused) {
      const t = currentRef.current;
      if (t < r.start - 0.05 || t >= r.end - 0.05) seekTo(r.start);
      void v.play();
    } else {
      v.pause();
    }
  };

  const playFromStart = () => {
    const v = videoRef.current;
    if (!v || !rangeRef.current || status !== "ready") return;
    seekTo(rangeRef.current.start);
    void v.play();
  };

  // --- timeline window ---------------------------------------------------------
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [win, setWin] = useState<Range | null>(null);
  const dragging = useRef(false);
  const hasRange = range !== null;
  useEffect(() => {
    if (rangeRef.current) setWin(timelineWindow(rangeRef.current, ZOOM_PADDING[zoom], duration));
  }, [zoom, duration, hasRange]);
  useEffect(() => {
    if (!range || dragging.current) return;
    setWin((w) => (w ? ensureVisible(w, [range.start, range.end], duration) : w));
  }, [range, duration]);
  useEffect(() => {
    if (dragging.current || !playing) return;
    setWin((w) => (w ? ensureVisible(w, [current], duration) : w));
  }, [current, playing, duration]);

  // --- edits -------------------------------------------------------------------
  const moveStart = (t: number, preview = true) => {
    const r = rangeRef.current;
    if (!r) return;
    const next = setStart(r, clampTime(t, duration));
    updateRange(next);
    if (preview) seekTo(next.start);
  };
  const moveEnd = (t: number, preview = true) => {
    const r = rangeRef.current;
    if (!r) return;
    const next = setEnd(r, t, duration);
    updateRange(next);
    if (preview) seekTo(next.end);
  };

  // --- metadata ---------------------------------------------------------------
  const [name, setName] = useState("");
  const [preset, setPreset] = useState<ExportPreset>("original");
  useEffect(() => setName(marker?.name ?? ""), [marker?.name]);
  useEffect(() => {
    if (settings) setPreset(settings.exportPreset);
  }, [settings]);
  const commitName = () => {
    if (marker && name.trim() !== (marker.name ?? "")) void api.updateMarker(sessionId, markerId, { name });
  };

  // --- export -------------------------------------------------------------------
  const exporter = useExport();
  const exportOpen = exporter.state.phase !== "idle";
  const doExport = () => {
    const r = rangeRef.current;
    if (!r || !marker) return;
    window.clearTimeout(saveTimer.current);
    pendingSave.current = null;
    videoRef.current?.pause();
    void exporter.start({ sessionId, markerId, clipStart: r.start, clipEnd: r.end, preset, name });
  };

  // --- keyboard -------------------------------------------------------------------
  const onAction = (a: EditorAction) => {
    const r = rangeRef.current;
    if (!r) return;
    switch (a.type) {
      case "togglePlay":
        return togglePlay();
      case "seekBy":
        return seekTo(currentRef.current + a.delta);
      case "startBy":
        return moveStart(r.start + a.delta);
      case "endBy":
        return moveEnd(r.end + a.delta);
      case "setStartHere":
        return moveStart(currentRef.current, false);
      case "setEndHere":
        return moveEnd(currentRef.current, false);
      case "export":
        return doExport();
    }
  };
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const exportOpenRef = useRef(exportOpen);
  exportOpenRef.current = exportOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpenRef.current || isTypingTarget(e.target)) return;
      const action = actionForKey(e);
      if (!action) return;
      if (e.repeat && (action.type === "togglePlay" || action.type === "export")) return;
      e.preventDefault();
      // Keep Space from also "clicking" whatever button has focus.
      if (e.target instanceof HTMLButtonElement) e.target.blur();
      actionRef.current(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- navigation -------------------------------------------------------------------
  const goTo = (i: number) => {
    const m = markers[i];
    if (!m) return;
    flushSave();
    commitName();
    replace({ name: "editor", sessionId, markerId: m.id });
  };

  // --- render -------------------------------------------------------------------
  if (loadError) return <Box sx={{ p: 3 }}><Alert severity="error">{loadError}</Alert></Box>;
  if (!session) return null;
  if (!marker) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" action={<Button onClick={back}>Back</Button>}>
          This marker no longer exists.
        </Alert>
      </Box>
    );
  }

  const selectRecording = async () => {
    const path = await pickRecording();
    if (path) await api.setRecordingPath(sessionId, path).catch((e) => setMediaError(errorMessage(e)));
  };

  const overlay =
    status === "missing" ? (
      <>
        <Box sx={{ color: colors.text, fontWeight: 600 }}>Recording file not found</Box>
        <Box>{recordingPath ?? "No recording is linked to this session."}</Box>
        <Button variant="contained" size="small" onClick={selectRecording}>
          Select recording…
        </Button>
      </>
    ) : status === "building" ? (
      <>
        <Box sx={{ color: colors.text, fontWeight: 600 }}>Generating preview…</Box>
        <Box>
          This recording{probe?.videoCodec ? ` (${probe.videoCodec})` : ""} can't be decoded directly by the built-in player, so a
          lightweight preview of the surrounding {Math.round(PREVIEW_CONTEXT / 60)} minutes is being made. Exports still use the
          original file.
        </Box>
      </>
    ) : status === "error" ? (
      <>
        <Box sx={{ color: colors.live, fontWeight: 600 }}>Can't preview this recording</Box>
        <Box sx={{ userSelect: "text" }}>{mediaError}</Box>
      </>
    ) : undefined;

  const selectionOutsidePreview = playable && range && (range.start < playable.start || range.end > playable.end);

  return (
    <Box sx={{ px: 3, py: 2, maxWidth: 1400, mx: "auto" }}>
      {/* header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
        <Button
          startIcon={<ArrowBack />}
          color="inherit"
          onClick={() => {
            flushSave();
            commitName();
            back();
          }}
          sx={{ color: colors.muted, ml: -1 }}
        >
          Clips
        </Button>
        <Box sx={{ width: "1px", height: 20, bgcolor: colors.border }} />
        <Box component="span" sx={{ fontSize: 14 }}>🔖</Box>
        <Mono sx={{ fontSize: 16, fontWeight: 600 }}>{formatHms(marker.timestamp)}</Mono>
        <Box sx={{ color: colors.muted, fontSize: 13 }}>
          Clip {index + 1} of {markers.length}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Previous clip">
          <span>
            <IconButton size="small" disabled={index <= 0} onClick={() => goTo(index - 1)}>
              <ChevronLeft />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Next clip">
          <span>
            <IconButton size="small" disabled={index >= markers.length - 1} onClick={() => goTo(index + 1)}>
              <ChevronRight />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 290px" }, gap: 2.5, alignItems: "start" }}>
        {/* left: player + timeline */}
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ position: "relative" }}>
            <VideoPlayer
              videoRef={videoRef}
              src={source?.url ?? null}
              overlay={overlay}
              loading={status === "loading" || status === "building"}
              onLoaded={onLoaded}
              onUnsupported={onUnsupported}
              onPlayingChange={setPlaying}
              onSeeked={onSeeked}
            />
            {preset === "vertical" && status === "ready" && <VerticalGuide />}
          </Box>

          {/* transport */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
            <Tooltip title="Play / pause (Space)">
              <IconButton onClick={togglePlay} disabled={status !== "ready"} sx={{ bgcolor: colors.panelRaised, border: `1px solid ${colors.border}` }}>
                {playing ? <Pause /> : <PlayArrow />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Preview the clip from its start">
              <span>
                <Button size="small" color="inherit" startIcon={<Replay />} onClick={playFromStart} disabled={status !== "ready"} sx={{ color: colors.muted }}>
                  Preview clip
                </Button>
              </span>
            </Tooltip>
            <Mono sx={{ fontSize: 15, ml: 1 }}>{formatHmsTenths(current)}</Mono>
            {duration !== undefined && <Mono sx={{ fontSize: 12.5, color: colors.faint }}>/ {formatHms(duration)}</Mono>}
            {source?.preview && (
              <Box sx={{ fontSize: 11.5, color: colors.warn, ml: 1 }}>preview proxy</Box>
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Zoom out">
              <span>
                <IconButton size="small" disabled={zoom >= ZOOM_PADDING.length - 1} onClick={() => setZoom((z) => z + 1)}>
                  <ZoomOut fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Mono sx={{ fontSize: 12, color: colors.muted, width: 48, textAlign: "center" }}>±{ZOOM_PADDING[zoom] >= 60 ? `${ZOOM_PADDING[zoom] / 60}m` : `${ZOOM_PADDING[zoom]}s`}</Mono>
            <Tooltip title="Zoom in">
              <span>
                <IconButton size="small" disabled={zoom <= 0} onClick={() => setZoom((z) => z - 1)}>
                  <ZoomIn fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          {/* timeline */}
          <Paper sx={{ mt: 1.5, px: 1.5, pt: 1.25, pb: 0.5 }}>
            {range && win && (
              <Timeline
                win={win}
                range={range}
                current={current}
                marker={marker.timestamp}
                playable={playable}
                onStartChange={(t) => moveStart(t)}
                onEndChange={(t) => moveEnd(t)}
                onSeek={seekTo}
                onDragChange={(d) => {
                  dragging.current = d;
                  if (d) videoRef.current?.pause();
                }}
              />
            )}
          </Paper>

          {selectionOutsidePreview && (
            <Alert
              severity="info"
              variant="outlined"
              sx={{ mt: 1.5 }}
              action={
                <Button size="small" color="inherit" onClick={() => void buildPreview()}>
                  Rebuild preview
                </Button>
              }
            >
              Part of the selection is outside the preview. Export still uses the full recording.
            </Alert>
          )}

          {/* readouts */}
          {range && (
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 2, mt: 2 }}>
              <EdgeReadout
                label="Start"
                value={range.start}
                onNudge={(d) => moveStart(range.start + d)}
                onSetHere={() => moveStart(currentRef.current, false)}
                hotkey="I"
                nudgeKeys="Shift + ← →"
              />
              <EdgeReadout
                label="End"
                value={range.end}
                onNudge={(d) => moveEnd(range.end + d)}
                onSetHere={() => moveEnd(currentRef.current, false)}
                hotkey="O"
                nudgeKeys="Ctrl + ← →"
              />
              <Paper sx={{ px: 2, py: 1.25, minWidth: 140 }}>
                <Label>Duration</Label>
                <Mono sx={{ fontSize: 20, fontWeight: 600 }}>{formatHms(range.end - range.start)}</Mono>
                <Mono sx={{ fontSize: 12, color: colors.faint, ml: 0.5 }}>.{Math.floor(((range.end - range.start) * 10) % 10)}</Mono>
              </Paper>
            </Box>
          )}
        </Box>

        {/* right: metadata + export */}
        <Paper sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 2.25 }}>
          <Box>
            <Label>Clip name</Label>
            <TextField
              fullWidth
              value={name}
              placeholder="Untitled clip"
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              sx={{ mt: 0.5 }}
            />
          </Box>
          <Box>
            <Label>Tag</Label>
            <Autocomplete
              freeSolo
              size="small"
              options={TAG_SUGGESTIONS}
              value={marker.tag ?? ""}
              onChange={(_, v) => void api.updateMarker(sessionId, markerId, { tag: v ?? "" })}
              onBlur={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (v !== (marker.tag ?? "")) void api.updateMarker(sessionId, markerId, { tag: v });
              }}
              renderInput={(params) => <TextField {...params} placeholder="Funny, Gaming…" sx={{ mt: 0.5 }} />}
            />
          </Box>
          <Box>
            <Label>Export format</Label>
            <RadioGroup value={preset} onChange={(e) => setPreset(e.target.value as ExportPreset)}>
              <FormControlLabel value="original" control={<Radio size="small" />} label={<FormatLabel ratio="16:9" text="Original" />} />
              <FormControlLabel value="vertical" control={<Radio size="small" />} label={<FormatLabel ratio="9:16" text="Vertical · 1080×1920 center crop" />} />
            </RadioGroup>
          </Box>

          <Button
            variant="contained"
            size="large"
            startIcon={<FileDownload />}
            onClick={doExport}
            disabled={!range || status === "missing"}
            sx={{ py: 1.25 }}
          >
            <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
              Export clip
            </Box>
            <Kbd>E</Kbd>
          </Button>
          <Box sx={{ fontSize: 11.5, color: colors.faint, mt: -1.25 }}>
            MP4 · H.264 + AAC{settings?.watermark.enabled && settings.watermark.imagePath ? " · watermark" : ""}
            <br />→ {settings?.outputDir || "Videos\\AKS Clips"}
          </Box>

          {marker.exports.length > 0 && (
            <Box sx={{ fontSize: 12, color: colors.muted }}>
              <Label>Exported</Label>
              {marker.exports.slice(-3).map((x) => (
                <Mono key={x.path + x.exportedAt} sx={{ display: "block", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.path}>
                  ✓ {x.path.split(/[\\/]/).pop()}
                </Mono>
              ))}
            </Box>
          )}

          <Box sx={{ borderTop: `1px solid ${colors.border}`, pt: 1.5 }}>
            <Label>Keyboard</Label>
            <Shortcuts />
          </Box>
        </Paper>
      </Box>

      <ExportDialog state={exporter.state} onCancel={exporter.cancel} onClose={exporter.reset} />
    </Box>
  );
}

function EdgeReadout({
  label,
  value,
  onNudge,
  onSetHere,
  hotkey,
  nudgeKeys,
}: {
  label: string;
  value: number;
  onNudge: (delta: number) => void;
  onSetHere: () => void;
  hotkey: string;
  nudgeKeys: string;
}) {
  return (
    <Paper sx={{ px: 2, py: 1.25, display: "flex", alignItems: "center", gap: 1 }}>
      <Box sx={{ flex: 1 }}>
        <Label>{label}</Label>
        <Mono sx={{ fontSize: 20, fontWeight: 600 }}>{formatHmsTenths(value)}</Mono>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
        <Box sx={{ display: "flex", gap: 0.25 }}>
          {[-1, -0.1, 0.1, 1].map((d) => (
            <Tooltip key={d} title={Math.abs(d) === 1 ? nudgeKeys : `Alt + ${nudgeKeys}`}>
              <Button size="small" color="inherit" onClick={() => onNudge(d)} sx={{ minWidth: 0, px: 0.75, py: 0.1, fontSize: 11, color: colors.muted, border: `1px solid ${colors.border}` }}>
                {d > 0 ? "+" : "−"}
                {Math.abs(d)}s
              </Button>
            </Tooltip>
          ))}
        </Box>
        <Button size="small" onClick={onSetHere} sx={{ fontSize: 11.5, py: 0, gap: 0.75 }}>
          Set to playhead <Kbd>{hotkey}</Kbd>
        </Button>
      </Box>
    </Paper>
  );
}

function FormatLabel({ ratio, text }: { ratio: "16:9" | "9:16"; text: string }) {
  const vertical = ratio === "9:16";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 13 }}>
      <Box sx={{ width: vertical ? 9 : 16, height: vertical ? 16 : 9, border: `1.5px solid ${colors.muted}`, borderRadius: 0.5 }} />
      <b>{ratio}</b> <Box component="span" sx={{ color: colors.muted }}>{text}</Box>
    </Box>
  );
}

/** Shows the centered 9:16 crop area (the video always fills the player's height). */
function VerticalGuide() {
  return (
    <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex", justifyContent: "center", borderRadius: 1.5, overflow: "hidden" }}>
      <Box sx={{ height: "100%", aspectRatio: "9 / 16", outline: `1px dashed ${colors.accent}`, outlineOffset: -1, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }} />
    </Box>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ["Space", "Play / pause"],
    ["← →", "Seek 1s"],
    [", .", "Step one frame"],
    ["Shift ← →", "Start ±1s"],
    ["Ctrl ← →", "End ±1s"],
    ["Alt + …", "Fine (0.1s)"],
    ["I / O", "Start / end at playhead"],
    ["E", "Export"],
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1.5, rowGap: 0.6, mt: 0.75, fontSize: 12, color: colors.muted, alignItems: "center" }}>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: "contents" }}>
          <Box>
            <Kbd>{k}</Kbd>
          </Box>
          <Box>{v}</Box>
        </Box>
      ))}
    </Box>
  );
}
