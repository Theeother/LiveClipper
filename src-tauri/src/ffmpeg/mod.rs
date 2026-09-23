//! FFmpeg discovery, probing, preview proxies and export jobs.

pub mod command;
pub mod probe;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::models::MediaInfo;

pub const EXE: &str = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

/// Build a `Command` that never flashes a console window and runs at
/// below-normal priority so an export never competes with OBS or a game.
pub fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        cmd.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
    }
    cmd
}

/// Candidate locations, in priority order:
/// 1. explicit path from Settings
/// 2. bundled with the app (`resources/ffmpeg/ffmpeg.exe`)
/// 3. next to the executable
/// 4. `PATH`
/// 5. common package-manager locations (winget, scoop, chocolatey, C:\ffmpeg)
fn candidates(app: &AppHandle, configured: &str) -> Vec<PathBuf> {
    let mut c = Vec::new();
    if !configured.trim().is_empty() {
        c.push(PathBuf::from(configured.trim()));
    }
    if let Ok(res) = app.path().resource_dir() {
        c.push(res.join("resources").join("ffmpeg").join(EXE));
        c.push(res.join("ffmpeg").join(EXE));
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        c.push(dir.join(EXE));
    }
    if let Some(path) = std::env::var_os("PATH") {
        c.extend(std::env::split_paths(&path).map(|d| d.join(EXE)));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let winget = PathBuf::from(local).join("Microsoft").join("WinGet");
        c.push(winget.join("Links").join(EXE));
        // `winget install Gyan.FFmpeg` edits the user PATH, which processes
        // started before the install don't see; look in the package folder directly.
        c.extend(winget_ffmpeg_bins(&winget.join("Packages")));
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        c.push(PathBuf::from(home).join("scoop").join("shims").join(EXE));
    }
    c.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin").join(EXE));
    c.push(PathBuf::from(r"C:\ffmpeg\bin").join(EXE));
    c
}

/// `Packages/*FFmpeg*/<build>/bin/ffmpeg.exe`
fn winget_ffmpeg_bins(packages: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(packages) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().contains("ffmpeg"))
        .filter_map(|pkg| std::fs::read_dir(pkg.path()).ok())
        .flat_map(|builds| builds.flatten().map(|b| b.path().join("bin").join(EXE)))
        .collect()
}

pub fn locate(app: &AppHandle, configured: &str) -> Option<PathBuf> {
    candidates(app, configured).into_iter().find(|p| p.is_file())
}

pub fn status(app: &AppHandle, configured: &str) -> FfmpegStatus {
    let Some(path) = locate(app, configured) else {
        return FfmpegStatus {
            found: false,
            path: None,
            version: None,
            error: Some(if configured.trim().is_empty() {
                "FFmpeg was not found. Install it (winget install Gyan.FFmpeg) or set its path in Settings.".into()
            } else {
                format!("FFmpeg not found at {configured}")
            }),
        };
    };
    match command(&path).arg("-version").stdin(Stdio::null()).output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            FfmpegStatus {
                found: true,
                path: Some(path.display().to_string()),
                version: text.lines().next().map(|l| l.trim().to_string()),
                error: None,
            }
        }
        Ok(out) => FfmpegStatus {
            found: false,
            path: Some(path.display().to_string()),
            version: None,
            error: Some(format!("FFmpeg exited with {}", out.status)),
        },
        Err(e) => FfmpegStatus {
            found: false,
            path: Some(path.display().to_string()),
            version: None,
            error: Some(format!("Could not run FFmpeg: {e}")),
        },
    }
}

pub fn require(app: &AppHandle, configured: &str) -> AppResult<PathBuf> {
    locate(app, configured).ok_or_else(|| {
        AppError::msg("FFmpeg is missing. Install it with `winget install Gyan.FFmpeg` or set the ffmpeg.exe path in Settings.")
    })
}

/// Probe a media file (duration, resolution, codec, audio presence).
pub fn probe(exe: &Path, input: &Path) -> AppResult<MediaInfo> {
    let out = command(exe)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(input)
        .stdin(Stdio::null())
        .output()?;
    // `ffmpeg -i` without an output always "fails"; the info is on stderr.
    let info = probe::parse_probe_output(&String::from_utf8_lossy(&out.stderr));
    if info.width.is_none() && info.duration.is_none() {
        return Err(AppError::msg(format!("FFmpeg could not read {}", input.display())));
    }
    Ok(info)
}

/// Create (or reuse) a 540p H.264 proxy of `[start, start+len)`.
pub fn make_preview(exe: &Path, input: &Path, start: f64, len: f64, output: &Path) -> AppResult<()> {
    if output.is_file() {
        return Ok(());
    }
    if let Some(dir) = output.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = output.with_extension("part.mp4");
    let args = command::preview_args(&input.to_string_lossy(), start, len, &tmp.to_string_lossy());
    let out = command(exe).args(&args).stdin(Stdio::null()).output()?;
    if !out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::msg(format!(
            "Preview generation failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    std::fs::rename(&tmp, output)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Export jobs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub job_id: String,
    /// 0.0 – 1.0
    pub progress: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportOutcome {
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFinished {
    pub job_id: String,
    pub outcome: ExportOutcome,
    pub output_path: String,
    pub error: Option<String>,
}

struct Job {
    child: Mutex<Child>,
    cancelled: std::sync::atomic::AtomicBool,
}

#[derive(Default)]
pub struct ExportJobs {
    jobs: Mutex<HashMap<String, Arc<Job>>>,
}

/// Last `n` non-empty lines of FFmpeg's stderr, for error messages.
fn last_lines(text: &str, n: usize) -> Option<String> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    (!lines.is_empty()).then(|| lines[lines.len().saturating_sub(n)..].join("\n"))
}

/// Parse `out_time_us=12345678` (or the misnamed `out_time_ms`, also µs) from `-progress` output.
pub fn parse_progress_line(line: &str) -> Option<f64> {
    let (key, value) = line.trim().split_once('=')?;
    match key {
        "out_time_us" | "out_time_ms" => value.parse::<f64>().ok().filter(|v| *v >= 0.0).map(|us| us / 1_000_000.0),
        _ => None,
    }
}

/// Temporary path FFmpeg writes to; renamed to the final name only on success,
/// so a cancelled/failed export never looks like a finished clip.
pub fn part_path(output: &Path) -> PathBuf {
    output.with_extension("part.mp4")
}

/// Delete a file, retrying briefly: right after a process is killed Windows
/// (or an antivirus scan of the fresh file) can still hold a handle for a few seconds.
fn remove_with_retry(path: &Path) {
    for _ in 0..50 {
        if !path.exists() || std::fs::remove_file(path).is_ok() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

fn rename_with_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = Ok(());
    for _ in 0..50 {
        last = std::fs::rename(from, to);
        if last.is_ok() {
            return last;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    last
}

impl ExportJobs {
    /// Spawn FFmpeg (whose args must write to `part_path(&output)`) and track
    /// it. Progress and completion are emitted as `export-progress` /
    /// `export-finished` events; `on_done` runs after a successful export
    /// (used to record the export on the marker).
    pub fn start(
        &self,
        app: AppHandle,
        exe: &Path,
        args: Vec<String>,
        output: PathBuf,
        duration: f64,
        on_done: impl FnOnce(&Path) + Send + 'static,
    ) -> AppResult<String> {
        let part = part_path(&output);
        if let Some(dir) = output.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut child = command(exe)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::msg(format!("Could not start FFmpeg: {e}")))?;

        let job_id = uuid::Uuid::new_v4().to_string();
        let stdout = child.stdout.take().expect("piped stdout");
        let mut stderr = child.stderr.take().expect("piped stderr");
        let job = Arc::new(Job { child: Mutex::new(child), cancelled: Default::default() });
        self.jobs.lock().unwrap().insert(job_id.clone(), job.clone());

        let stderr_thread = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });

        let id = job_id.clone();
        std::thread::spawn(move || {
            let mut last_emit = -1.0;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(t) = parse_progress_line(&line) {
                    let p = (t / duration.max(0.1)).clamp(0.0, 1.0);
                    if p - last_emit >= 0.005 {
                        last_emit = p;
                        let _ = app.emit("export-progress", ExportProgress { job_id: id.clone(), progress: p });
                    }
                }
            }
            let status = job.child.lock().unwrap().wait();
            let stderr_text = stderr_thread.join().unwrap_or_default();
            let cancelled = job.cancelled.load(std::sync::atomic::Ordering::SeqCst);

            let (mut outcome, mut error) = match status {
                _ if cancelled => (ExportOutcome::Cancelled, None),
                Ok(s) if s.success() && part.is_file() => (ExportOutcome::Done, None),
                Ok(s) => (ExportOutcome::Failed, Some(last_lines(&stderr_text, 6).unwrap_or_else(|| format!("FFmpeg exited with {s}")))),
                Err(e) => (ExportOutcome::Failed, Some(e.to_string())),
            };
            if outcome == ExportOutcome::Done {
                if let Err(e) = rename_with_retry(&part, &output) {
                    outcome = ExportOutcome::Failed;
                    error = Some(format!("Could not finalize {}: {e}", output.display()));
                }
            }
            if outcome == ExportOutcome::Done {
                on_done(&output);
            } else {
                remove_with_retry(&part);
            }
            app.state::<crate::AppState>().exports.jobs.lock().unwrap().remove(&id);
            let _ = app.emit(
                "export-finished",
                ExportFinished { job_id: id, outcome, output_path: output.display().to_string(), error },
            );
        });

        Ok(job_id)
    }

    pub fn cancel(&self, job_id: &str) {
        if let Some(job) = self.jobs.lock().unwrap().get(job_id) {
            job.cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = job.child.lock().unwrap().kill();
        }
    }

    pub fn cancel_all(&self) {
        let ids: Vec<String> = self.jobs.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.cancel(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_lines() {
        assert_eq!(parse_progress_line("out_time_us=30500000"), Some(30.5));
        assert_eq!(parse_progress_line("out_time_ms=1000000"), Some(1.0));
        assert_eq!(parse_progress_line("out_time_us=N/A"), None);
        assert_eq!(parse_progress_line("out_time_us=-9223372036854775807"), None);
        assert_eq!(parse_progress_line("progress=continue"), None);
        assert_eq!(parse_progress_line("frame=120"), None);
    }
}
