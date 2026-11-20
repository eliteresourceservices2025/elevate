//! The background task that keeps the app up to date. It checks at start, every 6 hours, when the person asks, and when ELEVATE says
//! this version is too old. A downloaded update is installed at once if it is required, otherwise only when the person is not working.
use std::sync::Arc;
use std::time::Duration;

use tauri::AppHandle;

use crate::commands::{now_ms, Core};
use crate::log::Event;
use crate::updates::{check, download_verified, launch_installer, should_install_now, PLATFORM, PUBLIC_KEY};

const FIRST_CHECK_MS: i64 = 20_000;
const CHECK_EVERY_MS: i64 = 6 * 3_600_000;
const TICK: Duration = Duration::from_secs(30);

/// Looks for an update and, if there is one newer than this version, downloads and verifies it. Returns the verified file.
async fn find(core: &Arc<Core>) -> Option<(String, Vec<u8>)> {
    let token = core.deps.store.load()?;
    let offer = match check(&core.deps.api, &token, PLATFORM, &core.version).await {
        Ok(Some(offer)) => offer,
        _ => return None,
    };
    match download_verified(&core.deps.api, &token, &offer, PUBLIC_KEY.trim()).await {
        Ok(bytes) => Some((offer.version, bytes)),
        Err(crate::updates::UpdateError::BadSignature) => {
            // Never run it. The next check may find a good one.
            core.deps.logger.log_event(Event::UpdateRejected);
            None
        }
        Err(_) => None,
    }
}

pub async fn run(core: Arc<Core>, app: AppHandle) {
    let mut next_check = now_ms() + FIRST_CHECK_MS;
    let mut ready: Option<(String, Vec<u8>)> = None;
    let mut asked_for_required = false;
    loop {
        tokio::select! {
            _ = tokio::time::sleep(TICK) => {}
            _ = core.update_notify.notified() => { next_check = now_ms(); }
        }

        let (state, required, signed_in) = core.deps.shared.lock().map(|s| (s.work_state, s.update_required.is_some(), s.signed_in)).unwrap_or((None, false, false));
        if !signed_in {
            continue;
        }
        // ELEVATE said this version is too old: look right away, once per such answer.
        if required && !asked_for_required {
            asked_for_required = true;
            next_check = now_ms();
        }
        if !required {
            asked_for_required = false;
        }

        if now_ms() >= next_check {
            next_check = now_ms() + CHECK_EVERY_MS;
            if let Some((version, bytes)) = find(&core).await {
                if ready.as_ref().map(|(v, _)| v.as_str()) != Some(version.as_str()) {
                    core.deps.logger.log_event(Event::UpdateReady);
                    if let Ok(mut s) = core.deps.shared.lock() {
                        s.update_version = Some(version.clone());
                    }
                    (core.deps.on_change)();
                }
                ready = Some((version, bytes));
            }
        }

        if let Some((_, bytes)) = &ready {
            if should_install_now(state, required, true) {
                // Hand over to the installer and leave: it replaces this app and starts it again in the tray.
                if launch_installer(bytes).is_ok() {
                    app.exit(0);
                    return;
                }
            }
        }
    }
}
