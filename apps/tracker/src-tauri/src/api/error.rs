//! What can go wrong when the app talks to ELEVATE, in the app's own words. Nothing here holds a token or any screen content.
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// 401: this computer's sign-in was removed or never valid.
    Unauthorized,
    /// 403 `policy`: no monitoring policy is published, so nothing is recorded or sent.
    PolicyOff,
    /// 426: this version of the app is too old.
    UpdateRequired { min_version: String },
    /// 429.
    TooManyRequests,
    /// 5xx, or no network, or a timeout: try again later.
    Unavailable,
    /// 400 or a redirect: the request itself was not accepted as written.
    Invalid,
    /// A reason the server gave in words of its own (`expired`, `not_working`, `window_used`, ...).
    Rejected(String),
    /// A clock action ELEVATE refused, with its own plain sentence (already clocked in, on leave, Jibble clock, ...).
    Refused { message: String },
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiError::Unauthorized => write!(f, "this computer is no longer signed in"),
            ApiError::PolicyOff => write!(f, "recording is off until the monitoring policy is published"),
            ApiError::UpdateRequired { min_version } => write!(f, "update required (version {min_version} or newer)"),
            ApiError::TooManyRequests => write!(f, "too many requests"),
            ApiError::Unavailable => write!(f, "ELEVATE cannot be reached"),
            ApiError::Invalid => write!(f, "the request was not accepted"),
            ApiError::Rejected(reason) => write!(f, "rejected: {reason}"),
            ApiError::Refused { message } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ApiError {}

/// Maps an answer to an error. `body` is the JSON of the answer (or `Null`).
pub fn map_error(status: u16, body: &Value) -> ApiError {
    let reason = body.get("error").and_then(Value::as_str);
    match status {
        401 => ApiError::Unauthorized,
        403 if reason == Some("policy") => ApiError::PolicyOff,
        403 => ApiError::Rejected(reason.unwrap_or("forbidden").to_string()),
        426 => ApiError::UpdateRequired { min_version: body.get("minVersion").and_then(Value::as_str).unwrap_or("").to_string() },
        429 => ApiError::TooManyRequests,
        500..=599 => ApiError::Unavailable,
        409 if reason == Some("refused") => ApiError::Refused { message: body.get("message").and_then(Value::as_str).unwrap_or("ELEVATE did not accept that.").to_string() },
        409 => ApiError::Rejected(reason.unwrap_or("conflict").to_string()),
        400 => match reason {
            None | Some("invalid") => ApiError::Invalid,
            Some(why) => ApiError::Rejected(why.to_string()),
        },
        // Any other answer, including a redirect (never followed), is a request we did not expect to make.
        _ => ApiError::Invalid,
    }
}
