//! The installer and release settings that must never drift: a per-user install (no administrator rights), signed update files, HTTPS
//! only in release builds, no developer tools in the shipped app, and an uninstaller that always removes the saved sign-in.

use std::fs;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn conf() -> serde_json::Value {
    serde_json::from_str(&fs::read_to_string(root().join("tauri.conf.json")).expect("tauri.conf.json")).expect("valid json")
}

fn constant(source: &str, name: &str) -> String {
    let marker = format!("const {name}: &str = \"");
    let start = source.find(&marker).unwrap_or_else(|| panic!("{name} not found")) + marker.len();
    source[start..start + source[start..].find('"').unwrap()].to_string()
}

#[test]
fn the_install_is_per_user_and_ships_signed_update_files() {
    let c = conf();
    assert_eq!(c["bundle"]["windows"]["nsis"]["installMode"], "currentUser", "no administrator rights should be needed");
    assert_eq!(c["bundle"]["createUpdaterArtifacts"], true);
    let targets: Vec<&str> = c["bundle"]["targets"].as_array().expect("targets").iter().filter_map(|t| t.as_str()).collect();
    assert_eq!(targets, vec!["nsis"]);
    for key in ["copyright", "shortDescription"] {
        assert!(c["bundle"][key].as_str().is_some_and(|s| s.len() > 5), "bundle.{key} must be filled in");
    }
}

#[test]
fn the_update_key_is_committed_as_text_and_matches_the_one_the_app_checks() {
    let key = fs::read_to_string(root().join("updater.pub")).expect("updater.pub");
    assert!(key.trim().len() > 40, "the public key is missing");
    assert_eq!(key.trim(), elevate_tracker_lib::updates::PUBLIC_KEY.trim());
    // The bundler signs update files using the key in the config: it must be the very same public key.
    assert_eq!(conf()["plugins"]["updater"]["pubkey"].as_str().map(str::trim), Some(key.trim()), "plugins.updater.pubkey must equal updater.pub");
    // A private key must never be in the source tree.
    for entry in fs::read_dir(root()).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        assert!(!name.ends_with(".key"), "a key file is in the source tree: {name}");
    }
}

#[test]
fn release_builds_talk_https_only_and_plain_http_is_a_debug_build_thing() {
    let lib = fs::read_to_string(root().join("src/lib.rs")).unwrap();
    assert!(lib.contains("\"https://elevate.eliteresourceservices.com\""), "the release address must be HTTPS");
    let client = fs::read_to_string(root().join("src/api/client.rs")).unwrap();
    assert!(client.contains("if cfg!(debug_assertions)"), "plain http must be limited to debug builds");
    assert!(client.contains("\"http://localhost\"") && !client.contains("\"http://elevate"), "only this computer may use plain http");
}

#[test]
fn no_developer_tools_are_shipped() {
    let text = fs::read_to_string(root().join("tauri.conf.json")).unwrap();
    assert!(!text.to_lowercase().contains("devtools"), "devtools must not be switched on in the config");
    let cargo = fs::read_to_string(root().join("Cargo.toml")).unwrap();
    assert!(!cargo.contains("devtools"), "the devtools feature must not be enabled");
}

#[test]
fn the_uninstaller_always_removes_the_saved_sign_in_but_never_during_an_update() {
    let c = conf();
    let hook_path = c["bundle"]["windows"]["nsis"]["installerHooks"].as_str().expect("installerHooks is set");
    let hook = fs::read_to_string(root().join(hook_path)).expect("the hook file exists");
    assert!(hook.contains("NSIS_HOOK_POSTUNINSTALL"));
    assert!(hook.contains("cmdkey"), "it must delete the credential");
    assert!(hook.contains("$UpdateMode"), "an update must not sign the person out");

    // The same name the token store writes: user.service, as Windows lists it.
    let token = fs::read_to_string(root().join("src/api/token.rs")).unwrap();
    let target = format!("{}.{}", constant(&token, "USER"), constant(&token, "SERVICE"));
    assert!(hook.contains(&format!("target={target}")), "the hook must delete the target {target}");
}

#[test]
fn a_closed_window_is_really_closed_so_the_tray_app_stays_small() {
    // The window runs in WebView2 helper processes worth hundreds of MB. Closing the window must end them (the app keeps running in the
    // tray and builds the window again when asked), so the window is not created at start and an exit request only stops when it is the
    // last window closing, never an explicit quit.
    let c = conf();
    assert_eq!(c["app"]["windows"][0]["create"], false, "the window must be created on demand, not at start");
    let lib = fs::read_to_string(root().join("src/lib.rs")).unwrap();
    assert!(lib.contains("prevent_exit"), "closing the last window must not quit the app");
    assert!(lib.contains("code.is_none()"), "an explicit quit (with an exit code) must still quit");
    assert!(!lib.contains("prevent_close"), "closing must destroy the window, not just hide it");
}

#[test]
fn the_build_workflow_gives_signing_secrets_only_to_the_steps_that_need_them() {
    let flow = fs::read_to_string(root().join("../../../.github/workflows/tracker.yml")).expect("workflow");
    let job_env: Vec<&str> = flow.lines().skip_while(|l| !l.starts_with("    env:")).skip(1).take_while(|l| l.starts_with("      ")).collect();
    assert!(job_env.iter().all(|l| !l.contains("secrets.")), "a secret at job level is visible to every dependency install script and action: {job_env:?}");
    assert!(flow.contains("cert.pfx") && flow.contains("if: always()"), "the certificate file is removed even when the build fails");
}

#[test]
fn the_build_workflow_conditions_are_valid_expressions() {
    let flow = fs::read_to_string(root().join("../../../.github/workflows/tracker.yml")).expect("workflow");
    for line in flow.lines().filter(|l| l.trim_start().starts_with("if:")) {
        assert!(line.contains("'refs/tags/tracker-v'") || line.contains("always()") || line.contains("matrix.target == '"), "an `if:` must use quoted strings so GitHub accepts the file: {line}");
    }
}
