import Add from "@mui/icons-material/Add";
import ArrowBack from "@mui/icons-material/ArrowBack";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { Label, Mono, Page, StatusDot } from "../../components/common";
import { ClipCard } from "../../components/MarkerList/ClipCard";
import { useSession } from "../../hooks/useSession";
import { useRouter } from "../../router";
import { api, errorMessage } from "../../services/api";
import { pickRecording } from "../../services/dialogs";
import { colors } from "../../theme";
import { fileName, formatHms, formatLongDate, formatTimeOfDay, parseTime } from "../../utils/time";

export function SessionPage({ sessionId }: { sessionId: string }) {
  const { navigate, back } = useRouter();
  const { session, error: loadError } = useSession(sessionId);
  const [error, setError] = useState<string | null>(null);
  const [fileMissing, setFileMissing] = useState(false);
  const [addAt, setAddAt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const recordingPath = session?.recordingPath;
  useEffect(() => {
    if (!recordingPath) return setFileMissing(false);
    // prepare_media reports whether the file still exists.
    api
      .prepareMedia(sessionId)
      .then((m) => setFileMissing(!m.exists))
      .catch(() => setFileMissing(false));
  }, [sessionId, recordingPath]);

  const run = (p: Promise<unknown>) => p.catch((e) => setError(errorMessage(e)));

  const selectRecording = async () => {
    const path = await pickRecording();
    if (path) await run(api.setRecordingPath(sessionId, path));
  };

  const addClip = async () => {
    const t = parseTime(addAt);
    if (t === null) return setError("Enter a time like 01:24:31");
    await run(api.addMarker(sessionId, t));
    setAddAt("");
  };

  const deleteSession = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    await api
      .deleteSession(sessionId)
      .then(() => back())
      .catch((e) => setError(errorMessage(e)));
  };

  if (loadError) return <Page><Alert severity="error">{loadError}</Alert></Page>;
  if (!session) return null;

  const live = session.status !== "ended";
  const noRecording = !session.recordingPath;

  return (
    <Page>
      <Button startIcon={<ArrowBack />} color="inherit" onClick={back} sx={{ color: colors.muted, mb: 2, ml: -1 }}>
        Back
      </Button>

      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 2, mb: 3 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Label>Stream</Label>
          <Typography sx={{ fontSize: 26, fontWeight: 700, lineHeight: 1.2 }}>
            {formatLongDate(session.startedAt)}
            <Box component="span" sx={{ color: colors.muted, fontWeight: 400, fontSize: 16, ml: 1.5 }}>
              {formatTimeOfDay(session.startedAt)}
            </Box>
          </Typography>
          <Box sx={{ display: "flex", gap: 3, mt: 1, fontSize: 13, color: colors.muted, alignItems: "center" }}>
            <span>
              Duration: <Mono sx={{ color: colors.text }}>{session.duration ? formatHms(session.duration) : live ? "recording…" : "unknown"}</Mono>
            </span>
            <span>
              Clips: <Mono sx={{ color: colors.text }}>{session.markers.length}</Mono>
            </span>
            {live && (
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, color: colors.live }}>
                <StatusDot color={colors.live} pulsing /> live session
              </Box>
            )}
          </Box>
        </Box>
        {!live && (
          <Button
            size="small"
            color={confirmDelete ? "error" : "inherit"}
            variant={confirmDelete ? "contained" : "text"}
            startIcon={<DeleteOutline />}
            onClick={deleteSession}
            onBlur={() => setConfirmDelete(false)}
            sx={{ color: confirmDelete ? undefined : colors.faint }}
          >
            {confirmDelete ? "Confirm delete (markers only, not the video)" : "Delete session"}
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {(noRecording || fileMissing) && !live && (
        <Alert
          severity={fileMissing ? "error" : "warning"}
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={selectRecording}>
              Select recording…
            </Button>
          }
        >
          {fileMissing ? (
            <>
              Recording file not found: <Mono>{session.recordingPath}</Mono>. It may have been moved or renamed.
            </>
          ) : (
            "No recording file is linked to this session yet. Select the OBS recording to preview and export clips."
          )}
        </Alert>
      )}

      <Paper sx={{ overflow: "hidden" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.5 }}>
          <Label>Clips</Label>
          {session.recordingPath && (
            <Box sx={{ fontSize: 12, color: colors.faint, display: "flex", gap: 1, alignItems: "center", minWidth: 0 }}>
              <Mono sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={session.recordingPath}>
                {fileName(session.recordingPath)}
              </Mono>
              <Button size="small" onClick={selectRecording} sx={{ minWidth: 0, fontSize: 12 }}>
                Change
              </Button>
            </Box>
          )}
          <Box sx={{ flex: 1 }} />
          <TextField
            placeholder="hh:mm:ss"
            value={addAt}
            onChange={(e) => setAddAt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addClip()}
            sx={{ width: 120 }}
            slotProps={{ htmlInput: { style: { fontFamily: "inherit" } } }}
          />
          <Button size="small" startIcon={<Add />} onClick={addClip} disabled={!addAt.trim()}>
            Add clip at
          </Button>
        </Box>

        {session.markers.length === 0 && (
          <Box sx={{ px: 2.5, py: 4, borderTop: `1px solid ${colors.border}`, color: colors.muted, fontSize: 13, textAlign: "center" }}>
            {live ? "Press F8 during the stream to mark moments. They'll appear here." : "No markers in this session. Add one with a timestamp above."}
          </Box>
        )}

        {session.markers.map((m, i) => (
          <ClipCard
            key={m.id}
            index={i}
            marker={m}
            onOpen={() => navigate({ name: "editor", sessionId, markerId: m.id })}
            onRename={(name) => void run(api.updateMarker(sessionId, m.id, { name }))}
            onTag={(tag) => void run(api.updateMarker(sessionId, m.id, { tag }))}
            onDelete={() => void run(api.deleteMarker(sessionId, m.id))}
          />
        ))}
      </Paper>
    </Page>
  );
}
