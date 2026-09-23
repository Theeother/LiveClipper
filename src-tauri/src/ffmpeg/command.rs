//! FFmpeg argument construction. Pure functions, no I/O.

use crate::models::{ExportPreset, WatermarkPosition};

/// Vertical export size.
pub const VERTICAL_W: u32 = 1080;
pub const VERTICAL_H: u32 = 1920;
/// Watermark width relative to the output width.
const WATERMARK_REL_WIDTH: f64 = 0.15;
/// Watermark margin relative to the output width.
const WATERMARK_REL_MARGIN: f64 = 0.025;

#[derive(Debug, Clone)]
pub struct WatermarkSpec {
    pub image_path: String,
    pub position: WatermarkPosition,
    pub opacity: f64,
}

#[derive(Debug, Clone)]
pub struct ExportSpec {
    pub input: String,
    pub output: String,
    pub start: f64,
    pub end: f64,
    pub preset: ExportPreset,
    /// Source dimensions (from probe); used to size the watermark.
    pub source_size: Option<(u32, u32)>,
    pub watermark: Option<WatermarkSpec>,
}

/// Formats seconds for FFmpeg (`-ss 5041.700`).
fn secs(v: f64) -> String {
    format!("{:.3}", v.max(0.0))
}

/// Output frame size for a preset.
pub fn output_size(preset: ExportPreset, source: Option<(u32, u32)>) -> Option<(u32, u32)> {
    match preset {
        ExportPreset::Vertical => Some((VERTICAL_W, VERTICAL_H)),
        // Never upscale the original: keep the source size (rounded down to even).
        ExportPreset::Original => source.map(|(w, h)| (w & !1, h & !1)),
    }
}

/// The per-preset video chain from `[0:v]` to `[base]`. This is the extension
/// point for future layouts (1:1, facecam stacks, tracked crops...).
fn video_chain(preset: ExportPreset) -> String {
    match preset {
        // Only force even dimensions (required by yuv420p/H.264), no rescale otherwise.
        ExportPreset::Original => "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1[base]".into(),
        // Centered 9:16 crop, then scale to 1080x1920.
        ExportPreset::Vertical => format!(
            "[0:v]crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',\
             scale={VERTICAL_W}:{VERTICAL_H}:flags=lanczos,setsar=1[base]"
        ),
    }
}

fn overlay_xy(position: WatermarkPosition, margin: u32) -> String {
    let m = margin;
    match position {
        WatermarkPosition::TopLeft => format!("{m}:{m}"),
        WatermarkPosition::TopRight => format!("main_w-overlay_w-{m}:{m}"),
        WatermarkPosition::BottomLeft => format!("{m}:main_h-overlay_h-{m}"),
        WatermarkPosition::BottomRight => format!("main_w-overlay_w-{m}:main_h-overlay_h-{m}"),
    }
}

/// Full `-filter_complex` graph producing `[vout]`.
pub fn filter_graph(spec: &ExportSpec) -> String {
    let mut graph = video_chain(spec.preset);
    match &spec.watermark {
        None => graph.push_str(";[base]format=yuv420p[vout]"),
        Some(wm) => {
            let out_w = output_size(spec.preset, spec.source_size).map(|(w, _)| w).unwrap_or(1920);
            let wm_w = ((out_w as f64 * WATERMARK_REL_WIDTH).round() as u32).max(16) & !1;
            let margin = (out_w as f64 * WATERMARK_REL_MARGIN).round() as u32;
            let opacity = wm.opacity.clamp(0.0, 1.0);
            graph.push_str(&format!(
                ";[1:v]scale={wm_w}:-1,format=rgba,colorchannelmixer=aa={opacity:.2}[wm]\
                 ;[base][wm]overlay={}:format=auto,format=yuv420p[vout]",
                overlay_xy(wm.position, margin)
            ));
        }
    }
    graph
}

/// Arguments for exporting `[start, end)` of the input as H.264/AAC MP4.
///
/// Input seeking (`-ss` before `-i`) is fast on multi-hour files and still
/// frame-accurate because we re-encode.
pub fn export_args(spec: &ExportSpec) -> Vec<String> {
    let duration = (spec.end - spec.start).max(0.1);
    let mut a: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostdin".into(),
        "-y".into(),
        "-loglevel".into(),
        "error".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        "-ss".into(),
        secs(spec.start),
        "-i".into(),
        spec.input.clone(),
    ];
    if let Some(wm) = &spec.watermark {
        a.push("-i".into());
        a.push(wm.image_path.clone());
    }
    a.extend([
        "-t".into(),
        secs(duration),
        "-filter_complex".into(),
        filter_graph(spec),
        "-map".into(),
        "[vout]".into(),
        // First audio track, if any (OBS track 1).
        "-map".into(),
        "0:a:0?".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-crf".into(),
        "20".into(),
        "-profile:v".into(),
        "high".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        spec.output.clone(),
    ]);
    a
}

/// Arguments for a lightweight 540p preview proxy of `[start, start+len)`,
/// used when the webview can't decode the recording directly (e.g. HEVC).
pub fn preview_args(input: &str, start: f64, len: f64, output: &str) -> Vec<String> {
    [
        "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-ss", &secs(start), "-i", input, "-t",
        &secs(len), "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=-2:540", "-c:v", "libx264", "-preset",
        "ultrafast", "-crf", "30", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart", output,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(preset: ExportPreset, watermark: Option<WatermarkSpec>) -> ExportSpec {
        ExportSpec {
            input: "D:/Streams/stream 2026-09-23.mkv".into(),
            output: "C:/Users/me/Videos/AKS Clips/AKS_X.mp4".into(),
            start: 5041.0,
            end: 5101.0,
            preset,
            source_size: Some((1920, 1080)),
            watermark,
        }
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> &'a str {
        let i = args.iter().position(|a| a == flag).unwrap_or_else(|| panic!("missing {flag}"));
        &args[i + 1]
    }

    #[test]
    fn original_export_args() {
        let args = export_args(&spec(ExportPreset::Original, None));
        // Seek before input, duration after.
        let ss = args.iter().position(|a| a == "-ss").unwrap();
        let i = args.iter().position(|a| a == "-i").unwrap();
        let t = args.iter().position(|a| a == "-t").unwrap();
        assert!(ss < i && i < t);
        assert_eq!(value_after(&args, "-ss"), "5041.000");
        assert_eq!(value_after(&args, "-t"), "60.000");
        // Paths with spaces are passed as single args (no shell quoting needed).
        assert_eq!(value_after(&args, "-i"), "D:/Streams/stream 2026-09-23.mkv");
        assert_eq!(args.last().unwrap(), "C:/Users/me/Videos/AKS Clips/AKS_X.mp4");
        assert_eq!(value_after(&args, "-c:v"), "libx264");
        assert_eq!(value_after(&args, "-c:a"), "aac");
        assert!(args.windows(2).any(|w| w[0] == "-map" && w[1] == "0:a:0?"));
        let graph = value_after(&args, "-filter_complex");
        assert!(graph.starts_with("[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2"));
        assert!(!graph.contains("crop"));
        assert!(graph.ends_with("[vout]"));
    }

    #[test]
    fn vertical_export_crops_center_and_scales() {
        let args = export_args(&spec(ExportPreset::Vertical, None));
        let graph = value_after(&args, "-filter_complex");
        assert!(graph.contains("crop='trunc(min(iw,ih*9/16)/2)*2'"));
        assert!(graph.contains("scale=1080:1920"));
    }

    #[test]
    fn watermark_adds_second_input_and_overlay() {
        let wm = WatermarkSpec {
            image_path: "C:/logo.png".into(),
            position: WatermarkPosition::BottomRight,
            opacity: 0.8,
        };
        let args = export_args(&spec(ExportPreset::Original, Some(wm)));
        let inputs: Vec<_> = args.windows(2).filter(|w| w[0] == "-i").map(|w| w[1].as_str()).collect();
        assert_eq!(inputs, vec!["D:/Streams/stream 2026-09-23.mkv", "C:/logo.png"]);
        let graph = value_after(&args, "-filter_complex");
        // 15% of 1920 = 288px wide, 2.5% margin = 48px
        assert!(graph.contains("[1:v]scale=288:-1"), "{graph}");
        assert!(graph.contains("colorchannelmixer=aa=0.80"));
        assert!(graph.contains("overlay=main_w-overlay_w-48:main_h-overlay_h-48"));
    }

    #[test]
    fn watermark_on_vertical_uses_vertical_width() {
        let wm = WatermarkSpec {
            image_path: "C:/logo.png".into(),
            position: WatermarkPosition::TopLeft,
            opacity: 1.5,
        };
        let graph = filter_graph(&spec(ExportPreset::Vertical, Some(wm)));
        // 15% of 1080 = 162, margin 27
        assert!(graph.contains("[1:v]scale=162:-1"), "{graph}");
        assert!(graph.contains("overlay=27:27"));
        assert!(graph.contains("aa=1.00"), "opacity is clamped");
    }

    #[test]
    fn original_never_upscales() {
        assert_eq!(output_size(ExportPreset::Original, Some((1281, 721))), Some((1280, 720)));
        assert_eq!(output_size(ExportPreset::Vertical, Some((1280, 720))), Some((1080, 1920)));
    }

    #[test]
    fn preview_args_are_well_formed() {
        let args = preview_args("in.mkv", 100.0, 240.0, "out.mp4");
        assert_eq!(value_after(&args, "-ss"), "100.000");
        assert_eq!(value_after(&args, "-t"), "240.000");
        assert_eq!(args.last().unwrap(), "out.mp4");
    }
}
