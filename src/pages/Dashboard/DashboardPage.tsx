import BookmarkAdd from "@mui/icons-material/BookmarkAdd";
import FolderOpen from "@mui/icons-material/FolderOpenOutlined";
import PlayArrow from "@mui/icons-material/PlayArrowRounded";
import Stop from "@mui/icons-material/StopRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { Kbd, Label, Mono, Page, StatusDot } from "../../components/common";
import { useAppStatus } from "../../hooks/useAppStatus";
import { useNow } from "../../hooks/useNow";
import { useTauriEvent } from "../../hooks/useTauriEvent";
import { useRouter } from "../../router";
import { api, errorMessage } from "../../services/api";
import { pickRecording } from "../../services/dialogs";
import { colors, fonts } from "../../theme";
import type { Session, SessionSummary } from "../../types";
import { fileName, formatDuration, formatHms, formatLongDate, formatTimeOfDay, plural, secondsSince } from "../../utils/time";

export function DashboardPage() {
  const { live, obs, ffmpeg, hotkey, settings } = useAppStatus();
  const [error, setError] = useState<string | null>(null);

  return (
    <Page>
      {hotkey?.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {hotkey.error} Change the hotkey in Settings.
        </Alert>
      )}
      {ffmpeg && !ffmpeg.found && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          FFmpeg not found — marking works, but exporting needs FFmpeg. Run <Mono>winget install Gyan.FFmpeg</Mono> or set its
          path in Settings.
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.25fr 1fr" }, gap: 2.5, alignItems: "start" }}>
        {live ? (
          <LivePanel session={live} onError={setError} />
        ) : (
          <IdlePanel obsConnected={obs?.state === "connected"} obsRecording={!!obs?.recording} autoSession={!!settings?.obs.autoSession} onError={setError} />
        )}
        <RecentSessions onError={setError} />
      </Box>
    </Page>
  );
}

function IdlePanel({
  obsConnected,
  obsRecording,
  autoSession,
  onError,
}: {
  obsConnected: boolean;
  obsRecording: boolean;
  autoSession: boolean;
  onError: (e: string) => void;
}) {
  const { navigate } = useRouter();
  const [recording, setRecording] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await api.startSession(recording ?? undefined);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const importExisting = async () => {
    const path = await pickRecording();
    if (!path) return;
    try {
      const s = await api.importRecording(path);
      navigate({ name: "session", id: s.id });
    } catch (e) {
      onError(errorMessage(e));
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Label>Status</Label>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5, mb: 2.5 }}>
        <StatusDot color={colors.faint} />
        <Typography sx={{ fontSize: 18, fontWeight: 600 }}>Not recording</Typography>
      </Box>

      <Label>Clips marked</Label>
      <Mono sx={{ display: "block", fontSize: 28, fontWeight: 600, mb: 3 }}>0</Mono>

      <Button variant="contained" size="large" startIcon={<PlayArrow />} onClick={start} disabled={busy} fullWidth sx={{ py: 1.5, fontSize: 15 }}>
        Start Session
      </Button>

      <Box sx={{ mt: 2, fontSize: 12.5, color: colors.muted, lineHeight: 1.6 }}>
        {obsConnected ? (
          <>
            <StatusDot color={colors.accent} size={6} />{" "}
            OBS connected — the session timeline follows the OBS recording{obsRecording ? " (recording now)." : "; it starts at 00:00:00 when you hit Start Recording."}
            {autoSession && (
              <Box sx={{ mt: 0.5 }}>Auto-session is on: a session also starts by itself when OBS starts recording.</Box>
            )}
          </>
        ) : (
          <>
            <StatusDot color={colors.warn} size={6} /> OBS not connected — <b>manual mode</b>: the timeline starts when you click Start
            Session, so click it right when you start recording. You can select the recording file now or after the stream.
            <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1 }}>
              <Button size="small" variant="outlined" color="inherit" onClick={async () => setRecording(await pickRecording())}>
                {recording ? "Change file" : "Select recording file (optional)"}
              </Button>
              {recording && <Mono sx={{ fontSize: 12, color: colors.text, overflow: "hidden", textOverflow: "ellipsis" }}>{fileName(recording)}</Mono>}
            </Box>
          </>
        )}
      </Box>

      <Box sx={{ borderTop: `1px solid ${colors.border}`, mt: 3, pt: 2 }}>
        <Button startIcon={<FolderOpen />} color="inherit" onClick={importExisting} sx={{ color: colors.muted }}>
          Open an existing recording…
        </Button>
      </Box>
    </Paper>
  );
}

function LivePanel({ session, onError }: { session: Session; onError: (e: string) => void }) {
  const { navigate } = useRouter();
  const { hotkey } = useAppStatus();
  const active = session.status === "active";
  const now = useNow(250, active);
  const [flash, setFlash] = useState(false);

  useTauriEvent("marker-added", () => {
    setFlash(true);
    window.setTimeout(() => setFlash(false), 600);
  });

  const mark = async () => {
    try {
      await api.markClip();
    } catch (e) {
      onError(errorMessage(e));
    }
  };
  const stop = async () => {
    const ended = await api.stopSession();
    if (ended) navigate({ name: "session", id: ended.id });
  };
  const selectRecording = async () => {
    const path = await pickRecording();
    if (path) await api.setRecordingPath(session.id, path).catch((e) => onError(errorMessage(e)));
  };

  const recent = [...session.markers].sort((a, b) => b.timestamp - a.timestamp).slice(0, 4);

  return (
    <Paper sx={{ p: 3, borderColor: active ? "rgba(255,71,71,0.35)" : colors.border }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2.5 }}>
        <StatusDot color={active ? colors.live : colors.warn} pulsing size={10} />
        <Typography sx={{ fontWeight: 800, letterSpacing: "0.12em", fontSize: 14, color: active ? colors.live : colors.warn }}>
          {active ? "SESSION ACTIVE" : "WAITING FOR OBS"}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" variant="outlined" startIcon={<Stop />} onClick={stop} sx={{ color: colors.muted, borderColor: colors.border }}>
          End session
        </Button>
      </Box>

      {!active && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2.5 }}>
          Start recording in OBS. The timeline begins at 00:00:00 when the recording starts.
        </Alert>
      )}

      <Label>Recording</Label>
      <Box sx={{ mb: 2.5, mt: 0.25, display: "flex", alignItems: "center", gap: 1, minHeight: 28 }}>
        {session.recordingPath ? (
          <Mono sx={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.recordingPath}>
            {fileName(session.recordingPath)}
          </Mono>
        ) : (
          <Box sx={{ color: colors.muted, fontSize: 13 }}>
            {session.mode === "obs" && active ? "Detecting OBS recording file…" : "Not selected yet — you can pick it after the stream"}
          </Box>
        )}
        {session.mode === "manual" && (
          <Button size="small" onClick={selectRecording} sx={{ ml: "auto", flexShrink: 0 }}>
            {session.recordingPath ? "Change" : "Select file"}
          </Button>
        )}
      </Box>

      <Box sx={{ display: "flex", gap: 5, mb: 3 }}>
        <Box>
          <Label>Elapsed</Label>
          <Mono sx={{ display: "block", fontSize: 40, fontWeight: 600, lineHeight: 1.15 }}>
            {active ? formatHms(secondsSince(session.timelineStartedAt, now)) : "--:--:--"}
          </Mono>
        </Box>
        <Box>
          <Label>Clips marked</Label>
          <Mono
            sx={{
              display: "block",
              fontSize: 40,
              fontWeight: 600,
              lineHeight: 1.15,
              color: flash ? colors.accent : colors.text,
              transition: "color 400ms ease-out",
            }}
          >
            {session.markers.length}
          </Mono>
        </Box>
      </Box>

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={!active}
        startIcon={<BookmarkAdd />}
        onClick={mark}
        sx={{ py: 2, fontSize: 17, fontWeight: 800, letterSpacing: "0.1em" }}
      >
        MARK CLIP
      </Button>
      <Box sx={{ textAlign: "center", mt: 1, fontSize: 12, color: colors.muted }}>
        or press <Kbd>{hotkey?.accelerator ?? "F8"}</Kbd> anywhere — no need to focus this window
      </Box>

      {recent.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Label>Latest markers</Label>
          {recent.map((m) => (
            <Box key={m.id} sx={{ display: "flex", alignItems: "center", gap: 1.25, py: 0.75, borderBottom: `1px solid ${colors.border}`, fontSize: 13 }}>
              <Box component="span" sx={{ color: colors.accent }}>🔖</Box>
              <Mono>{formatHms(m.timestamp)}</Mono>
              <Box sx={{ color: colors.faint, fontSize: 11.5 }}>{m.timing === "obs" ? "OBS time" : "clock"}</Box>
              <Box sx={{ flex: 1 }} />
              <Box sx={{ color: colors.muted, fontSize: 12 }}>{formatTimeOfDay(m.createdAt)}</Box>
            </Box>
          ))}
          <Button size="small" sx={{ mt: 1 }} onClick={() => navigate({ name: "session", id: session.id })}>
            View all clips
          </Button>
        </Box>
      )}
    </Paper>
  );
}

function RecentSessions({ onError }: { onError: (e: string) => void }) {
  const { navigate } = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);

  const reload = useCallback(() => {
    api.listSessions().then(setSessions).catch((e) => onError(errorMessage(e)));
  }, [onError]);
  useEffect(reload, [reload]);
  useTauriEvent("session-updated", reload);

  return (
    <Paper sx={{ p: 0, overflow: "hidden" }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1 }}>
        <Label>Streams</Label>
      </Box>
      {sessions?.length === 0 && (
        <Box sx={{ px: 2.5, pb: 2.5, color: colors.muted, fontSize: 13 }}>No sessions yet. Start one, then press F8 during your stream.</Box>
      )}
      {sessions?.map((s) => (
        <ButtonBase
          key={s.id}
          onClick={() => navigate({ name: "session", id: s.id })}
          sx={{
            width: "100%",
            justifyContent: "flex-start",
            textAlign: "left",
            px: 2.5,
            py: 1.5,
            gap: 2,
            borderTop: `1px solid ${colors.border}`,
            "&:hover": { bgcolor: colors.panelRaised },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
              {s.status !== "ended" && <StatusDot color={s.status === "active" ? colors.live : colors.warn} pulsing />}
              {formatLongDate(s.startedAt)}
              <Box component="span" sx={{ color: colors.muted, fontWeight: 400 }}>
                {formatTimeOfDay(s.startedAt)}
              </Box>
            </Box>
            <Box sx={{ fontSize: 12, color: colors.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: fonts.mono }}>
              {s.recordingPath ? fileName(s.recordingPath) : s.mode === "imported" ? "Imported recording" : "No recording file"}
            </Box>
          </Box>
          <Box sx={{ textAlign: "right", flexShrink: 0 }}>
            <Mono sx={{ fontSize: 13, display: "block" }}>{plural(s.markerCount, "clip")}</Mono>
            <Mono sx={{ fontSize: 12, color: colors.muted }}>{s.duration ? formatDuration(s.duration) : s.status === "ended" ? "—" : "live"}</Mono>
          </Box>
        </ButtonBase>
      ))}
    </Paper>
  );
}
