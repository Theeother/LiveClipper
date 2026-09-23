// Mirrors src-tauri/src/models.rs (serde camelCase).

export type MarkerSource = "hotkey" | "button" | "added";
export type TimingSource = "obs" | "clock" | "user";
export type ExportPreset = "original" | "vertical";
export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type SessionMode = "obs" | "manual" | "imported";
export type SessionStatus = "waiting" | "active" | "ended";

export interface ClipExport {
  path: string;
  preset: ExportPreset;
  exportedAt: string;
}

export interface Marker {
  id: string;
  /** Seconds from the beginning of the recording. */
  timestamp: number;
  createdAt: string;
  source: MarkerSource;
  timing: TimingSource;
  name?: string;
  tag?: string;
  clipStart: number;
  clipEnd: number;
  exports: ClipExport[];
}

export interface MediaInfo {
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  hasAudio: boolean;
}

export interface Session {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  timelineStartedAt?: string;
  recordingPath?: string;
  duration?: number;
  media?: MediaInfo;
  markers: Marker[];
}

export interface SessionSummary {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  startedAt: string;
  recordingPath?: string;
  duration?: number;
  markerCount: number;
}

export interface ObsSettings {
  enabled: boolean;
  host: string;
  port: number;
  password: string;
  autoSession: boolean;
}

export interface WatermarkSettings {
  enabled: boolean;
  imagePath?: string | null;
  position: WatermarkPosition;
  opacity: number;
}

export interface Settings {
  obs: ObsSettings;
  hotkey: string;
  paddingBefore: number;
  paddingAfter: number;
  outputDir: string;
  watermark: WatermarkSettings;
  exportPreset: ExportPreset;
  showOverlay: boolean;
  ffmpegPath: string;
}

export type ObsConnState = "disabled" | "connecting" | "connected" | "disconnected" | "error";

export interface ObsStatus {
  state: ObsConnState;
  message?: string | null;
  obsVersion?: string | null;
  websocketVersion?: string | null;
  recording: boolean;
}

export interface ObsTestResult {
  obsVersion?: string | null;
  websocketVersion?: string | null;
  recording: boolean;
}

export interface FfmpegStatus {
  found: boolean;
  path?: string | null;
  version?: string | null;
  error?: string | null;
}

export interface HotkeyStatus {
  accelerator: string;
  error?: string | null;
}

export interface PreparedMedia {
  path: string;
  exists: boolean;
  media?: MediaInfo | null;
}

export interface PreviewInfo {
  path: string;
  offset: number;
}

export interface ExportStarted {
  jobId: string;
  outputPath: string;
  clipStart: number;
  clipEnd: number;
}

export interface ExportProgressEvent {
  jobId: string;
  progress: number;
}

export interface ExportFinishedEvent {
  jobId: string;
  outcome: "done" | "cancelled" | "failed";
  outputPath: string;
  error?: string | null;
}

export interface MarkerPatch {
  name?: string;
  tag?: string;
  clipStart?: number;
  clipEnd?: number;
}
