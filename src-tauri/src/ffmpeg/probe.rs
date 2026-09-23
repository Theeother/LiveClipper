//! Media probing by parsing `ffmpeg -i <file>` output. This avoids shipping
//! ffprobe as a second binary; the banner format has been stable for years.

use std::sync::OnceLock;

use regex::Regex;

use crate::models::MediaInfo;

fn duration_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)").unwrap())
}

fn video_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // e.g. "Stream #0:0: Video: h264 (High), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 60 fps"
    RE.get_or_init(|| Regex::new(r"Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?\b(\d{2,5})x(\d{2,5})\b").unwrap())
}

fn audio_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"Stream #\d+:\d+[^\n]*?: Audio: ").unwrap())
}

pub fn parse_probe_output(stderr: &str) -> MediaInfo {
    let duration = duration_re().captures(stderr).and_then(|c| {
        let h: f64 = c[1].parse().ok()?;
        let m: f64 = c[2].parse().ok()?;
        let s: f64 = c[3].parse().ok()?;
        Some(h * 3600.0 + m * 60.0 + s)
    });
    let video = video_re().captures(stderr);
    MediaInfo {
        duration: duration.filter(|d| *d > 0.0),
        video_codec: video.as_ref().map(|c| c[1].to_string()),
        width: video.as_ref().and_then(|c| c[2].parse().ok()),
        height: video.as_ref().and_then(|c| c[3].parse().ok()),
        has_audio: audio_re().is_match(stderr),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OBS_MKV: &str = r#"Input #0, matroska,webm, from 'D:\Streams\2026-09-23 16-32-10.mkv':
  Metadata:
    ENCODER         : Lavf61.1.100
  Duration: 04:17:32.47, start: 0.000000, bitrate: 6123 kb/s
  Stream #0:0: Video: h264 (High), yuv420p(tv, bt709, progressive), 1920x1080 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 1k tbn (default)
  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp (default)
At least one output file must be specified"#;

    #[test]
    fn parses_obs_recording() {
        let info = parse_probe_output(OBS_MKV);
        assert!((info.duration.unwrap() - (4.0 * 3600.0 + 17.0 * 60.0 + 32.47)).abs() < 1e-6);
        assert_eq!(info.width, Some(1920));
        assert_eq!(info.height, Some(1080));
        assert_eq!(info.video_codec.as_deref(), Some("h264"));
        assert!(info.has_audio);
    }

    #[test]
    fn parses_hevc_with_language_tags() {
        let s = "  Duration: 00:10:00.00, start: 0.0\n  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 2560x1440, 8000 kb/s, 60 fps\n  Stream #0:1[0x2](und): Audio: aac (LC)";
        let info = parse_probe_output(s);
        assert_eq!(info.duration, Some(600.0));
        assert_eq!(info.video_codec.as_deref(), Some("hevc"));
        assert_eq!((info.width, info.height), (Some(2560), Some(1440)));
        assert!(info.has_audio);
    }

    #[test]
    fn unfinished_recording_has_no_duration() {
        let s = "  Duration: N/A, start: 0.000000, bitrate: N/A\n  Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps";
        let info = parse_probe_output(s);
        assert_eq!(info.duration, None);
        assert_eq!(info.width, Some(1280));
        assert!(!info.has_audio);
    }
}
