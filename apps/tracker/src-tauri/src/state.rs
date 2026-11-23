//! What the window and the tray show, shared between the engine (which updates it) and the commands (which read it).
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::api::{ApiClient, ClientChoice, CurrentWork, OnBreak, TodayWork, WorkState};
use crate::log::Logger;
use crate::platform::Platform;
use crate::queue::{Queue, SEGMENT_MAX_AGE_MS};

/// Where the device token lives. The real one is Windows Credential Manager; tests use memory.
pub trait TokenStore: Send + Sync {
    fn save(&self, token: &str) -> Result<(), String>;
    fn load(&self) -> Option<String>;
    fn clear(&self) -> Result<(), String>;
}

pub struct KeyringStore;

impl TokenStore for KeyringStore {
    fn save(&self, token: &str) -> Result<(), String> {
        crate::api::token::save_token(token)
    }
    fn load(&self) -> Option<String> {
        crate::api::token::load_token()
    }
    fn clear(&self) -> Result<(), String> {
        crate::api::token::clear_token()
    }
}

#[derive(Default)]
pub struct MemoryStore(Mutex<Option<String>>);

impl MemoryStore {
    pub fn with(token: &str) -> MemoryStore {
        MemoryStore(Mutex::new(Some(token.to_string())))
    }
}

impl TokenStore for MemoryStore {
    fn save(&self, token: &str) -> Result<(), String> {
        *self.0.lock().map_err(|_| "locked".to_string())? = Some(token.to_string());
        Ok(())
    }
    fn load(&self) -> Option<String> {
        self.0.lock().ok()?.clone()
    }
    fn clear(&self) -> Result<(), String> {
        *self.0.lock().map_err(|_| "locked".to_string())? = None;
        Ok(())
    }
}

/// Everything the app knows about this person's state right now.
pub struct Status {
    pub signed_in: bool,
    pub work_state: Option<WorkState>,
    pub policy: bool,
    /// False after ELEVATE could not be reached; true until then (so the first click is never blocked before the first check).
    pub online: bool,
    pub last_sent_ms: Option<i64>,
    pub queue_segments: usize,
    pub queue_shots: usize,
    pub update_required: Option<String>,
    /// A downloaded, verified update that is waiting for the right moment to install (the version number).
    pub update_version: Option<String>,
    pub clients: Vec<ClientChoice>,
    pub working_since: Option<String>,
    pub on_break: Option<OnBreak>,
    pub current: Option<CurrentWork>,
    pub clock_blocked_reason: Option<String>,
    /// Today's worked time as ELEVATE last counted it, and the moment (this computer's clock) it arrived, so the window can keep counting.
    pub today: Option<TodayWork>,
    pub today_received_ms: Option<i64>,
    /// False when the system has not let the app see the screen yet (macOS Screen Recording).
    pub permissions_ok: bool,
    pub idle_timeout_secs: u32,
    /// The last picture, already blurred: what the person can look at under "What was captured".
    pub last_shot: Option<Vec<u8>>,
}

impl Default for Status {
    fn default() -> Self {
        Status {
            signed_in: false,
            work_state: None,
            policy: false,
            online: true,
            last_sent_ms: None,
            queue_segments: 0,
            queue_shots: 0,
            update_required: None,
            update_version: None,
            clients: Vec::new(),
            working_since: None,
            on_break: None,
            current: None,
            clock_blocked_reason: None,
            today: None,
            today_received_ms: None,
            permissions_ok: true,
            idle_timeout_secs: 180,
            last_shot: None,
        }
    }
}

pub type Shared = Arc<Mutex<Status>>;

pub fn new_shared(signed_in: bool) -> Shared {
    Arc::new(Mutex::new(Status { signed_in, ..Status::default() }))
}

/// What the window gets: plain data, no picture bytes.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StatusView {
    pub signed_in: bool,
    pub state: Option<WorkState>,
    pub policy: bool,
    pub online: bool,
    pub last_sent_ms: Option<i64>,
    pub queue_len: usize,
    pub version: String,
    pub update_required: Option<String>,
    pub update_version: Option<String>,
    pub clients: Vec<ClientChoice>,
    pub working_since: Option<String>,
    pub on_break: Option<OnBreak>,
    pub current: Option<CurrentWork>,
    pub clock_blocked_reason: Option<String>,
    pub today: Option<TodayWork>,
    pub today_received_ms: Option<i64>,
    pub permissions_ok: bool,
    /// Whether this app installs its own updates (Windows). On a Mac the person downloads the new version from ELEVATE.
    pub auto_update: bool,
    pub has_shot: bool,
}

impl Status {
    pub fn view(&self, version: &str) -> StatusView {
        StatusView {
            signed_in: self.signed_in,
            state: self.work_state,
            policy: self.policy,
            online: self.online,
            last_sent_ms: self.last_sent_ms,
            queue_len: self.queue_segments + self.queue_shots,
            version: version.to_string(),
            update_required: self.update_required.clone(),
            update_version: self.update_version.clone(),
            clients: self.clients.clone(),
            working_since: self.working_since.clone(),
            on_break: self.on_break.clone(),
            current: self.current.clone(),
            clock_blocked_reason: self.clock_blocked_reason.clone(),
            today: self.today.clone(),
            today_received_ms: self.today_received_ms,
            permissions_ok: self.permissions_ok,
            auto_update: cfg!(windows),
            has_shot: self.last_shot.is_some(),
        }
    }
}

/// One program's time today. App name and minutes only.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapturedApp {
    pub app: String,
    pub start_ms: i64,
    pub minutes: u32,
}

/// The last 24 hours of active time by program, most time first (idle time and the lock screen are left out).
pub fn captured_today(queue: &Queue, now_ms: i64) -> Vec<CapturedApp> {
    let mut by_app: HashMap<String, (i64, i64)> = HashMap::new();
    for s in queue.history_since(now_ms - SEGMENT_MAX_AGE_MS).unwrap_or_default() {
        if s.state == crate::core::segments::State::Idle {
            continue;
        }
        let entry = by_app.entry(s.app).or_insert((s.start_ms, 0));
        entry.0 = entry.0.min(s.start_ms);
        entry.1 += s.end_ms - s.start_ms;
    }
    let mut out: Vec<CapturedApp> = by_app.into_iter().map(|(app, (start_ms, ms))| CapturedApp { app, start_ms, minutes: ((ms + 30_000) / 60_000) as u32 }).filter(|c| c.minutes > 0).collect();
    out.sort_by(|a, b| b.minutes.cmp(&a.minutes).then(a.app.cmp(&b.app)));
    out
}

/// What the engine and the commands share.
#[derive(Clone)]
pub struct Deps {
    pub platform: Arc<dyn Platform>,
    pub api: Arc<ApiClient>,
    pub queue: Arc<Queue>,
    pub store: Arc<dyn TokenStore>,
    pub shared: Shared,
    pub logger: Arc<Logger>,
    /// Set by a clock action or a sign-in: the engine asks ELEVATE for the state at once.
    pub poll_now: Arc<AtomicBool>,
    /// Called when something the window or the tray shows has changed.
    pub on_change: Arc<dyn Fn() + Send + Sync>,
}
