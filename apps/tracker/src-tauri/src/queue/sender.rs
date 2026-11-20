//! Sends what is waiting. One call does one round: a batch of segments, then at most one screenshot. A crash between "sent" and
//! "removed" is harmless: the server drops exact duplicates, so the next round simply sends the batch again.

use std::collections::HashMap;

use crate::api::{ApiClient, ApiError, Health};
use crate::core::segments::Segment;
use crate::queue::{Queue, MAX_BATCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    /// This many things (segments and screenshots) were delivered, or deliberately dropped.
    Sent(usize),
    /// Nothing is waiting.
    Idle,
    /// ELEVATE cannot be reached or asked to slow down: leave everything in place and wait before the next try.
    Backoff,
    /// ELEVATE does not know this computer any more. Nothing is cleared here; the engine decides.
    SignedOut,
    /// This version is too old; sending stops until the app is updated.
    UpdateRequired(String),
    /// No monitoring policy is published: sending stops.
    PolicyOff,
}

/// A batch (or a picture) that fails this many times is dropped, so one bad item cannot block everything behind it.
pub const INVALID_TRIES: u8 = 3;

pub struct Sender {
    /// Failed tries of the batch that starts with a given row.
    tries: HashMap<i64, u8>,
}

impl Sender {
    pub fn new() -> Self {
        Sender { tries: HashMap::new() }
    }

    pub async fn run_once(&mut self, api: &ApiClient, token: &str, queue: &Queue, health: Health) -> SendOutcome {
        let mut delivered = 0usize;
        let mut attempted = false;

        match queue.next_batch(MAX_BATCH) {
            Err(_) => return SendOutcome::Backoff,
            Ok(batch) if batch.is_empty() => {}
            Ok(batch) => {
                attempted = true;
                let ids: Vec<i64> = batch.iter().map(|(id, _)| *id).collect();
                let segments: Vec<Segment> = batch.into_iter().map(|(_, s)| s).collect();
                match api.post_segments(token, &segments, health).await {
                    Ok(_) => {
                        let _ = queue.ack(&ids);
                        self.tries.remove(&ids[0]);
                        delivered += ids.len();
                    }
                    Err(e) => match stop_or_wait(&e) {
                        Some(outcome) => return outcome,
                        None => {
                            let n = self.tries.entry(ids[0]).or_insert(0);
                            *n += 1;
                            if *n >= INVALID_TRIES {
                                let _ = queue.ack(&ids);
                                self.tries.remove(&ids[0]);
                                return SendOutcome::Sent(delivered);
                            }
                            return SendOutcome::Backoff;
                        }
                    },
                }
            }
        }

        let shot = match queue.next_shot() {
            Err(_) => return SendOutcome::Backoff,
            Ok(shot) => shot,
        };
        if let Some(shot) = shot {
            attempted = true;
            let Ok(bytes) = std::fs::read(&shot.path) else {
                // The file is gone: there is nothing to send.
                let _ = queue.ack_shot(shot.id);
                return SendOutcome::Sent(delivered);
            };
            // A failed try is counted; the third one drops the picture.
            let failed = |queue: &Queue| -> SendOutcome {
                match queue.shot_failed(shot.id) {
                    Ok(n) if n >= u32::from(INVALID_TRIES) => {
                        let _ = queue.ack_shot(shot.id);
                        SendOutcome::Sent(delivered)
                    }
                    _ => SendOutcome::Backoff,
                }
            };

            let ticket = match api.request_shot(token, shot.taken_at_ms).await {
                Ok(t) => t,
                // window_used, not_working, too_old: this picture can never be accepted.
                Err(ApiError::Rejected(_)) => {
                    let _ = queue.ack_shot(shot.id);
                    return SendOutcome::Sent(delivered);
                }
                Err(e) => return stop_or_wait(&e).unwrap_or_else(|| failed(queue)),
            };
            let Some(url) = ticket.upload_url else { return failed(queue) };
            if let Err(e) = api.upload_shot(&url, &bytes).await {
                return stop_or_wait(&e).filter(|o| *o != SendOutcome::Backoff).unwrap_or_else(|| failed(queue));
            }
            match api.finalize_shot(token, &ticket.shot_id).await {
                Ok(()) => {
                    let _ = queue.ack_shot(shot.id);
                    delivered += 1;
                }
                Err(ApiError::Rejected(_)) => {
                    let _ = queue.ack_shot(shot.id);
                }
                Err(e) => return stop_or_wait(&e).unwrap_or_else(|| failed(queue)),
            }
        }

        if attempted {
            SendOutcome::Sent(delivered)
        } else {
            SendOutcome::Idle
        }
    }
}

/// Answers that stop or pause everything (`Some`), as opposed to a problem with this one item (`None`).
fn stop_or_wait(e: &ApiError) -> Option<SendOutcome> {
    match e {
        ApiError::Unauthorized => Some(SendOutcome::SignedOut),
        ApiError::PolicyOff => Some(SendOutcome::PolicyOff),
        ApiError::UpdateRequired { min_version } => Some(SendOutcome::UpdateRequired(min_version.clone())),
        ApiError::Unavailable | ApiError::TooManyRequests => Some(SendOutcome::Backoff),
        ApiError::Invalid | ApiError::Rejected(_) | ApiError::Refused { .. } => None,
    }
}

impl Default for Sender {
    fn default() -> Self {
        Self::new()
    }
}
