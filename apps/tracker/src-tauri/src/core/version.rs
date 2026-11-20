//! Versions, read the way the server reads them (`releases-logic.ts`).
use std::cmp::Ordering;

/// MAJOR.MINOR.PATCH, each a plain number under a million (no leading zeros, no suffix). Anything else is not a version.
pub fn parse_version(v: &str) -> Option<[u32; 3]> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut out = [0u32; 3];
    for (i, p) in parts.iter().enumerate() {
        let plain = !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()) && (*p == "0" || !p.starts_with('0'));
        if !plain {
            return None;
        }
        out[i] = p.parse().ok()?;
    }
    Some(out)
}

/// A version that cannot be read sorts lowest, so it is never "newer".
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    // `None` (unreadable) orders before any `Some`, which is exactly the rule.
    parse_version(a).cmp(&parse_version(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_compare_numerically() {
        assert_eq!(compare_versions("1.10.0", "1.9.0"), Ordering::Greater);
        assert_eq!(compare_versions("1.2.3", "1.2.3"), Ordering::Equal);
        assert_eq!(compare_versions("0.9.9", "1.0.0"), Ordering::Less);
    }
    #[test]
    fn unreadable_sorts_lowest() {
        assert_eq!(compare_versions("0.0.0-sim", "0.0.1"), Ordering::Less);
        assert_eq!(compare_versions("0.0.1", "nope"), Ordering::Greater);
        assert_eq!(compare_versions("a", "b"), Ordering::Equal);
    }
    #[test]
    fn parse_is_strict() {
        assert_eq!(parse_version("1.2.3"), Some([1, 2, 3]));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("01.2.3"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("1.2.x"), None);
        assert_eq!(parse_version("1.2.1000000"), None);
    }
}
