The MVP is built, and the whole flow from your brief works end to end on this machine: start session → F8 during the stream → see markers → fine-tune start/end → export MP4. The installer is at `src-tauri\target\release\bundle\nsis\AKS Clipper_0.1.0_x64-setup.exe` (31 MB, FFmpeg bundled).

One caveat: OBS here had never been configured, so I tested against a mock OBS server that speaks the same WebSocket v5 protocol. I haven't run it against real OBS yet, so your first real session is the first true OBS test.

## What I verified
- **Automated tests:** 48 Rust and 25 frontend tests pass, covering every item in your list. Typecheck and clippy are clean.
- **Global F8:** marked clips while Slack and Brave had focus. In a controlled run, 8 of 8 presses registered within about 2 ms, and focus never moved.
- **Marker accuracy:** gaps between markers matched the key presses to the millisecond. An OBS recording pause was correctly left out of the timestamps. With OBS disconnected, the clock fallback landed 14 ms from the expected time.
- **Auto sessions:** a session started when (mock) OBS started recording and ended when it stopped, taking the file path from OBS.
- **Clip ranges:** 00:00:10 gave 0–40 s, end − 5 s ended exactly at the end of the recording, and two markers 2.5 s apart stayed separate.
- **4 h 10 min recording:** the editor streams it without loading it into memory. Exports are frame-accurate: first frame exactly 01:24:01.000, 20.000 s long, audio intact.
- **Vertical:** 1080×1920 center crop, with the watermark bottom-right.
- **Other cases:** cancel, FFmpeg missing, a moved recording file, crash recovery and hotkey changes all behave correctly. When a codec can't be previewed, the editor builds a small preview automatically; exports still use the original file.
- **The CLIP MARKED toast:** shows for about 1 s and never takes focus. It is hidden from OBS Display Capture, so it won't appear on stream.

**Bugs I found and fixed:**
- A cancelled export left a partial file behind. Exports now write to a temporary file and rename it only on success.
- The OBS status flickered between "connecting" and "offline" while OBS was closed.
- The editor layout broke at 125% display scaling.
- A session ended before OBS ever recorded showed up as an empty stream.

**Worth watching in your first real stream:**
- Early in testing, two F8 presses went missing and two extra markers appeared while you were using the PC. A controlled run afterwards registered 8 of 8, so I think those were real key presses, but keep an eye on it.
- If OBS splits a recording into several files, markers only line up with the first file.
- The toast won't show over games running in exclusive fullscreen. Marking still works.
- Your OBS password is saved in plain text in `settings.json`, the same way OBS stores it.
- Idle cost with the window open is about 1.7% of one CPU core.

## Your machine
I installed Rust, Visual Studio Build Tools 2022 and FFmpeg with winget. I then deleted all my test data: the generated videos, test sessions, test settings and exported clips. The git repo is initialized, `.gitignore` and the other repo files are in place, and nothing is committed.

## 1. Install dependencies
```powershell
winget install --id Rustlang.Rustup -e --source winget
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --source winget --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
npm install
```

## 2. Run in development
```powershell
npm run tauri dev
```

## 3. Build the installer
```powershell
npm run fetch-ffmpeg   # once: downloads ffmpeg.exe so it's bundled into the installer
npm run tauri build
```

## 4. FFmpeg
Nothing to do if you install from the built installer, because FFmpeg ships inside it. Otherwise the app finds FFmpeg in Settings, on PATH, or where winget/scoop/chocolatey install it.

## 5. OBS
1. In OBS: **Tools → WebSocket Server Settings**, enable the server, then use **Show Connect Info** to get the password.
2. In AKS Clipper: **Settings → OBS**, enter the password, click **Test Connection**, then **Save**.
3. Make sure OBS records while you stream: **Settings → Advanced → Automatically record when streaming**.

With auto-session on (the default), a session starts and ends with the OBS recording.

## 6. Manual test checklist
1. Start a recording in OBS; the app should show SESSION ACTIVE.
2. Alt-tab into a game and press F8 at 00:00:10, around 00:30:00, and just before you stop. You should see the toast, and the game should keep focus.
3. Press F8 twice quickly; you should get two separate markers.
4. Stop recording. The clip list should show the file and its duration, and the first marker's clip should start at 00:00.
5. Open the editor: drag the handles, try Space, I/O and Shift/Ctrl+arrows, then press E.
6. Export once as 16:9 and once as 9:16. Check that both play with sound.
7. Close OBS and start a session; it should fall back to manual mode.
8. Quit the app mid-session and relaunch; your markers should still be there.

## 7. Architecture
- **Rust side:** owns the live session. It handles the hotkey, the OBS connection, timestamp capture, saving every marker to disk immediately, and FFmpeg export and preview.
- **React side:** just the four screens: dashboard, clip list, editor and settings.
- **Future features:** new marker sources (AI, chat, audio) and export layouts (1:1 and others) each have a single place in the code to add them.

The README covers setup and the code layout in more detail.