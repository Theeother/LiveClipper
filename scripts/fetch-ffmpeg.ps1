# Downloads a static FFmpeg build into src-tauri/resources/ffmpeg so that
# `npm run tauri build` bundles it into the installer.
#
#   npm run fetch-ffmpeg
#
# Source: gyan.dev "release essentials" build (GPL). Only ffmpeg.exe is kept.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "src-tauri\resources\ffmpeg"
$url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("aks-ffmpeg-" + [guid]::NewGuid())

New-Item -ItemType Directory -Force $tmp, $dest | Out-Null
try {
    $zip = Join-Path $tmp "ffmpeg.zip"
    Write-Host "Downloading $url ..."
    $ProgressPreference = "SilentlyContinue"
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    Write-Host "Extracting ..."
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter ffmpeg.exe | Select-Object -First 1
    if (-not $exe) { throw "ffmpeg.exe not found in archive" }
    Copy-Item $exe.FullName (Join-Path $dest "ffmpeg.exe") -Force
    $license = Get-ChildItem -Path $tmp -Recurse -Filter LICENSE* | Select-Object -First 1
    if ($license) { Copy-Item $license.FullName (Join-Path $dest "FFMPEG-LICENSE.txt") -Force }
    & (Join-Path $dest "ffmpeg.exe") -hide_banner -version | Select-Object -First 1
    Write-Host "FFmpeg ready in $dest"
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
