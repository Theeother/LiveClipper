//! Marker timestamp calculation. Pure functions, no I/O.
//!
//! The preferred source is OBS itself: `GetRecordStatus.outputDuration` is the
//! position inside the file being written (it also accounts for pauses).
//! Because the query happens a few milliseconds after the key press, we
//! subtract the time between the press and the moment OBS most likely sampled
//! its duration (request sent + half the round trip).
//!
//! If OBS is unreachable we fall back to a monotonic clock anchored at the
//! recording start ("timeline start").

use std::time::{Duration, Instant};

/// Timestamp (seconds into the recording) from an OBS duration sample.
///
/// * `obs_duration_ms` – `outputDuration` reported by OBS
/// * `press_to_send`   – time between the key press and sending the request
/// * `round_trip`      – time between sending the request and receiving the response
pub fn timestamp_from_obs(obs_duration_ms: f64, press_to_send: Duration, round_trip: Duration) -> f64 {
    let lag = press_to_send.as_secs_f64() + round_trip.as_secs_f64() / 2.0;
    (obs_duration_ms / 1000.0 - lag).max(0.0)
}

/// Timestamp from the monotonic clock.
pub fn timestamp_from_clock(timeline_start: Instant, press: Instant) -> f64 {
    press.saturating_duration_since(timeline_start).as_secs_f64()
}

/// Given a timestamp we trust (e.g. from OBS) for a press instant, compute
/// the implied timeline start, so the clock fallback stays in sync even across
/// recording pauses.
pub fn implied_timeline_start(press: Instant, timestamp: f64) -> Instant {
    press
        .checked_sub(Duration::from_secs_f64(timestamp.max(0.0)))
        .unwrap_or(press)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }

    #[test]
    fn obs_timestamp_compensates_for_latency() {
        // OBS says 43:12.500; request sent 5ms after press; 20ms round trip.
        // OBS sampled ~15ms after the press.
        let t = timestamp_from_obs(2_592_500.0, Duration::from_millis(5), Duration::from_millis(20));
        approx(t, 2592.5 - 0.015);
    }

    #[test]
    fn obs_timestamp_never_negative() {
        approx(timestamp_from_obs(3.0, Duration::from_millis(10), Duration::from_millis(10)), 0.0);
    }

    #[test]
    fn clock_timestamp() {
        let start = Instant::now();
        let press = start + Duration::from_millis(2_592_000);
        approx(timestamp_from_clock(start, press), 2592.0);
    }

    #[test]
    fn clock_timestamp_press_before_start_is_zero() {
        let press = Instant::now();
        let start = press + Duration::from_secs(5);
        approx(timestamp_from_clock(start, press), 0.0);
    }

    #[test]
    fn implied_start_round_trips() {
        let press = Instant::now() + Duration::from_secs(10_000);
        let start = implied_timeline_start(press, 5234.2);
        approx(timestamp_from_clock(start, press), 5234.2);
    }
}
