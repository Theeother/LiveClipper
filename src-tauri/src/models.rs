//! Data types shared between the backend and the frontend (serialized as camelCase JSON).

use serde::{Deserialize, Serialize};

/// Where a marker came from. Only manual sources exist today; the enum is the
/// extension point for future sources (AI, chat, audio events...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MarkerSource {
    /// Global hotkey pressed while streaming.
    Hotkey,
    /// "Mark clip" button in the app window.
    Button,
    /// Added after the fact in the clip list (e.g. for an imported recording).
    Added,
}

/// How the marker's timestamp was determined.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimingSource {
    /// Queried from OBS (`GetRecordStatus.outputDuration`): the real position in the file.
    Obs,
    /// Monotonic clock relative to the recording/session start.
    Clock,
    /// Entered by the user.
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipExport {
    pub path: String,
    pub preset: ExportPreset,
    pub exported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: String,
    /// Seconds from the beginning of the recording.
    pub timestamp: f64,
    /// Local wall-clock time the marker was created (ISO 8601).
    pub created_at: String,
    pub source: MarkerSource,
    pub timing: TimingSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tag: Option<String>,
    /// Clip range in seconds from the beginning of the recording.
    pub clip_start: f64,
    pub clip_end: f64,
    #[serde(default)]
    pub exports: Vec<ClipExport>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    /// Timeline synchronized with OBS recording state via obs-websocket.
    Obs,
    /// Timeline starts when the user clicks "Start session".
    Manual,
    /// Created from an existing recording file after the fact.
    Imported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionStatus {
    /// OBS mode, waiting for OBS to start recording.
    Waiting,
    Active,
    Ended,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub video_codec: Option<String>,
    pub has_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// e.g. `2026-09-23_16-32-10`; also the JSON file name.
    pub id: String,
    pub mode: SessionMode,
    pub status: SessionStatus,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    /// Wall-clock instant corresponding to 00:00:00 of the recording.
    /// Used to display elapsed time and to recover the timeline after a crash.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeline_started_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recording_path: Option<String>,
    /// Recording duration in seconds, once known (from OBS or FFmpeg probe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<MediaInfo>,
    #[serde(default)]
    pub markers: Vec<Marker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub mode: SessionMode,
    pub status: SessionStatus,
    pub started_at: String,
    pub recording_path: Option<String>,
    pub duration: Option<f64>,
    pub marker_count: usize,
}

impl From<&Session> for SessionSummary {
    fn from(s: &Session) -> Self {
        Self {
            id: s.id.clone(),
            mode: s.mode,
            status: s.status,
            started_at: s.started_at.clone(),
            recording_path: s.recording_path.clone(),
            duration: s.duration,
            marker_count: s.markers.len(),
        }
    }
}

/// Export layout. New layouts (1:1, split-screen facecam...) are added here and
/// in `ffmpeg::command::video_chain`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportPreset {
    Original,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WatermarkPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ObsSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub password: String,
    /// Start a session automatically when OBS starts recording (and end it when OBS stops).
    pub auto_session: bool,
}

impl Default for ObsSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            host: "localhost".into(),
            port: 4455,
            password: String::new(),
            auto_session: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WatermarkSettings {
    pub enabled: bool,
    pub image_path: Option<String>,
    pub position: WatermarkPosition,
    /// 0.0 – 1.0
    pub opacity: f64,
}

impl Default for WatermarkSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            image_path: None,
            position: WatermarkPosition::BottomRight,
            opacity: 0.8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub obs: ObsSettings,
    /// Tauri accelerator string, e.g. `F8` or `Ctrl+Shift+M`.
    pub hotkey: String,
    pub padding_before: f64,
    pub padding_after: f64,
    /// Empty = `~/Videos/AKS Clips`.
    pub output_dir: String,
    pub watermark: WatermarkSettings,
    pub export_preset: ExportPreset,
    /// Show the small "clip marked" confirmation on screen.
    pub show_overlay: bool,
    /// Optional explicit ffmpeg.exe path. Empty = auto-detect.
    pub ffmpeg_path: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            obs: ObsSettings::default(),
            hotkey: "F8".into(),
            padding_before: 30.0,
            padding_after: 30.0,
            output_dir: String::new(),
            watermark: WatermarkSettings::default(),
            export_preset: ExportPreset::Original,
            show_overlay: true,
            ffmpeg_path: String::new(),
        }
    }
}
