//! The device token lives only in Windows Credential Manager (service `ELEVATE Tracker App`, user `device`).
//! It is never written to a file, a log or the queue, and never appears in a `Debug` print.

const SERVICE: &str = "ELEVATE Tracker App";
const USER: &str = "device";

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, USER).map_err(|e| e.to_string())
}

pub fn save_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

/// `None` when nothing is stored (or the store cannot be read).
pub fn load_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

/// Removing what is not there is fine.
pub fn clear_token() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
