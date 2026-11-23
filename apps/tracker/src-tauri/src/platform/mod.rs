//! The operating-system layer: which program is in front, how long since the last input, and a picture of every screen.
//! Everything above this trait is pure or portable, so macOS can be added later (Phase 4) without touching the rules.
//!
//! The app reads the program's file name only. No window title, URL or text of any window is ever read: the Windows layer
//! calls no title API at all (a source-scan test in `tests/no_titles.rs` enforces it).

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(any(windows, target_os = "macos")))]
mod unsupported;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "macos")]
pub use macos::ask_for_screen_recording;

/// One monitor's picture, with its place on the virtual desktop (can be negative: a monitor left of or above the main one).
/// It never leaves the `capture` module: the only public way to get a screenshot out is `capture::blur::capture_blurred`.
pub struct MonitorShot {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// RGBA, `width * height * 4` bytes.
    pub rgba: Vec<u8>,
}

#[derive(Debug)]
pub enum CaptureError {
    /// No monitor could be read (locked screen, no permission, no display).
    NoMonitors,
    /// The system refused or failed; the text is a short reason without any screen content.
    Failed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::NoMonitors => write!(f, "no monitor could be captured"),
            CaptureError::Failed(why) => write!(f, "capture failed: {why}"),
        }
    }
}

impl std::error::Error for CaptureError {}

pub trait Platform: Send + Sync {
    /// The front program's name without `.exe` (`chrome`), or `None` when there is none or it cannot be read (the lock screen).
    fn foreground_app(&self) -> Option<String>;
    /// Seconds since the last keyboard or mouse input, correct across the 49-day tick counter wrap.
    fn idle_seconds(&self) -> u32;
    /// Whether the system lets the app see the screen. Windows never asks; macOS makes the person allow Screen Recording first.
    fn permissions_ok(&self) -> bool {
        true
    }
    /// Every monitor, each with its position on the desktop.
    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError>;
}

/// A screen's place on the desktop in the pixels of its picture. macOS reports the place in points but the picture in pixels (a Retina
/// screen has two pixels to a point), so the place is scaled; an unusable scale counts as one.
pub(crate) fn physical_position(position: i32, scale: f32) -> i32 {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    (position as f32 * scale).round() as i32
}

/// Captures every screen with xcap (Windows and macOS). `scale_positions` is for macOS, see `physical_position`.
#[cfg(any(windows, target_os = "macos"))]
fn capture_with_xcap(scale_positions: bool) -> Result<Vec<MonitorShot>, CaptureError> {
    fn fail(e: xcap::XCapError) -> CaptureError {
        CaptureError::Failed(e.to_string())
    }
    let monitors = xcap::Monitor::all().map_err(fail)?;
    let mut out = Vec::with_capacity(monitors.len());
    for m in monitors {
        let scale = if scale_positions { m.scale_factor().map_err(fail)? } else { 1.0 };
        let (x, y) = (physical_position(m.x().map_err(fail)?, scale), physical_position(m.y().map_err(fail)?, scale));
        let image = m.capture_image().map_err(fail)?;
        out.push(MonitorShot { x, y, width: image.width(), height: image.height(), rgba: image.into_raw() });
    }
    if out.is_empty() {
        return Err(CaptureError::NoMonitors);
    }
    Ok(out)
}

/// The platform this build runs on.
pub fn current() -> Box<dyn Platform> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsPlatform)
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacPlatform)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        Box::new(unsupported::UnsupportedPlatform)
    }
}

#[cfg(test)]
mod tests {
    use super::physical_position;

    #[test]
    fn a_retina_screens_position_is_scaled_to_the_pixels_of_its_picture() {
        assert_eq!(physical_position(1440, 2.0), 2880);
        assert_eq!(physical_position(-1440, 2.0), -2880, "a screen to the left of or above the main one");
        assert_eq!(physical_position(100, 1.0), 100);
    }

    #[test]
    fn an_unusable_scale_is_treated_as_one() {
        assert_eq!(physical_position(100, 0.0), 100);
        assert_eq!(physical_position(100, f32::NAN), 100);
        assert_eq!(physical_position(100, -2.0), 100);
    }
}
