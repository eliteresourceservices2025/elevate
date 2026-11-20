pub mod api;
pub mod capture;
pub mod controller;
pub mod core;
pub mod engine;
pub mod log;
pub mod platform;
pub mod queue;
pub mod state;

use tauri::Manager;

/// The version shown in the window; it comes from tauri.conf.json, the one source of truth.
#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("status") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the ELEVATE Tracker App");
}
