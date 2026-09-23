//! Clip range calculation and clamping. Pure functions, no I/O.

/// Shortest clip we allow, so start < end always holds.
pub const MIN_CLIP_LEN: f64 = 0.5;

/// Default clip range around a marker: `[t - before, t + after]`,
/// clamped to `[0, duration]` when the recording duration is known.
pub fn default_clip_range(timestamp: f64, before: f64, after: f64, duration: Option<f64>) -> (f64, f64) {
    let t = match duration {
        Some(d) => timestamp.clamp(0.0, d),
        None => timestamp.max(0.0),
    };
    clamp_range(t - before.max(0.0), t + after.max(0.0), duration)
}

/// Clamp an arbitrary range into the recording, keeping at least `MIN_CLIP_LEN`.
pub fn clamp_range(start: f64, end: f64, duration: Option<f64>) -> (f64, f64) {
    let (mut s, mut e) = if start <= end { (start, end) } else { (end, start) };
    s = s.max(0.0);
    if let Some(d) = duration.filter(|d| *d > 0.0) {
        e = e.min(d);
        s = s.min(d);
    }
    if e - s < MIN_CLIP_LEN {
        e = s + MIN_CLIP_LEN;
        if let Some(d) = duration.filter(|d| *d > 0.0) {
            if e > d {
                e = d;
                s = (d - MIN_CLIP_LEN).max(0.0);
            }
        }
    }
    (round_ms(s), round_ms(e))
}

pub fn round_ms(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_range_in_the_middle() {
        assert_eq!(default_clip_range(5234.2, 30.0, 30.0, None), (5204.2, 5264.2));
    }

    #[test]
    fn marker_before_padding_clamps_start_to_zero() {
        // Marker at 00:00:10 -> start 0, end 40
        assert_eq!(default_clip_range(10.0, 30.0, 30.0, Some(7200.0)), (0.0, 40.0));
    }

    #[test]
    fn marker_near_end_clamps_to_duration() {
        // 2h recording, marker at 1:59:50 -> 1:59:20 .. 2:00:00
        assert_eq!(default_clip_range(7190.0, 30.0, 30.0, Some(7200.0)), (7160.0, 7200.0));
    }

    #[test]
    fn marker_five_seconds_before_end() {
        assert_eq!(default_clip_range(7195.0, 30.0, 30.0, Some(7200.0)), (7165.0, 7200.0));
    }

    #[test]
    fn marker_past_duration_is_pulled_back() {
        // Clock drift can make a marker land slightly past the end of the file.
        assert_eq!(default_clip_range(7205.0, 30.0, 30.0, Some(7200.0)), (7170.0, 7200.0));
    }

    #[test]
    fn unknown_duration_leaves_end_unclamped() {
        assert_eq!(default_clip_range(100.0, 30.0, 30.0, None), (70.0, 130.0));
    }

    #[test]
    fn custom_padding() {
        assert_eq!(default_clip_range(100.0, 10.0, 5.0, None), (90.0, 105.0));
    }

    #[test]
    fn clamp_swaps_inverted_range() {
        assert_eq!(clamp_range(50.0, 20.0, None), (20.0, 50.0));
    }

    #[test]
    fn clamp_enforces_min_length() {
        assert_eq!(clamp_range(10.0, 10.0, None), (10.0, 10.5));
        // At the very end of the recording the min length extends backwards.
        assert_eq!(clamp_range(100.0, 100.0, Some(100.0)), (99.5, 100.0));
    }

    #[test]
    fn clamp_negative_start() {
        assert_eq!(clamp_range(-5.0, 20.0, Some(100.0)), (0.0, 20.0));
    }
}
