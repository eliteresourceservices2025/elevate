//! The HTTP client. Every ELEVATE call carries the device token (except enroll), `X-Tracker-Version` and the user agent; redirects
//! are never followed; a call that fails to connect is `Unavailable` and says nothing about the address (the storage links hold a token).

use std::time::Duration;

use reqwest::multipart::{Form, Part};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use super::error::map_error;
use super::{ApiError, ClockAction, ClockReply, ClockState, Enrolled, Health, IngestReply, ReleaseNotes, ShotTicket, UpdateOffer};
use crate::core::segments::{Segment, State};
use crate::core::timefmt::iso_from_ms;

const TIMEOUT: Duration = Duration::from_secs(30);
/// The server accepts at most 200 segments in one batch.
const MAX_BATCH: usize = 200;
const NAME_MAX: usize = 60;

pub struct ApiClient {
    base: String,
    version: String,
    http: reqwest::Client,
    /// For the storage host: no ELEVATE headers and no token, ever.
    storage: reqwest::Client,
}

/// HTTPS only. Plain HTTP is allowed only to this computer, and only in a debug build (local testing).
fn address_allowed(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    if cfg!(debug_assertions) {
        for prefix in ["http://localhost", "http://127.0.0.1", "http://[::1]"] {
            if let Some(rest) = url.strip_prefix(prefix) {
                if matches!(rest.chars().next(), None | Some(':') | Some('/')) {
                    return true;
                }
            }
        }
    }
    false
}

fn state_text(s: State) -> &'static str {
    match s {
        State::Active => "active",
        State::Idle => "idle",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnrollAnswer {
    token: String,
    device_id: String,
}

impl ApiClient {
    pub fn new(base_url: &str, app_version: &str) -> Result<Self, ApiError> {
        let base = base_url.trim_end_matches('/').to_string();
        if !address_allowed(&base) {
            return Err(ApiError::Invalid);
        }
        let agent = format!("ELEVATE-Tracker/{app_version}");
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-tracker-version", app_version.parse().map_err(|_| ApiError::Invalid)?);
        let http = reqwest::Client::builder().timeout(TIMEOUT).redirect(reqwest::redirect::Policy::none()).user_agent(agent.clone()).default_headers(headers).build().map_err(|_| ApiError::Invalid)?;
        let storage = reqwest::Client::builder().timeout(TIMEOUT).redirect(reqwest::redirect::Policy::none()).user_agent(agent).build().map_err(|_| ApiError::Invalid)?;
        Ok(ApiClient { base, version: app_version.to_string(), http, storage })
    }

    fn url(&self, route: &str) -> String {
        format!("{}/api/tracker/{route}", self.base)
    }

    async fn call<T: DeserializeOwned>(&self, request: reqwest::RequestBuilder) -> Result<T, ApiError> {
        let response = request.send().await.map_err(|_| ApiError::Unavailable)?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|_| ApiError::Unavailable)?;
        if (200..300).contains(&status) {
            serde_json::from_slice(&bytes).map_err(|_| ApiError::Invalid)
        } else {
            let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            Err(map_error(status, &body))
        }
    }

    pub async fn enroll(&self, code: &str, name: &str) -> Result<Enrolled, ApiError> {
        let name: String = name.trim().chars().take(NAME_MAX).collect();
        let body = json!({ "code": code, "name": name, "os": "windows", "appVersion": self.version });
        let answer: EnrollAnswer = self.call(self.http.post(self.url("enroll")).json(&body)).await?;
        Ok(Enrolled { token: answer.token, device_id: answer.device_id })
    }

    pub async fn clock_state(&self, token: &str) -> Result<ClockState, ApiError> {
        self.call(self.http.get(self.url("clock-state")).bearer_auth(token)).await
    }

    pub async fn clock(&self, token: &str, action: &ClockAction) -> Result<ClockReply, ApiError> {
        self.call(self.http.post(self.url("clock")).bearer_auth(token).json(&action.body())).await
    }

    pub async fn post_segments(&self, token: &str, batch: &[Segment], health: Health) -> Result<IngestReply, ApiError> {
        if batch.is_empty() || batch.len() > MAX_BATCH {
            return Err(ApiError::Invalid);
        }
        let segments: Vec<Value> = batch.iter().map(|s| json!({ "start": iso_from_ms(s.start_ms), "end": iso_from_ms(s.end_ms), "app": s.app, "state": state_text(s.state) })).collect();
        let body = json!({ "segments": segments, "appVersion": self.version, "permissionsOk": health.permissions_ok, "queueSize": health.queue_size });
        self.call(self.http.post(self.url("segments")).bearer_auth(token).json(&body)).await
    }

    pub async fn request_shot(&self, token: &str, taken_at_ms: i64) -> Result<ShotTicket, ApiError> {
        let body = json!({ "takenAt": iso_from_ms(taken_at_ms) });
        self.call(self.http.post(self.url("shots/request")).bearer_auth(token).json(&body)).await
    }

    /// PUTs the blurred picture to the one-time storage link ELEVATE returned. Nothing of ours is sent along, least of all the token.
    pub async fn upload_shot(&self, upload_url: &str, jpeg: &[u8]) -> Result<(), ApiError> {
        if !address_allowed(upload_url) {
            return Err(ApiError::Invalid);
        }
        // Storage only treats the part as a file when it has a file name (found against the real local storage: without one it says "No content provided").
        let part = Part::bytes(jpeg.to_vec()).file_name("blob").mime_str("image/jpeg").map_err(|_| ApiError::Invalid)?;
        let form = Form::new().text("cacheControl", "3600").part("", part);
        let response = self.storage.put(upload_url).multipart(form).send().await.map_err(|_| ApiError::Unavailable)?;
        match response.status().as_u16() {
            200..=299 => Ok(()),
            429 | 500..=599 => Err(ApiError::Unavailable),
            // Whatever storage says, it is not about this device's sign-in with ELEVATE.
            _ => Err(ApiError::Rejected("upload_refused".into())),
        }
    }

    pub async fn finalize_shot(&self, token: &str, shot_id: &str) -> Result<(), ApiError> {
        let _: Value = self.call(self.http.post(self.url("shots/finalize")).bearer_auth(token).json(&json!({ "shotId": shot_id }))).await?;
        Ok(())
    }
}

/// Plain names only (letters, digits, dot, dash, underscore): nothing that could change the path or the query it is placed in.
fn plain(text: &str) -> bool {
    !text.is_empty() && text.len() <= 64 && text.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

/// Updates are never bigger than this.
const MAX_UPDATE_BYTES: u64 = 200 * 1024 * 1024;

impl ApiClient {
    /// The newest update for `platform` that is newer than `version`, or `None` (a 204). The answer is only an offer: nothing is trusted yet.
    pub async fn update_feed(&self, token: &str, platform: &str, version: &str) -> Result<Option<UpdateOffer>, ApiError> {
        if !plain(platform) || !plain(version) {
            return Err(ApiError::Invalid);
        }
        let url = format!("{}?platform={platform}&version={version}", self.url("update"));
        let response = self.http.get(url).bearer_auth(token).send().await.map_err(|_| ApiError::Unavailable)?;
        let status = response.status().as_u16();
        let bytes = response.bytes().await.map_err(|_| ApiError::Unavailable)?;
        match status {
            204 => Ok(None),
            200..=299 => serde_json::from_slice(&bytes).map(Some).map_err(|_| ApiError::Invalid),
            _ => Err(map_error(status, &serde_json::from_slice(&bytes).unwrap_or(Value::Null))),
        }
    }

    /// Downloads an update file. The address must be ELEVATE's own download route; ELEVATE answers with a redirect to a short-lived storage
    /// link, and that second request carries nothing of ours (no token, no version).
    pub async fn fetch_update_file(&self, token: &str, url: &str) -> Result<Vec<u8>, ApiError> {
        let prefix = format!("{}/api/tracker/update/download/", self.base);
        let rest = url.strip_prefix(&prefix).ok_or(ApiError::Invalid)?;
        if rest.is_empty() || !rest.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'/' | b'?' | b'=' | b'&')) || rest.contains("..") {
            return Err(ApiError::Invalid);
        }
        let first = self.http.get(url).bearer_auth(token).send().await.map_err(|_| ApiError::Unavailable)?;
        let status = first.status().as_u16();
        if !matches!(status, 301 | 302 | 303 | 307 | 308) {
            let bytes = first.bytes().await.map_err(|_| ApiError::Unavailable)?;
            return Err(if (200..300).contains(&status) { ApiError::Invalid } else { map_error(status, &serde_json::from_slice(&bytes).unwrap_or(Value::Null)) });
        }
        let location = first.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).map(str::to_string).ok_or(ApiError::Invalid)?;
        if !address_allowed(&location) {
            return Err(ApiError::Invalid);
        }
        let second = self.storage.get(&location).send().await.map_err(|_| ApiError::Unavailable)?;
        match second.status().as_u16() {
            200..=299 => {
                if second.content_length().is_some_and(|n| n > MAX_UPDATE_BYTES) {
                    return Err(ApiError::Invalid);
                }
                let bytes = second.bytes().await.map_err(|_| ApiError::Unavailable)?;
                if bytes.len() as u64 > MAX_UPDATE_BYTES {
                    return Err(ApiError::Invalid);
                }
                Ok(bytes.to_vec())
            }
            429 | 500..=599 => Err(ApiError::Unavailable),
            _ => Err(ApiError::Rejected("download_failed".into())),
        }
    }

    pub async fn release_notes(&self, token: &str, version: &str) -> Result<ReleaseNotes, ApiError> {
        if !plain(version) {
            return Err(ApiError::Invalid);
        }
        self.call(self.http.get(self.url(&format!("releases/{version}"))).bearer_auth(token)).await
    }
}
