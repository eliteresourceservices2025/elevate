//! What the tray icon and its menu should say for a given state. Pure, so it is tested without a window; `tray.rs` turns it into the real thing.
use crate::api::WorkState;
use crate::state::StatusView;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    /// Recording right now.
    Tracking,
    /// Signed in but not recording: clocked out, on a break, or no policy yet. Or not signed in.
    Waiting,
    /// ELEVATE cannot be reached: the app keeps what it records and sends it later.
    Offline,
    /// This version is too old.
    NeedsUpdate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Item { id: &'static str, label: String, enabled: bool },
    Submenu { label: String, items: Vec<Entry> },
    Separator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayPlan {
    pub state: TrayState,
    pub tooltip: String,
    pub entries: Vec<Entry>,
}

fn item(id: &'static str, label: &str, enabled: bool) -> Entry {
    Entry::Item { id, label: label.to_string(), enabled }
}

/// How many things the person can pick when clocking in: each client with no projects, or each project plus the client itself.
pub fn choice_count(view: &StatusView) -> usize {
    view.clients.iter().map(|c| if c.projects.is_empty() { 1 } else { c.projects.len() + 1 }).sum()
}

/// The short reason shown beside a greyed-out clock item.
fn short_reason(reason: &str) -> &'static str {
    match reason {
        "jibble" => "you clock in Jibble",
        "selfie" => "a selfie is needed: use ELEVATE",
        _ => "use ELEVATE",
    }
}

pub fn plan(view: &StatusView) -> TrayPlan {
    let state = if view.update_required.is_some() {
        TrayState::NeedsUpdate
    } else if !view.signed_in {
        TrayState::Waiting
    } else if !view.online {
        TrayState::Offline
    } else if view.state == Some(WorkState::Working) && view.policy {
        TrayState::Tracking
    } else {
        TrayState::Waiting
    };

    let tooltip = match (state, view.signed_in, view.state) {
        (TrayState::NeedsUpdate, _, _) => "ELEVATE Tracker App: update needed".to_string(),
        (_, false, _) => "ELEVATE Tracker App: not signed in".to_string(),
        (TrayState::Offline, _, _) => "ELEVATE Tracker App: offline, saving until you are back".to_string(),
        (TrayState::Tracking, _, _) => "ELEVATE Tracker App: recording".to_string(),
        (_, _, Some(WorkState::Break)) => "ELEVATE Tracker App: on a break, not recording".to_string(),
        (_, _, Some(WorkState::Working)) => "ELEVATE Tracker App: not recording yet (waiting for the monitoring policy)".to_string(),
        _ => "ELEVATE Tracker App: clocked out, not recording".to_string(),
    };

    let mut entries = vec![item("open", "Open", true), Entry::Separator];
    if view.signed_in && view.update_required.is_none() {
        let many = choice_count(view) > 1;
        if let Some(reason) = &view.clock_blocked_reason {
            entries.push(item("blocked", &format!("Clock is off: {}", short_reason(reason)), false));
        } else {
            let on = view.online;
            let suffix = if on { "" } else { " (offline)" };
            match view.state {
                Some(WorkState::Working) => {
                    entries.push(Entry::Submenu {
                        label: format!("Start break{suffix}"),
                        items: vec![item("break_15", "15 minutes", on), item("break_30", "30 minutes", on), item("break_60", "1 hour", on), item("break_none", "No time limit", on)],
                    });
                    if many {
                        entries.push(item("open", &format!("Switch client or project…{suffix}"), on));
                    }
                    entries.push(item("clock_out", &format!("Clock out{suffix}"), on));
                }
                Some(WorkState::Break) => {
                    entries.push(item("end_break", &format!("End break{suffix}"), on));
                    entries.push(item("clock_out", &format!("Clock out{suffix}"), on));
                }
                _ => {
                    if many {
                        entries.push(item("open", &format!("Clock in…{suffix}"), on));
                    } else {
                        entries.push(item("clock_in", &format!("Clock in{suffix}"), on));
                    }
                }
            }
        }
        entries.push(Entry::Separator);
    }
    entries.push(item("quit", "Quit", true));
    TrayPlan { state, tooltip, entries }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{ClientChoice, ProjectChoice};

    fn view() -> StatusView {
        StatusView {
            signed_in: true,
            state: Some(WorkState::Out),
            policy: true,
            online: true,
            last_sent_ms: None,
            queue_len: 0,
            version: "1.0.0".into(),
            update_required: None,
            clients: vec![],
            working_since: None,
            on_break: None,
            current: None,
            clock_blocked_reason: None,
            has_shot: false,
        }
    }

    fn ids(p: &TrayPlan) -> Vec<&'static str> {
        p.entries
            .iter()
            .flat_map(|e| match e {
                Entry::Item { id, .. } => vec![*id],
                Entry::Submenu { items, .. } => items.iter().filter_map(|i| if let Entry::Item { id, .. } = i { Some(*id) } else { None }).collect(),
                Entry::Separator => vec![],
            })
            .collect()
    }

    #[test]
    fn clocked_out_offers_clock_in() {
        let p = plan(&view());
        assert_eq!(p.state, TrayState::Waiting);
        assert_eq!(ids(&p), vec!["open", "clock_in", "quit"]);
    }

    #[test]
    fn working_offers_the_four_break_lengths_and_clock_out() {
        let mut v = view();
        v.state = Some(WorkState::Working);
        let p = plan(&v);
        assert_eq!(p.state, TrayState::Tracking);
        assert_eq!(ids(&p), vec!["open", "break_15", "break_30", "break_60", "break_none", "clock_out", "quit"]);
    }

    #[test]
    fn on_a_break_offers_end_break_and_clock_out() {
        let mut v = view();
        v.state = Some(WorkState::Break);
        let p = plan(&v);
        assert_eq!(p.state, TrayState::Waiting);
        assert_eq!(ids(&p), vec!["open", "end_break", "clock_out", "quit"]);
        assert!(p.tooltip.contains("break"));
    }

    #[test]
    fn working_without_a_policy_is_not_recording() {
        let mut v = view();
        v.state = Some(WorkState::Working);
        v.policy = false;
        assert_eq!(plan(&v).state, TrayState::Waiting);
    }

    #[test]
    fn with_several_clients_or_projects_clock_in_opens_the_window_to_choose() {
        let mut v = view();
        v.clients = vec![ClientChoice { id: "c1".into(), name: "Acme".into(), projects: vec![ProjectChoice { id: "p1".into(), name: "Intake".into() }] }];
        assert_eq!(choice_count(&v), 2);
        assert_eq!(ids(&plan(&v)), vec!["open", "open", "quit"]);
        v.state = Some(WorkState::Working);
        assert!(ids(&plan(&v)).windows(2).any(|w| w == ["open", "break_15"]), "a switch entry opens the window while working");
        v.clients = vec![ClientChoice { id: "c1".into(), name: "Acme".into(), projects: vec![] }];
        assert_eq!(choice_count(&v), 1);
    }

    #[test]
    fn a_blocked_clock_is_one_greyed_out_line_with_the_reason() {
        let mut v = view();
        v.clock_blocked_reason = Some("jibble".into());
        let p = plan(&v);
        assert!(p.entries.iter().any(|e| matches!(e, Entry::Item { id: "blocked", enabled: false, label } if label.contains("Jibble"))));
        assert!(!ids(&p).contains(&"clock_in"));
    }

    #[test]
    fn offline_greys_the_clock_items_and_says_why() {
        let mut v = view();
        v.online = false;
        let p = plan(&v);
        assert_eq!(p.state, TrayState::Offline);
        assert!(p.entries.iter().any(|e| matches!(e, Entry::Item { id: "clock_in", enabled: false, label } if label.contains("offline"))));
    }

    #[test]
    fn an_old_version_shows_needs_update_and_no_clock_items() {
        let mut v = view();
        v.update_required = Some("2.0.0".into());
        let p = plan(&v);
        assert_eq!(p.state, TrayState::NeedsUpdate);
        assert_eq!(ids(&p), vec!["open", "quit"]);
    }

    #[test]
    fn not_signed_in_offers_only_open_and_quit() {
        let mut v = view();
        v.signed_in = false;
        let p = plan(&v);
        assert_eq!(ids(&p), vec!["open", "quit"]);
        assert!(p.tooltip.contains("not signed in"));
    }
}
