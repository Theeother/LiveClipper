Bundled FFmpeg
==============

Put ffmpeg.exe in this folder before `npm run tauri build` to ship FFmpeg
inside the installer. The app looks here first, so end users don't need to
install anything.

  npm run fetch-ffmpeg     (downloads a GPL "essentials" build from gyan.dev)

If this folder only contains this README, the app falls back to an FFmpeg on
PATH / winget / scoop / chocolatey, or the path set in Settings.
