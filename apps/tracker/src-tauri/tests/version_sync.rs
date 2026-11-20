//! The app's version has one source of truth, tauri.conf.json. Cargo.toml and package.json must say the same thing,
//! and it must look like MAJOR.MINOR.PATCH (the update feed compares numbers).

use std::fs;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn conf_version() -> String {
    let text = fs::read_to_string(root().join("tauri.conf.json")).expect("tauri.conf.json");
    let v: serde_json::Value = serde_json::from_str(&text).expect("valid json");
    v["version"].as_str().expect("version in tauri.conf.json").to_string()
}

fn package_version() -> String {
    let text = fs::read_to_string(root().join("../package.json")).expect("package.json");
    let v: serde_json::Value = serde_json::from_str(&text).expect("valid json");
    v["version"].as_str().expect("version in package.json").to_string()
}

#[test]
fn versions_match_and_look_like_semver() {
    let conf = conf_version();
    let parts: Vec<&str> = conf.split('.').collect();
    assert_eq!(parts.len(), 3, "version must be MAJOR.MINOR.PATCH, got {conf}");
    assert!(parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())), "numbers only, got {conf}");
    assert_eq!(package_version(), conf, "package.json version differs from tauri.conf.json");
    assert_eq!(env!("CARGO_PKG_VERSION"), conf, "Cargo.toml version differs from tauri.conf.json");
}
