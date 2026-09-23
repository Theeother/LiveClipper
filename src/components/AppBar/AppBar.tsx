import SettingsOutlined from "@mui/icons-material/SettingsOutlined";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useAppStatus } from "../../hooks/useAppStatus";
import { useNow } from "../../hooks/useNow";
import { useRouter } from "../../router";
import { colors } from "../../theme";
import type { ObsStatus } from "../../types";
import { formatHms, plural, secondsSince } from "../../utils/time";
import { Kbd, Mono, StatusDot } from "../common";

function obsLabel(obs: ObsStatus | null): { text: string; color: string; hint: string } {
  if (!obs) return { text: "OBS", color: colors.faint, hint: "" };
  switch (obs.state) {
    case "connected":
      return {
        text: obs.recording ? "OBS recording" : "OBS connected",
        color: obs.recording ? colors.live : colors.accent,
        hint: `OBS ${obs.obsVersion ?? ""} · WebSocket ${obs.websocketVersion ?? ""}`,
      };
    case "connecting":
      return { text: "OBS connecting…", color: colors.warn, hint: "" };
    case "error":
      return { text: "OBS auth error", color: colors.live, hint: obs.message ?? "" };
    case "disabled":
      return { text: "OBS off", color: colors.faint, hint: "OBS integration disabled in Settings" };
    default:
      return { text: "OBS offline", color: colors.faint, hint: obs.message ?? "Manual mode available" };
  }
}

export function AppBar() {
  const { navigate, route } = useRouter();
  const { live, obs, hotkey } = useAppStatus();
  const active = live?.status === "active";
  const now = useNow(1000, active);
  const o = obsLabel(obs);

  return (
    <Box
      component="header"
      sx={{
        height: 48,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 2,
        px: 2,
        borderBottom: `1px solid ${colors.border}`,
        bgcolor: colors.bg,
      }}
    >
      <ButtonBase
        onClick={() => route.name !== "dashboard" && navigate({ name: "dashboard" })}
        sx={{ gap: 1, borderRadius: 1, px: 0.5, py: 0.5 }}
      >
        <Box component="img" src="/app-icon.svg" alt="" sx={{ width: 20, height: 20 }} />
        <Box sx={{ fontWeight: 800, letterSpacing: "0.14em", fontSize: 13 }}>AKS CLIPPER</Box>
      </ButtonBase>

      <Box sx={{ flex: 1 }} />

      {live && (
        <ButtonBase
          onClick={() => navigate({ name: "dashboard" })}
          sx={{
            gap: 1,
            px: 1.25,
            py: 0.5,
            borderRadius: 1,
            bgcolor: active ? colors.liveDim : "transparent",
            border: `1px solid ${active ? "rgba(255,71,71,0.35)" : colors.border}`,
            fontSize: 12,
          }}
        >
          <StatusDot color={active ? colors.live : colors.warn} pulsing={active} />
          {active ? (
            <>
              <Box sx={{ fontWeight: 700, letterSpacing: "0.08em" }}>LIVE</Box>
              <Mono>{formatHms(secondsSince(live.timelineStartedAt, now))}</Mono>
              <Box sx={{ color: colors.muted }}>· {plural(live.markers.length, "clip")}</Box>
            </>
          ) : (
            <Box sx={{ color: colors.muted }}>Waiting for OBS recording</Box>
          )}
        </ButtonBase>
      )}

      <Tooltip title={o.hint}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12, color: colors.muted }}>
          <StatusDot color={o.color} />
          {o.text}
        </Box>
      </Tooltip>

      <Tooltip title={hotkey?.error ?? "Global mark hotkey"}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12, color: hotkey?.error ? colors.live : colors.muted }}>
          Mark <Kbd>{hotkey?.accelerator ?? "F8"}</Kbd>
        </Box>
      </Tooltip>

      <Tooltip title="Settings">
        <IconButton
          size="small"
          onClick={() => route.name !== "settings" && navigate({ name: "settings" })}
          sx={{ color: route.name === "settings" ? colors.accent : colors.muted }}
        >
          <SettingsOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
