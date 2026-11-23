//! A stand-in so the crate compiles on macOS and Linux on systems other than Windows and macOS. It reports nothing and captures nothing.
use super::{CaptureError, MonitorShot, Platform};

pub struct UnsupportedPlatform;

impl Platform for UnsupportedPlatform {
    fn foreground_app(&self) -> Option<String> {
        None
    }
    fn idle_seconds(&self) -> u32 {
        0
    }
    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
        Err(CaptureError::Failed("this operating system is not supported yet".into()))
    }
}
