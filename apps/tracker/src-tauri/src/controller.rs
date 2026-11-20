//! What the person does in the window or the tray: sign in with a code, press a clock button, disconnect. The only thing here that
//! sends a clock request is `clock`, and it runs only when a person clicked. Nothing else in the app can clock anyone.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::api::{ApiError, ClockAction, ClockReply};
use crate::log::{ClockKind, Event};
use crate::state::Deps;

pub struct Controller {
    d: Deps,
    /// A clock request is on its way: another click is refused until it is answered.
    in_flight: AtomicBool,
}

/// Puts `in_flight` back to false however the request ends.
struct Release<'a>(&'a AtomicBool);

impl Drop for Release<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Controller {
    pub fn new(d: Deps) -> Controller {
        Controller { d, in_flight: AtomicBool::new(false) }
    }

    fn changed(&self) {
        (self.d.on_change)();
    }

    /// Trades the typed code for this computer's sign-in and stores it.
    pub async fn enroll(&self, code: &str, computer_name: &str) -> Result<(), String> {
        let code = code.trim();
        if code.is_empty() {
            return Err("Type the code from ELEVATE.".into());
        }
        match self.d.api.enroll(code, computer_name).await {
            Ok(enrolled) => {
                if self.d.store.save(&enrolled.token).is_err() {
                    self.d.logger.log_event(Event::EnrollFailed);
                    return Err("The sign-in could not be saved on this computer.".into());
                }
                {
                    let mut s = self.d.shared.lock().map_err(|_| "Try again.".to_string())?;
                    s.signed_in = true;
                    s.online = true;
                    s.update_required = None;
                }
                self.d.poll_now.store(true, Ordering::SeqCst);
                self.d.logger.log_event(Event::Enrolled);
                self.changed();
                Ok(())
            }
            Err(e) => {
                self.d.logger.log_event(Event::EnrollFailed);
                Err(match e {
                    ApiError::Rejected(reason) => match reason.as_str() {
                        "expired" => "That code has expired. Ask for a new one in ELEVATE.",
                        "used" => "That code was already used. Ask for a new one in ELEVATE.",
                        "policy" => "Recording is not switched on yet. Ask HR.",
                        _ => "That code did not work.",
                    },
                    ApiError::Invalid => "That code is not right. Check it and try again.",
                    ApiError::TooManyRequests => "Too many tries. Wait a minute and try again.",
                    ApiError::Unavailable => "Could not reach ELEVATE. Check your internet connection and try again.",
                    _ => "That code did not work.",
                }
                .into())
            }
        }
    }

    /// One click, one request: a second click while one is on its way is refused, an offline click sends nothing, and a refusal from
    /// ELEVATE comes back as its own sentence.
    pub async fn clock(&self, action: ClockAction) -> Result<ClockReply, String> {
        let kind = match &action {
            ClockAction::ClockIn { .. } => ClockKind::ClockIn,
            ClockAction::SwitchClient { .. } => ClockKind::SwitchClient,
            ClockAction::StartBreak { .. } => ClockKind::StartBreak,
            ClockAction::EndBreak => ClockKind::EndBreak,
            ClockAction::ClockOut => ClockKind::ClockOut,
        };
        let (signed_in, online, blocked) = {
            let s = self.d.shared.lock().map_err(|_| "Try again.".to_string())?;
            (s.signed_in, s.online, s.clock_blocked_reason.clone())
        };
        if !signed_in {
            return Err("Sign in first.".into());
        }
        if let Some(reason) = blocked {
            self.d.logger.log_event(Event::ClockBlocked);
            return Err(blocked_message(&reason).into());
        }
        if !online {
            self.d.logger.log_event(Event::ClockOffline);
            return Err("You are offline. Try again when you are connected.".into());
        }
        if self.in_flight.swap(true, Ordering::SeqCst) {
            return Err("One moment: the last click is still being sent.".into());
        }
        let _release = Release(&self.in_flight);
        let Some(token) = self.d.store.load() else {
            return Err("Sign in first.".into());
        };

        match self.d.api.clock(&token, &action).await {
            Ok(reply) => {
                self.d.logger.log_event(Event::Clock(kind));
                self.d.poll_now.store(true, Ordering::SeqCst);
                self.changed();
                Ok(reply)
            }
            Err(ApiError::Refused { message }) => {
                self.d.logger.log_event(Event::ClockRefused);
                Err(message)
            }
            Err(ApiError::Unauthorized) => {
                self.sign_out();
                Err("This computer is signed out. Sign in again with a new code.".into())
            }
            Err(ApiError::TooManyRequests) => Err("Too many clicks. Wait a minute and try again.".into()),
            Err(ApiError::Unavailable) => Err("Could not reach ELEVATE. Try again in a moment.".into()),
            Err(ApiError::Rejected(_)) | Err(ApiError::Invalid) | Err(ApiError::PolicyOff) | Err(ApiError::UpdateRequired { .. }) => Err("ELEVATE did not accept that. Use the ELEVATE page.".into()),
        }
    }

    fn sign_out(&self) {
        let _ = self.d.store.clear();
        if let Ok(mut s) = self.d.shared.lock() {
            s.signed_in = false;
        }
        self.d.logger.log_event(Event::SignedOut);
        self.changed();
    }

    /// Removes the sign-in and everything waiting on this computer.
    pub fn disconnect(&self) -> Result<(), String> {
        self.d.store.clear()?;
        self.d.queue.clear().map_err(|e| e.to_string())?;
        {
            let mut s = self.d.shared.lock().map_err(|_| "Try again.".to_string())?;
            let version_gate = s.update_required.clone();
            *s = crate::state::Status { update_required: version_gate, ..crate::state::Status::default() };
        }
        self.d.logger.log_event(Event::Disconnected);
        self.changed();
        Ok(())
    }
}

/// The plain sentence for why the clock buttons are off.
pub fn blocked_message(reason: &str) -> &'static str {
    match reason {
        "jibble" => "You clock in Jibble. ELEVATE reads your hours from there, so the clock here is off.",
        "selfie" => "Your team needs a selfie to clock in. Clock in on the ELEVATE page.",
        _ => "The clock is off for you right now. Use the ELEVATE page.",
    }
}
