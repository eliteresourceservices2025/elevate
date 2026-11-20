//! The ELEVATE client against a local mock server: every status maps to the right error, the three headers are on every call,
//! the bodies hold only what the server expects, the screenshot upload never carries our token, and secrets never reach `Debug`.

use elevate_tracker_lib::api::{ApiClient, ApiError, ClockAction, Health, WorkState};
use elevate_tracker_lib::core::segments::{Segment, State};
use serde_json::{json, Value};
use wiremock::matchers::{header, header_exists, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const VERSION: &str = "1.2.3";
const TOKEN: &str = "tok_secret_value_123";

async fn client(server: &MockServer) -> ApiClient {
    ApiClient::new(&server.uri(), VERSION).expect("a local test address is allowed")
}

async fn answer(server: &MockServer, verb: &str, route: &str, status: u16, body: Value) {
    Mock::given(method(verb)).and(path(route)).respond_with(ResponseTemplate::new(status).set_body_json(body)).mount(server).await;
}

fn state_body() -> Value {
    json!({
        "state": "working", "since": "2026-11-20T16:00:00.000Z", "workingSince": "2026-11-20T16:00:00.000Z",
        "onBreak": null,
        "current": { "clientId": "c1", "clientName": "Acme", "projectId": "p1", "projectName": "Intake", "since": "2026-11-20T16:00:00.000Z" },
        "clients": [{ "id": "c1", "name": "Acme", "projects": [{ "id": "p1", "name": "Intake" }] }, { "id": "c2", "name": "Beta", "projects": [] }],
        "clockBlockedReason": null, "policy": true,
        "settings": { "idleTimeoutSeconds": 180, "shotIntervalMinutes": 10 }
    })
}

#[tokio::test]
async fn every_status_maps_to_the_right_error() {
    let cases: Vec<(u16, Value, ApiError)> = vec![
        (401, json!({ "error": "unauthorized" }), ApiError::Unauthorized),
        (403, json!({ "error": "policy" }), ApiError::PolicyOff),
        (403, json!({ "error": "no_person" }), ApiError::Rejected("no_person".into())),
        (426, json!({ "error": "update_required", "minVersion": "2.0.0" }), ApiError::UpdateRequired { min_version: "2.0.0".into() }),
        (429, json!({ "error": "too_many_requests" }), ApiError::TooManyRequests),
        (500, json!({}), ApiError::Unavailable),
        (503, json!({ "error": "storage_unavailable" }), ApiError::Unavailable),
        (400, json!({ "error": "invalid" }), ApiError::Invalid),
        (409, json!({ "error": "not_working" }), ApiError::Rejected("not_working".into())),
        (404, json!({}), ApiError::Invalid),
    ];
    for (status, body, expected) in cases {
        let server = MockServer::start().await;
        answer(&server, "GET", "/api/tracker/clock-state", status, body).await;
        let got = client(&server).await.clock_state(TOKEN).await.err();
        assert_eq!(got, Some(expected), "status {status}");
    }
}

#[tokio::test]
async fn no_network_is_unavailable_not_a_crash() {
    let c = ApiClient::new("http://127.0.0.1:1", VERSION).unwrap();
    assert_eq!(c.clock_state(TOKEN).await.err(), Some(ApiError::Unavailable));
}

#[tokio::test]
async fn a_redirect_is_not_followed_so_the_token_cannot_be_sent_elsewhere() {
    let elsewhere = MockServer::start().await;
    answer(&elsewhere, "GET", "/api/tracker/clock-state", 200, state_body()).await;
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/clock-state")).respond_with(ResponseTemplate::new(302).insert_header("location", format!("{}/api/tracker/clock-state", elsewhere.uri()))).mount(&server).await;
    let got = client(&server).await.clock_state(TOKEN).await;
    assert_eq!(got.err(), Some(ApiError::Invalid));
    assert!(elsewhere.received_requests().await.unwrap().is_empty(), "the redirect target must never be called");
}

#[tokio::test]
async fn every_call_carries_the_token_version_and_user_agent_but_enroll_has_no_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/clock-state")).and(header("authorization", format!("Bearer {TOKEN}").as_str())).and(header("x-tracker-version", VERSION)).and(header("user-agent", "ELEVATE-Tracker/1.2.3")).respond_with(ResponseTemplate::new(200).set_body_json(state_body())).expect(1).mount(&server).await;
    answer(&server, "POST", "/api/tracker/enroll", 200, json!({ "token": "new_token", "deviceId": "d1" })).await;
    let c = client(&server).await;
    c.clock_state(TOKEN).await.expect("headers matched");
    c.enroll("ABCD2345", "LORIE-PC").await.expect("enrolled");
    let enroll = server.received_requests().await.unwrap().into_iter().find(|r| r.url.path() == "/api/tracker/enroll").unwrap();
    assert!(!enroll.headers.contains_key("authorization"), "enroll must not send a token");
    assert_eq!(enroll.headers.get("x-tracker-version").unwrap(), VERSION);
}

#[tokio::test]
async fn enroll_sends_the_code_name_os_and_version_and_never_prints_the_token() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/enroll", 200, json!({ "token": "super_secret_token", "deviceId": "dev-9" })).await;
    let got = client(&server).await.enroll("ABCD2345", "LORIE-PC").await.unwrap();
    assert_eq!(got.token, "super_secret_token");
    assert_eq!(got.device_id, "dev-9");
    assert!(!format!("{got:?}").contains("super_secret_token"), "Debug must hide the token");
    let body: Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    assert_eq!(body, json!({ "code": "ABCD2345", "name": "LORIE-PC", "os": "windows", "appVersion": VERSION }));
}

#[tokio::test]
async fn a_bad_code_is_rejected_with_the_servers_reason() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/enroll", 400, json!({ "error": "expired" })).await;
    assert_eq!(client(&server).await.enroll("ABCD2345", "PC").await.err(), Some(ApiError::Rejected("expired".into())));
}

#[tokio::test]
async fn clock_state_reads_clients_with_projects_and_the_current_work() {
    let server = MockServer::start().await;
    answer(&server, "GET", "/api/tracker/clock-state", 200, state_body()).await;
    let s = client(&server).await.clock_state(TOKEN).await.unwrap();
    assert_eq!(s.state, WorkState::Working);
    assert!(s.policy);
    assert_eq!(s.settings.idle_timeout_seconds, 180);
    assert_eq!(s.clients.len(), 2);
    assert_eq!(s.clients[0].projects[0].name, "Intake");
    assert_eq!(s.current.as_ref().and_then(|c| c.project_name.as_deref()), Some("Intake"));
    assert!(s.clock_blocked_reason.is_none());
}

#[tokio::test]
async fn a_segments_batch_holds_only_start_end_app_and_state() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/segments", 200, json!({ "ok": true, "accepted": 2, "clipped": 0, "duplicate": 0, "rejected": {} })).await;
    let batch = vec![
        Segment { start_ms: 1_700_000_000_000, end_ms: 1_700_000_060_000, app: "chrome".into(), state: State::Active },
        Segment { start_ms: 1_700_000_060_000, end_ms: 1_700_000_120_000, app: "Locked".into(), state: State::Idle },
    ];
    let reply = client(&server).await.post_segments(TOKEN, &batch, Health { permissions_ok: true, queue_size: 7 }).await.unwrap();
    assert_eq!(reply.accepted, 2);
    let body: Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    assert_eq!(
        body,
        json!({
            "segments": [
                { "start": "2023-11-14T22:13:20.000Z", "end": "2023-11-14T22:14:20.000Z", "app": "chrome", "state": "active" },
                { "start": "2023-11-14T22:14:20.000Z", "end": "2023-11-14T22:15:20.000Z", "app": "Locked", "state": "idle" }
            ],
            "appVersion": VERSION, "permissionsOk": true, "queueSize": 7
        })
    );
}

#[tokio::test]
async fn an_empty_or_oversized_batch_is_not_sent() {
    let server = MockServer::start().await;
    let c = client(&server).await;
    let h = Health { permissions_ok: true, queue_size: 0 };
    assert_eq!(c.post_segments(TOKEN, &[], h).await.err(), Some(ApiError::Invalid));
    let big: Vec<Segment> = (0..201).map(|i| Segment { start_ms: i * 1000, end_ms: i * 1000 + 500, app: "a".into(), state: State::Active }).collect();
    assert_eq!(c.post_segments(TOKEN, &big, h).await.err(), Some(ApiError::Invalid));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn clock_requests_name_the_action_client_and_project_and_never_a_time() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/clock", 200, json!({ "state": "working", "at": "2026-11-20T16:00:00.000Z", "outsideAllowedRange": false })).await;
    let c = client(&server).await;
    let actions = [
        (ClockAction::ClockIn { client_id: Some("c1".into()), project_id: Some("p1".into()) }, json!({ "action": "clock_in", "clientId": "c1", "projectId": "p1" })),
        (ClockAction::ClockIn { client_id: None, project_id: None }, json!({ "action": "clock_in" })),
        (ClockAction::SwitchClient { client_id: Some("c1".into()), project_id: None }, json!({ "action": "switch_client", "clientId": "c1" })),
        (ClockAction::StartBreak { minutes: Some(30) }, json!({ "action": "break_start", "breakMinutes": 30 })),
        (ClockAction::StartBreak { minutes: None }, json!({ "action": "break_start" })),
        (ClockAction::EndBreak, json!({ "action": "break_end" })),
        (ClockAction::ClockOut, json!({ "action": "clock_out" })),
    ];
    for (action, expected) in &actions {
        c.clock(TOKEN, action).await.unwrap();
        let last = server.received_requests().await.unwrap().pop().unwrap();
        assert_eq!(&serde_json::from_slice::<Value>(&last.body).unwrap(), expected);
    }
}

#[tokio::test]
async fn a_refusal_carries_elevates_own_sentence() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/clock", 409, json!({ "error": "refused", "message": "You are already clocked in." })).await;
    let got = client(&server).await.clock(TOKEN, &ClockAction::ClockIn { client_id: None, project_id: None }).await;
    assert_eq!(got.err(), Some(ApiError::Refused { message: "You are already clocked in.".into() }));
    answer(&server, "POST", "/api/tracker/clock", 403, json!({ "error": "no_person" })).await;
}

#[tokio::test]
async fn the_screenshot_goes_request_upload_finalize_and_the_upload_never_carries_our_token() {
    let storage = MockServer::start().await;
    Mock::given(method("PUT")).and(path("/storage/upload")).respond_with(ResponseTemplate::new(200)).mount(&storage).await;
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/shots/request", 200, json!({ "shotId": "shot-1", "uploadUrl": format!("{}/storage/upload?token=abc", storage.uri()) })).await;
    answer(&server, "POST", "/api/tracker/shots/finalize", 200, json!({ "ok": true })).await;
    let c = client(&server).await;

    let ticket = c.request_shot(TOKEN, 1_700_000_000_000).await.unwrap();
    assert_eq!(ticket.shot_id, "shot-1");
    let requested: Value = serde_json::from_slice(&server.received_requests().await.unwrap()[0].body).unwrap();
    assert_eq!(requested, json!({ "takenAt": "2023-11-14T22:13:20.000Z" }));

    c.upload_shot(ticket.upload_url.as_deref().unwrap(), &[0xFF, 0xD8, 0xFF, 1, 2, 3]).await.unwrap();
    let put = storage.received_requests().await.unwrap().pop().unwrap();
    assert!(put.headers.get("content-type").unwrap().to_str().unwrap().starts_with("multipart/form-data"));
    assert!(String::from_utf8_lossy(&put.body).contains("name=\"cacheControl\""));
    // Real storage answers "No content provided" to a picture part that has no file name, so it must have one.
    assert!(String::from_utf8_lossy(&put.body).contains("filename=\""), "the picture part needs a file name");
    assert!(!put.headers.contains_key("authorization"), "the storage host must never see the device token");
    assert!(!put.headers.contains_key("x-tracker-version"));

    c.finalize_shot(TOKEN, &ticket.shot_id).await.unwrap();
}

#[tokio::test]
async fn a_storage_refusal_is_not_mistaken_for_a_signed_out_device() {
    let storage = MockServer::start().await;
    Mock::given(method("PUT")).and(path("/storage/upload")).respond_with(ResponseTemplate::new(401)).mount(&storage).await;
    let c = ApiClient::new(&storage.uri(), VERSION).unwrap();
    let got = c.upload_shot(&format!("{}/storage/upload", storage.uri()), &[0xFF, 0xD8, 0xFF]).await;
    assert_ne!(got.clone().err(), Some(ApiError::Unauthorized), "a 401 from storage must not clear the device sign-in");
    assert_eq!(got.err(), Some(ApiError::Rejected("upload_refused".into())));
}

#[tokio::test]
async fn a_shot_with_no_upload_address_or_a_plain_http_address_is_refused() {
    let server = MockServer::start().await;
    answer(&server, "POST", "/api/tracker/shots/request", 200, json!({ "shotId": "s", "uploadUrl": null })).await;
    let c = client(&server).await;
    assert!(c.request_shot(TOKEN, 1).await.unwrap().upload_url.is_none());
    assert_eq!(c.upload_shot("http://storage.example.com/x", &[0xFF]).await.err(), Some(ApiError::Invalid));
}

#[test]
fn only_https_is_allowed_apart_from_this_computer_in_a_debug_build() {
    assert!(ApiClient::new("https://elevate.example.com", VERSION).is_ok());
    assert!(ApiClient::new("https://elevate.example.com/", VERSION).is_ok());
    assert!(ApiClient::new("http://elevate.example.com", VERSION).is_err());
    assert!(ApiClient::new("ftp://elevate.example.com", VERSION).is_err());
    assert!(ApiClient::new("elevate.example.com", VERSION).is_err());
    assert!(ApiClient::new("http://localhost:3000", VERSION).is_ok());
}

#[test]
#[ignore = "needs the real Windows Credential Manager"]
fn the_token_is_saved_loaded_and_cleared() {
    use elevate_tracker_lib::api::token::{clear_token, load_token, save_token};
    clear_token().unwrap();
    assert_eq!(load_token(), None);
    save_token("test-token-value").unwrap();
    assert_eq!(load_token().as_deref(), Some("test-token-value"));
    clear_token().unwrap();
    assert_eq!(load_token(), None);
    clear_token().unwrap(); // clearing nothing is fine
}

#[allow(dead_code)]
fn _uses(_: &dyn Fn()) {
    let _ = header_exists("x");
}
