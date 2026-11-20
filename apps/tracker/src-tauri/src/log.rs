//! The app's log. The API takes an `Event` enum and nothing else: there is no string field, so an app name, a title, a token or any
//! other text cannot reach the file. A line is the time, the event's name and at most one number. 1 MB, then one rotation.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::core::timefmt::iso_from_ms;

const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockKind {
    ClockIn,
    SwitchClient,
    StartBreak,
    EndBreak,
    ClockOut,
}

/// Counts, states and error kinds only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Started,
    Enrolled,
    EnrollFailed,
    SignedOut,
    Disconnected,
    WentOnline,
    WentOffline,
    StateWorking,
    StateBreak,
    StateOut,
    PolicyOff,
    UpdateRequired,
    UpdateReady,
    UpdateRejected,
    /// How many things were delivered.
    Delivered(u32),
    SendBackoff,
    ShotCaptured,
    ShotCaptureFailed,
    Clock(ClockKind),
    ClockRefused,
    ClockOffline,
    ClockBlocked,
}

impl Event {
    fn text(self) -> String {
        match self {
            Event::Started => "started".into(),
            Event::Enrolled => "enrolled".into(),
            Event::EnrollFailed => "enroll_failed".into(),
            Event::SignedOut => "signed_out".into(),
            Event::Disconnected => "disconnected".into(),
            Event::WentOnline => "online".into(),
            Event::WentOffline => "offline".into(),
            Event::StateWorking => "state_working".into(),
            Event::StateBreak => "state_break".into(),
            Event::StateOut => "state_out".into(),
            Event::PolicyOff => "policy_off".into(),
            Event::UpdateRequired => "update_required".into(),
            Event::UpdateReady => "update_ready".into(),
            Event::UpdateRejected => "update_rejected".into(),
            Event::Delivered(n) => format!("delivered {n}"),
            Event::SendBackoff => "send_backoff".into(),
            Event::ShotCaptured => "shot_captured".into(),
            Event::ShotCaptureFailed => "shot_capture_failed".into(),
            Event::Clock(k) => format!(
                "clock_{}",
                match k {
                    ClockKind::ClockIn => "in",
                    ClockKind::SwitchClient => "switch",
                    ClockKind::StartBreak => "break_start",
                    ClockKind::EndBreak => "break_end",
                    ClockKind::ClockOut => "out",
                }
            ),
            Event::ClockRefused => "clock_refused".into(),
            Event::ClockOffline => "clock_offline".into(),
            Event::ClockBlocked => "clock_blocked".into(),
        }
    }
}

pub struct Logger {
    file: Option<PathBuf>,
    lock: Mutex<()>,
    max_bytes: u64,
}

impl Logger {
    /// Writes to `dir/tracker.log` (rotating to `tracker.log.1`).
    pub fn new(dir: PathBuf) -> Logger {
        let _ = fs::create_dir_all(&dir);
        Logger { file: Some(dir.join("tracker.log")), lock: Mutex::new(()), max_bytes: MAX_BYTES }
    }

    /// Logs nothing (tests).
    pub fn none() -> Logger {
        Logger { file: None, lock: Mutex::new(()), max_bytes: MAX_BYTES }
    }

    #[cfg(test)]
    fn with_limit(dir: PathBuf, max_bytes: u64) -> Logger {
        Logger { max_bytes, ..Logger::new(dir) }
    }

    pub fn log_event(&self, event: Event) {
        let Some(path) = &self.file else { return };
        let Ok(_guard) = self.lock.lock() else { return };
        if fs::metadata(path).map(|m| m.len() >= self.max_bytes).unwrap_or(false) {
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{} {}", iso_from_ms(now), event.text());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_is_a_time_and_an_event_name_only() {
        let dir = tempfile::tempdir().unwrap();
        let log = Logger::new(dir.path().to_path_buf());
        log.log_event(Event::Started);
        log.log_event(Event::Delivered(12));
        log.log_event(Event::Clock(ClockKind::StartBreak));
        let text = fs::read_to_string(dir.path().join("tracker.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].ends_with(" started"));
        assert!(lines[1].ends_with(" delivered 12"));
        assert!(lines[2].ends_with(" clock_break_start"));
        // Nothing but digits, letters, dashes, colons, dots, underscores and spaces can be written.
        assert!(text.chars().all(|c| c.is_ascii_alphanumeric() || " -:._\n".contains(c)));
    }

    #[test]
    fn it_rotates_once_at_the_limit_and_never_grows_past_two_files() {
        let dir = tempfile::tempdir().unwrap();
        let log = Logger::with_limit(dir.path().to_path_buf(), 400);
        for _ in 0..200 {
            log.log_event(Event::StateWorking);
        }
        let files: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        assert!(files.contains(&"tracker.log".to_string()) && files.contains(&"tracker.log.1".to_string()), "{files:?}");
        assert_eq!(files.len(), 2);
        assert!(fs::metadata(dir.path().join("tracker.log")).unwrap().len() <= 400 + 64);
    }

    #[test]
    fn the_null_logger_writes_nothing() {
        Logger::none().log_event(Event::Started);
    }
}
