//! Output file naming.

use std::path::{Path, PathBuf};

use crate::models::ExportPreset;

const MAX_NAME_LEN: usize = 80;

/// Turn a user-provided clip name into a safe, Windows-friendly file stem
/// fragment: `I can't believe this!` -> `I_CANT_BELIEVE_THIS`.
///
/// Keeps letters and digits (Unicode included), collapses everything else into
/// single underscores, uppercases, trims and truncates.
pub fn sanitize_clip_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_sep = false;
    for ch in name.chars() {
        if ch == '\'' || ch == '’' {
            // Drop apostrophes entirely: "can't" -> "CANT", not "CAN_T".
            continue;
        }
        if ch.is_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('_');
            }
            pending_sep = false;
            out.extend(ch.to_uppercase());
        } else {
            pending_sep = true;
        }
    }
    if out.chars().count() > MAX_NAME_LEN {
        out = out.chars().take(MAX_NAME_LEN).collect();
        while out.ends_with('_') {
            out.pop();
        }
    }
    out
}

/// `HH-MM-SS` (hours not wrapped at 24).
pub fn hms_dashed(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    format!("{:02}-{:02}-{:02}", total / 3600, (total % 3600) / 60, total % 60)
}

/// File stem for an exported clip.
///
/// * custom name: `AKS_I_CANT_BELIEVE_THIS`
/// * default:     `AKS_2026-09-23_01-24-01` (session date + clip start in the recording)
///
/// Vertical exports get a `_VERTICAL` suffix so both versions can coexist.
pub fn clip_file_stem(session_date: &str, clip_start: f64, custom_name: Option<&str>, preset: ExportPreset) -> String {
    let custom = custom_name.map(sanitize_clip_name).filter(|s| !s.is_empty());
    let mut stem = match custom {
        Some(name) => format!("AKS_{name}"),
        None => format!("AKS_{session_date}_{}", hms_dashed(clip_start)),
    };
    if preset == ExportPreset::Vertical {
        stem.push_str("_VERTICAL");
    }
    stem
}

/// `dir/stem.ext`, or `dir/stem_2.ext`, `dir/stem_3.ext`... if it already exists.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem}_{n}.{ext}")))
        .find(|p| !p.exists())
        .expect("infinite iterator")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_user_names() {
        assert_eq!(sanitize_clip_name("I can't believe this"), "I_CANT_BELIEVE_THIS");
        assert_eq!(sanitize_clip_name("  hello   world!!  "), "HELLO_WORLD");
        assert_eq!(sanitize_clip_name("a/b\\c:d*e?f\"g<h>i|j"), "A_B_C_D_E_F_G_H_I_J");
        assert_eq!(sanitize_clip_name("..\\..\\windows\\system32"), "WINDOWS_SYSTEM32");
        assert_eq!(sanitize_clip_name("clip-01_final"), "CLIP_01_FINAL");
        assert_eq!(sanitize_clip_name("!!!"), "");
        assert_eq!(sanitize_clip_name("café ünïcode"), "CAFÉ_ÜNÏCODE");
    }

    #[test]
    fn truncates_long_names() {
        let long = "word ".repeat(40);
        let s = sanitize_clip_name(&long);
        assert!(s.chars().count() <= MAX_NAME_LEN);
        assert!(!s.ends_with('_'));
    }

    #[test]
    fn default_stem_uses_date_and_clip_start() {
        assert_eq!(
            clip_file_stem("2026-09-23", 5041.7, None, ExportPreset::Original),
            "AKS_2026-09-23_01-24-01"
        );
        assert_eq!(
            clip_file_stem("2026-09-23", 5041.7, Some("   "), ExportPreset::Original),
            "AKS_2026-09-23_01-24-01"
        );
    }

    #[test]
    fn custom_stem_and_vertical_suffix() {
        assert_eq!(
            clip_file_stem("2026-09-23", 0.0, Some("I can't believe this"), ExportPreset::Original),
            "AKS_I_CANT_BELIEVE_THIS"
        );
        assert_eq!(
            clip_file_stem("2026-09-23", 0.0, Some("wow"), ExportPreset::Vertical),
            "AKS_WOW_VERTICAL"
        );
    }

    #[test]
    fn hms_handles_long_recordings() {
        assert_eq!(hms_dashed(0.0), "00-00-00");
        assert_eq!(hms_dashed(8.0 * 3600.0 + 61.9), "08-01-01");
        assert_eq!(hms_dashed(30.0 * 3600.0), "30-00-00");
    }

    #[test]
    fn unique_path_appends_counter() {
        let dir = tempfile::tempdir().unwrap();
        let p1 = unique_path(dir.path(), "AKS_X", "mp4");
        assert_eq!(p1.file_name().unwrap(), "AKS_X.mp4");
        std::fs::write(&p1, b"").unwrap();
        let p2 = unique_path(dir.path(), "AKS_X", "mp4");
        assert_eq!(p2.file_name().unwrap(), "AKS_X_2.mp4");
    }
}
