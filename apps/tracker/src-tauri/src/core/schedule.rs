//! When to take a screenshot: one per 10-minute window, at a random moment in the window's middle 8 minutes.

use super::backoff::mix;

pub const WINDOW_MS: i64 = 600_000;
const EARLIEST_MS: i64 = 60_000;
const LATEST_MS: i64 = 540_000;
/// A retry is not allowed in the last 30 seconds of a window, and not sooner than 30 seconds after the failed try.
const RETRY_GAP_MS: i64 = 30_000;

pub fn window_index(at_ms: i64) -> i64 {
    at_ms.div_euclid(WINDOW_MS)
}

#[derive(Clone, Copy, PartialEq)]
enum Status {
    /// Nothing handed out yet for this window.
    Pending,
    /// A capture was handed out at this time and has not been reported yet.
    Issued(i64),
    /// The last try failed; a retry is allowed 30 seconds after it, until 30 seconds before the window ends.
    Retry(i64),
    Done,
}

pub struct ShotPlan {
    seed: u64,
    window: i64,
    status: Status,
}

impl ShotPlan {
    pub fn new(rng_seed: u64) -> Self {
        ShotPlan { seed: rng_seed, window: i64::MIN, status: Status::Pending }
    }

    fn moment(&self, window: i64) -> i64 {
        let span = (LATEST_MS - EARLIEST_MS + 1) as u64;
        window * WINDOW_MS + EARLIEST_MS + (mix(self.seed ^ (window as u64).wrapping_mul(0x2545_F491_4F6C_DD1D)) % span) as i64
    }

    /// `Some(moment)` when a screenshot should be taken now. Nothing when not working, or when this window was already handled.
    pub fn due(&mut self, now_ms: i64, working: bool) -> Option<i64> {
        let w = window_index(now_ms);
        if w != self.window {
            self.window = w;
            self.status = Status::Pending;
        }
        if !working {
            return None;
        }
        match self.status {
            Status::Pending => {
                let m = self.moment(w);
                if now_ms >= m {
                    self.status = Status::Issued(m);
                    Some(m)
                } else {
                    None
                }
            }
            Status::Retry(at) => {
                let window_end = (w + 1) * WINDOW_MS;
                if now_ms >= at + RETRY_GAP_MS && now_ms < window_end - RETRY_GAP_MS {
                    self.status = Status::Issued(now_ms);
                    Some(now_ms)
                } else {
                    None
                }
            }
            Status::Issued(_) | Status::Done => None,
        }
    }

    pub fn done(&mut self, window: i64) {
        if window == self.window {
            self.status = Status::Done;
        }
    }

    pub fn failed(&mut self, window: i64) {
        if window == self.window {
            if let Status::Issued(at) = self.status {
                self.status = Status::Retry(at);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W0: i64 = 1_000 * WINDOW_MS; // the start of some window

    fn first_moment(p: &mut ShotPlan, from: i64) -> i64 {
        let mut t = from;
        loop {
            if let Some(m) = p.due(t, true) {
                return m;
            }
            t += 1_000;
        }
    }

    #[test]
    fn window_index_is_the_ten_minute_slot() {
        assert_eq!(window_index(0), 0);
        assert_eq!(window_index(599_999), 0);
        assert_eq!(window_index(600_000), 1);
    }
    #[test]
    fn nothing_when_not_working() {
        let mut p = ShotPlan::new(1);
        assert_eq!(p.due(W0 + 9 * 60_000, false), None);
    }
    #[test]
    fn moment_is_inside_minutes_one_to_nine_and_only_issued_once() {
        for seed in 0..50u64 {
            let mut p = ShotPlan::new(seed);
            let mut issued = Vec::new();
            let mut t = W0;
            while t < W0 + WINDOW_MS {
                if let Some(m) = p.due(t, true) {
                    issued.push(m);
                }
                t += 5_000;
            }
            assert_eq!(issued.len(), 1, "seed {seed}");
            assert!(issued[0] >= W0 + EARLIEST_MS && issued[0] <= W0 + LATEST_MS, "seed {seed}: {}", issued[0] - W0);
        }
    }
    #[test]
    fn nothing_right_at_the_start_of_the_window() {
        let mut p = ShotPlan::new(3);
        assert_eq!(p.due(W0 + 10_000, true), None);
    }
    #[test]
    fn same_seed_same_moments_and_the_moments_vary() {
        let moment = |seed: u64, w: i64| first_moment(&mut ShotPlan::new(seed), w * WINDOW_MS) - w * WINDOW_MS;
        assert_eq!(moment(9, 5), moment(9, 5));
        let all: std::collections::HashSet<i64> = (0..20).map(|w| moment(9, w)).collect();
        assert!(all.len() > 5, "moments should differ between windows");
    }
    #[test]
    fn done_stops_further_shots_in_the_window() {
        let mut p = ShotPlan::new(4);
        let m = first_moment(&mut p, W0);
        p.done(window_index(m));
        assert_eq!(p.due(W0 + 595_000, true), None);
    }
    #[test]
    fn a_failed_try_is_retried_after_a_pause_but_not_in_the_last_30_seconds() {
        let mut p = ShotPlan::new(5);
        let m = first_moment(&mut p, W0);
        let w = window_index(m);
        p.failed(w);
        assert_eq!(p.due(m + 1_000, true), None, "too soon to retry");
        assert_eq!(p.due(m + 31_000, true), Some(m + 31_000));
        p.failed(w);
        assert_eq!(p.due(W0 + WINDOW_MS - 10_000, true), None, "too late in the window");
    }
    #[test]
    fn a_new_window_starts_fresh() {
        let mut p = ShotPlan::new(6);
        first_moment(&mut p, W0);
        let m2 = first_moment(&mut p, W0 + WINDOW_MS);
        assert_eq!(window_index(m2), window_index(W0) + 1);
    }
}
