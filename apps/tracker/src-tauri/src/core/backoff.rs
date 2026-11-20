//! How long to wait before trying again after a failure: doubling, capped, never a tight loop.

/// splitmix64: a small deterministic mixer, enough to spread retries.
pub(crate) fn mix(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

pub struct Backoff {
    base_ms: u64,
    max_ms: u64,
    attempt: u32,
    seed: Option<u64>,
}

impl Backoff {
    pub fn new(base_ms: u64, max_ms: u64) -> Self {
        Backoff { base_ms, max_ms, attempt: 0, seed: None }
    }
    /// Adds up to 10% on top of each wait (never past the cap), from a seed, so many computers do not retry in step.
    pub fn with_jitter(mut self, seed: u64) -> Self {
        self.seed = Some(seed);
        self
    }
    pub fn next(&mut self) -> u64 {
        let plain = self.base_ms.saturating_mul(1u64 << self.attempt.min(30)).min(self.max_ms);
        let extra = match self.seed {
            Some(seed) => plain / 10 * (mix(seed ^ u64::from(self.attempt)) % 1001) / 1000,
            None => 0,
        };
        self.attempt = self.attempt.saturating_add(1);
        (plain + extra).min(self.max_ms)
    }
    pub fn reset(&mut self) {
        self.attempt = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_up_to_the_cap() {
        let mut b = Backoff::new(5_000, 300_000);
        let got: Vec<u64> = (0..8).map(|_| b.next()).collect();
        assert_eq!(got, vec![5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
    }
    #[test]
    fn reset_goes_back_to_the_base() {
        let mut b = Backoff::new(5_000, 300_000);
        b.next();
        b.next();
        b.reset();
        assert_eq!(b.next(), 5_000);
    }
    #[test]
    fn jitter_is_small_deterministic_and_within_the_cap() {
        let mut a = Backoff::new(5_000, 300_000).with_jitter(7);
        let mut b = Backoff::new(5_000, 300_000).with_jitter(7);
        for i in 0..20u32 {
            let (x, y) = (a.next(), b.next());
            assert_eq!(x, y);
            let plain = (5_000u64 << i.min(6)).min(300_000);
            assert!(x >= plain && x <= 300_000 && x <= plain + plain / 10, "{x} vs {plain}");
        }
    }
    #[test]
    fn many_failures_do_not_overflow() {
        let mut b = Backoff::new(5_000, 300_000);
        for _ in 0..200 {
            assert!(b.next() <= 300_000);
        }
    }
}
