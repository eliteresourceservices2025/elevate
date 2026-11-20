//! Shared by the queue and sender tests.
#![allow(dead_code)]

use elevate_tracker_lib::capture::blur::{capture_blurred, BlurredJpeg};
use elevate_tracker_lib::core::segments::{Segment, State};
use elevate_tracker_lib::platform::{CaptureError, MonitorShot, Platform};

struct Tiny;

impl Platform for Tiny {
    fn foreground_app(&self) -> Option<String> {
        None
    }
    fn idle_seconds(&self) -> u32 {
        0
    }
    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
        Ok(vec![MonitorShot { x: 0, y: 0, width: 64, height: 48, rgba: [90, 90, 90, 255].repeat(64 * 48) }])
    }
}

/// A real (tiny) blurred JPEG: the only kind the queue accepts.
pub fn jpeg() -> BlurredJpeg {
    capture_blurred(&Tiny).expect("a tiny capture")
}

/// One segment of `len_ms` ending at `end_ms`.
pub fn seg(end_ms: i64, len_ms: i64, app: &str) -> Segment {
    Segment { start_ms: end_ms - len_ms, end_ms, app: app.to_string(), state: State::Active }
}
