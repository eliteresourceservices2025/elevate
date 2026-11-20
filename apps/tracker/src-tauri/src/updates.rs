//! Updates, done so that every decision can be tested without a window: ask ELEVATE for an update (never trust the answer), download
//! it through ELEVATE's own route, check its signature against the key inside this app, and only then run it. An update that is not
//! signed by our key is never run, however it arrived.

use std::cmp::Ordering;
use std::path::Path;

use base64::Engine as _;

use crate::api::{ApiClient, ApiError, UpdateOffer, WorkState};
use crate::core::version::compare_versions;

/// What ELEVATE's update feed calls this build.
pub const PLATFORM: &str = "windows-x86_64";

/// The public half of the update signing key, committed as text. The matching private key is only ever in the build's secrets.
pub const PUBLIC_KEY: &str = include_str!("../updater.pub");

const LAST_SEEN_FILE: &str = "last_seen_version";

#[derive(Debug, PartialEq, Eq)]
pub enum UpdateError {
    Api(ApiError),
    /// The file is not signed by our key (or was changed on the way). Nothing is run.
    BadSignature,
}

impl std::fmt::Display for UpdateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UpdateError::Api(e) => write!(f, "{e}"),
            UpdateError::BadSignature => write!(f, "the update is not signed by ELEVATE's key"),
        }
    }
}

impl std::error::Error for UpdateError {}

/// Install the downloaded update now? A required update goes in at once; an optional one waits for the person to stop working, so a
/// shift is never interrupted.
pub fn should_install_now(state: Option<WorkState>, required: bool, ready: bool) -> bool {
    ready && (required || state != Some(WorkState::Working))
}

/// Show "What's new"? Not on a first install (nothing was updated), only when the version moved up since the last one the person saw.
pub fn whats_new_due(last_seen: Option<&str>, current: &str) -> bool {
    last_seen.is_some_and(|last| compare_versions(current, last) == Ordering::Greater)
}

pub fn read_last_seen(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(LAST_SEEN_FILE)).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

pub fn write_last_seen(dir: &Path, version: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join(LAST_SEEN_FILE), version)
}

fn decode_text(b64: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    String::from_utf8(bytes).ok()
}

/// Checks `bytes` against a Tauri-format signature (the base64 of a minisign signature file) and public key (the base64 of a minisign
/// public key file), the same formats `tauri signer generate` and the build produce.
pub fn verify_signature(bytes: &[u8], signature: &str, public_key: &str) -> Result<(), UpdateError> {
    let key = decode_text(public_key).and_then(|t| minisign_verify::PublicKey::decode(&t).ok()).ok_or(UpdateError::BadSignature)?;
    let sig = decode_text(signature).and_then(|t| minisign_verify::Signature::decode(&t).ok()).ok_or(UpdateError::BadSignature)?;
    key.verify(bytes, &sig, true).map_err(|_| UpdateError::BadSignature)
}

/// Asks ELEVATE for an update. An offer that is not newer than this version is ignored.
pub async fn check(api: &ApiClient, token: &str, platform: &str, current: &str) -> Result<Option<UpdateOffer>, ApiError> {
    Ok(api.update_feed(token, platform, current).await?.filter(|offer| compare_versions(&offer.version, current) == Ordering::Greater))
}

/// Downloads the offer and checks its signature. Returns the file only when it is signed by `public_key`.
pub async fn download_verified(api: &ApiClient, token: &str, offer: &UpdateOffer, public_key: &str) -> Result<Vec<u8>, UpdateError> {
    let bytes = api.fetch_update_file(token, &offer.url).await.map_err(UpdateError::Api)?;
    verify_signature(&bytes, &offer.signature, public_key)?;
    Ok(bytes)
}

/// Runs a verified installer the way Tauri's own updater does (per-user, passive, as an update, start again in the tray afterwards).
/// Only ever called with bytes that passed `verify_signature`. The caller exits the app right after.
#[cfg(windows)]
pub fn launch_installer(bytes: &[u8]) -> Result<(), String> {
    let dir = std::env::temp_dir().join("ELEVATE-Tracker-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("ELEVATE-Tracker-Setup.exe");
    std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
    std::process::Command::new(&file).args(["/P", "/UPDATE", "/R", "/ARGS", "--minimized"]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn launch_installer(_bytes: &[u8]) -> Result<(), String> {
    Err("updates are not supported on this system yet".into())
}
