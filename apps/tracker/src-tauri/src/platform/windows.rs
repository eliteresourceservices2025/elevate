//! Windows: the front program, idle time and the screens. No window title is read anywhere in this file.
use ::windows::core::PWSTR;
use ::windows::Win32::Foundation::{CloseHandle, HANDLE};
use ::windows::Win32::System::SystemInformation::GetTickCount64;
use ::windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use ::windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

use super::{CaptureError, MonitorShot, Platform};
use crate::core::app_name::app_from_exe_path;

pub struct WindowsPlatform;

/// The lock screen and the sign-in screen are not an app the person is using: they are reported as one name the engine treats as idle.
const LOCK_SCREEN_PROGRAMS: [&str; 2] = ["LockApp", "LogonUI"];
pub const LOCKED: &str = "Locked";

/// The full path of the program a process runs, or `None` when it cannot be opened (system programs, the lock screen).
fn process_path(pid: u32) -> Option<String> {
    // SAFETY: plain Win32 calls with a handle that is closed before returning; the buffer outlives the call.
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = vec![0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(handle);
        if !ok || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

impl Platform for WindowsPlatform {
    fn foreground_app(&self) -> Option<String> {
        // SAFETY: GetForegroundWindow and GetWindowThreadProcessId only read system state.
        let pid = unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.0.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            pid
        };
        if pid == 0 {
            return None;
        }
        let name = app_from_exe_path(&process_path(pid)?)?;
        if LOCK_SCREEN_PROGRAMS.iter().any(|p| p.eq_ignore_ascii_case(&name)) {
            return Some(LOCKED.to_string());
        }
        Some(name)
    }

    fn idle_seconds(&self) -> u32 {
        // SAFETY: LASTINPUTINFO is filled by the call; cbSize is set as the API requires.
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            // dwTime is a 32-bit tick count that wraps every 49 days: compare it with the low 32 bits of the 64-bit counter.
            let now = (GetTickCount64() & 0xFFFF_FFFF) as u32;
            now.wrapping_sub(info.dwTime) / 1000
        }
    }

    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
        let monitors = xcap::Monitor::all().map_err(|e| CaptureError::Failed(e.to_string()))?;
        let mut out = Vec::with_capacity(monitors.len());
        for m in monitors {
            let (x, y) = (m.x().map_err(fail)?, m.y().map_err(fail)?);
            let image = m.capture_image().map_err(fail)?;
            out.push(MonitorShot { x, y, width: image.width(), height: image.height(), rgba: image.into_raw() });
        }
        if out.is_empty() {
            return Err(CaptureError::NoMonitors);
        }
        Ok(out)
    }
}

fn fail(e: xcap::XCapError) -> CaptureError {
    CaptureError::Failed(e.to_string())
}
