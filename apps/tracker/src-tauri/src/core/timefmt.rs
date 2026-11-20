//! Milliseconds since the epoch as the ISO 8601 text the server reads (UTC, `Z`). No time library: the rule is small and exact.

/// `1700000000000` gives `2023-11-14T22:13:20.000Z`. Times before 1970 are not used by the app and give the epoch.
pub fn iso_from_ms(ms: i64) -> String {
    let ms = ms.max(0);
    let secs = ms / 1000;
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, (rem % 3600) / 60, rem % 60, ms % 1000)
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_moments() {
        assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
        assert_eq!(iso_from_ms(1_700_000_000_123), "2023-11-14T22:13:20.123Z");
    }
    #[test]
    fn leap_days_and_year_ends() {
        assert_eq!(iso_from_ms(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_709_164_800_000), "2024-02-29T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_767_225_599_999), "2025-12-31T23:59:59.999Z");
        assert_eq!(iso_from_ms(1_767_225_600_000), "2026-01-01T00:00:00.000Z");
    }
}
