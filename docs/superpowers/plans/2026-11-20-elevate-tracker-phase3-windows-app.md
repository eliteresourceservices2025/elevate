# ELEVATE Tracker App, Phase 3 (the Windows app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows version of the ELEVATE Tracker App: a small tray app that, while a person is clocked in, records which app they use and whether they are active or idle, takes a blurred screenshot about every 10 minutes, and sends both to ELEVATE, updating itself from ELEVATE's own release feed.

**Architecture:** A Tauri 2 app in `apps/tracker/` (Rust core and Windows layer, a tiny React status window). The Rust core is split so the logic that matters is pure and unit-tested (turning samples into segments, scheduling screenshots, blurring, retry rules), and the Windows-only parts (foreground app, idle time, screen capture) sit behind one `Platform` trait so macOS can be added in Phase 4. The app only ever asks ELEVATE what to do (`/api/tracker/*`), never decides the clock state itself, and keeps an on-disk queue so nothing is lost offline.

**Tech Stack:** Rust (stable, MSVC toolchain), Tauri 2 (`tauri-plugin-updater`, `single-instance`, `autostart`), `windows` crate, `xcap` (screen capture), `image` (downscale, blur, JPEG), `reqwest` with rustls, `rusqlite` (bundled), `keyring`, `tokio`, `wiremock` and `tempfile` for tests; React + Vite + TypeScript for the one window; GitHub Actions for builds.

**Spec:** `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`. The server side the app talks to: `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md` (device API) and `...phase2b-download-releases.md` (update feed, version floor). API reference: `docs/modules/activity-tracker.md`.

All paths are relative to the repo root unless they start with `apps/tracker/`.

## Global Constraints

- **App name only.** The app never reads a window title, URL, keystroke, clipboard or the contents of any window. The Windows layer uses no `GetWindowText*` or title API at all, so this is true by construction, and a source-scan test enforces it. The app name is the foreground program's file name without `.exe`, cleaned like the server's `sanitizeApp` (control characters removed, spaces collapsed, at most 80 characters).
- **No unblurred pixels are ever kept.** A screenshot is captured in memory, downscaled to at most 480 px wide, blurred, encoded as JPEG (quality 60, at most 300 KB) and only then may touch disk. The capture function returns only a `BlurredJpeg`; there is no code path that saves a raw capture.
- **Only while the server says "working".** The app polls `GET /api/tracker/clock-state` every 30 seconds and samples only when `state = "working"` and `policy = true`. It never decides the clock state, and it records nothing on a break, when clocked out, or when the policy is off.
- **Network:** only the ELEVATE base URL (compile-time `ELEVATE_TRACKER_BASE_URL`, default the production address) and the storage links ELEVATE returns. HTTPS only (HTTP allowed only to `localhost` in debug builds). No analytics, no crash reporting, no third-party calls.
- **Secrets:** the device token lives only in Windows Credential Manager (`keyring`). It is never written to a file, a log or the queue. The update signing private key is never committed; only the public key is in `tauri.conf.json`.
- **Logs and local files hold no app names.** The log (a file under the app data folder, 1 MB, rotated) contains counts, states and error kinds only. The queue database holds app names and times (it is what is waiting to be sent) and nothing else.
- **Segments:** at most 30 minutes each; same program and state within 15 seconds of each other merge; a gap of more than 60 seconds between samples (sleep, lid closed) ends the segment at the last sample, and no time is invented across it. Sampling every 5 seconds; idle after the server's `idleTimeoutSeconds` (default 180) without input.
- **Screenshots:** one per 10-minute window at a random moment inside it, taken of the monitor that holds the foreground window; a failed one is retried inside the same window, then skipped.
- **Windows 10 21H2 or newer, per-user install (no administrator rights needed).** Resource budget: under 1% of one CPU on average and under 80 MB of memory while tracking.
- **Version:** one source of truth, `apps/tracker/src-tauri/tauri.conf.json` (`version`), mirrored into `package.json` and `Cargo.toml` by a test. Sent on every request as `X-Tracker-Version` and in the User-Agent `ELEVATE-Tracker/<version>`.
- **Existing CI must keep passing.** `pnpm -r lint|typecheck|test` run in every workspace package on an Ubuntu runner with no Rust. `apps/tracker/package.json` therefore defines only a Node `typecheck` (the TypeScript window); the Rust tests run as `test:rust` in their own Windows workflow.
- **Not in this phase:** macOS (a stub `Platform` only), code signing certificates (Windows or Apple; builds are unsigned until they exist), the in-app pause button (not part of the design), Linux.

## Review Focus

- A window title, URL or any app name reaching a log, the queue's file name, an error message, or the network in any field other than `app` of a segment.
- A raw screenshot touching disk or being held after blurring; a blur that leaves text readable (the test uses a text-like pattern, and the live check looks at a real capture).
- Sleep and resume, the system clock moving backwards or forwards, a locked screen (the lock screen must count as idle, not as an app), and multiple monitors (capture the monitor of the foreground window).
- The server answers `out` or `break` mid-batch: sampling stops at once and nothing is recorded after it.
- 401 (token revoked), 403 (policy off), 426 (update required), 429 and 5xx or no network: no tight retry loops, no memory growth, the queue stays within its cap, and a crash between "sent" and "deleted" resends harmlessly (the server drops exact duplicates).
- The updater: never installs an older version, verifies its signature against the key in the app, uses HTTPS only, and the device token is not forwarded to the storage host when the update link redirects there.
- Two copies of the app, starting at login, closing the window (must hide to the tray, not quit), and uninstalling (offer to remove local data).
- Idle cost: CPU and memory over a 30-minute run.

---

### Task 1: Tools check and the project skeleton

**Files:**
- Create: `apps/tracker/package.json`, `apps/tracker/tsconfig.json`, `apps/tracker/vite.config.ts`, `apps/tracker/index.html`, `apps/tracker/src/main.tsx`, `apps/tracker/src/App.tsx`
- Create: `apps/tracker/src-tauri/Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`, `icons/` (generated from `brand/` with `pnpm tauri icon`)
- Modify: `.gitignore` (`apps/tracker/src-tauri/target`, `apps/tracker/dist`)
- Test: `apps/tracker/src-tauri/tests/version_sync.rs`

**Interfaces:**
- Package name `elevate-tracker`; scripts: `dev` (vite), `build` (vite build), `typecheck` (`tsc --noEmit`), `tauri` (the Tauri CLI), `test:rust` (`cargo test --manifest-path src-tauri/Cargo.toml`), `build:win` (`tauri build --bundles nsis`).
- `tauri.conf.json`: `productName` "ELEVATE Tracker App", `identifier` "com.eliteresourceservices.elevate-tracker", `version` "0.1.0", one window `status` (small, 420 x 560, resizable false, `visible: false`, shown by code), no devtools in release.

- [ ] **Step 1: Check the tools** with `rustc --version`, `cargo --version`, `rustup show` (default toolchain `stable-x86_64-pc-windows-msvc`) and `where link`. If anything is missing, stop and ask the owner to finish the installs (Visual Studio Build Tools "Desktop development with C++", Rustup) rather than working around it.
- [ ] **Step 2: Write the failing test** `version_sync.rs`: reads `tauri.conf.json`, `Cargo.toml` and `../package.json` and asserts the three versions are equal and look like `MAJOR.MINOR.PATCH`.
- [ ] **Step 3: Run** `pnpm --filter elevate-tracker test:rust` (the first run downloads and builds Tauri's dependencies, expect 10 to 20 minutes) and confirm FAIL (nothing exists yet).
- [ ] **Step 4: Implement** the skeleton by hand (not an interactive generator): the files above, a window that renders "ELEVATE Tracker App" and the version read through a Tauri command `app_version()`, a tray-less `lib.rs` for now. Generate icons from the ERS logo in `brand/`.
- [ ] **Step 5: Run** `pnpm --filter elevate-tracker test:rust`, `pnpm --filter elevate-tracker typecheck`, and `pnpm --filter elevate-tracker tauri dev` (confirm the window opens and shows the version; close it). From the repo root run `pnpm typecheck && pnpm test` and confirm the existing apps still pass and nothing tries to run cargo.
- [ ] **Step 6: Commit** `feat(tracker): Tauri project skeleton`.

---

### Task 2: The core rules, in pure Rust

**Files:**
- Create: `apps/tracker/src-tauri/src/core/mod.rs`, `segments.rs`, `app_name.rs`, `schedule.rs`, `backoff.rs`, `version.rs`
- Test: unit tests inside each file (`#[cfg(test)]`)

**Interfaces:**
- `app_name.rs`: `fn sanitize_app(input: &str) -> Option<String>` (control characters removed, spaces collapsed, at most 80 characters, `None` when empty); `fn app_from_exe_path(path: &str) -> Option<String>` (file stem of the program path, so `C:\Program Files\...\chrome.exe` gives `chrome`).
- `segments.rs`: `struct Sample { at_ms: i64, app: String, idle_secs: u32 }`; `enum State { Active, Idle }`; `struct Segment { start_ms: i64, end_ms: i64, app: String, state: State }`; `struct SegmentBuilder::new(idle_timeout_secs: u32)` with `push(&mut self, s: Sample) -> Vec<Segment>` (segments that are finished by this sample) and `flush(&mut self, now_ms: i64) -> Vec<Segment>` (the open one, closed at its last sample). Rules as in Global Constraints (merge within 15 s, split at 30 minutes, close at the last sample across a gap over 60 s, idle when `idle_secs >= idle_timeout_secs`, a sample earlier than the previous one is ignored).
- `schedule.rs`: `fn window_index(at_ms: i64) -> i64` (`at_ms / 600_000`); `struct ShotPlan::new(rng_seed: u64)`; `fn due(&mut self, now_ms: i64, working: bool) -> Option<i64>` (the capture moment, chosen once per window at a random point in its middle 8 minutes; `Some` when `now_ms` reaches it and nothing was finished for that window; nothing when not working); `fn done(&mut self, window: i64)`; `fn failed(&mut self, window: i64)` (allows a retry until 30 seconds before the window ends).
- `backoff.rs`: `struct Backoff::new(base_ms, max_ms)`; `next(&mut self) -> u64` (doubles up to the cap, with a small deterministic jitter from a seed), `reset(&mut self)`.
- `version.rs`: `fn parse_version(v: &str) -> Option<[u32; 3]>`, `fn compare_versions(a: &str, b: &str) -> Ordering` (same rules as the server's `releases-logic.ts`: numeric, unreadable sorts lowest).

- [ ] **Step 1: Write failing tests** mirroring the server's tests: `sanitize_app("  Chrome\u{7}  ")` is `Some("Chrome")`, 200 characters are cut to 80, blank is `None`; `app_from_exe_path` for a Windows path with spaces and for a path with no extension; `SegmentBuilder`: samples every 5 s in one app for 31 minutes give a 30-minute segment and the rest; an app change closes the segment; going idle at 180 s closes the active one and opens an idle one; a 90-second gap closes at the last sample and starts fresh; a sample with an earlier time is ignored; `flush` closes the open segment. `ShotPlan`: never returns two moments in one window, never earlier than minute 1 or later than minute 9 of its window, returns `None` when not working, allows a retry after `failed` until 30 s before the end, and the same seed gives the same moments. `Backoff`: 5 s, 10 s, 20 s, ... capped at 300 s, `reset` returns to 5 s. `version`: `1.10.0 > 1.9.0`, `0.0.0-sim` sorts lowest.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the signatures above (no I/O, no clock reads, no randomness except the seed).
- [ ] **Step 4: Run** the same command; confirm PASS.
- [ ] **Step 5: Commit** `feat(tracker): pure core rules`.

---

### Task 3: The Windows layer and the blur

**Files:**
- Create: `apps/tracker/src-tauri/src/platform/mod.rs` (the trait), `windows.rs`, `unsupported.rs`; `apps/tracker/src-tauri/src/capture/blur.rs`
- Test: `blur.rs` unit tests; `apps/tracker/src-tauri/tests/platform_smoke.rs` (`#[ignore]`, needs a desktop session)

**Interfaces:**
- `trait Platform { fn foreground_app(&self) -> Option<String>; fn idle_seconds(&self) -> u32; fn capture_foreground_monitor(&self) -> Result<RawCapture, CaptureError>; }` with `struct RawCapture { width: u32, height: u32, rgba: Vec<u8> }` (never leaves the `capture` module).
- `windows.rs`: `foreground_app` = `GetForegroundWindow` -> `GetWindowThreadProcessId` -> `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` -> `QueryFullProcessImageNameW` -> `app_from_exe_path`; the lock screen (`LockApp`, `LogonUI`) and no foreground window are reported as `Some("Locked")`/`None` and the engine treats them as idle. `idle_seconds` = `GetLastInputInfo` with `GetTickCount64` (correct across the 49-day wrap). `capture_foreground_monitor` uses `xcap` on the monitor under the foreground window (the primary monitor when there is none). **No call that reads a window title.**
- `blur.rs`: `struct BlurredJpeg(Vec<u8>)`; `fn blur_and_encode(raw: RawCapture) -> Result<BlurredJpeg, BlurError>` (downscale to at most 480 px wide, Gaussian blur sigma 3, JPEG quality 60; refuse a result over 300 KB by lowering quality in steps to 30, then error); `fn capture_blurred(p: &dyn Platform) -> Result<BlurredJpeg, CaptureError>` is the only public way to get a screenshot out.

- [ ] **Step 1: Write failing tests** for `blur_and_encode`: a 1920x1080 white image with black stripes 6 px wide (text-like) comes out at most 480 px wide, starts with the JPEG bytes `FF D8 FF`, is under 300 KB, and its edge energy (sum of absolute neighbour differences) is under 10% of the input's scaled edge energy; a flat colour image survives (colour roughly preserved); a 0 x 0 image errors instead of panicking; a noisy image (worst case for size) still ends under 300 KB. Platform smoke test (`#[ignore]`): on a desktop session `foreground_app()` returns a non-empty name without `.exe`, `idle_seconds()` is a small number right after the test starts, and `capture_blurred` returns bytes with the JPEG header.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the trait, the Windows layer (`windows` crate features `Win32_UI_WindowsAndMessaging`, `Win32_System_Threading`, `Win32_UI_Input_KeyboardAndMouse`, `Win32_System_SystemInformation`, `Win32_Foundation`) and the blur. `unsupported.rs` returns errors so the crate compiles on macOS and Linux.
- [ ] **Step 4: Run** the tests, then `cargo test -- --ignored platform_smoke` once from a normal desktop terminal; confirm PASS.
- [ ] **Step 5: Commit** `feat(tracker): windows layer and screenshot blur`.

---

### Task 4: The ELEVATE client and sign-in

**Files:**
- Create: `apps/tracker/src-tauri/src/api/mod.rs` (client), `error.rs`, `token.rs`
- Test: `apps/tracker/src-tauri/tests/api_client.rs` (wiremock)

**Interfaces:**
- `struct ApiClient::new(base_url: String, app_version: String)`; every request carries `Authorization: Bearer <token>` (except enroll), `X-Tracker-Version`, and `User-Agent: ELEVATE-Tracker/<version>`; 30-second timeout; redirects are not followed for ELEVATE calls.
- `async fn enroll(&self, code: &str, name: &str) -> Result<Enrolled, ApiError>` (`POST /api/tracker/enroll` with `os: "windows"`; returns `token` and `device_id`).
- `async fn clock_state(&self, token) -> Result<ClockState, ApiError>` (`state: working|break|out`, `policy: bool`, `idleTimeoutSeconds`).
- `async fn post_segments(&self, token, batch: &[Segment], health: Health) -> Result<IngestReply, ApiError>` (`Health { permissions_ok, queue_size }` goes in the same body, as the server expects).
- `async fn request_shot`, `upload_shot` (PUT to the returned `uploadUrl`, multipart with the fields `cacheControl` and an empty-named file part, exactly as `scripts/tracker-sim.mts` does), `finalize_shot`.
- `enum ApiError { Unauthorized, PolicyOff, UpdateRequired { min_version }, TooManyRequests, Unavailable, Invalid, Rejected(String reason) }` mapped from 401, 403, 426, 429, 5xx or no network, 400, and 409 with its `error` reason.
- `token.rs`: `save_token(&str)`, `load_token() -> Option<String>`, `clear_token()` over `keyring` (service `ELEVATE Tracker App`, user `device`).

- [ ] **Step 1: Write failing tests** with a local mock server: each status maps to the right `ApiError`; the three headers are present on every call and `Authorization` is absent on enroll; a segments body contains only `start`, `end`, `app`, `state` per item (no other keys); the screenshot upload sends a multipart PUT with the `cacheControl` field; enroll with a bad code returns `Rejected("expired")` (the server's reason); the token never appears in `Debug` output of any error or struct (implement `Debug` by hand for types holding it); `token.rs` saves, loads and clears (this test is `#[ignore]`: it needs the real Credential Manager).
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the client with `reqwest` (rustls, no default native TLS) and the token store.
- [ ] **Step 4: Run** the tests, and the `#[ignore]` token test once; confirm PASS.
- [ ] **Step 5: Commit** `feat(tracker): ELEVATE client and token store`.

---

### Task 5: The offline queue and the sender

**Files:**
- Create: `apps/tracker/src-tauri/src/queue/mod.rs`, `sender.rs`
- Test: `apps/tracker/src-tauri/tests/queue.rs`, `tests/sender.rs`

**Interfaces:**
- `struct Queue::open(dir: &Path)`: SQLite (bundled `rusqlite`) with tables `segments(id, start_ms, end_ms, app, state)` and `shots(id, path, taken_at_ms, attempts)`; blurred files under `dir/shots/`. `push_segments(&[Segment])`, `next_batch(max: usize) -> Vec<(i64, Segment)>` (oldest first, at most 200), `ack(ids: &[i64])`, `push_shot(BlurredJpeg, taken_at_ms)`, `next_shot() -> Option<QueuedShot>`, `ack_shot(id)`, `len() -> (usize, usize)`, `enforce_caps(now_ms)` (drop segments older than 24 hours and keep at most 20 shots, oldest first; delete the files).
- `struct Sender` with `async fn run_once(&mut self, api: &ApiClient, token: &str, queue: &Queue, health: Health) -> SendOutcome` where `enum SendOutcome { Sent(usize), Idle, Backoff, SignedOut, UpdateRequired(String), PolicyOff }`: sends a batch and acks on success (the server drops exact duplicates, so a crash between send and ack is harmless); a batch the server rejects as invalid more than 3 times is dropped; `Unauthorized` clears nothing itself but returns `SignedOut`; `UpdateRequired` and `PolicyOff` stop sending; shots go through request, upload, finalize and are removed on success, and a `window_used`, `not_working` or `too_old` answer discards the shot.

- [ ] **Step 1: Write failing tests**: pushed segments come back oldest first in batches of at most 200; `ack` removes only those; the same batch sent twice (simulating a crash) is accepted by the mock without double counting on our side; reopening the queue directory keeps its rows; `enforce_caps` removes day-old segments and the 21st shot with its file; the sender maps each mock answer to the right outcome and leaves the rows in place on `Backoff`; an invalid batch is dropped after the third try; shot files are deleted after a successful finalize and after a discard answer.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the queue and sender.
- [ ] **Step 4: Run** the tests; confirm PASS.
- [ ] **Step 5: Commit** `feat(tracker): offline queue and sender`.

---

### Task 6: The engine, the tray and the status window

**Files:**
- Create: `apps/tracker/src-tauri/src/engine.rs`, `state.rs`, `tray.rs`, `commands.rs`, `log.rs`
- Modify: `apps/tracker/src-tauri/src/lib.rs`, `apps/tracker/src/App.tsx`; create `apps/tracker/src/screens/SignIn.tsx`, `Status.tsx`, `Captured.tsx`
- Test: `apps/tracker/src-tauri/tests/engine.rs` (fake `Platform` and mock server), `tests/privacy_guard.rs` (source scan)

**Interfaces:**
- `engine.rs`: `struct Engine` run on a `tokio` task with a fake-able `Platform`, `ApiClient`, `Queue` and a clock: every 30 s `clock_state`; every 5 s while `working && policy` take a `Sample` (`foreground_app`, `idle_seconds`) into the `SegmentBuilder` and push finished segments to the queue; every 60 s flush the open segment's finished part and run `Sender::run_once`; every tick ask `ShotPlan::due`, capture with `capture_blurred`, queue it; when the state leaves `working`, flush and stop sampling immediately; on `SignedOut` clear the token and show sign-in; on `UpdateRequired` show the required-update screen and stop sending; on a long gap treat as sleep (rule in Global Constraints); the lock screen counts as idle; `Backoff` between failed network calls.
- `commands.rs` (Tauri commands): `enroll(code)`, `status() -> StatusView { signed_in, state, policy, last_sent_ms, queue_len, version, update_required }`, `captured_today() -> Vec<{ app, start_ms, minutes }>` (from a local 24-hour history table of finished segments; app names and times only) and `last_shot_thumbnail() -> Option<Vec<u8>>`, `disconnect()` (clears the token and the queue after a confirmation in the window).
- Tray: icon with four states (tracking, waiting/clocked out, offline, needs update), menu "Open", "Check for updates", "Quit". Closing the window hides it. `tauri-plugin-single-instance` (a second start shows the window) and `tauri-plugin-autostart` (turned on after a successful enrollment).
- `log.rs`: a file logger (1 MB, one rotation) with a type-restricted API: `log_event(Event)` where `Event` is an enum of counts, states and error kinds with no string fields that could hold an app name.
- `privacy_guard.rs`: reads every `.rs` file under `src/` and fails if it finds `GetWindowText`, `window_title`, `.title(` on a foreground-window value, `println!`, `eprintln!`, `dbg!`, or a `log_event`/`tracing`/`log::` call whose arguments mention `app` or `segment` outside an allowlist file; and fails if `capture/` exports anything that returns a `RawCapture` outside the module.

- [ ] **Step 1: Write failing tests**: with a fake platform and a mock server (`working` for 2 minutes, then `out`): segments appear in the queue and are sent; after `out` no more samples are taken (assert the fake platform is not called again); a `break` answer does the same; a 426 answer stops sending and sets `update_required`; a 401 answer clears the token; with the fake clock jumping 10 minutes (sleep) no segment spans the gap; the lock screen app name produces idle time; `enroll` with a good code stores the token and a following `clock_state` call uses it; `captured_today` returns only app names and minutes. `privacy_guard` first fails on a deliberately planted `println!` in a scratch copy of the check (a test of the test), then passes on the real source.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the engine, tray, commands, logger and the three screens (sign-in with a code, status with a plain "What it records" panel, and "What was captured today": app names with minutes, the last blurred screenshot, and a short sentence on what is never recorded). Copy in plain sentence case; the product is "ELEVATE Tracker App".
- [ ] **Step 4: Run** `pnpm --filter elevate-tracker test:rust` and `pnpm --filter elevate-tracker typecheck`; confirm PASS.
- [ ] **Step 5: Commit** `feat(tracker): engine, tray and status window`.

---

### Task 7: Updates and "What's new"

**Files:**
- Create: `apps/tracker/src-tauri/src/updates.rs`; `apps/tracker/src/screens/WhatsNew.tsx`, `RequiredUpdate.tsx`
- Modify: `apps/tracker/src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts`, `plugins.updater.pubkey` and `endpoints`), `apps/tracker/src-tauri/Cargo.toml`, `capabilities/default.json`
- Test: `apps/tracker/src-tauri/tests/updates.rs`

**Interfaces:**
- Config: `plugins.updater.endpoints = ["<base>/api/tracker/update?platform={{target}}-{{arch}}&version={{current_version}}"]` (`windows-x86_64`), the public key from `pnpm tauri signer generate -w <path>` committed as text, `windows.installMode` "passive" and the NSIS installer set to per-user (`currentUser`).
- `updates.rs`: the updater is built in Rust so it can add `Authorization: Bearer <token>` and `X-Tracker-Version`; `fn should_install_now(state: ClockStateKind, required: bool, ready: bool) -> bool` (install at once when the update is required, otherwise only when not `working` so a shift is never interrupted); `check_for_updates()` runs at start, every 6 hours, from the tray menu and when a call answers 426; after an update `fn whats_new_due(last_seen: Option<&str>, current: &str) -> bool` then `GET /api/tracker/releases/<current>` and the window shows the notes once (`last_seen_version` stored beside the queue).
- The ELEVATE update route answers a 302 to a storage link: the updater is configured so the `Authorization` header is dropped on a redirect to another host (verify with the mock server, which serves the redirect on a second port).

- [ ] **Step 1: Write failing tests**: `should_install_now` over all combinations (required while working installs; optional while working waits; optional while out installs); `whats_new_due(None, "1.0.0")` false on a first install and `whats_new_due(Some("1.0.0"), "1.1.0")` true; against the mock server: the update request carries the token and version headers, a 204 means no update, a signature that does not match the app's key is refused and nothing is run, the token is not sent to the second host after a redirect, and a feed offering an older or equal version is ignored.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Generate the signing key pair** with `pnpm --filter elevate-tracker tauri signer generate -w "$HOME/.tauri/elevate-tracker.key"` (with a password the owner chooses), commit only the public key, and give the owner exact instructions to store the private key and password as GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` and in the password manager (losing the key means existing installs can never update). **Never print or commit the private key.**
- [ ] **Step 4: Implement** the updater logic and the two screens (What's new lists Added, Improved and Fixed from the server; Required update says the app will not send anything until it is updated, with an Update now button).
- [ ] **Step 5: Run** the tests and `pnpm --filter elevate-tracker typecheck`; confirm PASS.
- [ ] **Step 6: Commit** `feat(tracker): updates and what's new`.

---

### Task 8: The installer and the build workflow

**Files:**
- Modify: `apps/tracker/src-tauri/tauri.conf.json` (`bundle.targets: ["nsis"]`, icons, NSIS options, `copyright`, `shortDescription`)
- Create: `.github/workflows/tracker.yml`, `apps/tracker/scripts/release-notes.md` (template), `apps/tracker/README.md`
- Test: the workflow itself on a pushed branch (owner pushes), `apps/tracker/src-tauri/tests/config_guard.rs`

**Interfaces:**
- `.github/workflows/tracker.yml`: triggers `workflow_dispatch` and tags `tracker-v*`. Job `windows` on `windows-latest`: checkout, Node (from `.nvmrc`), pnpm, Rust stable with cache, `pnpm install --frozen-lockfile --filter elevate-tracker...`, `pnpm --filter elevate-tracker typecheck`, `pnpm --filter elevate-tracker test:rust`, then `pnpm --filter elevate-tracker build:win` with `TAURI_SIGNING_PRIVATE_KEY` and its password from secrets, then a step that computes SHA-256 of the installer and the `.sig`, and uploads `*-setup.exe`, `*-setup.exe.sig` and a `SHA256SUMS.txt` as run artifacts (14-day retention). A Windows code-signing step is present but gated on its secrets existing (skipped with a notice until the owner has a certificate). A `macos` job exists as a commented placeholder for Phase 4.
- `config_guard.rs`: asserts `tauri.conf.json` has per-user NSIS install, updater `pubkey` non-empty, endpoints HTTPS (the dev override is code-only), `createUpdaterArtifacts` true, and no `devtools` in the release config.
- Hand-off documented in `apps/tracker/README.md`: download the run's artifacts, then `pnpm tracker:build --kind installer` (the setup file) and `pnpm tracker:build --kind update` (the same setup file with `--sig`) for the release the owner created as a draft, then Publish.

- [ ] **Step 1: Write the failing test** `config_guard.rs`.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the config changes, the workflow and the README. Run `pnpm --filter elevate-tracker build:win` locally with the signing key in the environment (owner supplies it for this one command) and confirm it produces `*-setup.exe` and `.sig` under `src-tauri/target/release/bundle/nsis/`.
- [ ] **Step 4: Run** the tests; confirm PASS; run the produced installer on this machine (it is unsigned, so Windows SmartScreen will show its warning: record exactly what it shows) and confirm it installs without an administrator prompt, creates a Start menu entry, and uninstalls cleanly (with the local-data question).
- [ ] **Step 5: Commit** `feat(tracker): installer and build workflow`.

---

### Task 9: End to end against the local ELEVATE, documents, and measurements

**Files:**
- Modify: `docs/modules/activity-tracker.md`, `CLAUDE.md` (one line), `docs/RUNBOOK.md`, `content/help/attendance/your-tracker-day.md` (real install steps, including what an unsigned build shows), create `apps/elevate/content/help/attendance/tracker-troubleshooting.md`
- Test: manual, recorded in the module notes

- [ ] **Step 1: Prepare the local stack** (ask the owner before touching the shared dev database): `pnpm db:migrate`, publish a monitoring policy locally, `pnpm storage:setup`, start `pnpm dev`, sign in as a seed employee, clock in, create an enrollment code.
- [ ] **Step 2: Run the installed app** (build the release, install it, point it at the local server with the debug-only base URL override), enter the code, and watch: the status window turns to "Recording"; use two or three programs for about 15 minutes; then in ELEVATE look at My day (timeline, apps, a blurred screenshot) and the Live floor as the lead; **open the stored screenshot and check by eye that on-screen text cannot be read.**
- [ ] **Step 3: Check the hard cases** by hand: lock the screen for 5 minutes (shows as idle), put the laptop to sleep and wake it (no segment across the gap), take it offline for 5 minutes then reconnect (the queue drains, no duplicates in My day), clock out and in again (recording stops and resumes at once), revoke the device from the Devices page (the app returns to sign-in), publish a newer release and watch the app update (and show What's new), publish a "Required update" and watch the app refuse to send until it updates.
- [ ] **Step 3b: Measure**: with Task Manager or `Get-Process`, record CPU and memory over 30 minutes of tracking; confirm the budget in Global Constraints. Check Windows Security shows no detection, and note any warning verbatim.
- [ ] **Step 4: Write** the docs and guides with the real button names and the measured numbers; record what was and was not tested (including: macOS not tested, no code signing, which Windows versions were tried).
- [ ] **Step 5: Full gate**: `cargo test`, `pnpm lint && pnpm typecheck && pnpm test` at the root, `pnpm test:integration`, and the GitHub Actions run on the owner's push. Commit `docs(tracker): windows app guides and live check`.

---

## Self-review

- **Spec coverage:** active app and idle recording while clocked in (Tasks 2, 3, 6); blurred screenshots about every 10 minutes (Tasks 2, 3, 5, 6); offline queue and safe resend (Task 5); enrolling with a code and a revocable token (Tasks 4, 6); app-name-only and no title ever (Global Constraints, Task 3, the privacy guard in Task 6); "What was captured" for the person (Task 6); updates, "What's new" and the required-update floor (Task 7); installer, per-user, build workflow, update signing (Task 8); the SmartScreen reality of an unsigned build is recorded, not hidden (Tasks 8 and 9). **Not here, by decision:** macOS (a stub only; the coworker will test it in Phase 4), signing certificates, an in-app pause button, Linux.
- **Types:** `Segment`, `Sample`, `State`, `ShotPlan`, `BlurredJpeg`, `Platform`, `ApiError`, `SendOutcome`, `StatusView` are each defined once and used by name in later tasks; `Segment` serializes to the server's `start`, `end`, `app`, `state`.
- **Honest limits:** the Windows layer and the blur are covered by unit tests plus one by-eye check of a real capture. Whether antivirus products react, how it behaves on other Windows versions, DPI and multi-monitor setups, and any Mac behavior can only be learned by running it on other computers, which Task 9 and the coworker are for. The updater's behavior (including dropping `Authorization` on a cross-host redirect) is tested against a mock; it must also be seen working once against the real ELEVATE routes. The Tauri configuration keys and plugin APIs named here follow the Tauri 2 documentation checked on 2026-11-20 and may need small adjustments when written.
- **Decisions to confirm:** (1) the screenshot is of the monitor holding the foreground window, not all monitors; (2) the blur is strong (480 px wide, sigma 3), so a lead sees layout and colour, not text; (3) the lock screen counts as idle; (4) the app has no pause button; (5) uninstalling offers to delete local data.
