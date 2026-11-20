//! The tray icon: four states, and a menu that offers the clock actions that fit the state. A click here is a person's click, the same as
//! pressing the button in the window.
use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::api::ClockAction;
use crate::commands::Core;
use crate::tray_plan::{plan, Entry, TrayPlan, TrayState};

const TRAY_ID: &str = "main";

fn colour(state: TrayState) -> (u8, u8, u8) {
    match state {
        TrayState::Tracking => (34, 160, 90),
        TrayState::Waiting => (120, 120, 135),
        TrayState::Offline => (225, 150, 30),
        TrayState::NeedsUpdate => (210, 60, 60),
    }
}

/// A 32 x 32 disc in the state's colour with a white ring, drawn here so there is no image file to ship for each state.
fn icon(state: TrayState) -> Image<'static> {
    let (r, g, b) = colour(state);
    let size = 32usize;
    let mut rgba = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x as f32 - 15.5, y as f32 - 15.5);
            let d = (dx * dx + dy * dy).sqrt();
            let px = &mut rgba[(y * size + x) * 4..(y * size + x) * 4 + 4];
            if d <= 11.0 {
                px.copy_from_slice(&[r, g, b, 255]);
            } else if d <= 14.5 {
                px.copy_from_slice(&[255, 255, 255, 255]);
            }
        }
    }
    Image::new_owned(rgba, size as u32, size as u32)
}

fn build_entry(app: &AppHandle, menu: &Menu<tauri::Wry>, entry: &Entry) -> tauri::Result<()> {
    match entry {
        Entry::Item { id, label, enabled } => menu.append(&MenuItem::with_id(app, *id, label, *enabled, None::<&str>)?),
        Entry::Separator => menu.append(&PredefinedMenuItem::separator(app)?),
        Entry::Submenu { label, items } => {
            let sub = Submenu::new(app, label, true)?;
            for item in items {
                if let Entry::Item { id, label, enabled } = item {
                    sub.append(&MenuItem::with_id(app, *id, label, *enabled, None::<&str>)?)?;
                }
            }
            menu.append(&sub)
        }
    }
}

fn build_menu(app: &AppHandle, plan: &TrayPlan) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for entry in &plan.entries {
        build_entry(app, &menu, entry)?;
    }
    Ok(menu)
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("status") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Tells the window how the click went. A refusal also brings the window forward so the sentence is seen.
fn notice(app: &AppHandle, ok: bool, message: &str) {
    let _ = app.emit("notice", serde_json::json!({ "ok": ok, "message": message }));
    if !ok {
        show_window(app);
    }
}

fn clock_from_menu(app: &AppHandle, action: ClockAction, done: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(core) = app.try_state::<Arc<Core>>() else { return };
        let core = core.inner().clone();
        match core.controller.clock(action).await {
            Ok(_) => notice(&app, true, done),
            Err(message) => notice(&app, false, &message),
        }
    });
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => show_window(app),
        "clock_in" => clock_from_menu(app, ClockAction::ClockIn { client_id: None, project_id: None }, "Clocked in."),
        "break_15" => clock_from_menu(app, ClockAction::StartBreak { minutes: Some(15) }, "Break started."),
        "break_30" => clock_from_menu(app, ClockAction::StartBreak { minutes: Some(30) }, "Break started."),
        "break_60" => clock_from_menu(app, ClockAction::StartBreak { minutes: Some(60) }, "Break started."),
        "break_none" => clock_from_menu(app, ClockAction::StartBreak { minutes: None }, "Break started."),
        "end_break" => clock_from_menu(app, ClockAction::EndBreak, "Break ended."),
        "clock_out" => clock_from_menu(app, ClockAction::ClockOut, "Clocked out."),
        "updates" => {
            if let Some(core) = app.try_state::<Arc<Core>>() {
                core.update_notify.notify_one();
                notice(app, true, "Looking for an update…");
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

pub fn build(app: &AppHandle, core: &Arc<Core>) -> tauri::Result<()> {
    let p = plan(&core.status_view());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(p.state))
        .tooltip(&p.tooltip)
        .menu(&build_menu(app, &p)?)
        .on_menu_event(|app, event| on_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Brings the icon, the tooltip and the menu in line with the current state. Safe to call from any thread.
pub fn refresh(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(core) = handle.try_state::<Arc<Core>>() else { return };
        let p = plan(&core.status_view());
        let Some(tray) = handle.tray_by_id(TRAY_ID) else { return };
        let _ = tray.set_icon(Some(icon(p.state)));
        let _ = tray.set_tooltip(Some(&p.tooltip));
        if let Ok(menu) = build_menu(&handle, &p) {
            let _ = tray.set_menu(Some(menu));
        }
    });
}
