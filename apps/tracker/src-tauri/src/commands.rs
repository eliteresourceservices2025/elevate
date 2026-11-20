//! What the window can ask the app to do. Each clock command is one click: it sends one request through the controller, which is the
//! only code that can clock anyone.
use std::path::PathBuf;
use std::sync::Arc;

use base64::Engine as _;
use tauri::{AppHandle, State};
use tokio::sync::Notify;

use crate::api::{ClockAction, ReleaseNotes};
use crate::controller::Controller;
use crate::state::{captured_today, CapturedApp, Deps, StatusView};

/// Everything the commands and the tray need, built once at start.
pub struct Core {
    pub deps: Deps,
    pub controller: Controller,
    pub version: String,
    /// Where the app keeps its small files (the queue folder lives inside it).
    pub data_dir: PathBuf,
    /// Wakes the update task: the person asked to check, or ELEVATE said this version is too old.
    pub update_notify: Arc<Notify>,
}

impl Core {
    pub fn status_view(&self) -> StatusView {
        self.deps.shared.lock().map(|s| s.view(&self.version)).unwrap_or_else(|p| p.into_inner().view(&self.version))
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[tauri::command]
pub fn app_version(core: State<'_, Arc<Core>>) -> String {
    core.version.clone()
}

#[tauri::command]
pub fn status(core: State<'_, Arc<Core>>) -> StatusView {
    core.status_view()
}

#[tauri::command]
pub async fn enroll(app: AppHandle, core: State<'_, Arc<Core>>, code: String) -> Result<(), String> {
    let core = core.inner().clone();
    let computer = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows computer".to_string());
    core.controller.enroll(&code, &computer).await?;
    // Start with Windows from now on (the person can turn it off in Windows settings).
    use tauri_plugin_autostart::ManagerExt;
    let _ = app.autolaunch().enable();
    Ok(())
}

async fn click(core: &Arc<Core>, action: ClockAction, done: &str) -> Result<String, String> {
    core.controller.clock(action).await.map(|_| done.to_string())
}

#[tauri::command]
pub async fn clock_in(core: State<'_, Arc<Core>>, client_id: Option<String>, project_id: Option<String>) -> Result<String, String> {
    click(core.inner(), ClockAction::ClockIn { client_id, project_id }, "Clocked in.").await
}

#[tauri::command]
pub async fn switch_client(core: State<'_, Arc<Core>>, client_id: Option<String>, project_id: Option<String>) -> Result<String, String> {
    click(core.inner(), ClockAction::SwitchClient { client_id, project_id }, "Switched.").await
}

#[tauri::command]
pub async fn start_break(core: State<'_, Arc<Core>>, minutes: Option<u8>) -> Result<String, String> {
    click(core.inner(), ClockAction::StartBreak { minutes }, "Break started.").await
}

#[tauri::command]
pub async fn end_break(core: State<'_, Arc<Core>>) -> Result<String, String> {
    click(core.inner(), ClockAction::EndBreak, "Break ended.").await
}

#[tauri::command]
pub async fn clock_out(core: State<'_, Arc<Core>>) -> Result<String, String> {
    click(core.inner(), ClockAction::ClockOut, "Clocked out.").await
}

/// App names and minutes of the last 24 hours, for "What was captured".
#[tauri::command]
pub fn captured_today_list(core: State<'_, Arc<Core>>) -> Vec<CapturedApp> {
    captured_today(&core.deps.queue, now_ms())
}

/// The last picture, already blurred, as a data address the window can show. `None` before the first one.
#[tauri::command]
pub fn last_shot_thumbnail(core: State<'_, Arc<Core>>) -> Option<String> {
    let bytes = core.deps.shared.lock().ok()?.last_shot.clone()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn disconnect(core: State<'_, Arc<Core>>) -> Result<(), String> {
    core.controller.disconnect()
}

/// Look for an update now (the tray item, or the Update now button).
#[tauri::command]
pub fn check_for_updates(core: State<'_, Arc<Core>>) {
    core.update_notify.notify_one();
}

/// The notes of the release this app was just updated to, once. `None` on a first install, when nothing changed, or when ELEVATE is
/// not reachable (it asks again at the next start, because the version is only marked seen when the person closes the box).
#[tauri::command]
pub async fn whats_new(core: State<'_, Arc<Core>>) -> Result<Option<ReleaseNotes>, String> {
    let core = core.inner().clone();
    let last = crate::updates::read_last_seen(&core.data_dir);
    let Some(_) = last.as_deref() else {
        // A first install: nothing was updated, so there is nothing new to show. Remember this version.
        let _ = crate::updates::write_last_seen(&core.data_dir, &core.version);
        return Ok(None);
    };
    if !crate::updates::whats_new_due(last.as_deref(), &core.version) {
        return Ok(None);
    }
    let Some(token) = core.deps.store.load() else { return Ok(None) };
    Ok(core.deps.api.release_notes(&token, &core.version).await.ok())
}

#[tauri::command]
pub fn mark_whats_new_seen(core: State<'_, Arc<Core>>) {
    let _ = crate::updates::write_last_seen(&core.data_dir, &core.version);
}
