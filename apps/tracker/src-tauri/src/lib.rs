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
const BASE_URL: &str = match option_env!("ELEVATE_TRACKER_BASE_URL") {
    Some(url) => url,
    None => {
        if cfg!(debug_assertions) {
            "http://localhost:3000"
        } else {
            "https://elevate.eliteresourceservices.com"
        }
    }
};

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
        ])
        .on_window_event(|window, event| {
            // Closing the window hides it: the app keeps running in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
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
            let core = Arc::new(Core { controller: Controller::new(deps.clone()), deps: deps.clone(), version });
            app.manage(core.clone());
            tray::build(app.handle(), &core)?;

            // The engine: about once a second it does whatever is due.
            tauri::async_runtime::spawn(async move {
                let mut engine = Engine::new(deps);
                loop {
                    engine.tick(now_ms()).await;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            });

            // Show the window unless Windows started the app at sign-in and the computer is already set up.
            if !(started_minimized && signed_in) {
                if let Some(window) = app.get_webview_window("status") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the ELEVATE Tracker App");
}
