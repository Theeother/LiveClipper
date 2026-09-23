import { createTheme } from "@mui/material/styles";

export const colors = {
  bg: "#0d0e10",
  panel: "#141619",
  panelRaised: "#1a1d21",
  border: "#262a30",
  borderStrong: "#343942",
  text: "#e8eaed",
  muted: "#8d949e",
  faint: "#5d636c",
  accent: "#53fc18",
  accentDim: "rgba(83, 252, 24, 0.12)",
  live: "#ff4747",
  liveDim: "rgba(255, 71, 71, 0.12)",
  warn: "#ffb020",
};

export const fonts = {
  ui: '"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif',
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace',
};

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: colors.accent, contrastText: "#07140a" },
    error: { main: colors.live },
    warning: { main: colors.warn },
    background: { default: colors.bg, paper: colors.panel },
    divider: colors.border,
    text: { primary: colors.text, secondary: colors.muted, disabled: colors.faint },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: fonts.ui,
    fontSize: 13,
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    overline: { fontWeight: 700, letterSpacing: "0.12em", fontSize: 11, lineHeight: 1.6 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: colors.bg, WebkitFontSmoothing: "antialiased", userSelect: "none" },
        "input, textarea": { userSelect: "text" },
        "::-webkit-scrollbar": { width: 10, height: 10 },
        "::-webkit-scrollbar-thumb": { background: colors.border, borderRadius: 8, border: `2px solid ${colors.bg}` },
        "::-webkit-scrollbar-track": { background: "transparent" },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none", border: `1px solid ${colors.border}` } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 7 } },
    },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiTooltip: { defaultProps: { arrow: true, enterDelay: 400 } },
    MuiDialog: {
      styleOverrides: { paper: { backgroundColor: colors.panelRaised, border: `1px solid ${colors.borderStrong}` } },
    },
    MuiAlert: { styleOverrides: { root: { alignItems: "center" } } },
  },
});
