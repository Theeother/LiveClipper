// Typed wrappers around the Rust commands (src-tauri/src/commands.rs).
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  ExportPreset,
  ExportStarted,
  FfmpegStatus,
  HotkeyStatus,
  Marker,
  MarkerPatch,
  ObsStatus,
  ObsTestResult,
  PreparedMedia,
  PreviewInfo,
  Session,
  SessionSummary,
  Settings,
} from "../types";

export const api = {
  // settings
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  defaultOutputDir: () => invoke<string>("default_output_dir"),
  getHotkeyStatus: () => invoke<HotkeyStatus>("get_hotkey_status"),

  // status
  getObsStatus: () => invoke<ObsStatus>("get_obs_status"),
  testObsConnection: (host: string, port: number, password: string) =>
    invoke<ObsTestResult>("test_obs_connection", { host, port, password }),
  getFfmpegStatus: () => invoke<FfmpegStatus>("get_ffmpeg_status"),

  // live session
  getLiveSession: () => invoke<Session | null>("get_live_session"),
  startSession: (recordingPath?: string) => invoke<Session>("start_session", { recordingPath: recordingPath ?? null }),
  stopSession: () => invoke<Session | null>("stop_session"),
  markClip: () => invoke<Marker>("mark_clip"),

  // sessions
  listSessions: () => invoke<SessionSummary[]>("list_sessions"),
  getSession: (id: string) => invoke<Session>("get_session", { id }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),
  importRecording: (path: string) => invoke<Session>("import_recording", { path }),
  setRecordingPath: (id: string, path: string) => invoke<Session>("set_recording_path", { id, path }),

  // markers
  addMarker: (sessionId: string, timestamp: number) => invoke<Session>("add_marker", { sessionId, timestamp }),
  updateMarker: (sessionId: string, markerId: string, patch: MarkerPatch) =>
    invoke<Session>("update_marker", { sessionId, markerId, patch }),
  deleteMarker: (sessionId: string, markerId: string) => invoke<Session>("delete_marker", { sessionId, markerId }),

  // media & export
  prepareMedia: (sessionId: string) => invoke<PreparedMedia>("prepare_media", { sessionId }),
  createPreview: (sessionId: string, start: number, length: number) =>
    invoke<PreviewInfo>("create_preview", { sessionId, start, length }),
  startExport: (request: {
    sessionId: string;
    markerId: string;
    clipStart: number;
    clipEnd: number;
    preset: ExportPreset;
    name?: string;
  }) => invoke<ExportStarted>("start_export", { request }),
  cancelExport: (jobId: string) => invoke<void>("cancel_export", { jobId }),
};

/** URL the <video> element can stream from (HTTP range requests, never loaded into RAM). */
export const mediaUrl = (path: string) => convertFileSrc(path);

/** Tauri rejects with a plain string; normalize for display. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
