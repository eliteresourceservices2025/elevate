//! Updates: when to install, when to show "What's new", signature checking, and the network steps against a mock ELEVATE and a second
//! mock host standing in for storage.
use base64::Engine as _;
use elevate_tracker_lib::api::{ApiClient, ApiError, UpdateOffer, WorkState};
use elevate_tracker_lib::updates::{check, download_verified, read_last_seen, should_install_now, verify_signature, whats_new_due, write_last_seen, UpdateError, PLATFORM};
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "tok";
const CURRENT: &str = "1.0.0";

fn b64(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s)
}

/// A throwaway key pair and a signature over `data`, in the formats the build produces: (public key, signature).
fn sign_with_new_key(data: &[u8]) -> (String, String) {
    let kp = minisign::KeyPair::generate_unencrypted_keypair().unwrap();
    let sig = minisign::sign(Some(&kp.pk), &kp.sk, std::io::Cursor::new(data), Some("trusted"), Some("untrusted")).unwrap();
    (b64(&kp.pk.to_box().unwrap().to_string()), b64(&sig.to_string()))
}

#[test]
fn a_required_update_installs_at_once_an_optional_one_waits_for_the_shift_to_end() {
    use WorkState::*;
    // (state, required, ready) -> install now?
    assert!(should_install_now(Some(Working), true, true), "required while working installs");
    assert!(!should_install_now(Some(Working), false, true), "optional while working waits");
    assert!(should_install_now(Some(Out), false, true), "optional while clocked out installs");
    assert!(should_install_now(Some(Break), false, true), "optional on a break installs (nothing is being recorded)");
    assert!(should_install_now(None, false, true), "not signed in: nothing to interrupt");
    assert!(!should_install_now(Some(Out), true, false), "nothing downloaded yet: nothing to install");
    assert!(!should_install_now(Some(Working), true, false));
}

#[test]
fn whats_new_shows_only_after_a_real_update() {
    assert!(!whats_new_due(None, "1.0.0"), "a first install has nothing new to show");
    assert!(whats_new_due(Some("1.0.0"), "1.1.0"));
    assert!(!whats_new_due(Some("1.1.0"), "1.1.0"), "already seen");
    assert!(!whats_new_due(Some("1.2.0"), "1.1.0"), "never for going back");
    assert!(whats_new_due(Some("1.9.0"), "1.10.0"), "numbers, not text");
    assert!(!whats_new_due(Some("1.0.0"), "not-a-version"));
}

#[test]
fn the_last_seen_version_is_kept_beside_the_queue() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(read_last_seen(dir.path()), None);
    write_last_seen(dir.path(), "1.2.3").unwrap();
    assert_eq!(read_last_seen(dir.path()).as_deref(), Some("1.2.3"));
    write_last_seen(dir.path(), "1.3.0").unwrap();
    assert_eq!(read_last_seen(dir.path()).as_deref(), Some("1.3.0"));
}

#[test]
fn only_a_file_signed_by_our_key_passes() {
    let data = b"the installer bytes";
    let (key, sig) = sign_with_new_key(data);
    assert_eq!(verify_signature(data, &sig, &key), Ok(()));
    assert_eq!(verify_signature(b"the installer bytes, changed", &sig, &key), Err(UpdateError::BadSignature), "a changed file is refused");
    let (other_key, _) = sign_with_new_key(b"x");
    assert_eq!(verify_signature(data, &sig, &other_key), Err(UpdateError::BadSignature), "a signature from another key is refused");
    assert_eq!(verify_signature(data, "not a signature", &key), Err(UpdateError::BadSignature));
    assert_eq!(verify_signature(data, &sig, "not a key"), Err(UpdateError::BadSignature));
    assert_eq!(verify_signature(data, "", &key), Err(UpdateError::BadSignature));
}

#[test]
fn the_key_inside_the_app_is_a_real_public_key() {
    // The committed key must decode; a typo here would make every update fail.
    let decoded = base64::engine::general_purpose::STANDARD.decode(elevate_tracker_lib::updates::PUBLIC_KEY.trim()).expect("base64");
    let text = String::from_utf8(decoded).expect("text");
    assert!(minisign_verify::PublicKey::decode(&text).is_ok());
}

fn offer(version: &str, url: &str, signature: &str) -> UpdateOffer {
    UpdateOffer { version: version.into(), notes: "Added:\n- A thing".into(), pub_date: Some("2026-11-20T00:00:00.000Z".into()), url: url.into(), signature: signature.into() }
}

fn feed_body(version: &str, url: &str) -> Value {
    json!({ "version": version, "notes": "Added:\n- A thing", "pub_date": "2026-11-20T00:00:00.000Z", "url": url, "signature": "sig" })
}

#[tokio::test]
async fn the_feed_request_carries_the_token_and_version_and_says_which_platform_and_version() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/update")).respond_with(ResponseTemplate::new(204)).mount(&server).await;
    let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
    assert_eq!(check(&api, TOKEN, PLATFORM, CURRENT).await.unwrap(), None);
    let req = &server.received_requests().await.unwrap()[0];
    assert_eq!(req.headers.get("authorization").unwrap(), "Bearer tok");
    assert_eq!(req.headers.get("x-tracker-version").unwrap(), CURRENT);
    assert_eq!(req.url.query(), Some("platform=windows-x86_64&version=1.0.0"));
}

#[tokio::test]
async fn a_newer_offer_is_returned_and_an_older_or_equal_one_is_ignored() {
    for (offered, expected_some) in [("1.1.0", true), ("1.10.0", true), ("1.0.0", false), ("0.9.0", false), ("garbage", false)] {
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/api/tracker/update")).respond_with(ResponseTemplate::new(200).set_body_json(feed_body(offered, &format!("{}/api/tracker/update/download/windows-x86_64?version={offered}", server.uri())))).mount(&server).await;
        let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
        assert_eq!(check(&api, TOKEN, PLATFORM, CURRENT).await.unwrap().is_some(), expected_some, "offered {offered}");
    }
}

#[tokio::test]
async fn an_unreadable_feed_answer_is_invalid_not_a_crash() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/update")).respond_with(ResponseTemplate::new(200).set_body_string("<html>")).mount(&server).await;
    let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
    assert_eq!(check(&api, TOKEN, PLATFORM, CURRENT).await, Err(ApiError::Invalid));
}

/// ELEVATE answers the download route with a redirect to a storage host (a second server here), and the file is at the second host.
async fn two_hosts(file: &[u8]) -> (MockServer, MockServer, String) {
    let storage = MockServer::start().await;
    Mock::given(method("GET")).and(path("/files/update.exe")).respond_with(ResponseTemplate::new(200).set_body_bytes(file.to_vec())).mount(&storage).await;
    let elevate = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/update/download/windows-x86_64")).respond_with(ResponseTemplate::new(302).insert_header("location", format!("{}/files/update.exe?token=abc", storage.uri()))).mount(&elevate).await;
    let url = format!("{}/api/tracker/update/download/windows-x86_64?version=1.1.0", elevate.uri());
    (elevate, storage, url)
}

#[tokio::test]
async fn the_token_goes_to_elevate_and_never_to_the_storage_host() {
    let file = b"signed installer bytes".to_vec();
    let (key, sig) = sign_with_new_key(&file);
    let (elevate, storage, url) = two_hosts(&file).await;
    let api = ApiClient::new(&elevate.uri(), CURRENT).unwrap();

    let got = download_verified(&api, TOKEN, &offer("1.1.0", &url, &sig), &key).await.unwrap();
    assert_eq!(got, file);

    let at_elevate = &elevate.received_requests().await.unwrap()[0];
    assert_eq!(at_elevate.headers.get("authorization").unwrap(), "Bearer tok");
    let at_storage = &storage.received_requests().await.unwrap()[0];
    assert!(!at_storage.headers.contains_key("authorization"), "the storage host must never see the device token");
    assert!(!at_storage.headers.contains_key("x-tracker-version"));
}

#[tokio::test]
async fn a_file_that_is_not_signed_by_our_key_is_refused() {
    let file = b"someone else's installer".to_vec();
    let (_other_key, sig) = sign_with_new_key(&file); // signed, but not by the key this app trusts
    let (our_key, _) = sign_with_new_key(b"x");
    let (elevate, _storage, url) = two_hosts(&file).await;
    let api = ApiClient::new(&elevate.uri(), CURRENT).unwrap();
    assert_eq!(download_verified(&api, TOKEN, &offer("1.1.0", &url, &sig), &our_key).await, Err(UpdateError::BadSignature));
}

#[tokio::test]
async fn a_tampered_file_is_refused() {
    let original = b"the real installer".to_vec();
    let (key, sig) = sign_with_new_key(&original);
    let (elevate, _storage, url) = two_hosts(b"the real installer, with something added").await;
    let api = ApiClient::new(&elevate.uri(), CURRENT).unwrap();
    assert_eq!(download_verified(&api, TOKEN, &offer("1.1.0", &url, &sig), &key).await, Err(UpdateError::BadSignature));
}

#[tokio::test]
async fn an_offer_pointing_anywhere_but_elevates_download_route_is_refused_before_any_request() {
    let server = MockServer::start().await;
    let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
    let (key, sig) = sign_with_new_key(b"x");
    for bad in ["https://evil.example.com/update.exe", "http://127.0.0.1:1/api/tracker/update/download/windows-x86_64", &format!("{}/api/tracker/other", server.uri()), &format!("{}.evil.com/api/tracker/update/download/x", server.uri())] {
        let got = download_verified(&api, TOKEN, &offer("1.1.0", bad, &sig), &key).await;
        assert_eq!(got, Err(UpdateError::Api(ApiError::Invalid)), "{bad}");
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_download_that_is_not_a_redirect_or_fails_is_unavailable_or_invalid() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/update/download/windows-x86_64")).respond_with(ResponseTemplate::new(503).set_body_json(json!({ "error": "storage_unavailable" }))).mount(&server).await;
    let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
    let (key, sig) = sign_with_new_key(b"x");
    let url = format!("{}/api/tracker/update/download/windows-x86_64?version=1.1.0", server.uri());
    assert_eq!(download_verified(&api, TOKEN, &offer("1.1.0", &url, &sig), &key).await, Err(UpdateError::Api(ApiError::Unavailable)));
}

#[tokio::test]
async fn release_notes_come_as_three_lists_and_a_bad_version_is_not_requested() {
    let server = MockServer::start().await;
    Mock::given(method("GET")).and(path("/api/tracker/releases/1.1.0")).respond_with(ResponseTemplate::new(200).set_body_json(json!({
        "version": "1.1.0", "publishedAt": "2026-11-20T00:00:00.000Z", "minRequired": false,
        "notes": { "added": ["A new thing"], "improved": ["It is faster"], "fixed": [] }
    }))).mount(&server).await;
    let api = ApiClient::new(&server.uri(), CURRENT).unwrap();
    let n = api.release_notes(TOKEN, "1.1.0").await.unwrap();
    assert_eq!(n.notes.added, vec!["A new thing"]);
    assert_eq!(n.notes.improved, vec!["It is faster"]);
    assert!(n.notes.fixed.is_empty());
    let before = server.received_requests().await.unwrap().len();
    for bad in ["../secret", "1.1.0/../../x", "1.1.0?x=1", "", "1.1.0 "] {
        assert_eq!(api.release_notes(TOKEN, bad).await.err(), Some(ApiError::Invalid), "{bad:?}");
    }
    assert_eq!(server.received_requests().await.unwrap().len(), before, "a bad version is never sent");
    Mock::given(method("GET")).and(path("/api/tracker/releases/9.9.9")).respond_with(ResponseTemplate::new(404).set_body_json(json!({ "error": "not_found" }))).mount(&server).await;
    assert_eq!(api.release_notes(TOKEN, "9.9.9").await.err(), Some(ApiError::Invalid));
}
