//! macOS: the front program, idle time and the screens. No window title, accessibility text or clipboard is read anywhere in this file
//! (a source-scan test in `tests/no_titles.rs` enforces it): only the program's name from `NSWorkspace`, the seconds since the last
//! input, and a picture of each screen once the person has allowed Screen Recording.
use objc2_app_kit::NSWorkspace;

use super::{CaptureError, MonitorShot, Platform};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    /// Seconds since the last event of a kind. `state_id` 0 = the whole login session; `event_type` `u32::MAX` = any keyboard or mouse input.
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    /// Whether this app may record the screen. Never shows a prompt.
    fn CGPreflightScreenCaptureAccess() -> bool;
    /// Asks macOS to list this app under Screen Recording (shows the system prompt the first time).
    fn CGRequestScreenCaptureAccess() -> bool;
}

const WHOLE_SESSION: i32 = 0;
const ANY_INPUT: u32 = u32::MAX;

pub struct MacPlatform;

impl Platform for MacPlatform {
    fn foreground_app(&self) -> Option<String> {
        let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let name = app.localizedName()?.to_string();
        // The lock screen and the login window are not a program the person is using: report nothing, which the engine counts as idle.
        if name.is_empty() || name == "loginwindow" {
            return None;
        }
        Some(name)
    }

    fn idle_seconds(&self) -> u32 {
        // SAFETY: a plain query with constant arguments.
        let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(WHOLE_SESSION, ANY_INPUT) };
        if seconds.is_finite() && seconds >= 0.0 {
            seconds.min(f64::from(u32::MAX)) as u32
        } else {
            0
        }
    }

    fn permissions_ok(&self) -> bool {
        // SAFETY: a plain query; it never shows a prompt.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
        // Without permission macOS hands back pictures with no windows in them, so refuse instead of sending those.
        if !self.permissions_ok() {
            return Err(CaptureError::Failed("screen recording is not allowed".into()));
        }
        super::capture_with_xcap(true)
    }
}

/// Makes macOS list the app under Privacy & Security > Screen Recording (the first call shows its own prompt) and opens that page.
pub fn ask_for_screen_recording() {
    // SAFETY: a plain request with no arguments.
    unsafe {
        CGRequestScreenCaptureAccess();
    }
    let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").spawn();
}
