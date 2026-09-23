//! Global "mark clip" hotkey (default F8).
//!
//! Uses the OS-level hotkey API via tauri-plugin-global-shortcut, so it works
//! while OBS, a game or a browser has focus. The press instant is captured
//! immediately in the handler, before any async work, so the marker's
//! timestamp reflects the moment the key was hit.

use std::time::Instant;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::error::{AppError, AppResult};
use crate::models::MarkerSource;
use crate::AppState;

pub fn parse(accelerator: &str) -> AppResult<Shortcut> {
    accelerator
        .trim()
        .parse::<Shortcut>()
        .map_err(|e| AppError::msg(format!("Invalid hotkey \"{accelerator}\": {e}")))
}

/// (Re)register the mark hotkey. On failure the previous hotkey stays active.
pub fn register(app: &AppHandle, accelerator: &str, previous: Option<&str>) -> AppResult<()> {
    let shortcut = parse(accelerator)?;
    let gs = app.global_shortcut();
    if let Some(prev) = previous.and_then(|p| parse(p).ok()) {
        if prev == shortcut && gs.is_registered(shortcut) {
            return Ok(());
        }
        let _ = gs.unregister(prev);
    }
    let result = gs.on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let press = Instant::now();
        #[cfg(debug_assertions)]
        eprintln!("[hotkey] pressed at {}", chrono::Local::now().format("%H:%M:%S%.3f"));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Manager;
            let state = app.state::<AppState>();
            if let Err(e) = state.sessions.mark(&app, press, MarkerSource::Hotkey).await {
                eprintln!("[hotkey] {e}");
            }
        });
    });
    if let Err(e) = result {
        // Restore the previous hotkey so the user is never left without one.
        if let Some(prev) = previous {
            let _ = register(app, prev, None);
        }
        return Err(AppError::msg(format!(
            "Could not register hotkey \"{accelerator}\" — another app may be using it. ({e})"
        )));
    }
    Ok(())
}
