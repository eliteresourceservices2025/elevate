//! The engine and the clock controls against a fake platform, a fake clock and a mock ELEVATE.
//! The whole day is simulated: working, breaks, sleep, a locked screen, idle, going offline, an update, signing in again.
mod common;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use elevate_tracker_lib::api::{ApiClient, ClockAction, WorkState};
use elevate_tracker_lib::controller::{blocked_message, Controller};
use elevate_tracker_lib::core::segments::State;
use elevate_tracker_lib::engine::Engine;
use elevate_tracker_lib::log::Logger;
use elevate_tracker_lib::platform::{CaptureError, MonitorShot, Platform};
use elevate_tracker_lib::queue::Queue;
use elevate_tracker_lib::state::{captured_today, new_shared, Deps, MemoryStore, Shared, TokenStore};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const T0: i64 = 1_700_000_000_000;

struct FakePlatform {
    app: Mutex<Option<String>>,
    idle: AtomicU32,
    foreground_calls: AtomicUsize,
}

impl Platform for FakePlatform {
    fn foreground_app(&self) -> Option<String> {
        self.foreground_calls.fetch_add(1, Ordering::SeqCst);
        self.app.lock().unwrap().clone()
    }
    fn idle_seconds(&self) -> u32 {
        self.idle.load(Ordering::SeqCst)
    }
    fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError> {
        Ok(vec![MonitorShot { x: 0, y: 0, width: 64, height: 48, rgba: [90, 90, 90, 255].repeat(64 * 48) }])
    }
}

struct Rig {
    server: MockServer,
    engine: Engine,
    controller: Controller,
    fake: Arc<FakePlatform>,
    store: Arc<MemoryStore>,
    shared: Shared,
    queue: Arc<Queue>,
    poll_now: Arc<AtomicBool>,
    changes: Arc<AtomicUsize>,
    _dir: tempfile::TempDir,
}

fn state_body(state: &str, policy: bool) -> Value {
    json!({
        "state": state, "since": null, "workingSince": null, "onBreak": null, "current": null, "clients": [],
        "clockBlockedReason": null, "policy": policy, "settings": { "idleTimeoutSeconds": 180, "shotIntervalMinutes": 10 }
    })
}

/// Replaces everything the mock knows with a normal day: this state, and accepting segments, pictures and clock actions.
async fn says(server: &MockServer, state: &str, policy: bool) {
    server.reset().await;
    mount_rest(server).await;
    Mock::given(method("GET")).and(path("/api/tracker/clock-state")).respond_with(ResponseTemplate::new(200).set_body_json(state_body(state, policy))).mount(server).await;
}

/// Like `says`, but clock-state answers with this status and body.
async fn says_status(server: &MockServer, status: u16, body: Value) {
    server.reset().await;
    mount_rest(server).await;
    Mock::given(method("GET")).and(path("/api/tracker/clock-state")).respond_with(ResponseTemplate::new(status).set_body_json(body)).mount(server).await;
}

async fn mount_rest(server: &MockServer) {
    let ok = |route: &'static str, body: Value| {
        let server_route = route;
        (server_route, body)
    };
    let (_, ingest) = ok("segments", json!({ "ok": true, "accepted": 1, "clipped": 0, "duplicate": 0, "rejected": {} }));
    Mock::given(method("POST")).and(path("/api/tracker/segments")).respond_with(ResponseTemplate::new(200).set_body_json(ingest)).mount(server).await;
    Mock::given(method("POST")).and(path("/api/tracker/shots/request")).respond_with(ResponseTemplate::new(200).set_body_json(json!({ "shotId": "s1", "uploadUrl": format!("{}/storage/upload?token=t", server.uri()) }))).mount(server).await;
    Mock::given(method("PUT")).and(path("/storage/upload")).respond_with(ResponseTemplate::new(200)).mount(server).await;
    Mock::given(method("POST")).and(path("/api/tracker/shots/finalize")).respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true }))).mount(server).await;
    Mock::given(method("POST")).and(path("/api/tracker/clock")).respond_with(ResponseTemplate::new(200).set_body_json(json!({ "state": "working", "at": "2026-11-20T16:00:00.000Z", "outsideAllowedRange": false }))).mount(server).await;
}

async fn rig(signed_in: bool) -> Rig {
    let server = MockServer::start().await;
    says(&server, "working", true).await;
    let dir = tempfile::tempdir().unwrap();
    let queue = Arc::new(Queue::open(dir.path()).unwrap());
    let fake = Arc::new(FakePlatform { app: Mutex::new(Some("chrome".into())), idle: AtomicU32::new(0), foreground_calls: AtomicUsize::new(0) });
    let store = Arc::new(if signed_in { MemoryStore::with("tok") } else { MemoryStore::default() });
    let shared = new_shared(signed_in);
    let poll_now = Arc::new(AtomicBool::new(false));
    let changes = Arc::new(AtomicUsize::new(0));
    let counter = changes.clone();
    let deps = Deps {
        platform: fake.clone(),
        api: Arc::new(ApiClient::new(&server.uri(), "1.0.0").unwrap()),
        queue: queue.clone(),
        store: store.clone(),
        shared: shared.clone(),
        logger: Arc::new(Logger::none()),
        poll_now: poll_now.clone(),
        on_change: Arc::new(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        }),
    };
    Rig { server, engine: Engine::new(deps.clone()), controller: Controller::new(deps), fake, store, shared, queue, poll_now, changes, _dir: dir }
}

impl Rig {
    /// Runs the engine from second `from` to second `to` (inclusive) in `step`-second ticks.
    async fn run(&mut self, from: i64, to: i64, step: i64) {
        let mut t = from;
        while t <= to {
            self.engine.tick(T0 + t * 1000).await;
            t += step;
        }
    }
    fn app(&self, name: Option<&str>) {
        *self.fake.app.lock().unwrap() = name.map(|s| s.to_string());
    }
    async fn calls(&self, route: &str) -> usize {
        self.server.received_requests().await.unwrap().iter().filter(|r| r.url.path() == route).count()
    }
    fn foreground_calls(&self) -> usize {
        self.fake.foreground_calls.load(Ordering::SeqCst)
    }
    /// Everything recorded so far, waiting or already sent.
    fn history(&self) -> Vec<elevate_tracker_lib::core::segments::Segment> {
        self.queue.history_since(0).unwrap()
    }
}

async fn sent_apps(server: &MockServer) -> Vec<String> {
    let mut apps = Vec::new();
    for r in server.received_requests().await.unwrap().iter().filter(|r| r.url.path() == "/api/tracker/segments") {
        let body: Value = serde_json::from_slice(&r.body).unwrap();
        for s in body["segments"].as_array().unwrap() {
            apps.push(s["app"].as_str().unwrap().to_string());
        }
    }
    apps
}

#[tokio::test]
async fn working_time_becomes_segments_that_are_sent_and_after_clock_out_nothing_more_is_sampled() {
    let mut r = rig(true).await;
    r.run(0, 55, 5).await; // chrome for a minute
    r.app(Some("excel"));
    r.run(60, 120, 5).await;
    assert_eq!(r.shared.lock().unwrap().work_state, Some(WorkState::Working));
    let mut apps = sent_apps(&r.server).await; // what was already sent (changing the mock's answers forgets its record)

    says(&r.server, "out", true).await; // the person clocked out on the web
    r.run(125, 155, 5).await; // the next check (at 150 s) sees it
    assert_eq!(r.shared.lock().unwrap().work_state, Some(WorkState::Out));
    let after = r.foreground_calls();
    r.run(160, 600, 5).await;
    assert_eq!(r.foreground_calls(), after, "no sample is taken once ELEVATE says the person is not working");

    apps.extend(sent_apps(&r.server).await);
    assert!(apps.contains(&"chrome".to_string()) && apps.contains(&"excel".to_string()), "{apps:?}");
    assert_eq!(r.queue.len().unwrap().0, 0, "everything finished was sent");
}

#[tokio::test]
async fn a_break_stops_sampling_the_same_way() {
    let mut r = rig(true).await;
    r.run(0, 120, 5).await;
    says(&r.server, "break", true).await;
    r.run(125, 155, 5).await;
    assert_eq!(r.shared.lock().unwrap().work_state, Some(WorkState::Break));
    let after = r.foreground_calls();
    r.run(160, 400, 5).await;
    assert_eq!(r.foreground_calls(), after);
}

#[tokio::test]
async fn nothing_is_recorded_when_the_monitoring_policy_is_off() {
    let mut r = rig(true).await;
    says(&r.server, "working", false).await;
    r.run(0, 300, 5).await;
    assert_eq!(r.foreground_calls(), 0);
    assert!(r.history().is_empty());
    assert_eq!(r.calls("/api/tracker/segments").await, 0);
}

#[tokio::test]
async fn an_update_required_answer_stops_sampling_and_sending() {
    let mut r = rig(true).await;
    says_status(&r.server, 426, json!({ "error": "update_required", "minVersion": "2.0.0" })).await;
    r.run(0, 300, 5).await;
    assert_eq!(r.shared.lock().unwrap().update_required.as_deref(), Some("2.0.0"));
    assert_eq!(r.foreground_calls(), 0);
    assert_eq!(r.calls("/api/tracker/segments").await, 0);
}

#[tokio::test]
async fn a_signed_out_answer_clears_the_token_and_stops_asking() {
    let mut r = rig(true).await;
    says_status(&r.server, 401, json!({ "error": "unauthorized" })).await;
    r.run(0, 5, 5).await;
    assert!(r.store.load().is_none(), "the token is removed");
    assert!(!r.shared.lock().unwrap().signed_in);
    let asked = r.calls("/api/tracker/clock-state").await;
    r.run(10, 300, 5).await;
    assert_eq!(r.calls("/api/tracker/clock-state").await, asked, "a signed-out app stops asking");
    assert_eq!(r.foreground_calls(), 0);
}

#[tokio::test]
async fn sleeping_never_invents_time_across_the_gap() {
    let mut r = rig(true).await;
    r.run(0, 30, 5).await;
    r.run(630, 660, 5).await; // the lid was closed for ten minutes
    says(&r.server, "out", true).await;
    r.run(665, 700, 5).await;
    let segs = r.history();
    assert!(!segs.is_empty());
    let (gap_start, gap_end) = (T0 + 30_000, T0 + 630_000);
    assert!(segs.iter().all(|s| !(s.start_ms < gap_end && s.end_ms > gap_start + 1000 && s.start_ms <= gap_start && s.end_ms >= gap_end)), "no segment spans the sleep: {segs:?}");
    assert!(segs.iter().all(|s| s.end_ms - s.start_ms <= 60_000), "{segs:?}");
}

#[tokio::test]
async fn the_lock_screen_counts_as_idle_not_as_an_app() {
    let mut r = rig(true).await;
    r.app(None); // nothing readable in front: the lock screen
    r.run(0, 120, 5).await;
    says(&r.server, "out", true).await;
    r.run(125, 160, 5).await;
    let segs = r.history();
    assert!(!segs.is_empty());
    assert!(segs.iter().all(|s| s.state == State::Idle), "{segs:?}");
    let apps = sent_apps(&r.server).await;
    assert!(apps.iter().all(|a| a == "Locked"), "{apps:?}");
}

#[tokio::test]
async fn going_idle_after_the_servers_timeout_is_recorded_as_idle() {
    let mut r = rig(true).await;
    r.run(0, 30, 5).await;
    r.fake.idle.store(200, Ordering::SeqCst); // past the 180 s the server asked for
    r.run(35, 120, 5).await;
    says(&r.server, "out", true).await;
    r.run(125, 160, 5).await;
    let segs = r.history();
    assert!(segs.iter().any(|s| s.state == State::Active) && segs.iter().any(|s| s.state == State::Idle), "{segs:?}");
}

#[tokio::test]
async fn one_blurred_picture_per_window_while_working_and_none_on_a_break() {
    let mut r = rig(true).await;
    r.run(0, 1200, 5).await; // twenty minutes
    let sent = r.calls("/api/tracker/shots/finalize").await;
    assert!((1..=3).contains(&sent), "{sent} pictures in twenty minutes");
    assert!(r.shared.lock().unwrap().last_shot.is_some(), "the last blurred picture is kept for the window");
    says(&r.server, "break", true).await;
    r.run(1205, 1260, 5).await;
    let before = r.calls("/api/tracker/shots/request").await;
    r.run(1265, 2400, 5).await;
    assert_eq!(r.calls("/api/tracker/shots/request").await, before, "no picture on a break");
}

#[tokio::test]
async fn signing_in_stores_the_token_and_the_next_check_uses_it() {
    let mut r = rig(false).await;
    Mock::given(method("POST")).and(path("/api/tracker/enroll")).respond_with(ResponseTemplate::new(200).set_body_json(json!({ "token": "new_tok", "deviceId": "d1" }))).mount(&r.server).await;
    r.engine.tick(T0).await;
    assert_eq!(r.calls("/api/tracker/clock-state").await, 0, "a computer that is not signed in asks nothing");

    r.controller.enroll("ABCD2345", "LORIE-PC").await.expect("the code worked");
    assert_eq!(r.store.load().as_deref(), Some("new_tok"));
    assert!(r.shared.lock().unwrap().signed_in);
    assert!(r.poll_now.load(Ordering::SeqCst), "the engine is told to look at once");
    r.engine.tick(T0 + 1000).await;
    let check = r.server.received_requests().await.unwrap().into_iter().find(|q| q.url.path() == "/api/tracker/clock-state").expect("a check was made");
    assert_eq!(check.headers.get("authorization").unwrap(), "Bearer new_tok");
}

#[tokio::test]
async fn a_bad_code_says_so_in_plain_words_and_stores_nothing() {
    let r = rig(false).await;
    Mock::given(method("POST")).and(path("/api/tracker/enroll")).respond_with(ResponseTemplate::new(400).set_body_json(json!({ "error": "expired" }))).mount(&r.server).await;
    let err = r.controller.enroll("ABCD2345", "PC").await.unwrap_err();
    assert!(err.to_lowercase().contains("expired"), "{err}");
    assert!(r.store.load().is_none());
    assert!(!r.shared.lock().unwrap().signed_in);
}

#[tokio::test]
async fn what_was_captured_today_is_app_names_and_minutes_only() {
    let mut r = rig(true).await;
    r.run(0, 180, 5).await;
    r.app(Some("excel"));
    r.run(185, 300, 5).await;
    says(&r.server, "out", true).await;
    r.run(305, 340, 5).await;
    let today = captured_today(&r.queue, T0 + 340_000);
    assert_eq!(today.iter().map(|c| c.app.as_str()).collect::<Vec<_>>(), vec!["chrome", "excel"]);
    assert_eq!(today[0].minutes, 3);
    let json = serde_json::to_value(&today[0]).unwrap();
    let mut keys: Vec<&str> = json.as_object().unwrap().keys().map(|k| k.as_str()).collect();
    keys.sort();
    assert_eq!(keys, vec!["app", "minutes", "startMs"]);
}

// --- The clock controls ---------------------------------------------------------------------------------------------------------

fn clock_in() -> ClockAction {
    ClockAction::ClockIn { client_id: None, project_id: None }
}

async fn last_clock_body(r: &Rig) -> Value {
    let req = r.server.received_requests().await.unwrap().into_iter().rev().find(|q| q.url.path() == "/api/tracker/clock").expect("a clock request");
    serde_json::from_slice(&req.body).unwrap()
}

#[tokio::test]
async fn clicking_clock_in_sends_exactly_one_request_with_only_the_action_and_the_chosen_client() {
    let r = rig(true).await;
    r.controller.clock(clock_in()).await.expect("clocked in");
    assert_eq!(r.calls("/api/tracker/clock").await, 1);
    assert_eq!(last_clock_body(&r).await, json!({ "action": "clock_in" }));
    assert!(r.poll_now.load(Ordering::SeqCst), "the state is refreshed at once");

    r.controller.clock(ClockAction::ClockIn { client_id: Some("c1".into()), project_id: Some("p1".into()) }).await.unwrap();
    assert_eq!(last_clock_body(&r).await, json!({ "action": "clock_in", "clientId": "c1", "projectId": "p1" }));
}

#[tokio::test]
async fn a_double_click_still_sends_one_request() {
    let r = rig(true).await;
    r.server.reset().await;
    Mock::given(method("POST")).and(path("/api/tracker/clock")).respond_with(ResponseTemplate::new(200).set_delay(std::time::Duration::from_millis(300)).set_body_json(json!({ "state": "working", "at": "x", "outsideAllowedRange": false }))).mount(&r.server).await;
    let (a, b) = tokio::join!(r.controller.clock(clock_in()), r.controller.clock(clock_in()));
    assert_eq!([a.is_ok(), b.is_ok()].iter().filter(|x| **x).count(), 1, "one went through, one was refused");
    let refused = a.err().or(b.err()).unwrap();
    assert!(refused.contains("still being sent"), "{refused}");
    assert_eq!(r.calls("/api/tracker/clock").await, 1);
    // And once the first is done, a new click works again.
    r.controller.clock(clock_in()).await.unwrap();
    assert_eq!(r.calls("/api/tracker/clock").await, 2);
}

#[tokio::test]
async fn a_refusal_shows_elevates_own_sentence_and_changes_nothing() {
    let r = rig(true).await;
    r.shared.lock().unwrap().work_state = Some(WorkState::Out);
    r.server.reset().await;
    Mock::given(method("POST")).and(path("/api/tracker/clock")).respond_with(ResponseTemplate::new(409).set_body_json(json!({ "error": "refused", "message": "You are already clocked in." }))).mount(&r.server).await;
    let err = r.controller.clock(clock_in()).await.unwrap_err();
    assert_eq!(err, "You are already clocked in.");
    assert_eq!(r.shared.lock().unwrap().work_state, Some(WorkState::Out));
}

#[tokio::test]
async fn an_offline_click_sends_nothing_and_says_so() {
    let r = rig(true).await;
    r.shared.lock().unwrap().online = false;
    let err = r.controller.clock(clock_in()).await.unwrap_err();
    assert_eq!(err, "You are offline. Try again when you are connected.");
    assert_eq!(r.calls("/api/tracker/clock").await, 0);
}

#[tokio::test]
async fn the_clock_buttons_are_off_with_the_reason_when_elevate_says_so() {
    for reason in ["jibble", "selfie"] {
        let r = rig(true).await;
        r.shared.lock().unwrap().clock_blocked_reason = Some(reason.to_string());
        let err = r.controller.clock(clock_in()).await.unwrap_err();
        assert_eq!(err, blocked_message(reason));
        assert_eq!(r.calls("/api/tracker/clock").await, 0, "{reason}");
    }
}

#[tokio::test]
async fn disconnecting_removes_the_sign_in_and_everything_waiting() {
    let mut r = rig(true).await;
    r.run(0, 60, 5).await;
    r.controller.disconnect().unwrap();
    assert!(r.store.load().is_none());
    assert!(!r.shared.lock().unwrap().signed_in);
    assert_eq!(r.queue.len().unwrap(), (0, 0));
    assert!(r.queue.history_since(0).unwrap().is_empty());
}

#[tokio::test]
async fn over_a_whole_simulated_day_no_clock_request_is_ever_sent_unless_a_person_clicked() {
    let mut r = rig(true).await;
    let hour = 3600;
    // Start, work, a break, back to work, the lock screen, idle, sleep, a failing network, an update notice, signing out and in again.
    r.run(0, hour, 5).await;
    says(&r.server, "break", true).await;
    r.run(hour + 5, hour + 1800, 5).await;
    says(&r.server, "working", true).await;
    r.app(None);
    r.run(2 * hour, 2 * hour + 900, 5).await;
    r.app(Some("chrome"));
    r.fake.idle.store(900, Ordering::SeqCst);
    r.run(3 * hour, 3 * hour + 900, 5).await;
    r.run(6 * hour, 6 * hour + 300, 5).await; // slept for hours
    says_status(&r.server, 503, json!({})).await;
    r.run(7 * hour, 7 * hour + 900, 5).await; // offline
    says_status(&r.server, 426, json!({ "error": "update_required", "minVersion": "9.9.9" })).await;
    r.run(8 * hour, 8 * hour + 300, 5).await;
    says_status(&r.server, 401, json!({})).await;
    r.run(9 * hour, 9 * hour + 60, 5).await;
    Mock::given(method("POST")).and(path("/api/tracker/enroll")).respond_with(ResponseTemplate::new(200).set_body_json(json!({ "token": "again", "deviceId": "d" }))).mount(&r.server).await;
    r.controller.enroll("ABCD2345", "PC").await.unwrap();
    says(&r.server, "working", true).await;
    r.run(10 * hour, 10 * hour + 300, 5).await;
    assert!(r.changes.load(Ordering::SeqCst) > 0, "the window was told about changes");
    assert_eq!(r.calls("/api/tracker/clock").await, 0, "nothing the app does by itself ever clocks anyone");
}

/// Every route answers 503: ELEVATE is down.
async fn down(server: &MockServer) {
    server.reset().await;
    for (verb, route) in [("GET", "/api/tracker/clock-state"), ("POST", "/api/tracker/segments"), ("POST", "/api/tracker/shots/request"), ("POST", "/api/tracker/shots/finalize"), ("POST", "/api/tracker/clock")] {
        Mock::given(method(verb)).and(path(route)).respond_with(ResponseTemplate::new(503).set_body_json(json!({}))).mount(server).await;
    }
}

#[tokio::test]
async fn when_elevate_comes_back_what_is_waiting_is_sent_at_once_not_after_the_long_retry_pause() {
    let mut r = rig(true).await;
    r.run(0, 60, 5).await;
    r.app(Some("excel"));
    r.run(65, 120, 5).await;
    down(&r.server).await;
    // A long outage: the retry pauses have grown by now. Work keeps being recorded and queued.
    for minute in 0..13 {
        r.app(Some(if minute % 2 == 0 { "chrome" } else { "excel" }));
        r.run(125 + minute * 60, 125 + minute * 60 + 55, 5).await;
    }
    r.run(905, 905, 5).await;
    assert!(!r.shared.lock().unwrap().online);
    let queued = r.queue.len().unwrap().0;
    assert!(queued > 0, "the work was kept while offline");

    says(&r.server, "working", true).await; // ELEVATE is back
    r.run(905, 1000, 5).await; // within about a minute and a half
    assert!(r.shared.lock().unwrap().online, "the app noticed within a minute");
    assert_eq!(r.queue.len().unwrap().0, 0, "everything waiting went out as soon as ELEVATE was seen again");
    assert!(r.calls("/api/tracker/segments").await > 0);
}
