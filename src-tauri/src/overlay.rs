//! The tiny "🔖 CLIP MARKED" confirmation.
//!
//! A small transparent, always-on-top, click-through window that never takes
//! focus. It is created once at startup and parked off-screen; showing a toast
//! just moves it on-screen (`SetWindowPos` with `SWP_NOACTIVATE`) and back —
//! no show/hide calls, so it can't steal focus from a game or OBS.
//!
//! On Windows it is also excluded from screen capture
//! (`WDA_EXCLUDEFROMCAPTURE`), so it is visible to the streamer but never shows
//! up in an OBS Display Capture.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "overlay";
const WIDTH: f64 = 248.0;
const HEIGHT: f64 = 64.0;
const MARGIN: f64 = 24.0;
const VISIBLE_FOR: Duration = Duration::from_millis(1100);
const OFFSCREEN: PhysicalPosition<i32> = PhysicalPosition { x: -20000, y: -20000 };

static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ToastKind {
    Marked,
    Warn,
}

#[derive(Debug, Clone, Serialize)]
struct ToastPayload<'a> {
    kind: ToastKind,
    title: &'a str,
    detail: &'a str,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("overlay.html".into()))
        .title("AKS Clipper Overlay")
        .inner_size(WIDTH, HEIGHT)
        .position(OFFSCREEN.x as f64, OFFSCREEN.y as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()?;
    window.set_ignore_cursor_events(true)?;
    window.set_position(OFFSCREEN)?;
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        win::harden(hwnd.0 as _);
    }
    Ok(())
}

/// Show a toast for ~1 second. Never blocks, never focuses.
pub fn toast(app: &AppHandle, kind: ToastKind, title: &str, detail: &str) {
    let enabled = app.state::<crate::AppState>().settings.read().unwrap().show_overlay;
    if !enabled {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let _ = app.emit_to(LABEL, "toast", ToastPayload { kind, title, detail });

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let position = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let scale = m.scale_factor();
            let (mx, my) = (m.position().x as f64, m.position().y as f64);
            let x = mx + m.size().width as f64 - (WIDTH + MARGIN) * scale;
            let y = my + MARGIN * scale;
            PhysicalPosition::new(x.round() as i32, y.round() as i32)
        })
        .unwrap_or(PhysicalPosition::new(40, 40));

    tauri::async_runtime::spawn(async move {
        // Let the webview paint the new content before it becomes visible.
        tokio::time::sleep(Duration::from_millis(30)).await;
        let _ = window.set_position(position);
        #[cfg(windows)]
        if let Ok(hwnd) = window.hwnd() {
            win::raise_topmost(hwnd.0 as _);
        }
        tokio::time::sleep(VISIBLE_FOR).await;
        if GENERATION.load(Ordering::SeqCst) == generation {
            let _ = window.set_position(OFFSCREEN);
        }
    });
}

#[cfg(windows)]
mod win {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WDA_EXCLUDEFROMCAPTURE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    pub fn harden(hwnd: HWND) {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as isize);
            // Visible to the streamer, invisible to screen capture (Windows 10 2004+).
            SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
    }

    pub fn raise_topmost(hwnd: HWND) {
        unsafe {
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
        }
    }
}
