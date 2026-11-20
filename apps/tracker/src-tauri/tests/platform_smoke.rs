//! Needs a real desktop session (a signed-in, unlocked screen), so it is ignored in normal runs:
//!   cargo test --manifest-path src-tauri/Cargo.toml -- --ignored platform_smoke
use elevate_tracker_lib::capture::blur::capture_blurred;
use elevate_tracker_lib::platform;

#[test]
#[ignore]
fn platform_smoke_reads_the_front_program_and_idle_time_and_takes_a_blurred_picture() {
    let p = platform::current();
    let app = p.foreground_app().expect("a front program on an unlocked desktop");
    assert!(!app.is_empty());
    assert!(!app.to_lowercase().ends_with(".exe"), "the name has no extension: {app}");
    // Nobody may be at the keyboard while the test runs, so the value can be large; it only has to be sane (under the 49-day counter wrap).
    let idle = p.idle_seconds();
    println!("idle seconds: {idle}, front program: {app}");
    assert!(idle < 49 * 24 * 3600, "idle time must not be a wrapped counter: {idle}");

    let jpeg = capture_blurred(p.as_ref()).expect("a blurred capture");
    assert_eq!(&jpeg.as_bytes()[..3], &[0xFF, 0xD8, 0xFF]);
    assert!(jpeg.len() <= 300 * 1024);
}
