pub mod api;
pub mod capture;
pub mod commands;
pub mod controller;
pub mod core;
pub mod engine;
pub mod log;
pub mod platform;
pub mod queue;
pub mod state;
pub mod tray;
pub mod tray_plan;
pub mod update_task;
pub mod updates;

use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::api::ApiClient;
use crate::commands::{now_ms, Core};
use crate::controller::Controller;
use crate::engine::Engine;
use crate::log::{Event, Logger};
use crate::queue::Queue;
use crate::state::{new_shared, Deps, KeyringStore, TokenStore};

/// Where the app talks to. Set `ELEVATE_TRACKER_BASE_URL` when building to point a build somewhere else (for example a staging site).
/// An empty value counts as not set: GitHub Actions passes an unset variable as an empty string, and that once built an app with no address.
const BASE_URL: &str = pick_base_url(option_env!("ELEVATE_TRACKER_BASE_URL"), cfg!(debug_assertions));

const fn pick_base_url(configured: Option<&'static str>, debug: bool) -> &'static str {
    if let Some(url) = configured {
        if !str_is_blank(url) {
            return url;
        }
    }
    if debug {
        "http://localhost:3000"
    } else {
        "https://elevate.eliteresourceservices.com"
    }
}

const fn str_is_blank(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !matches!(bytes[i], b' ' | b'\t' | b'\r' | b'\n') {
            return false;
        }
        i += 1;
    }
    true
}

pub fn run() {
    let started_minimized = std::env::args().any(|a| a == "--minimized");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_window(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::status,
            commands::enroll,
            commands::clock_in,
            commands::switch_client,
            commands::start_break,
            commands::end_break,
            commands::clock_out,
            commands::captured_today_list,
            commands::last_shot_thumbnail,
            commands::disconnect,
            commands::check_for_updates,
            commands::open_permission_settings,
            commands::whats_new,
            commands::mark_whats_new_seen,
        ])
        .setup(move |app| {
            // A menu-bar app on a Mac: no icon in the Dock, and the app stays when its window is closed.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let version = app.package_info().version.to_string();
            let data_dir = app.path().app_data_dir()?;
            let logger = Arc::new(Logger::new(data_dir.join("logs")));
            logger.log_event(Event::Started);
            let queue = Arc::new(Queue::open(&data_dir.join("queue")).map_err(|e| e.to_string())?);
            let api = Arc::new(ApiClient::new(BASE_URL, &version).map_err(|e| format!("this build has no usable ELEVATE address: {e}"))?);
            let store: Arc<dyn TokenStore> = Arc::new(KeyringStore);
            let signed_in = store.load().is_some();

            let handle = app.handle().clone();
            let on_change: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
                tray::refresh(&handle);
                let _ = handle.emit("status", ());
            });
            let deps = Deps {
                platform: Arc::from(platform::current()),
                api,
                queue,
                store,
                shared: new_shared(signed_in),
                logger,
                poll_now: Arc::new(AtomicBool::new(false)),
                on_change,
            };
            let core = Arc::new(Core { controller: Controller::new(deps.clone()), deps: deps.clone(), version, data_dir: data_dir.clone(), update_notify: Arc::new(tokio::sync::Notify::new()) });
            app.manage(core.clone());
            tray::build(app.handle(), &core)?;

            // Updates: at start, every 6 hours, on request, and when ELEVATE says this version is too old.
            tauri::async_runtime::spawn(update_task::run(core.clone(), app.handle().clone()));

            // The engine: about once a second it does whatever is due.
            tauri::async_runtime::spawn(async move {
                let mut engine = Engine::new(deps);
                loop {
                    engine.tick(now_ms()).await;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            });

            // Show the window unless Windows started the app at sign-in and the computer is already set up. The window is not created at
            // start: it is built when shown and destroyed when closed, so a tray-only app does not keep WebView2 (hundreds of MB) alive.
            if !(started_minimized && signed_in) {
                tray::show_window(app.handle());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the ELEVATE Tracker App")
        .run(|_app, event| {
            // Closing the last window ends its WebView2 processes but not the app; only an explicit quit (which carries an exit code) exits.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod base_url_tests {
    use super::pick_base_url;

    #[test]
    fn an_empty_address_from_the_build_means_the_default_not_no_address() {
        // GitHub Actions passes an unset variable as an empty string. That crashed the first release at start-up.
        assert_eq!(pick_base_url(Some(""), false), "https://elevate.eliteresourceservices.com");
        assert_eq!(pick_base_url(None, false), "https://elevate.eliteresourceservices.com");
        assert_eq!(pick_base_url(Some("   "), false), "https://elevate.eliteresourceservices.com");
    }

    #[test]
    fn a_real_address_wins_and_debug_builds_default_to_localhost() {
        assert_eq!(pick_base_url(Some("https://staging.example.com"), false), "https://staging.example.com");
        assert_eq!(pick_base_url(None, true), "http://localhost:3000");
    }
}
