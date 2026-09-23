import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useState, type KeyboardEvent } from "react";
import { colors } from "../../theme";
import { acceleratorFromEvent } from "../../utils/hotkey";
import { Kbd } from "../common";

/** Click, then press the new key combination. */
export function HotkeyInput({ value, onChange }: { value: string; onChange: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(false);
      setHint(null);
      return;
    }
    const result = acceleratorFromEvent(e);
    if (result.kind === "incomplete") return;
    if (result.kind === "invalid") {
      setHint(result.reason);
      return;
    }
    onChange(result.accelerator);
    setRecording(false);
    setHint(null);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <Box
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
          onClick={() => setRecording(true)}
          sx={{
            minWidth: 200,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            border: `1px solid ${recording ? colors.accent : colors.borderStrong}`,
            bgcolor: colors.bg,
            cursor: "pointer",
            outline: "none",
            fontSize: 13,
            color: recording ? colors.accent : colors.text,
          }}
        >
          {recording ? "Press a key combination…" : <Kbd>{value}</Kbd>}
        </Box>
        {!recording && (
          <Button size="small" onClick={() => onChange("F8")} disabled={value === "F8"}>
            Reset to F8
          </Button>
        )}
      </Box>
      <Box sx={{ fontSize: 12, color: hint ? colors.warn : colors.faint, mt: 0.75 }}>
        {hint ?? "F-keys work alone; letters and numbers need a modifier (e.g. Ctrl+Shift+M) so typing isn't blocked."}
      </Box>
    </Box>
  );
}
