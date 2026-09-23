//! AKS Clipper backend.
//!
//! OBS records the video; this app only tracks the session, records marker
//! timestamps, and exports clips with FFmpeg.
//!
//! ```text
//!  hotkey ─┐                         ┌─> overlay toast
//!  button ─┼─> SessionManager::mark ─┼─> sessions/<id>.json
//!  OBS ws ─┘   (OBS time | clock)    └─> "session-updated" -> UI
//! ```

mod commands;
mod error;
mod ffmpeg;
mod filename;
mod hotkey;
mod models;
mod obs;
mod overlay;
mod session;
mod storage;

use std::sync::{Arc, Mutex, RwLock};

use tauri::{Manager, WindowEvent};

use models::Settings;
use obs::ObsManager;
use session::SessionManager;
use storage::Storage;

pub struct AppState {
    pub storage: Storage,
    pub settings: RwLock<Settings>,
    pub sessions: SessionManager,
    pub obs: Arc<ObsManager>,
    pub exports: ffmpeg::ExportJobs,
    pub hotkey_error: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // A second instance would fight over the global hotkey; focus the first instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let storage = Storage::new(app.path().app_data_dir()?);
            let settings = storage.load_settings();
            let obs = ObsManager::new(settings.obs.clone());

            app.manage(AppState {
                sessions: SessionManager::new(storage.clone()),
                storage,
                settings: RwLock::new(settings.clone()),
                obs: obs.clone(),
                exports: Default::default(),
                hotkey_error: Mutex::new(None),
            });

            if let Err(e) = overlay::create(&handle) {
                eprintln!("[overlay] could not create overlay window: {e}");
            }
            if let Err(e) = hotkey::register(&handle, &settings.hotkey, None) {
                eprintln!("[hotkey] {e}");
                *app.state::<AppState>().hotkey_error.lock().unwrap() = Some(e.to_string());
            }

            app.state::<AppState>().sessions.restore(&handle);

            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            obs.spawn(handle.clone(), tx);
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    handle.state::<AppState>().sessions.handle_obs_event(&handle, event).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the main window quits the app (the overlay window would
            // otherwise keep the process alive). Live sessions are already on disk.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { .. } = event {
                    let app = window.app_handle();
                    app.state::<AppState>().exports.cancel_all();
                    app.exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::default_output_dir,
            commands::get_hotkey_status,
            commands::get_obs_status,
            commands::test_obs_connection,
            commands::get_ffmpeg_status,
            commands::get_live_session,
            commands::start_session,
            commands::stop_session,
            commands::mark_clip,
            commands::list_sessions,
            commands::get_session,
            commands::delete_session,
            commands::import_recording,
            commands::set_recording_path,
            commands::add_marker,
            commands::update_marker,
            commands::delete_marker,
            commands::prepare_media,
            commands::create_preview,
            commands::start_export,
            commands::cancel_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AKS Clipper");
}
