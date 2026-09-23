// Small presentational building blocks shared across screens.
import Box, { type BoxProps } from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";
import type { ReactNode } from "react";
import { colors, fonts } from "../theme";

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

export function StatusDot({ color, pulsing = false, size = 8 }: { color: string; pulsing?: boolean; size?: number }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: color,
        flexShrink: 0,
        animation: pulsing ? `${pulse} 1.6s ease-in-out infinite` : undefined,
      }}
    />
  );
}

export function Mono({ children, sx, ...rest }: BoxProps) {
  return (
    <Box component="span" sx={{ fontFamily: fonts.mono, fontVariantNumeric: "tabular-nums", ...sx }} {...rest}>
      {children}
    </Box>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" component="div" sx={{ color: colors.muted, lineHeight: 1.4 }}>
      {children}
    </Typography>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box
      component="kbd"
      sx={{
        fontFamily: fonts.mono,
        fontSize: 11,
        px: 0.75,
        py: 0.1,
        borderRadius: 0.75,
        border: `1px solid ${colors.borderStrong}`,
        borderBottomWidth: 2,
        bgcolor: colors.panelRaised,
        color: colors.text,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Box>
  );
}

export function Page({ children, maxWidth = 1080 }: { children: ReactNode; maxWidth?: number }) {
  return <Box sx={{ maxWidth, mx: "auto", px: 3, py: 3 }}>{children}</Box>;
}
