//! The operating-system layer: which program is in front, how long since the last input, and a picture of every screen.
//! Everything above this trait is pure or portable, so macOS can be added later (Phase 4) without touching the rules.
//!
//! The app reads the program's file name only. No window title, URL or text of any window is ever read: the Windows layer
//! calls no title API at all (a source-scan test in `tests/no_titles.rs` enforces it).

#[cfg(windows)]
mod windows;
#[cfg(not(windows))]
mod unsupported;

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
    /// Every monitor, each with its position on the desktop.
    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError>;
}

/// The platform this build runs on.
pub fn current() -> Box<dyn Platform> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsPlatform)
    }
    #[cfg(not(windows))]
    {
        Box::new(unsupported::UnsupportedPlatform)
    }
}
