//! Tauri commands invoked by the frontend.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::ffmpeg::command::{export_args, ExportSpec, WatermarkSpec};
use crate::ffmpeg::{self, FfmpegStatus};
use crate::filename;
use crate::models::*;
use crate::obs::{self, ObsStatus, ObsTestResult};
use crate::session::{self, clip};
use crate::{hotkey, AppState};

// --- Settings ---------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.read().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let previous = state.settings.read().unwrap().clone();
    let mut settings = settings;
    settings.padding_before = settings.padding_before.clamp(0.0, 600.0);
    settings.padding_after = settings.padding_after.clamp(0.0, 600.0);
    settings.watermark.opacity = settings.watermark.opacity.clamp(0.0, 1.0);
    if settings.hotkey.trim().is_empty() {
        settings.hotkey = "F8".into();
    }

    if settings.hotkey != previous.hotkey {
        hotkey::register(&app, &settings.hotkey, Some(&previous.hotkey))?;
        *state.hotkey_error.lock().unwrap() = None;
    }
    state.storage.save_settings(&settings)?;
    *state.settings.write().unwrap() = settings.clone();

    let obs_changed = serde_json::to_value(&previous.obs).ok() != serde_json::to_value(&settings.obs).ok();
    if obs_changed {
        state.obs.update_config(settings.obs.clone());
    }
    Ok(settings)
}

#[tauri::command]
pub fn default_output_dir(app: AppHandle) -> String {
    resolve_output_dir(&app, "").display().to_string()
}

fn resolve_output_dir(app: &AppHandle, configured: &str) -> PathBuf {
    if !configured.trim().is_empty() {
        return PathBuf::from(configured.trim());
    }
    app.path()
        .video_dir()
        .or_else(|_| app.path().home_dir().map(|h| h.join("Videos")))
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("AKS Clips")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub accelerator: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn get_hotkey_status(state: State<'_, AppState>) -> HotkeyStatus {
    HotkeyStatus {
        accelerator: state.settings.read().unwrap().hotkey.clone(),
        error: state.hotkey_error.lock().unwrap().clone(),
    }
}

// --- OBS / FFmpeg status -------------------------------------------------------

#[tauri::command]
pub fn get_obs_status(state: State<'_, AppState>) -> ObsStatus {
    state.obs.status()
}

#[tauri::command]
pub async fn test_obs_connection(host: String, port: u16, password: String) -> Result<ObsTestResult, String> {
    let cfg = ObsSettings { enabled: true, host, port, password, auto_session: false };
    obs::test_connection(&cfg).await
}

#[tauri::command]
pub async fn get_ffmpeg_status(app: AppHandle, state: State<'_, AppState>) -> Result<FfmpegStatus, String> {
    let configured = state.settings.read().unwrap().ffmpeg_path.clone();
    tauri::async_runtime::spawn_blocking(move || ffmpeg::status(&app, &configured))
        .await
        .map_err(|e| e.to_string())
}

// --- Live session -------------------------------------------------------------

#[tauri::command]
pub fn get_live_session(state: State<'_, AppState>) -> Option<Session> {
    state.sessions.live()
}

#[tauri::command]
pub async fn start_session(app: AppHandle, recording_path: Option<String>) -> AppResult<Session> {
    let state = app.state::<AppState>();
    state.sessions.start(&app, recording_path.filter(|p| !p.trim().is_empty())).await
}

#[tauri::command]
pub fn stop_session(app: AppHandle, state: State<'_, AppState>) -> Option<Session> {
    state.sessions.stop(&app)
}

#[tauri::command]
pub async fn mark_clip(app: AppHandle) -> AppResult<Marker> {
    let press = Instant::now();
    let state = app.state::<AppState>();
    state.sessions.mark(&app, press, MarkerSource::Button).await
}

// --- Sessions -----------------------------------------------------------------

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Vec<SessionSummary> {
    let mut list = state.storage.list_summaries();
    // The live session in memory is the freshest version.
    if let Some(live) = state.sessions.live() {
        list.retain(|s| s.id != live.id);
        list.insert(0, SessionSummary::from(&live));
    }
    list
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>, id: String) -> AppResult<Session> {
    state.sessions.get(&id)
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.sessions.delete(&id)
}

#[tauri::command]
pub fn import_recording(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<Session> {
    state.sessions.import(&app, &path)
}

#[tauri::command]
pub fn set_recording_path(app: AppHandle, state: State<'_, AppState>, id: String, path: String) -> AppResult<Session> {
    if !Path::new(&path).is_file() {
        return Err(AppError::msg(format!("File not found: {path}")));
    }
    let session = state.sessions.update(&app, &id, |s| {
        s.recording_path = Some(path);
        s.media = None;
        Ok(())
    })?;
    session::refresh_media(app.clone(), id, Duration::ZERO);
    Ok(session)
}

// --- Markers ------------------------------------------------------------------

#[tauri::command]
pub fn add_marker(app: AppHandle, state: State<'_, AppState>, session_id: String, timestamp: f64) -> AppResult<Session> {
    state.sessions.add_marker(&app, &session_id, timestamp)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkerPatch {
    /// `Some("")` clears the name.
    pub name: Option<String>,
    pub tag: Option<String>,
    pub clip_start: Option<f64>,
    pub clip_end: Option<f64>,
}

fn apply_patch(session: &mut Session, marker_id: &str, patch: MarkerPatch) -> AppResult<()> {
    let duration = session.duration;
    let marker = session
        .markers
        .iter_mut()
        .find(|m| m.id == marker_id)
        .ok_or_else(|| AppError::msg("Marker not found"))?;
    if let Some(name) = patch.name {
        marker.name = Some(name.trim().to_string()).filter(|n| !n.is_empty());
    }
    if let Some(tag) = patch.tag {
        marker.tag = Some(tag.trim().to_string()).filter(|t| !t.is_empty());
    }
    if patch.clip_start.is_some() || patch.clip_end.is_some() {
        let (s, e) = clip::clamp_range(
            patch.clip_start.unwrap_or(marker.clip_start),
            patch.clip_end.unwrap_or(marker.clip_end),
            duration,
        );
        marker.clip_start = s;
        marker.clip_end = e;
    }
    Ok(())
}

#[tauri::command]
pub fn update_marker(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    marker_id: String,
    patch: MarkerPatch,
) -> AppResult<Session> {
    state.sessions.update(&app, &session_id, |s| apply_patch(s, &marker_id, patch))
}

#[tauri::command]
pub fn delete_marker(app: AppHandle, state: State<'_, AppState>, session_id: String, marker_id: String) -> AppResult<Session> {
    state.sessions.update(&app, &session_id, |s| {
        s.markers.retain(|m| m.id != marker_id);
        Ok(())
    })
}

// --- Media (editor) -------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMedia {
    pub path: String,
    pub exists: bool,
    pub media: Option<MediaInfo>,
}

/// Make the session's recording playable in the webview (asset protocol scope)
/// and make sure we know its duration/codec.
#[tauri::command]
pub async fn prepare_media(app: AppHandle, session_id: String) -> AppResult<PreparedMedia> {
    let state = app.state::<AppState>();
    let session = state.sessions.get(&session_id)?;
    let path = session.recording_path.clone().ok_or_else(|| AppError::msg("No recording file is associated with this session."))?;
    let exists = Path::new(&path).is_file();
    if !exists {
        return Ok(PreparedMedia { path, exists, media: None });
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| AppError::msg(format!("Cannot allow media file: {e}")))?;

    let media = match session.media {
        Some(m) => Some(m),
        None => {
            let app2 = app.clone();
            let id = session_id.clone();
            tauri::async_runtime::spawn_blocking(move || session::probe_session(&app2, &id))
                .await
                .ok()
                .and_then(Result::ok)
                .and_then(|s| s.media)
        }
    };
    Ok(PreparedMedia { path, exists, media })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewInfo {
    pub path: String,
    /// Recording time (seconds) at which the preview starts.
    pub offset: f64,
}

/// Build a small H.264 proxy around the clip for recordings the webview can't
/// decode directly (e.g. HEVC).
#[tauri::command]
pub async fn create_preview(app: AppHandle, session_id: String, start: f64, length: f64) -> AppResult<PreviewInfo> {
    let state = app.state::<AppState>();
    let session = state.sessions.get(&session_id)?;
    let input = session.recording_path.ok_or_else(|| AppError::msg("No recording file"))?;
    let configured = state.settings.read().unwrap().ffmpeg_path.clone();
    let exe = ffmpeg::require(&app, &configured)?;
    let start = start.max(0.0).floor();
    let length = length.clamp(10.0, 1200.0).ceil();
    let out = app
        .path()
        .app_cache_dir()?
        .join("previews")
        .join(format!("{session_id}_{start}_{length}.mp4"));
    let out2 = out.clone();
    tauri::async_runtime::spawn_blocking(move || ffmpeg::make_preview(&exe, Path::new(&input), start, length, &out2))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    app.asset_protocol_scope()
        .allow_file(&out)
        .map_err(|e| AppError::msg(format!("Cannot allow preview file: {e}")))?;
    Ok(PreviewInfo { path: out.display().to_string(), offset: start })
}

// --- Export ---------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub session_id: String,
    pub marker_id: String,
    pub clip_start: f64,
    pub clip_end: f64,
    pub preset: ExportPreset,
    pub name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportStarted {
    pub job_id: String,
    pub output_path: String,
    pub clip_start: f64,
    pub clip_end: f64,
}

#[tauri::command]
pub async fn start_export(app: AppHandle, request: ExportRequest) -> AppResult<ExportStarted> {
    let state = app.state::<AppState>();
    let settings = state.settings.read().unwrap().clone();
    let exe = ffmpeg::require(&app, &settings.ffmpeg_path)?;

    // Persist the final range/name first so the export matches what's saved.
    let session = state.sessions.update(&app, &request.session_id, |s| {
        apply_patch(
            s,
            &request.marker_id,
            MarkerPatch {
                name: request.name.clone(),
                tag: None,
                clip_start: Some(request.clip_start),
                clip_end: Some(request.clip_end),
            },
        )
    })?;
    let marker = session.markers.iter().find(|m| m.id == request.marker_id).cloned().ok_or_else(|| AppError::msg("Marker not found"))?;
    let input = session.recording_path.clone().ok_or_else(|| AppError::msg("No recording file is associated with this session."))?;
    if !Path::new(&input).is_file() {
        return Err(AppError::msg(format!("Recording not found: {input}. Select the recording file again.")));
    }

    let watermark = if settings.watermark.enabled {
        let image = settings.watermark.image_path.clone().filter(|p| !p.trim().is_empty());
        match image {
            Some(p) if Path::new(&p).is_file() => Some(WatermarkSpec {
                image_path: p,
                position: settings.watermark.position,
                opacity: settings.watermark.opacity,
            }),
            Some(p) => return Err(AppError::msg(format!("Watermark image not found: {p}"))),
            None => None, // enabled but no image selected: nothing to add
        }
    } else {
        None
    };

    let media = match session.media.clone() {
        Some(m) => Some(m),
        None => {
            let (exe2, input2) = (exe.clone(), input.clone());
            tauri::async_runtime::spawn_blocking(move || ffmpeg::probe(&exe2, Path::new(&input2)).ok())
                .await
                .ok()
                .flatten()
        }
    };
    let source_size = media.as_ref().and_then(|m| Some((m.width?, m.height?)));

    let out_dir = resolve_output_dir(&app, &settings.output_dir);
    std::fs::create_dir_all(&out_dir).map_err(|e| AppError::msg(format!("Cannot create output folder {}: {e}", out_dir.display())))?;
    let stem = filename::clip_file_stem(&session::session_date(&session), marker.clip_start, marker.name.as_deref(), request.preset);
    let output = filename::unique_path(&out_dir, &stem, "mp4");

    let spec = ExportSpec {
        input,
        // FFmpeg writes to NAME.part.mp4; renamed to NAME.mp4 on success.
        output: ffmpeg::part_path(&output).display().to_string(),
        start: marker.clip_start,
        end: marker.clip_end,
        preset: request.preset,
        source_size,
        watermark,
    };
    let args = export_args(&spec);
    let duration = marker.clip_end - marker.clip_start;

    let app2 = app.clone();
    let (session_id, marker_id, preset) = (request.session_id.clone(), request.marker_id.clone(), request.preset);
    let job_id = state.exports.start(app.clone(), &exe, args, output.clone(), duration, move |path| {
        let path = path.display().to_string();
        let _ = app2.state::<AppState>().sessions.update(&app2, &session_id, |s| {
            if let Some(m) = s.markers.iter_mut().find(|m| m.id == marker_id) {
                m.exports.push(ClipExport {
                    path,
                    preset,
                    exported_at: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
                });
            }
            Ok(())
        });
    })?;

    Ok(ExportStarted {
        job_id,
        output_path: output.display().to_string(),
        clip_start: marker.clip_start,
        clip_end: marker.clip_end,
    })
}

#[tauri::command]
pub fn cancel_export(state: State<'_, AppState>, job_id: String) {
    state.exports.cancel(&job_id);
}
