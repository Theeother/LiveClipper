import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import type { ReactNode, RefObject } from "react";
import { colors } from "../../theme";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string | null;
  /** Shown centered over the video (loading / preview generation / errors). */
  overlay?: ReactNode;
  loading?: boolean;
  onLoaded: (video: HTMLVideoElement) => void;
  onUnsupported: () => void;
  onPlayingChange: (playing: boolean) => void;
  onSeeked: () => void;
}

/**
 * Plain <video> streaming the recording through Tauri's asset protocol
 * (HTTP range requests), so multi-hour files are never loaded into memory.
 */
export function VideoPlayer({ videoRef, src, overlay, loading, onLoaded, onUnsupported, onPlayingChange, onSeeked }: Props) {
  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        // Keep the timeline on screen in small windows; the video letterboxes.
        maxHeight: "max(220px, calc(100vh - 440px))",
        bgcolor: "#000",
        borderRadius: 1.5,
        overflow: "hidden",
        border: `1px solid ${colors.border}`,
      }}
    >
      {src && (
        <video
          ref={videoRef}
          src={src}
          preload="auto"
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            // Some codecs (e.g. HEVC without the system extension) load audio only.
            if (v.videoWidth === 0) onUnsupported();
            else onLoaded(v);
          }}
          // The file's existence was checked by prepare_media, so any error here
          // means the webview can't decode it -> fall back to a preview proxy.
          onError={onUnsupported}
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
          onEnded={() => onPlayingChange(false)}
          onSeeked={onSeeked}
        />
      )}
      {(overlay || loading) && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1.5,
            bgcolor: overlay ? "rgba(0,0,0,0.75)" : "transparent",
            color: colors.muted,
            fontSize: 13,
            textAlign: "center",
            px: 4,
            pointerEvents: overlay ? "auto" : "none",
          }}
        >
          {loading && <CircularProgress size={28} />}
          {overlay}
        </Box>
      )}
    </Box>
  );
}
