import CheckCircle from "@mui/icons-material/CheckCircle";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import FolderOpen from "@mui/icons-material/FolderOpenOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import LinearProgress from "@mui/material/LinearProgress";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ExportState } from "../../hooks/useExport";
import { colors } from "../../theme";
import { fileName, formatHms } from "../../utils/time";
import { Label, Mono } from "../common";

interface Props {
  state: ExportState;
  onCancel: () => void;
  onClose: () => void;
}

export function ExportDialog({ state, onCancel, onClose }: Props) {
  const open = state.phase !== "idle";
  const busy = state.phase === "starting" || state.phase === "running";
  const pct = Math.round(state.progress * 100);
  const range =
    state.clipStart !== undefined && state.clipEnd !== undefined
      ? `${formatHms(state.clipStart)} → ${formatHms(state.clipEnd)}`
      : "";

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box sx={{ p: 3 }}>
        {busy && (
          <>
            <Label>{state.phase === "starting" ? "Preparing…" : "Exporting…"}</Label>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1.5 }}>
              <LinearProgress
                variant={state.phase === "starting" ? "indeterminate" : "determinate"}
                value={pct}
                sx={{ flex: 1, height: 8, borderRadius: 4, bgcolor: colors.border }}
              />
              <Mono sx={{ width: 44, textAlign: "right", fontSize: 14 }}>{pct}%</Mono>
            </Box>
            <Mono sx={{ display: "block", mt: 1.5, color: colors.muted, fontSize: 13 }}>{range}</Mono>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2.5 }}>
              <Button color="inherit" variant="outlined" onClick={onCancel} disabled={state.phase === "starting"}>
                Cancel
              </Button>
            </Box>
          </>
        )}

        {state.phase === "done" && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: colors.accent, fontWeight: 700 }}>
              <CheckCircle fontSize="small" /> Export complete
            </Box>
            <Mono sx={{ display: "block", mt: 1.5, fontSize: 13.5, wordBreak: "break-all" }}>{fileName(state.outputPath)}</Mono>
            <Mono sx={{ display: "block", mt: 0.5, color: colors.muted, fontSize: 12 }}>{range}</Mono>
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2.5 }}>
              <Button color="inherit" onClick={onClose}>
                Close
              </Button>
              <Button
                variant="contained"
                startIcon={<FolderOpen />}
                autoFocus
                onClick={() => state.outputPath && void revealItemInDir(state.outputPath)}
              >
                Open Folder
              </Button>
            </Box>
          </>
        )}

        {(state.phase === "failed" || state.phase === "cancelled") && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 700, color: state.phase === "failed" ? colors.live : colors.muted }}>
              <ErrorOutline fontSize="small" /> {state.phase === "failed" ? "Export failed" : "Export cancelled"}
            </Box>
            {state.error && (
              <Box
                component="pre"
                sx={{ mt: 1.5, mb: 0, p: 1.5, bgcolor: colors.bg, borderRadius: 1, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", userSelect: "text" }}
              >
                {state.error}
              </Box>
            )}
            <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 2.5 }}>
              <Button color="inherit" variant="outlined" onClick={onClose} autoFocus>
                Close
              </Button>
            </Box>
          </>
        )}
      </Box>
    </Dialog>
  );
}
