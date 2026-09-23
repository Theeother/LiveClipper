import ArrowBack from "@mui/icons-material/ArrowBack";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutline from "@mui/icons-material/ErrorOutlineOutlined";
import Visibility from "@mui/icons-material/VisibilityOutlined";
import VisibilityOff from "@mui/icons-material/VisibilityOffOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type ReactNode } from "react";
import { Kbd, Label, Mono, Page } from "../../components/common";
import { HotkeyInput } from "../../components/Settings/HotkeyInput";
import { useAppStatus } from "../../hooks/useAppStatus";
import { useRouter } from "../../router";
import { api, errorMessage } from "../../services/api";
import { pickExecutable, pickFolder, pickPng } from "../../services/dialogs";
import { colors } from "../../theme";
import type { ExportPreset, ObsTestResult, Settings, WatermarkPosition } from "../../types";

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2.5, display: "grid", gridTemplateColumns: { xs: "1fr", md: "220px 1fr" }, gap: 3 }}>
      <Box>
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{title}</Typography>
        {description && <Box sx={{ fontSize: 12, color: colors.muted, mt: 0.5, lineHeight: 1.5 }}>{description}</Box>}
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>{children}</Box>
    </Paper>
  );
}

export function SettingsPage() {
  const { back } = useRouter();
  const { settings: saved, setSettings: setSaved, obs, ffmpeg, refreshFfmpeg, refreshHotkey } = useAppStatus();
  const [draft, setDraft] = useState<Settings | null>(saved);
  const [defaultOut, setDefaultOut] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; result: ObsTestResult } | { ok: false; error: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    if (saved && !draft) setDraft(saved);
  }, [saved, draft]);
  useEffect(() => void api.defaultOutputDir().then(setDefaultOut), []);

  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const setObs = (patch: Partial<Settings["obs"]>) => setDraft({ ...draft, obs: { ...draft.obs, ...patch } });
  const setWm = (patch: Partial<Settings["watermark"]>) => setDraft({ ...draft, watermark: { ...draft.watermark, ...patch } });

  const save = async () => {
    setSaveError(null);
    try {
      const result = await api.saveSettings(draft);
      setSaved(result);
      setDraft(result);
      refreshHotkey();
      refreshFfmpeg();
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTest(null);
    try {
      const result = await api.testObsConnection(draft.obs.host, draft.obs.port, draft.obs.password);
      setTest({ ok: true, result });
    } catch (e) {
      setTest({ ok: false, error: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Page maxWidth={920}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Button startIcon={<ArrowBack />} color="inherit" onClick={back} sx={{ color: colors.muted, ml: -1 }}>
          Back
        </Button>
        <Typography sx={{ fontSize: 20, fontWeight: 700 }}>Settings</Typography>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pb: 10 }}>
        <Section
          title="OBS"
          description={
            <>
              Uses OBS's built-in WebSocket server (OBS 28+). In OBS: <b>Tools → WebSocket Server Settings</b> → enable, then
              copy the port and password here.
            </>
          }
        >
          <FormControlLabel control={<Switch checked={draft.obs.enabled} onChange={(e) => setObs({ enabled: e.target.checked })} />} label="Connect to OBS" />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 1.5 }}>
            <TextField label="OBS WebSocket Host" value={draft.obs.host} onChange={(e) => setObs({ host: e.target.value })} disabled={!draft.obs.enabled} />
            <TextField
              label="Port"
              type="number"
              value={draft.obs.port}
              onChange={(e) => setObs({ port: Math.max(1, Math.min(65535, Number(e.target.value) || 4455)) })}
              disabled={!draft.obs.enabled}
            />
          </Box>
          <TextField
            label="Password"
            type={showPw ? "text" : "password"}
            value={draft.obs.password}
            onChange={(e) => setObs({ password: e.target.value })}
            disabled={!draft.obs.enabled}
            autoComplete="off"
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPw((v) => !v)} edge="end">
                      {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <FormControlLabel
            control={<Switch checked={draft.obs.autoSession} onChange={(e) => setObs({ autoSession: e.target.checked })} disabled={!draft.obs.enabled} />}
            label="Start / end sessions automatically with the OBS recording"
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Button variant="outlined" color="inherit" onClick={testConnection} disabled={testing}>
              {testing ? "Testing…" : "Test Connection"}
            </Button>
            {test?.ok && (
              <Box sx={{ color: colors.accent, fontSize: 13, display: "flex", alignItems: "center", gap: 0.75 }}>
                <CheckCircle fontSize="small" /> Connected to OBS {test.result.obsVersion} (WebSocket {test.result.websocketVersion})
                {test.result.recording ? " — recording" : ""}
              </Box>
            )}
            {test && !test.ok && (
              <Box sx={{ color: colors.live, fontSize: 13, display: "flex", alignItems: "center", gap: 0.75 }}>
                <ErrorOutline fontSize="small" /> {test.error}
              </Box>
            )}
          </Box>
          <Box sx={{ fontSize: 12, color: colors.faint }}>
            Current status: {obs?.state ?? "unknown"}
            {obs?.message ? ` — ${obs.message}` : ""}
          </Box>
        </Section>

        <Section title="Hotkey" description="Global — works while OBS, a game or a browser has focus. The press is consumed so it won't reach the game.">
          <HotkeyInput value={draft.hotkey} onChange={(hotkey) => set({ hotkey })} />
          <FormControlLabel
            control={<Switch checked={draft.showOverlay} onChange={(e) => set({ showOverlay: e.target.checked })} />}
            label={
              <span>
                Show the small <Kbd>🔖 CLIP MARKED</Kbd> confirmation (hidden from OBS display capture)
              </span>
            }
          />
        </Section>

        <Section title="Default clip padding" description="Initial clip range around each marker. You fine-tune it in the editor.">
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <TextField
              label="Before marker"
              type="number"
              value={draft.paddingBefore}
              onChange={(e) => set({ paddingBefore: Math.max(0, Number(e.target.value)) })}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">sec</InputAdornment> } }}
              sx={{ width: 170 }}
            />
            <TextField
              label="After marker"
              type="number"
              value={draft.paddingAfter}
              onChange={(e) => set({ paddingAfter: Math.max(0, Number(e.target.value)) })}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">sec</InputAdornment> } }}
              sx={{ width: 170 }}
            />
          </Box>
        </Section>

        <Section title="Export">
          <Box>
            <Label>Output directory</Label>
            <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
              <TextField fullWidth value={draft.outputDir} placeholder={defaultOut} onChange={(e) => set({ outputDir: e.target.value })} />
              <Button
                variant="outlined"
                color="inherit"
                onClick={async () => {
                  const dir = await pickFolder("Select output folder");
                  if (dir) set({ outputDir: dir });
                }}
              >
                Browse
              </Button>
            </Box>
          </Box>
          <Box>
            <Label>Default export format</Label>
            <RadioGroup row value={draft.exportPreset} onChange={(e) => set({ exportPreset: e.target.value as ExportPreset })}>
              <FormControlLabel value="original" control={<Radio size="small" />} label="Original 16:9" />
              <FormControlLabel value="vertical" control={<Radio size="small" />} label="Vertical 9:16 (1080×1920)" />
            </RadioGroup>
          </Box>
        </Section>

        <Section title="Branding" description="Optional PNG overlay (transparent PNGs work best). Scaled to 15% of the video width.">
          <FormControlLabel control={<Switch checked={draft.watermark.enabled} onChange={(e) => setWm({ enabled: e.target.checked })} />} label="Add AKS watermark" />
          <Box>
            <Label>Watermark</Label>
            <Box sx={{ display: "flex", gap: 1, mt: 0.5, alignItems: "center" }}>
              <TextField fullWidth value={draft.watermark.imagePath ?? ""} placeholder="No image selected" onChange={(e) => setWm({ imagePath: e.target.value })} disabled={!draft.watermark.enabled} />
              <Button
                variant="outlined"
                color="inherit"
                disabled={!draft.watermark.enabled}
                onClick={async () => {
                  const p = await pickPng();
                  if (p) setWm({ imagePath: p });
                }}
              >
                Select image
              </Button>
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: 3, alignItems: "center" }}>
            <TextField
              select
              label="Position"
              value={draft.watermark.position}
              onChange={(e) => setWm({ position: e.target.value as WatermarkPosition })}
              disabled={!draft.watermark.enabled}
              sx={{ width: 180 }}
            >
              <MenuItem value="top-left">Top Left</MenuItem>
              <MenuItem value="top-right">Top Right</MenuItem>
              <MenuItem value="bottom-left">Bottom Left</MenuItem>
              <MenuItem value="bottom-right">Bottom Right</MenuItem>
            </TextField>
            <Box sx={{ flex: 1, maxWidth: 280 }}>
              <Label>Opacity · {Math.round(draft.watermark.opacity * 100)}%</Label>
              <Slider
                size="small"
                min={0.1}
                max={1}
                step={0.05}
                value={draft.watermark.opacity}
                onChange={(_, v) => setWm({ opacity: v as number })}
                disabled={!draft.watermark.enabled}
              />
            </Box>
          </Box>
        </Section>

        <Section title="FFmpeg" description="Used for exports and previews. Bundled with the installer when available; otherwise found on PATH / winget.">
          {ffmpeg?.found ? (
            <Alert severity="success" variant="outlined" icon={<CheckCircle fontSize="small" />}>
              <Mono sx={{ fontSize: 12 }}>{ffmpeg.version}</Mono>
              <Box sx={{ fontSize: 12, color: colors.muted, wordBreak: "break-all" }}>{ffmpeg.path}</Box>
            </Alert>
          ) : (
            <Alert severity="warning" variant="outlined">
              {ffmpeg?.error ?? "Checking…"}
              <Box sx={{ mt: 0.5, fontSize: 12 }}>
                Install: <Mono>winget install Gyan.FFmpeg</Mono>, then restart AKS Clipper — or select ffmpeg.exe below.
              </Box>
            </Alert>
          )}
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField fullWidth value={draft.ffmpegPath} placeholder="Auto-detect" onChange={(e) => set({ ffmpegPath: e.target.value })} />
            <Button
              variant="outlined"
              color="inherit"
              onClick={async () => {
                const p = await pickExecutable();
                if (p) set({ ffmpegPath: p });
              }}
            >
              Browse
            </Button>
            <Button color="inherit" onClick={refreshFfmpeg}>
              Re-check
            </Button>
          </Box>
        </Section>
      </Box>

      {/* sticky save bar */}
      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          px: 3,
          py: 1.5,
          bgcolor: "rgba(13,14,16,0.92)",
          backdropFilter: "blur(6px)",
          borderTop: `1px solid ${colors.border}`,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 2,
        }}
      >
        {saveError && <Box sx={{ color: colors.live, fontSize: 13, mr: "auto" }}>{saveError}</Box>}
        {savedFlash && <Box sx={{ color: colors.accent, fontSize: 13 }}>Saved</Box>}
        {dirty && !savedFlash && <Box sx={{ color: colors.muted, fontSize: 13 }}>Unsaved changes</Box>}
        <Button color="inherit" disabled={!dirty} onClick={() => setDraft(saved)}>
          Discard
        </Button>
        <Button variant="contained" disabled={!dirty} onClick={save}>
          Save changes
        </Button>
      </Box>
    </Page>
  );
}
