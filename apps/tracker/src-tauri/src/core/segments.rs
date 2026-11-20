//! Turns samples (every 5 seconds: which program, how long since the last input) into merged segments.
//!
//! A sample covers the time from itself to the next sample. Same program and state continue one segment; a change closes it at
//! the new sample; a segment is cut at 30 minutes; a gap of more than 60 seconds between samples (sleep, lid closed) closes the
//! segment at the last sample, and no time is invented across the gap.

pub const MAX_SEGMENT_MS: i64 = 30 * 60_000;
pub const MAX_GAP_MS: i64 = 60_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Sample {
    pub at_ms: i64,
    pub app: String,
    pub idle_secs: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Active,
    Idle,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub app: String,
    pub state: State,
}

pub struct SegmentBuilder {
    idle_timeout_secs: u32,
    open: Option<Segment>,
    last_at: Option<i64>,
}

/// A segment with no length carries no time, so it is never reported.
fn finished(seg: Segment) -> Option<Segment> {
    (seg.end_ms > seg.start_ms).then_some(seg)
}

impl SegmentBuilder {
    pub fn new(idle_timeout_secs: u32) -> Self {
        SegmentBuilder { idle_timeout_secs, open: None, last_at: None }
    }

    /// The segments this sample finished (usually none).
    pub fn push(&mut self, s: Sample) -> Vec<Segment> {
        let mut out = Vec::new();
        if self.last_at.is_some_and(|last| s.at_ms <= last) {
            return out; // the system clock went back, or a repeat: nothing is invented
        }
        self.last_at = Some(s.at_ms);
        let state = if s.idle_secs >= self.idle_timeout_secs { State::Idle } else { State::Active };
        let fresh = |s: &Sample| Segment { start_ms: s.at_ms, end_ms: s.at_ms, app: s.app.clone(), state };
        match self.open.take() {
            None => self.open = Some(fresh(&s)),
            Some(mut open) => {
                if s.at_ms - open.end_ms > MAX_GAP_MS {
                    // Sleep or a closed lid: the old segment ends at its last sample.
                    out.extend(finished(open));
                    self.open = Some(fresh(&s));
                } else if open.app == s.app && open.state == state {
                    open.end_ms = s.at_ms;
                    while open.end_ms - open.start_ms > MAX_SEGMENT_MS {
                        let mut head = open.clone();
                        head.end_ms = head.start_ms + MAX_SEGMENT_MS;
                        open.start_ms = head.end_ms;
                        out.extend(finished(head));
                    }
                    self.open = Some(open);
                } else {
                    open.end_ms = s.at_ms;
                    out.extend(finished(open));
                    self.open = Some(fresh(&s));
                }
            }
        }
        out
    }

    /// Closes the open segment at its last sample (stopping, clocking out, going offline).
    pub fn flush(&mut self, _now_ms: i64) -> Vec<Segment> {
        self.open.take().and_then(finished).into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_700_000_000_000;
    fn s(at: i64, app: &str, idle: u32) -> Sample {
        Sample { at_ms: T0 + at, app: app.into(), idle_secs: idle }
    }
    fn seg(a: i64, b: i64, app: &str, st: State) -> Segment {
        Segment { start_ms: T0 + a, end_ms: T0 + b, app: app.into(), state: st }
    }

    #[test]
    fn thirty_one_minutes_in_one_app_is_a_thirty_minute_segment_and_the_rest() {
        let mut b = SegmentBuilder::new(180);
        let mut done = Vec::new();
        for i in 0..=(31 * 12) {
            done.extend(b.push(s(i * 5_000, "chrome", 0)));
        }
        assert_eq!(done, vec![seg(0, 30 * 60_000, "chrome", State::Active)]);
        assert_eq!(b.flush(T0 + 31 * 60_000), vec![seg(30 * 60_000, 31 * 60_000, "chrome", State::Active)]);
    }
    #[test]
    fn an_app_change_closes_the_segment_at_the_new_sample() {
        let mut b = SegmentBuilder::new(180);
        assert!(b.push(s(0, "chrome", 0)).is_empty());
        assert!(b.push(s(5_000, "chrome", 0)).is_empty());
        assert_eq!(b.push(s(10_000, "excel", 0)), vec![seg(0, 10_000, "chrome", State::Active)]);
        b.push(s(15_000, "excel", 0));
        assert_eq!(b.flush(T0 + 16_000), vec![seg(10_000, 15_000, "excel", State::Active)]);
    }
    #[test]
    fn going_idle_closes_the_active_segment_and_opens_an_idle_one() {
        let mut b = SegmentBuilder::new(180);
        b.push(s(0, "chrome", 0));
        b.push(s(5_000, "chrome", 100));
        let done = b.push(s(10_000, "chrome", 180));
        assert_eq!(done, vec![seg(0, 10_000, "chrome", State::Active)]);
        b.push(s(15_000, "chrome", 185));
        assert_eq!(b.flush(T0 + 16_000), vec![seg(10_000, 15_000, "chrome", State::Idle)]);
    }
    #[test]
    fn a_gap_over_sixty_seconds_closes_at_the_last_sample_and_starts_fresh() {
        let mut b = SegmentBuilder::new(180);
        b.push(s(0, "chrome", 0));
        b.push(s(5_000, "chrome", 0));
        let done = b.push(s(95_000, "chrome", 0)); // 90 s later
        assert_eq!(done, vec![seg(0, 5_000, "chrome", State::Active)]);
        b.push(s(100_000, "chrome", 0));
        assert_eq!(b.flush(T0 + 101_000), vec![seg(95_000, 100_000, "chrome", State::Active)]);
    }
    #[test]
    fn a_sample_with_an_earlier_or_equal_time_is_ignored() {
        let mut b = SegmentBuilder::new(180);
        b.push(s(10_000, "chrome", 0));
        b.push(s(15_000, "chrome", 0));
        assert!(b.push(s(5_000, "excel", 0)).is_empty());
        assert!(b.push(s(15_000, "excel", 0)).is_empty());
        assert_eq!(b.flush(T0 + 20_000), vec![seg(10_000, 15_000, "chrome", State::Active)]);
    }
    #[test]
    fn flush_with_nothing_open_gives_nothing() {
        let mut b = SegmentBuilder::new(180);
        assert!(b.flush(T0).is_empty());
        b.push(s(0, "chrome", 0));
        b.push(s(1_000, "chrome", 0));
        assert_eq!(b.flush(T0 + 2_000).len(), 1);
        assert!(b.flush(T0 + 3_000).is_empty());
    }
    #[test]
    fn a_single_sample_has_no_length_and_reports_nothing() {
        let mut b = SegmentBuilder::new(180);
        b.push(s(0, "chrome", 0));
        assert!(b.flush(T0 + 1_000).is_empty());
    }
    #[test]
    fn the_lock_screen_name_is_just_another_app_name_and_counts_as_idle() {
        let mut b = SegmentBuilder::new(180);
        b.push(s(0, "Locked", 400));
        b.push(s(5_000, "Locked", 405));
        assert_eq!(b.flush(T0 + 6_000), vec![seg(0, 5_000, "Locked", State::Idle)]);
    }
}
