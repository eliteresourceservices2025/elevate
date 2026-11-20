//! The sender against a mock ELEVATE and a mock storage host.
mod common;

use common::{jpeg, seg};
use elevate_tracker_lib::api::{ApiClient, Health};
use elevate_tracker_lib::queue::sender::{SendOutcome, Sender, INVALID_TRIES};
use elevate_tracker_lib::queue::Queue;
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const NOW: i64 = 1_700_000_000_000;
const TOKEN: &str = "tok";
const HEALTH: Health = Health { permissions_ok: true, queue_size: 0 };

struct Rig {
    server: MockServer,
    api: ApiClient,
    queue: Queue,
    dir: tempfile::TempDir,
    sender: Sender,
}

async fn rig() -> Rig {
    let server = MockServer::start().await;
    let api = ApiClient::new(&server.uri(), "1.0.0").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let queue = Queue::open(dir.path()).unwrap();
    Rig { server, api, queue, dir, sender: Sender::new() }
}

async fn answer(server: &MockServer, verb: &str, route: &str, status: u16, body: Value) {
    Mock::given(method(verb)).and(path(route)).respond_with(ResponseTemplate::new(status).set_body_json(body)).mount(server).await;
}

fn ok_ingest() -> Value {
    json!({ "ok": true, "accepted": 2, "clipped": 0, "duplicate": 0, "rejected": {} })
}

async fn calls(server: &MockServer, route: &str) -> usize {
    server.received_requests().await.unwrap().iter().filter(|r| r.url.path() == route).count()
}

fn two_segments() -> Vec<elevate_tracker_lib::core::segments::Segment> {
    vec![seg(NOW, 60_000, "chrome"), seg(NOW + 60_000, 60_000, "excel")]
}

#[tokio::test]
async fn a_batch_is_sent_and_then_removed_and_the_next_round_is_idle() {
    let mut r = rig().await;
    answer(&r.server, "POST", "/api/tracker/segments", 200, ok_ingest()).await;
    r.queue.push_segments(&two_segments()).unwrap();
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(2));
    assert_eq!(r.queue.len().unwrap().0, 0);
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Idle);
    assert_eq!(calls(&r.server, "/api/tracker/segments").await, 1, "nothing is sent when nothing is waiting");
}

#[tokio::test]
async fn a_crash_between_sent_and_removed_resends_harmlessly() {
    let mut r = rig().await;
    answer(&r.server, "POST", "/api/tracker/segments", 200, ok_ingest()).await;
    r.queue.push_segments(&two_segments()).unwrap();
    // The first delivery succeeded but the app died before removing the rows.
    let batch = r.queue.next_batch(200).unwrap();
    r.api.post_segments(TOKEN, &batch.iter().map(|(_, s)| s.clone()).collect::<Vec<_>>(), HEALTH).await.unwrap();
    // After the restart the same rows are sent again, and now they are removed.
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(2));
    assert_eq!(r.queue.len().unwrap().0, 0);
    assert_eq!(calls(&r.server, "/api/tracker/segments").await, 2);
}

#[tokio::test]
async fn each_answer_maps_to_the_right_outcome_and_the_rows_stay() {
    let cases: Vec<(u16, Value, SendOutcome)> = vec![
        (401, json!({ "error": "unauthorized" }), SendOutcome::SignedOut),
        (403, json!({ "error": "policy" }), SendOutcome::PolicyOff),
        (426, json!({ "error": "update_required", "minVersion": "2.0.0" }), SendOutcome::UpdateRequired("2.0.0".into())),
        (429, json!({ "error": "too_many_requests" }), SendOutcome::Backoff),
        (503, json!({}), SendOutcome::Backoff),
    ];
    for (status, body, expected) in cases {
        let mut r = rig().await;
        answer(&r.server, "POST", "/api/tracker/segments", status, body).await;
        r.queue.push_segments(&two_segments()).unwrap();
        assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, expected, "status {status}");
        assert_eq!(r.queue.len().unwrap().0, 2, "rows stay after {status}");
    }
}

#[tokio::test]
async fn no_network_is_a_backoff() {
    let mut r = rig().await;
    let api = ApiClient::new("http://127.0.0.1:1", "1.0.0").unwrap();
    r.queue.push_segments(&two_segments()).unwrap();
    assert_eq!(r.sender.run_once(&api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Backoff);
    assert_eq!(r.queue.len().unwrap().0, 2);
}

#[tokio::test]
async fn an_invalid_batch_is_dropped_on_the_third_try_so_it_cannot_block_the_rest() {
    let mut r = rig().await;
    answer(&r.server, "POST", "/api/tracker/segments", 400, json!({ "error": "invalid" })).await;
    r.queue.push_segments(&two_segments()).unwrap();
    for _ in 1..INVALID_TRIES {
        assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Backoff);
        assert_eq!(r.queue.len().unwrap().0, 2);
    }
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(0));
    assert_eq!(r.queue.len().unwrap().0, 0);
}

fn shot_dir_files(dir: &std::path::Path) -> usize {
    std::fs::read_dir(dir.join("shots")).map(|d| d.count()).unwrap_or(0)
}

async fn mount_storage(r: &Rig, upload_status: u16) -> MockServer {
    let storage = MockServer::start().await;
    Mock::given(method("PUT")).and(path("/storage/upload")).respond_with(ResponseTemplate::new(upload_status)).mount(&storage).await;
    answer(&r.server, "POST", "/api/tracker/shots/request", 200, json!({ "shotId": "s1", "uploadUrl": format!("{}/storage/upload?token=abc", storage.uri()) })).await;
    storage
}

#[tokio::test]
async fn a_shot_goes_request_upload_finalize_and_its_file_is_deleted() {
    let mut r = rig().await;
    let storage = mount_storage(&r, 200).await;
    answer(&r.server, "POST", "/api/tracker/shots/finalize", 200, json!({ "ok": true })).await;
    r.queue.push_shot(jpeg(), NOW).unwrap();
    assert_eq!(shot_dir_files(r.dir.path()), 1);
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(1));
    assert_eq!(r.queue.len().unwrap().1, 0);
    assert_eq!(shot_dir_files(r.dir.path()), 0);
    assert_eq!(storage.received_requests().await.unwrap().len(), 1);
    assert_eq!(calls(&r.server, "/api/tracker/shots/finalize").await, 1);
}

#[tokio::test]
async fn a_discard_answer_removes_the_shot_and_its_file_without_uploading() {
    for reason in ["window_used", "not_working", "too_old"] {
        let mut r = rig().await;
        answer(&r.server, "POST", "/api/tracker/shots/request", 409, json!({ "error": reason })).await;
        r.queue.push_shot(jpeg(), NOW).unwrap();
        assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(0), "{reason}");
        assert_eq!(r.queue.len().unwrap().1, 0);
        assert_eq!(shot_dir_files(r.dir.path()), 0, "{reason}: the file is deleted");
    }
}

#[tokio::test]
async fn a_failing_upload_backs_off_and_the_picture_is_dropped_after_three_tries() {
    let mut r = rig().await;
    let _storage = mount_storage(&r, 500).await;
    r.queue.push_shot(jpeg(), NOW).unwrap();
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Backoff);
    assert_eq!(r.queue.len().unwrap().1, 1);
    assert_eq!(r.queue.next_shot().unwrap().unwrap().attempts, 1);
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Backoff);
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(0));
    assert_eq!(r.queue.len().unwrap().1, 0);
    assert_eq!(shot_dir_files(r.dir.path()), 0);
}

#[tokio::test]
async fn a_finalize_refusal_discards_the_shot() {
    let mut r = rig().await;
    let _storage = mount_storage(&r, 200).await;
    answer(&r.server, "POST", "/api/tracker/shots/finalize", 409, json!({ "error": "not_working" })).await;
    r.queue.push_shot(jpeg(), NOW).unwrap();
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Sent(0));
    assert_eq!(r.queue.len().unwrap().1, 0);
    assert_eq!(shot_dir_files(r.dir.path()), 0);
}

#[tokio::test]
async fn a_signed_out_answer_on_a_shot_stops_and_keeps_the_picture() {
    let mut r = rig().await;
    answer(&r.server, "POST", "/api/tracker/shots/request", 401, json!({})).await;
    r.queue.push_shot(jpeg(), NOW).unwrap();
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::SignedOut);
    assert_eq!(r.queue.len().unwrap().1, 1);
}

#[tokio::test]
async fn nothing_waiting_sends_nothing() {
    let mut r = rig().await;
    assert_eq!(r.sender.run_once(&r.api, TOKEN, &r.queue, HEALTH).await, SendOutcome::Idle);
    assert!(r.server.received_requests().await.unwrap().is_empty());
}
