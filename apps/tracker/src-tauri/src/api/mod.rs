//! The only door to ELEVATE (`/api/tracker/*`). One client, three headers on every call, a 30-second limit, no redirects.
//! The app never sends a time of its own for a clock action: the server decides it.

mod client;
pub mod error;
pub mod token;

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub use client::ApiClient;
pub use error::ApiError;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkState {
    Working,
    Break,
    Out,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnBreak {
    pub started_at: String,
    pub planned_minutes: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentWork {
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub since: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ProjectChoice {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct ClientChoice {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub projects: Vec<ProjectChoice>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackerSettings {
    pub idle_timeout_seconds: u32,
    pub shot_interval_minutes: u32,
}

/// What ELEVATE says about this person right now.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockState {
    pub state: WorkState,
    pub since: Option<String>,
    #[serde(default)]
    pub working_since: Option<String>,
    #[serde(default)]
    pub on_break: Option<OnBreak>,
    #[serde(default)]
    pub current: Option<CurrentWork>,
    #[serde(default)]
    pub clients: Vec<ClientChoice>,
    /// `"jibble"` or `"selfie"` when the clock buttons must stay off.
    #[serde(default)]
    pub clock_blocked_reason: Option<String>,
    pub policy: bool,
    pub settings: TrackerSettings,
    /// The version this app must update to. The app still gets the clock state (time keeping is never blocked by the version floor),
    /// but records and sends nothing until it is updated.
    #[serde(default)]
    pub update_required: Option<String>,
}

/// What the person asked for on the clock. Nothing here is a time: ELEVATE stamps the moment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ClockAction {
    ClockIn { client_id: Option<String>, project_id: Option<String> },
    SwitchClient { client_id: Option<String>, project_id: Option<String> },
    StartBreak { minutes: Option<u8> },
    EndBreak,
    ClockOut,
}

impl ClockAction {
    fn body(&self) -> Value {
        fn with(action: &str, client: &Option<String>, project: &Option<String>, minutes: Option<u8>) -> Value {
            let mut v = json!({ "action": action });
            if let Some(c) = client {
                v["clientId"] = json!(c);
            }
            if let Some(p) = project {
                v["projectId"] = json!(p);
            }
            if let Some(m) = minutes {
                v["breakMinutes"] = json!(m);
            }
            v
        }
        match self {
            ClockAction::ClockIn { client_id, project_id } => with("clock_in", client_id, project_id, None),
            ClockAction::SwitchClient { client_id, project_id } => with("switch_client", client_id, project_id, None),
            ClockAction::StartBreak { minutes } => with("break_start", &None, &None, *minutes),
            ClockAction::EndBreak => with("break_end", &None, &None, None),
            ClockAction::ClockOut => with("clock_out", &None, &None, None),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockReply {
    pub state: WorkState,
    pub at: String,
    pub outside_allowed_range: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct IngestReply {
    pub accepted: u32,
    pub clipped: u32,
    pub duplicate: u32,
    #[serde(default)]
    pub rejected: HashMap<String, u32>,
}

/// Sent with each batch of segments so HR can see which computers are healthy.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Health {
    pub permissions_ok: bool,
    pub queue_size: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotTicket {
    pub shot_id: String,
    pub upload_url: Option<String>,
}

/// The answer to enrolling. `Debug` is written by hand so the token can never be printed.
pub struct Enrolled {
    pub token: String,
    pub device_id: String,
}

impl std::fmt::Debug for Enrolled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Enrolled").field("token", &"<hidden>").field("device_id", &self.device_id).finish()
    }
}


/// The newest published update for this platform, in Tauri's dynamic update shape. `url` is ELEVATE's own download address.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct UpdateOffer {
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub url: String,
    pub signature: String,
}

/// What changed in one release, in three plain lists.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct ChangeLists {
    #[serde(default)]
    pub added: Vec<String>,
    #[serde(default)]
    pub improved: Vec<String>,
    #[serde(default)]
    pub fixed: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseNotes {
    pub version: String,
    #[serde(default)]
    pub published_at: Option<String>,
    pub notes: ChangeLists,
    #[serde(default)]
    pub min_required: bool,
}
