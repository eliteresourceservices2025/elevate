//! App names only. The app never reads a window title: the name comes from the program's file name.

const APP_MAX: usize = 80;

/// Same cleaning as the server's `sanitizeApp`: control characters become spaces, spaces collapse, at most 80 characters.
pub fn sanitize_app(input: &str) -> Option<String> {
    let spaced: String = input.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let collapsed = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    let cut: String = collapsed.chars().take(APP_MAX).collect();
    Some(cut.trim_end().to_string())
}

/// The program's file name without its extension: `C:\Program Files\Google\Chrome\chrome.exe` gives `chrome`.
pub fn app_from_exe_path(path: &str) -> Option<String> {
    let file = path.rsplit(['\\', '/']).next().unwrap_or("");
    if file.is_empty() {
        return None;
    }
    let stem = match file.rfind('.') {
        Some(i) if i > 0 => &file[..i],
        _ => file,
    };
    sanitize_app(stem)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_removes_control_characters_and_trims() {
        assert_eq!(sanitize_app("  Chrome\u{7}  "), Some("Chrome".into()));
    }
    #[test]
    fn sanitize_collapses_spaces() {
        assert_eq!(sanitize_app("Visual   Studio\tCode"), Some("Visual Studio Code".into()));
    }
    #[test]
    fn sanitize_cuts_to_80_characters() {
        let long = "a".repeat(200);
        assert_eq!(sanitize_app(&long).unwrap().chars().count(), 80);
    }
    #[test]
    fn sanitize_blank_is_none() {
        assert_eq!(sanitize_app("   \u{1}\t "), None);
        assert_eq!(sanitize_app(""), None);
    }
    #[test]
    fn exe_path_with_spaces_gives_the_stem() {
        assert_eq!(app_from_exe_path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), Some("chrome".into()));
    }
    #[test]
    fn exe_path_without_extension_gives_the_name() {
        assert_eq!(app_from_exe_path(r"C:\Windows\System32\LockApp"), Some("LockApp".into()));
        assert_eq!(app_from_exe_path("notepad"), Some("notepad".into()));
    }
    #[test]
    fn exe_path_empty_or_directory_is_none() {
        assert_eq!(app_from_exe_path(""), None);
        assert_eq!(app_from_exe_path(r"C:\Windows\"), None);
    }
}
