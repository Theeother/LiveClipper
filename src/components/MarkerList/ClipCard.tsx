import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import MovieEdit from "@mui/icons-material/MovieEdit";
import CheckCircle from "@mui/icons-material/CheckCircleOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";
import { colors } from "../../theme";
import type { Marker } from "../../types";
import { formatHms } from "../../utils/time";
import { Mono } from "../common";

export const TAG_SUGGESTIONS = ["Funny", "Gaming", "Reaction", "Story"];

interface Props {
  index: number;
  marker: Marker;
  onOpen: () => void;
  onRename: (name: string) => void;
  onTag: (tag: string) => void;
  onDelete: () => void;
}

export function ClipCard({ index, marker, onOpen, onRename, onTag, onDelete }: Props) {
  const [name, setName] = useState(marker.name ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setName(marker.name ?? ""), [marker.name]);
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  const commitName = () => {
    if (name.trim() !== (marker.name ?? "")) onRename(name);
  };
  const duration = marker.clipEnd - marker.clipStart;

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "28px 150px 1fr 170px auto",
        alignItems: "center",
        gap: 2,
        px: 2.5,
        py: 1.5,
        borderTop: `1px solid ${colors.border}`,
        "&:hover": { bgcolor: "rgba(255,255,255,0.015)" },
      }}
    >
      <Mono sx={{ color: colors.faint, fontSize: 12 }}>{String(index + 1).padStart(2, "0")}</Mono>

      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box component="span" sx={{ fontSize: 13 }}>🔖</Box>
          <Mono sx={{ fontSize: 15, fontWeight: 600 }}>{formatHms(marker.timestamp)}</Mono>
        </Box>
        <Mono sx={{ fontSize: 12, color: colors.muted }}>{formatHms(duration)} duration</Mono>
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <InputBase
          value={name}
          placeholder="Untitled clip — click to name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setName(marker.name ?? "");
              (e.target as HTMLInputElement).blur();
            }
          }}
          sx={{
            width: "100%",
            fontSize: 14,
            fontWeight: 500,
            px: 1,
            borderRadius: 1,
            border: "1px solid transparent",
            "&:hover": { borderColor: colors.border },
            "&.Mui-focused": { borderColor: colors.borderStrong, bgcolor: colors.bg },
          }}
        />
        <Box sx={{ px: 1, fontSize: 11.5, color: colors.faint, display: "flex", gap: 1.5 }}>
          <span>
            {formatHms(marker.clipStart)} → {formatHms(marker.clipEnd)}
          </span>
          {marker.exports.length > 0 && (
            <Box component="span" sx={{ color: colors.accent, display: "inline-flex", alignItems: "center", gap: 0.4 }}>
              <CheckCircle sx={{ fontSize: 12 }} /> exported{marker.exports.length > 1 ? ` ×${marker.exports.length}` : ""}
            </Box>
          )}
        </Box>
      </Box>

      <Autocomplete
        freeSolo
        size="small"
        options={TAG_SUGGESTIONS}
        value={marker.tag ?? ""}
        onChange={(_, v) => onTag(v ?? "")}
        onInputChange={(_, _value, reason) => {
          if (reason === "clear") onTag("");
        }}
        onBlur={(e) => {
          const v = (e.target as HTMLInputElement).value;
          if (v !== (marker.tag ?? "")) onTag(v);
        }}
        renderInput={(params) => <TextField {...params} placeholder="Tag" />}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Button variant="outlined" size="small" startIcon={<MovieEdit />} onClick={onOpen}>
          Open Editor
        </Button>
        <Tooltip title={confirmDelete ? "Click again to delete" : "Delete marker"}>
          <IconButton
            size="small"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            sx={{ color: confirmDelete ? colors.live : colors.faint, bgcolor: confirmDelete ? colors.liveDim : undefined }}
          >
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
