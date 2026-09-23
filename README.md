# AKS Clipper

Local-first clipping utility for streaming with OBS. Press **F8** while live to mark a moment; after the stream, fine-tune each clip and export MP4s with FFmpeg.

OBS records the video. AKS Clipper only tracks the session, records timestamps, and cuts clips. It never re-encodes or duplicates the recording while you stream.

## Setup (Windows)

Prerequisites (one-time):

```powershell
winget install --id Rustlang.Rustup -e --source winget
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Gyan.FFmpeg -e --source winget      # for development; the installer can bundle it
# Node.js 20+ is required as well. WebView2 ships with Windows 11.
```

```powershell
npm install
npm run tauri dev          # run in development
npm run fetch-ffmpeg       # optional: bundle ffmpeg.exe into the installer
npm run tauri build        # -> src-tauri/target/release/bundle/nsis/AKS Clipper_0.1.0_x64-setup.exe
```

Tests:

```powershell
npm test                   # frontend logic (vitest)
npm run test:rust          # backend logic (cargo test)
```

## OBS setup

1. OBS 28+ → **Tools → WebSocket Server Settings** → *Enable WebSocket server*. Note the port (4455) and click *Show Connect Info* for the password.
2. AKS Clipper → **Settings → OBS**: enter host/port/password → **Test Connection** → **Save**.
3. Make sure OBS actually **records** while you stream: *Settings → Advanced → Automatically record when streaming*, or press *Start Recording*.

With auto-session enabled (the default), a session starts when OBS starts recording and ends when it stops. Without OBS, click **Start Session** when you start recording (manual mode) and select the recording file afterwards.

**Tip:** Hybrid MP4 or MKV recordings work best. MKV is safest if OBS crashes; the editor streams it directly.

## How timestamps work

When you press F8, the app asks OBS for `GetRecordStatus.outputDuration`, which is the position inside the file being written (pauses included). It subtracts the query latency. If OBS doesn't answer within 400 ms, it falls back to a monotonic clock anchored to the recording start, which is re-synced from every OBS sample. Each marker records which source it used (`obs` / `clock`).

## Architecture

```text
src-tauri/src/
  lib.rs            app setup, state, window lifecycle
  hotkey.rs         global F8 (OS-level RegisterHotKey via tauri-plugin-global-shortcut)
  overlay.rs        "🔖 CLIP MARKED" toast window: click-through, never focused, hidden from capture
  obs/              obs-websocket v5 client (auth, reconnect, requests, record events)
  session/          live session + marker capture (mod.rs), clip range math, timestamp math
  ffmpeg/           discovery, probe, export args (per-preset filter graphs), export jobs, preview proxies
  storage.rs        atomic JSON persistence (settings.json, sessions/<id>.json)
  filename.rs       output naming + sanitization
  commands.rs       Tauri commands used by the UI
src/
  pages/            Dashboard, Session (clip list), ClipEditor, Settings
  components/       Timeline, VideoPlayer, ExportDialog, ClipCard, AppBar, …
  hooks/ services/  typed command wrappers, backend event subscriptions
  utils/            time formatting, editor math + keyboard map, hotkey parsing (unit tested)
  overlay/          framework-free toast page
```

- The **Rust side owns the live session.** Marking never depends on the webview, so it works while the window is minimized or throttled. Every marker is written to disk immediately; an unfinished session is restored after a crash.
- **Video preview** streams the recording through Tauri's asset protocol (HTTP range requests), so a 4–8 h file is never loaded into RAM. If the webview can't decode the codec, the editor generates a small 540p H.264 proxy around the clip. Exports always use the original file.
- **Export** re-encodes the selected range with libx264/AAC (`-ss` input seek, frame-accurate) at below-normal CPU priority. It writes to `NAME.part.mp4` and renames to `NAME.mp4` on success.
- **Extension points:** `MarkerSource` (future AI/chat/audio markers), `ExportPreset` + `ffmpeg::command::video_chain` (future 1:1 and custom layouts).

Data lives in `%APPDATA%\com.aks.clipper\` (`settings.json`, `sessions\*.json`). Clips go to `~/Videos/AKS Clips` by default.
