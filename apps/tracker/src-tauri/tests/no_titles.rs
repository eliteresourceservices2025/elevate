//! The app records the program's name only. This scans our own source for any call that could read a window title,
//! a class name, the text of a control or the clipboard, so the rule holds by construction.

use std::fs;
use std::path::{Path, PathBuf};

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
fn no_source_file_reads_a_window_title_or_other_content() {
    // Built from pieces so this file does not match itself.
    let forbidden: Vec<String> = [
        ["Get", "Window", "Text"].concat(),
        ["Internal", "Get", "Window", "Text"].concat(),
        ["Get", "Class", "Name"].concat(),
        ["Send", "Message"].concat(),
        ["Get", "Clipboard", "Data"].concat(),
        ["Set", "Windows", "Hook"].concat(),
        ["Get", "Async", "Key", "State"].concat(),
        ["Get", "Key", "State"].concat(),
        ["Get", "Raw", "Input", "Data"].concat(),
        ["UI", "Automation"].concat(),
        // macOS: window names, accessibility element titles, the clipboard and global input taps.
        ["CGWindow", "ListCopyWindowInfo"].concat(),
        ["kCG", "WindowName"].concat(),
        ["AX", "UIElement"].concat(),
        ["AX", "Title"].concat(),
        ["NS", "Pasteboard"].concat(),
        ["CGEvent", "TapCreate"].concat(),
    ]
    .into();
    let mut files = Vec::new();
    rust_files(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
    assert!(files.len() >= 3, "the scan must actually find the source files");
    for file in files {
        let text = fs::read_to_string(&file).expect("readable source file");
        for word in &forbidden {
            assert!(!text.contains(word.as_str()), "{} uses {word}", file.display());
        }
    }
}
