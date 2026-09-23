//! Session lifecycle and marker capture.
//!
//! A session represents one OBS recording. Only one session can be "live"
//! (waiting/active) at a time; it is kept in memory and written to disk after
//! every change, so markers survive a crash or reboot. Ended sessions live only
//! on disk and are edited through `SessionManager::update`.

pub mod clip;
pub mod timing;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use chrono::{DateTime, Local, SecondsFormat};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::obs::{ObsEvent, RecordStatus};
use crate::storage::Storage;
use crate::{ffmpeg, overlay, AppState};

/// How long we wait for OBS to answer the timestamp query before falling back to the clock.
const OBS_MARK_TIMEOUT: Duration = Duration::from_millis(400);
/// Ignore key-repeat / accidental double presses closer than this.
const MARK_DEBOUNCE: Duration = Duration::from_millis(250);

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "mov", "flv", "ts", "m4v", "webm"];

struct Inner {
    live: Option<Session>,
    /// Monotonic instant corresponding to 00:00:00 of the live recording.
    timeline_start: Option<Instant>,
    /// Set when the user ends a session while OBS keeps recording, so the
    /// auto-session logic doesn't immediately start another one.
    suppress_auto: bool,
    last_mark: Option<Instant>,
}

pub struct SessionManager {
    storage: Storage,
    inner: Mutex<Inner>,
}

fn now_iso() -> String {
    Local::now().to_rfc3339_opts(SecondsFormat::Millis, false)
}

fn iso_from_instant(instant: Instant) -> String {
    let ago = Instant::now().saturating_duration_since(instant);
    let wall = Local::now() - chrono::Duration::from_std(ago).unwrap_or_default();
    wall.to_rfc3339_opts(SecondsFormat::Millis, false)
}

/// Reconstruct a monotonic instant from a persisted wall-clock time (crash recovery).
fn instant_from_iso(iso: &str) -> Option<Instant> {
    let then = DateTime::parse_from_rfc3339(iso).ok()?;
    let ago = (Local::now().fixed_offset() - then).to_std().ok()?;
    Instant::now().checked_sub(ago)
}

/// `HH:MM:SS` for toasts/logs.
pub fn hms(seconds: f64) -> String {
    let t = seconds.max(0.0).floor() as u64;
    format!("{:02}:{:02}:{:02}", t / 3600, (t % 3600) / 60, t % 60)
}

/// Local calendar date of a session (`2026-09-23`), used in file names.
pub fn session_date(session: &Session) -> String {
    DateTime::parse_from_rfc3339(&session.started_at)
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| session.id.chars().take(10).collect())
}

fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

/// Newest video file in `dir` modified within `within` — used to guess the
/// active OBS recording when OBS doesn't report the path.
pub fn newest_recording_in(dir: &Path, within: Duration) -> Option<PathBuf> {
    let cutoff = SystemTime::now().checked_sub(within)?;
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let ext = path.extension()?.to_str()?.to_ascii_lowercase();
            if !VIDEO_EXTENSIONS.contains(&ext.as_str()) {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            (modified >= cutoff).then_some((modified, path))
        })
        .max_by_key(|(m, _)| *m)
        .map(|(_, p)| p)
}

impl SessionManager {
    pub fn new(storage: Storage) -> Self {
        Self {
            storage,
            inner: Mutex::new(Inner { live: None, timeline_start: None, suppress_auto: false, last_mark: None }),
        }
    }

    fn emit(app: &AppHandle, session: &Session) {
        let _ = app.emit("session-updated", session);
    }

    fn new_id(&self) -> String {
        let base = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
        if !self.storage.session_exists(&base) {
            return base;
        }
        (2..).map(|n| format!("{base}_{n}")).find(|id| !self.storage.session_exists(id)).unwrap()
    }

    pub fn live(&self) -> Option<Session> {
        self.inner.lock().unwrap().live.clone()
    }

    pub fn get(&self, id: &str) -> AppResult<Session> {
        if let Some(live) = self.inner.lock().unwrap().live.as_ref().filter(|s| s.id == id) {
            return Ok(live.clone());
        }
        self.storage.load_session(id)
    }

    /// Apply a change to a session (live or on disk), persist it and notify the UI.
    pub fn update(&self, app: &AppHandle, id: &str, f: impl FnOnce(&mut Session) -> AppResult<()>) -> AppResult<Session> {
        let mut inner = self.inner.lock().unwrap();
        let session = if let Some(live) = inner.live.as_mut().filter(|s| s.id == id) {
            f(live)?;
            self.storage.save_session(live)?;
            live.clone()
        } else {
            let mut s = self.storage.load_session(id)?;
            f(&mut s)?;
            self.storage.save_session(&s)?;
            s
        };
        drop(inner);
        Self::emit(app, &session);
        Ok(session)
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let inner = self.inner.lock().unwrap();
        if inner.live.as_ref().is_some_and(|s| s.id == id) {
            return Err(AppError::msg("End the active session before deleting it."));
        }
        self.storage.delete_session(id)
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    fn install_live(&self, app: &AppHandle, inner: &mut Inner, session: Session, timeline_start: Option<Instant>) -> Session {
        if let Err(e) = self.storage.save_session(&session) {
            eprintln!("[session] failed to persist session: {e}");
        }
        inner.timeline_start = timeline_start;
        inner.live = Some(session.clone());
        Self::emit(app, &session);
        session
    }

    fn build(&self, mode: SessionMode, status: SessionStatus, timeline_start: Option<Instant>, recording_path: Option<String>) -> Session {
        Session {
            id: self.new_id(),
            mode,
            status,
            started_at: now_iso(),
            ended_at: None,
            timeline_started_at: timeline_start.map(iso_from_instant),
            recording_path,
            duration: None,
            media: None,
            markers: Vec::new(),
        }
    }

    /// Start a session. With OBS connected the timeline is synchronized with
    /// the OBS recording (waiting for it to start if necessary); otherwise the
    /// timeline starts now (manual mode).
    pub async fn start(&self, app: &AppHandle, manual_recording: Option<String>) -> AppResult<Session> {
        if let Some(live) = self.live() {
            return Ok(live);
        }
        let obs = state(app).obs.clone();
        let record = match obs.handle() {
            Some(h) => h
                .request("GetRecordStatus", None, Duration::from_secs(2))
                .await
                .ok()
                .map(|v| RecordStatus::from_response(&v)),
            None => None,
        };
        let now = Instant::now();

        let session = {
            let mut inner = self.inner.lock().unwrap();
            if let Some(live) = inner.live.clone() {
                return Ok(live);
            }
            inner.suppress_auto = false;
            match record {
                Some(r) if r.active => {
                    let t0 = now.checked_sub(Duration::from_secs_f64(r.duration_ms / 1000.0)).unwrap_or(now);
                    let s = self.build(SessionMode::Obs, SessionStatus::Active, Some(t0), None);
                    self.install_live(app, &mut inner, s, Some(t0))
                }
                Some(_) => {
                    let s = self.build(SessionMode::Obs, SessionStatus::Waiting, None, None);
                    self.install_live(app, &mut inner, s, None)
                }
                None => {
                    let s = self.build(SessionMode::Manual, SessionStatus::Active, Some(now), manual_recording);
                    self.install_live(app, &mut inner, s, Some(now))
                }
            }
        };
        if session.mode == SessionMode::Obs && session.status == SessionStatus::Active {
            self.resolve_recording_path(app, session.id.clone());
        }
        Ok(session)
    }

    /// End the live session (user action).
    pub fn stop(&self, app: &AppHandle) -> Option<Session> {
        let obs_recording = state(app).obs.status().recording;
        let mut inner = self.inner.lock().unwrap();
        if inner.live.as_ref().is_some_and(|s| s.mode == SessionMode::Obs) && obs_recording {
            inner.suppress_auto = true;
        }
        self.finish(app, &mut inner, None)
    }

    /// Finalize the live session: mark ended, estimate duration, clamp clips,
    /// persist, and kick off a probe for the exact duration.
    fn finish(&self, app: &AppHandle, inner: &mut Inner, final_path: Option<String>) -> Option<Session> {
        let mut session = inner.live.take()?;
        let t0 = inner.timeline_start.take();
        if final_path.is_some() {
            session.recording_path = final_path;
        }
        if session.status == SessionStatus::Waiting {
            // OBS never started recording: there is nothing to clip, so don't
            // leave an empty stream in the history.
            session.status = SessionStatus::Ended;
            session.ended_at = Some(now_iso());
            let _ = self.storage.delete_session(&session.id);
            Self::emit(app, &session);
            return Some(session);
        }
        if session.duration.is_none() {
            session.duration = t0.map(|t| t.elapsed().as_secs_f64());
        }
        session.status = SessionStatus::Ended;
        session.ended_at = Some(now_iso());
        clamp_markers(&mut session);
        if let Err(e) = self.storage.save_session(&session) {
            eprintln!("[session] failed to persist ended session: {e}");
        }
        Self::emit(app, &session);
        refresh_media(app.clone(), session.id.clone(), Duration::from_secs(2));
        Some(session)
    }

    /// Restore an unfinished session after a crash/restart.
    pub fn restore(&self, app: &AppHandle) {
        let unfinished: Vec<Session> =
            self.storage.list_sessions().into_iter().filter(|s| s.status != SessionStatus::Ended).collect();
        let mut inner = self.inner.lock().unwrap();
        for (i, mut s) in unfinished.into_iter().enumerate() {
            if i == 0 {
                let t0 = s.timeline_started_at.as_deref().and_then(instant_from_iso);
                eprintln!("[session] restored unfinished session {}", s.id);
                inner.timeline_start = t0;
                inner.live = Some(s);
            } else {
                // Only the newest can be live; close older leftovers.
                s.status = SessionStatus::Ended;
                s.ended_at.get_or_insert_with(now_iso);
                let _ = self.storage.save_session(&s);
            }
        }
        drop(inner);
        let _ = app;
    }

    /// Create an ended session from an existing recording file.
    pub fn import(&self, app: &AppHandle, path: &str) -> AppResult<Session> {
        let p = Path::new(path);
        if !p.is_file() {
            return Err(AppError::msg(format!("Recording not found: {path}")));
        }
        // Prefer the file's creation time (≈ when OBS started writing it) as the stream date.
        let started = std::fs::metadata(p)
            .and_then(|m| m.created().or_else(|_| m.modified()))
            .map(|t| DateTime::<Local>::from(t).to_rfc3339_opts(SecondsFormat::Millis, false))
            .unwrap_or_else(|_| now_iso());
        let session = Session {
            id: self.new_id(),
            mode: SessionMode::Imported,
            status: SessionStatus::Ended,
            started_at: started,
            ended_at: Some(now_iso()),
            timeline_started_at: None,
            recording_path: Some(path.to_string()),
            duration: None,
            media: None,
            markers: Vec::new(),
        };
        self.storage.save_session(&session)?;
        Self::emit(app, &session);
        refresh_media(app.clone(), session.id.clone(), Duration::ZERO);
        Ok(session)
    }

    // -----------------------------------------------------------------------
    // Markers
    // -----------------------------------------------------------------------

    /// Capture a marker for the moment `press` happened.
    pub async fn mark(&self, app: &AppHandle, press: Instant, source: MarkerSource) -> AppResult<Marker> {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.last_mark.is_some_and(|t| press.saturating_duration_since(t) < MARK_DEBOUNCE) {
                return Err(AppError::msg("Ignored repeated key press"));
            }
            inner.last_mark = Some(press);
        }

        let obs = state(app).obs.clone();
        if self.live().is_none() {
            // Forgot to start a session but OBS is recording: start one now.
            if obs.handle().is_some() && obs.status().recording {
                self.start(app, None).await?;
            } else {
                overlay::toast(app, overlay::ToastKind::Warn, "NO ACTIVE SESSION", "Open AKS Clipper to start one");
                return Err(AppError::msg("No active session. Start a session first."));
            }
        }
        let Some(live) = self.live() else {
            return Err(AppError::msg("No active session"));
        };
        if live.status == SessionStatus::Waiting {
            overlay::toast(app, overlay::ToastKind::Warn, "OBS IS NOT RECORDING", "Marker not saved");
            return Err(AppError::msg("OBS is not recording yet — the marker was not saved."));
        }

        // Preferred: ask OBS where the recording is right now.
        let mut obs_timestamp = None;
        if live.mode == SessionMode::Obs {
            if let Some(h) = obs.handle() {
                let sent = Instant::now();
                if let Ok(v) = h.request("GetRecordStatus", None, OBS_MARK_TIMEOUT).await {
                    let r = RecordStatus::from_response(&v);
                    if r.active {
                        let ts = timing::timestamp_from_obs(
                            r.duration_ms,
                            sent.saturating_duration_since(press),
                            sent.elapsed(),
                        );
                        obs_timestamp = Some(ts);
                    }
                }
            }
        }

        let (marker, count) = {
            let mut inner = self.inner.lock().unwrap();
            let (timestamp, timing_source) = match obs_timestamp {
                Some(ts) => {
                    // Keep the clock fallback in sync with OBS (handles pauses too).
                    inner.timeline_start = Some(timing::implied_timeline_start(press, ts));
                    (ts, TimingSource::Obs)
                }
                None => {
                    let t0 = *inner.timeline_start.get_or_insert(press);
                    (timing::timestamp_from_clock(t0, press), TimingSource::Clock)
                }
            };
            let settings = state(app).settings.read().unwrap().clone();
            let Some(session) = inner.live.as_mut() else {
                return Err(AppError::msg("Session ended"));
            };
            let timestamp = clip::round_ms(timestamp);
            let (clip_start, clip_end) =
                clip::default_clip_range(timestamp, settings.padding_before, settings.padding_after, session.duration);
            let marker = Marker {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp,
                created_at: now_iso(),
                source,
                timing: timing_source,
                name: None,
                tag: None,
                clip_start,
                clip_end,
                exports: Vec::new(),
            };
            session.markers.push(marker.clone());
            session.markers.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
            if let Err(e) = self.storage.save_session(session) {
                eprintln!("[session] failed to persist marker: {e}");
            }
            Self::emit(app, session);
            (marker, session.markers.len())
        };

        overlay::toast(app, overlay::ToastKind::Marked, "CLIP MARKED", &format!("{}  ·  #{count}", hms(marker.timestamp)));
        let _ = app.emit("marker-added", &marker);
        Ok(marker)
    }

    /// Add a marker after the fact (clip list "Add clip at...").
    pub fn add_marker(&self, app: &AppHandle, id: &str, timestamp: f64) -> AppResult<Session> {
        let settings = state(app).settings.read().unwrap().clone();
        self.update(app, id, |s| {
            let (clip_start, clip_end) =
                clip::default_clip_range(timestamp, settings.padding_before, settings.padding_after, s.duration);
            s.markers.push(Marker {
                id: uuid::Uuid::new_v4().to_string(),
                timestamp: clip::round_ms(timestamp.max(0.0)),
                created_at: now_iso(),
                source: MarkerSource::Added,
                timing: TimingSource::User,
                name: None,
                tag: None,
                clip_start,
                clip_end,
                exports: Vec::new(),
            });
            s.markers.sort_by(|a, b| a.timestamp.total_cmp(&b.timestamp));
            Ok(())
        })
    }

    // -----------------------------------------------------------------------
    // OBS integration
    // -----------------------------------------------------------------------

    pub async fn handle_obs_event(&self, app: &AppHandle, event: ObsEvent) {
        let auto = state(app).settings.read().unwrap().obs.auto_session;
        match event {
            ObsEvent::Connected => self.on_obs_connected(app, auto).await,
            ObsEvent::Disconnected => {}
            ObsEvent::RecordStateChanged { state, path, .. } => match state.as_str() {
                "OBS_WEBSOCKET_OUTPUT_STARTED" => self.on_record_started(app, path, auto),
                "OBS_WEBSOCKET_OUTPUT_STOPPED" => self.on_record_stopped(app, path),
                _ => {}
            },
            ObsEvent::RecordFileChanged { path } => {
                // OBS split the recording into a new file. The MVP keeps the
                // first file (markers are relative to it); just log it.
                eprintln!("[obs] recording file changed to {path}");
            }
        }
    }

    fn on_record_started(&self, app: &AppHandle, path: Option<String>, auto: bool) {
        let now = Instant::now();
        let mut resolve = None;
        {
            let mut inner = self.inner.lock().unwrap();
            inner.suppress_auto = false;
            match inner.live.as_ref().map(|s| (s.mode, s.status)) {
                Some((SessionMode::Obs, SessionStatus::Waiting)) => {
                    let session = inner.live.as_mut().unwrap();
                    session.status = SessionStatus::Active;
                    session.timeline_started_at = Some(iso_from_instant(now));
                    session.recording_path = path.clone();
                    let _ = self.storage.save_session(session);
                    Self::emit(app, session);
                    resolve = Some(session.id.clone());
                    inner.timeline_start = Some(now);
                }
                Some((SessionMode::Obs, SessionStatus::Active)) => {
                    // We missed a stop event: close the old session, then start fresh.
                    self.finish(app, &mut inner, None);
                    if auto {
                        let s = self.build(SessionMode::Obs, SessionStatus::Active, Some(now), path.clone());
                        resolve = Some(self.install_live(app, &mut inner, s, Some(now)).id);
                    }
                }
                Some(_) => {} // manual session: leave it alone
                None if auto => {
                    let s = self.build(SessionMode::Obs, SessionStatus::Active, Some(now), path.clone());
                    resolve = Some(self.install_live(app, &mut inner, s, Some(now)).id);
                }
                None => {}
            }
        }
        if let Some(id) = resolve.filter(|_| path.is_none()) {
            self.resolve_recording_path(app, id);
        }
    }

    fn on_record_stopped(&self, app: &AppHandle, path: Option<String>) {
        let mut inner = self.inner.lock().unwrap();
        inner.suppress_auto = false;
        if inner.live.as_ref().is_some_and(|s| s.mode == SessionMode::Obs && s.status == SessionStatus::Active) {
            self.finish(app, &mut inner, path);
        }
    }

    async fn on_obs_connected(&self, app: &AppHandle, auto: bool) {
        let Some(h) = state(app).obs.handle() else { return };
        let Ok(v) = h.request("GetRecordStatus", None, Duration::from_secs(2)).await else { return };
        let r = RecordStatus::from_response(&v);
        let now = Instant::now();
        let t0 = now.checked_sub(Duration::from_secs_f64(r.duration_ms / 1000.0)).unwrap_or(now);

        let mut resolve = None;
        {
            let mut inner = self.inner.lock().unwrap();
            match inner.live.as_ref().map(|s| (s.mode, s.status, s.id.clone())) {
                Some((SessionMode::Obs, SessionStatus::Active, id)) => {
                    if r.active {
                        inner.timeline_start = Some(t0); // re-sync after reconnect / restart
                        if inner.live.as_ref().is_some_and(|s| s.recording_path.is_none()) {
                            resolve = Some(id);
                        }
                    } else {
                        // Recording stopped while we were disconnected.
                        self.finish(app, &mut inner, None);
                    }
                }
                Some((SessionMode::Obs, SessionStatus::Waiting, id)) if r.active => {
                    let session = inner.live.as_mut().unwrap();
                    session.status = SessionStatus::Active;
                    session.timeline_started_at = Some(iso_from_instant(t0));
                    let _ = self.storage.save_session(session);
                    Self::emit(app, session);
                    inner.timeline_start = Some(t0);
                    resolve = Some(id);
                }
                None if r.active && auto && !inner.suppress_auto => {
                    let s = self.build(SessionMode::Obs, SessionStatus::Active, Some(t0), None);
                    resolve = Some(self.install_live(app, &mut inner, s, Some(t0)).id);
                }
                _ => {}
            }
        }
        if let Some(id) = resolve {
            self.resolve_recording_path(app, id);
        }
    }

    /// Figure out the file OBS is writing when the start event didn't include
    /// it: newest video in OBS's recording directory.
    fn resolve_recording_path(&self, app: &AppHandle, id: String) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Give OBS a moment to create the file.
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let Some(h) = state(&app).obs.handle() else { return };
            let Ok(v) = h.request("GetRecordDirectory", None, Duration::from_secs(2)).await else { return };
            let Some(dir) = crate::obs::protocol::str_field(&v, "recordDirectory") else { return };
            let Some(found) = newest_recording_in(Path::new(&dir), Duration::from_secs(120)) else { return };
            let found = found.display().to_string();
            let _ = state(&app).sessions.update(&app, &id, |s| {
                if s.recording_path.is_none() {
                    s.recording_path = Some(found);
                }
                Ok(())
            });
        });
    }
}

/// Clamp every marker's clip range to the (now known) recording duration.
pub fn clamp_markers(session: &mut Session) {
    let duration = session.duration.filter(|d| *d > 0.0);
    for m in &mut session.markers {
        let (s, e) = clip::clamp_range(m.clip_start, m.clip_end, duration);
        m.clip_start = s;
        m.clip_end = e;
    }
}

/// Probe the session's recording in the background (exact duration, size,
/// codec) and store the result.
pub fn refresh_media(app: AppHandle, id: String, delay: Duration) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        let _ = tauri::async_runtime::spawn_blocking(move || probe_session(&app, &id)).await;
    });
}

pub fn probe_session(app: &AppHandle, id: &str) -> AppResult<Session> {
    let st = state(app);
    let session = st.sessions.get(id)?;
    let path = session.recording_path.clone().ok_or_else(|| AppError::msg("No recording selected"))?;
    if !Path::new(&path).is_file() {
        return Err(AppError::msg(format!("Recording not found: {path}")));
    }
    let configured = st.settings.read().unwrap().ffmpeg_path.clone();
    let exe = ffmpeg::require(app, &configured)?;
    let info = ffmpeg::probe(&exe, Path::new(&path))?;
    st.sessions.update(app, id, |s| {
        if s.status == SessionStatus::Ended {
            if let Some(d) = info.duration {
                s.duration = Some(d);
            }
            clamp_markers(s);
        }
        s.media = Some(info);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hms_formats() {
        assert_eq!(hms(0.0), "00:00:00");
        assert_eq!(hms(6157.9), "01:42:37");
        assert_eq!(hms(4.0 * 3600.0 + 17.0 * 60.0 + 32.0), "04:17:32");
    }

    #[test]
    fn instant_round_trip_through_iso() {
        let t0 = Instant::now() - Duration::from_secs(3600);
        let iso = iso_from_instant(t0);
        let back = instant_from_iso(&iso).unwrap();
        let diff = if back > t0 { back - t0 } else { t0 - back };
        assert!(diff < Duration::from_millis(50), "{diff:?}");
    }

    #[test]
    fn clamp_markers_uses_duration() {
        let mut s = Session {
            id: "x".into(),
            mode: SessionMode::Obs,
            status: SessionStatus::Ended,
            started_at: now_iso(),
            ended_at: None,
            timeline_started_at: None,
            recording_path: None,
            duration: Some(7200.0),
            media: None,
            markers: vec![Marker {
                id: "m".into(),
                timestamp: 7195.0,
                created_at: now_iso(),
                source: MarkerSource::Hotkey,
                timing: TimingSource::Clock,
                name: None,
                tag: None,
                clip_start: 7165.0,
                clip_end: 7225.0,
                exports: vec![],
            }],
        };
        clamp_markers(&mut s);
        assert_eq!((s.markers[0].clip_start, s.markers[0].clip_end), (7165.0, 7200.0));
    }

    #[test]
    fn finds_newest_recording() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        std::fs::write(dir.path().join("a.mkv"), b"x").unwrap();
        std::thread::sleep(Duration::from_millis(30));
        std::fs::write(dir.path().join("b.mp4"), b"x").unwrap();
        let found = newest_recording_in(dir.path(), Duration::from_secs(60)).unwrap();
        assert_eq!(found.file_name().unwrap(), "b.mp4");
    }

    #[test]
    fn session_date_from_started_at() {
        let mut s = Session {
            id: "2026-09-23_16-32-10".into(),
            mode: SessionMode::Manual,
            status: SessionStatus::Ended,
            started_at: "garbage".into(),
            ended_at: None,
            timeline_started_at: None,
            recording_path: None,
            duration: None,
            media: None,
            markers: vec![],
        };
        assert_eq!(session_date(&s), "2026-09-23");
        s.started_at = Local::now().to_rfc3339();
        assert_eq!(session_date(&s), Local::now().format("%Y-%m-%d").to_string());
    }
}
