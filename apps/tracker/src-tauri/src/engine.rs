//! The engine: asks ELEVATE what the person is doing, and only while they are working records which program is in front and whether
//! they are active or idle, takes a blurred screenshot of every screen about every 10 minutes, and sends it. It never clocks anyone.
//!
//! `tick(now_ms)` does whatever is due at that moment, so the whole day can be simulated with a fake platform, a fake clock and a mock
//! server. The real loop calls it about once a second.

use std::sync::atomic::Ordering;

use crate::api::{ApiError, WorkState};
use crate::capture::blur::capture_blurred;
use crate::core::backoff::Backoff;
use crate::core::schedule::{window_index, ShotPlan};
use crate::core::segments::{Sample, Segment, SegmentBuilder};
use crate::log::Event;
use crate::queue::sender::{SendOutcome, Sender};
use crate::state::Deps;

/// How often the app asks ELEVATE for the person's state.
pub const POLL_MS: i64 = 30_000;
/// How often it looks at the front program.
pub const SAMPLE_MS: i64 = 5_000;
/// How often it sends what is waiting.
pub const SEND_MS: i64 = 60_000;
/// How often the queue's caps are enforced.
const CAPS_MS: i64 = 60_000;
/// The clock moving back by more than this between two ticks counts as the computer's clock being set back.
const BACKWARDS_JUMP_MS: i64 = 10_000;
/// A gap between two ticks (about a second apart) longer than this is sleep or a clock set forward.
const FORWARD_JUMP_MS: i64 = 3_600_000;
/// How long old data is kept after the clock moved.
const CAPS_HOLD_MS: i64 = 15 * 60_000;
/// The name used when nothing readable is in front: the lock screen. It is always idle.
const LOCKED: &str = "Locked";

pub struct Engine {
    d: Deps,
    sender: Sender,
    builder: SegmentBuilder,
    plan: ShotPlan,
    /// Waits between failed status checks: short, so coming back online is noticed within about a minute.
    poll_backoff: Backoff,
    /// Waits between failed sends: longer, so a down server is not hammered.
    send_backoff: Backoff,
    token: Option<String>,
    idle_timeout: u32,
    next_poll: i64,
    next_send: i64,
    next_caps: i64,
    last_sample: i64,
    /// The clock reading of the previous tick, to notice the computer's clock being moved.
    last_tick: i64,
    /// Until this time the queue's old data is not deleted (after the clock was moved).
    caps_hold_until: i64,
    was_recording: bool,
    last_state: Option<WorkState>,
}

fn seed() -> u64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1);
    nanos ^ (u64::from(std::process::id()) << 32)
}

impl Engine {
    pub fn new(d: Deps) -> Engine {
        let idle_timeout = d.shared.lock().map(|s| s.idle_timeout_secs).unwrap_or(180);
        Engine {
            sender: Sender::new(),
            builder: SegmentBuilder::new(idle_timeout),
            plan: ShotPlan::new(seed()),
            poll_backoff: Backoff::new(5_000, 60_000).with_jitter(seed()),
            send_backoff: Backoff::new(5_000, 300_000).with_jitter(seed()),
            token: None,
            idle_timeout,
            next_poll: i64::MIN,
            next_send: i64::MIN,
            next_caps: i64::MIN,
            last_sample: i64::MIN,
            last_tick: i64::MIN,
            caps_hold_until: i64::MIN,
            was_recording: false,
            last_state: None,
            d,
        }
    }

    fn changed(&self) {
        (self.d.on_change)();
    }

    fn refresh_counts(&self) {
        if let (Ok((segments, shots)), Ok(mut s)) = (self.d.queue.len(), self.d.shared.lock()) {
            s.queue_segments = segments;
            s.queue_shots = shots;
        }
    }

    /// Stores finished segments for sending and for the person's own "captured today" list.
    fn keep(&self, finished: &[Segment]) {
        if finished.is_empty() {
            return;
        }
        let _ = self.d.queue.push_segments(finished);
        let _ = self.d.queue.record_history(finished);
        self.refresh_counts();
    }

    fn flush(&mut self, now: i64) {
        let done = self.builder.flush(now);
        self.keep(&done);
    }

    fn sign_out(&mut self) {
        let _ = self.d.store.clear();
        self.token = None;
        self.builder = SegmentBuilder::new(self.idle_timeout);
        self.was_recording = false;
        if let Ok(mut s) = self.d.shared.lock() {
            s.signed_in = false;
            s.work_state = None;
        }
        self.d.logger.log_event(Event::SignedOut);
        self.changed();
    }

    /// Notices the computer's clock being moved. Set back: what is open is closed at the last good moment and everything is due again, so a
    /// wrong time cannot stall polling, sampling or sending for hours. A big jump either way holds back the deletion of old waiting data for
    /// a while, so setting the clock forward and correcting it a minute later cannot wipe what has not been sent yet.
    fn watch_clock(&mut self, now: i64) {
        let last = std::mem::replace(&mut self.last_tick, now);
        if last == i64::MIN {
            return;
        }
        if now < last.saturating_sub(BACKWARDS_JUMP_MS) {
            self.flush(last);
            self.next_poll = i64::MIN;
            self.next_send = i64::MIN;
            self.next_caps = i64::MIN;
            self.last_sample = i64::MIN;
            self.caps_hold_until = now.saturating_add(CAPS_HOLD_MS);
        } else if now.saturating_sub(last) > FORWARD_JUMP_MS {
            self.caps_hold_until = now.saturating_add(CAPS_HOLD_MS);
        }
    }

    pub async fn tick(&mut self, now: i64) {
        self.watch_clock(now);
        let signed_in = self.d.shared.lock().map(|s| s.signed_in).unwrap_or(false);
        if !signed_in {
            self.token = None;
            self.was_recording = false;
            // What was open belongs to the previous sign-in: drop it rather than finish it under the next one.
            self.builder = SegmentBuilder::new(self.idle_timeout);
            return;
        }
        let forced = self.d.poll_now.swap(false, Ordering::SeqCst);
        if forced || self.token.is_none() {
            self.token = self.d.store.load();
            if self.token.is_none() {
                if let Ok(mut s) = self.d.shared.lock() {
                    s.signed_in = false;
                }
                self.changed();
                return;
            }
        }

        if forced || now >= self.next_poll {
            self.poll(now).await;
            if !self.d.shared.lock().map(|s| s.signed_in).unwrap_or(false) {
                return;
            }
        }

        let recording = self.d.shared.lock().map(|s| s.work_state == Some(WorkState::Working) && s.policy && s.update_required.is_none()).unwrap_or(false);
        if recording {
            self.was_recording = true;
            if now.saturating_sub(self.last_sample) >= SAMPLE_MS {
                self.last_sample = now;
                self.sample(now);
            }
            self.screenshot(now).await;
        } else if self.was_recording {
            // The person stopped working (clocked out, a break, the policy went off, an update is needed): close what is open at once.
            self.was_recording = false;
            self.flush(now);
            self.next_send = now;
        }

        if now >= self.next_send {
            self.send(now).await;
        }
        if now >= self.next_caps && now >= self.caps_hold_until {
            self.next_caps = now + CAPS_MS;
            let _ = self.d.queue.enforce_caps(now);
            self.refresh_counts();
        }
    }

    async fn poll(&mut self, now: i64) {
        let Some(token) = self.token.clone() else { return };
        match self.d.api.clock_state(&token).await {
            Ok(cs) => {
                let came_back = {
                    let Ok(mut s) = self.d.shared.lock() else { return };
                    let came_back = !s.online;
                    s.online = true;
                    s.work_state = Some(cs.state);
                    s.policy = cs.policy;
                    s.update_required = cs.update_required.clone().filter(|v| !v.is_empty());
                    s.clients = cs.clients;
                    s.working_since = cs.working_since;
                    s.on_break = cs.on_break;
                    s.current = cs.current;
                    s.clock_blocked_reason = cs.clock_blocked_reason;
                    s.today = cs.today;
                    s.today_received_ms = Some(now);
                    s.idle_timeout_secs = cs.settings.idle_timeout_seconds;
                    came_back
                };
                if cs.settings.idle_timeout_seconds != self.idle_timeout {
                    self.flush(now);
                    self.idle_timeout = cs.settings.idle_timeout_seconds;
                    self.builder = SegmentBuilder::new(self.idle_timeout);
                }
                if came_back {
                    self.d.logger.log_event(Event::WentOnline);
                }
                if self.last_state != Some(cs.state) {
                    self.last_state = Some(cs.state);
                    self.d.logger.log_event(match cs.state {
                        WorkState::Working => Event::StateWorking,
                        WorkState::Break => Event::StateBreak,
                        WorkState::Out => Event::StateOut,
                    });
                }
                if !cs.policy {
                    self.d.logger.log_event(Event::PolicyOff);
                }
                if cs.update_required.as_deref().is_some_and(|v| !v.is_empty()) {
                    self.d.logger.log_event(Event::UpdateRequired);
                }
                self.next_poll = now + POLL_MS;
                self.poll_backoff.reset();
                if came_back {
                    // ELEVATE is reachable again: send what is waiting now, not after the long pause that grew while it was down.
                    self.send_backoff.reset();
                    self.next_send = now;
                }
                self.changed();
            }
            Err(ApiError::Unauthorized) => self.sign_out(),
            Err(ApiError::UpdateRequired { min_version }) => {
                if let Ok(mut s) = self.d.shared.lock() {
                    s.update_required = Some(min_version);
                }
                self.d.logger.log_event(Event::UpdateRequired);
                self.next_poll = now + 2 * POLL_MS;
                self.changed();
            }
            Err(ApiError::Unavailable) | Err(ApiError::TooManyRequests) => {
                let went_offline = self.d.shared.lock().map(|mut s| std::mem::replace(&mut s.online, false)).unwrap_or(false);
                if went_offline {
                    self.d.logger.log_event(Event::WentOffline);
                }
                self.next_poll = now + self.poll_backoff.next() as i64;
                self.changed();
            }
            Err(_) => self.next_poll = now + 2 * POLL_MS,
        }
    }

    /// Looks at the front program and the idle time, nothing else.
    fn sample(&mut self, now: i64) {
        let front = self.d.platform.foreground_app();
        let idle = self.d.platform.idle_seconds();
        let timeout = self.idle_timeout.max(1);
        let (app, idle_secs) = match front {
            Some(name) if name != LOCKED => (name, idle),
            // The lock screen (or nothing readable in front) is not an app the person is using: it counts as idle.
            _ => (LOCKED.to_string(), idle.max(timeout)),
        };
        let finished = self.builder.push(Sample { at_ms: now, app, idle_secs });
        self.keep(&finished);
    }

    async fn screenshot(&mut self, now: i64) {
        if self.plan.due(now, true).is_none() {
            return;
        }
        let window = window_index(now);
        let platform = self.d.platform.clone();
        match tokio::task::spawn_blocking(move || capture_blurred(platform.as_ref())).await {
            Ok(Ok(jpeg)) => {
                let bytes = jpeg.as_bytes().to_vec();
                if self.d.queue.push_shot(jpeg, now).is_ok() {
                    if let Ok(mut s) = self.d.shared.lock() {
                        s.last_shot = Some(bytes);
                    }
                    self.plan.done(window);
                    self.d.logger.log_event(Event::ShotCaptured);
                    self.refresh_counts();
                    self.changed();
                } else {
                    self.plan.failed(window);
                }
            }
            _ => {
                self.plan.failed(window);
                self.d.logger.log_event(Event::ShotCaptureFailed);
            }
        }
    }

    async fn send(&mut self, now: i64) {
        let (policy, update) = self.d.shared.lock().map(|s| (s.policy, s.update_required.is_some())).unwrap_or((false, false));
        let Some(token) = self.token.clone() else { return };
        if update || !policy {
            self.next_send = now + SEND_MS;
            return;
        }
        let queue_size = self.d.queue.len().map(|(segments, _)| segments as u32).unwrap_or(0);
        let health = crate::api::Health { permissions_ok: true, queue_size };
        match self.sender.run_once(&self.d.api, &token, &self.d.queue, health).await {
            SendOutcome::Sent(n) => {
                if let Ok(mut s) = self.d.shared.lock() {
                    s.last_sent_ms = Some(now);
                }
                self.d.logger.log_event(Event::Delivered(n as u32));
                let more = self.d.queue.len().map(|(a, b)| a + b > 0).unwrap_or(false);
                self.next_send = now + if more && n > 0 { 1_000 } else { SEND_MS };
                self.send_backoff.reset();
                self.changed();
            }
            SendOutcome::Idle => self.next_send = now + SEND_MS,
            SendOutcome::Backoff => {
                self.d.logger.log_event(Event::SendBackoff);
                self.next_send = now + self.send_backoff.next() as i64;
            }
            SendOutcome::SignedOut => self.sign_out(),
            SendOutcome::UpdateRequired(min) => {
                if let Ok(mut s) = self.d.shared.lock() {
                    s.update_required = Some(min);
                }
                self.d.logger.log_event(Event::UpdateRequired);
                self.next_send = now + SEND_MS;
                self.changed();
            }
            SendOutcome::PolicyOff => {
                if let Ok(mut s) = self.d.shared.lock() {
                    s.policy = false;
                }
                self.d.logger.log_event(Event::PolicyOff);
                self.next_send = now + SEND_MS;
                self.changed();
            }
        }
        self.refresh_counts();
    }
}
