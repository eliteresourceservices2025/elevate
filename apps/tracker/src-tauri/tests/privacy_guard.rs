//! Reads every source file and fails on anything that could let an app name, a window title or a screenshot slip out:
//! printing, tracing, a window-title call, a log call that mentions an app or a segment, or a raw capture used outside `capture/`.
//! The check itself is tested first on planted violations, so a broken check cannot pass silently.

use std::fs;
use std::path::{Path, PathBuf};

/// What is wrong with one file's text. `rel` is its path under `src/` with forward slashes.
fn violations(rel: &str, text: &str) -> Vec<String> {
    // Built from pieces so this file does not match itself.
    let banned: Vec<String> = vec![
        ["Get", "Window", "Text"].concat(),
        ["window", "_title"].concat(),
        [".ti", "tle("].concat(),
        ["print", "ln!"].concat(),
        ["e", "print", "ln!"].concat(),
        ["db", "g!"].concat(),
        ["trac", "ing"].concat(),
    ];
    let mut found = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let code = line.split("//").next().unwrap_or("");
        for word in &banned {
            if code.contains(word.as_str()) {
                found.push(format!("{rel}:{}: uses {word}", n + 1));
            }
        }
        // A log call may carry an event and a number, never anything about an app or a segment.
        if code.contains("log_event(") && !code.contains("pub fn log_event") {
            let lower = code.to_lowercase();
            let words: Vec<&str> = lower.split(|c: char| !c.is_alphanumeric()).collect();
            if words.contains(&"app") || lower.contains("segment") {
                found.push(format!("{rel}:{}: a log call mentions an app or a segment", n + 1));
            }
        }
        // The raw canvas stays inside the capture module.
        if !rel.starts_with("capture/") && code.contains("RawCanvas") {
            found.push(format!("{rel}:{}: a raw capture is used outside capture/", n + 1));
        }
    }
    found
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("readable source folder") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn the_check_catches_planted_violations() {
    let bad_print = ["fn f() { print", "ln!(\"{}\", app); }"].concat();
    assert!(!violations("engine.rs", &bad_print).is_empty());
    let bad_title = ["let t = GetWindow", "Text(hwnd);"].concat();
    assert!(!violations("platform/windows.rs", &bad_title).is_empty());
    assert!(!violations("engine.rs", "logger.log_event(Event::Delivered(app_count_for(app)));").is_empty());
    assert!(!violations("engine.rs", "logger.log_event(Event::Segment(1));").is_empty());
    assert!(!violations("engine.rs", "let c: RawCanvas = x;").is_empty());
    // And it leaves ordinary code and comments alone.
    assert!(violations("engine.rs", "logger.log_event(Event::Delivered(n as u32)); // mentions the app in a comment").is_empty());
    assert!(violations("capture/blur.rs", "pub struct RawCanvas { width: u32 }").is_empty());
}

#[test]
fn the_real_source_is_clean() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&root, &mut files);
    assert!(files.len() >= 15, "the scan must find the source files, found {}", files.len());
    let mut all = Vec::new();
    for file in files {
        let rel = file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        all.extend(violations(&rel, &fs::read_to_string(&file).expect("readable source")));
    }
    assert!(all.is_empty(), "{}", all.join("\n"));
}
