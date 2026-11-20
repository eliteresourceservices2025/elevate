# ELEVATE Tracker App, Phase 3 (the Windows app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Windows version of the ELEVATE Tracker App: a small tray app where a person can clock in, take breaks and clock out, and that, while they are clocked in, records which app they use and whether they are active or idle, takes a blurred screenshot of all their screens about every 10 minutes, and sends both to ELEVATE, updating itself from ELEVATE's own release feed.

**Architecture:** A Tauri 2 app in `apps/tracker/` (Rust core and Windows layer, a tiny React status window). The Rust core is split so the logic that matters is pure and unit-tested (turning samples into segments, scheduling screenshots, blurring, retry rules), and the Windows-only parts (foreground app, idle time, screen capture) sit behind one `Platform` trait so macOS can be added in Phase 4. The app only ever asks ELEVATE what to do (`/api/tracker/*`). ELEVATE stays the one ledger of hours: the app's Clock in, Break and Clock out buttons call a new device clock route that runs the same rules as the web clock (server time, request IP, leave, team rules), and the app never clocks anyone by itself. An on-disk queue keeps activity safe while offline.

**Tech Stack:** Rust (stable, MSVC toolchain), Tauri 2 (`tauri-plugin-updater`, `single-instance`, `autostart`), `windows` crate, `xcap` (screen capture), `image` (downscale, blur, JPEG), `reqwest` with rustls, `rusqlite` (bundled), `keyring`, `tokio`, `wiremock` and `tempfile` for tests; React + Vite + TypeScript for the one window; GitHub Actions for builds.

**Spec:** `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`. The server side the app talks to: `docs/superpowers/plans/2026-11-19-elevate-tracker-phase1-server.md` (device API) and `...phase2b-download-releases.md` (update feed, version floor). API reference: `docs/modules/activity-tracker.md`.

All paths are relative to the repo root unless they start with `apps/tracker/`.

## Global Constraints

- **App name only.** The app never reads a window title, URL, keystroke, clipboard or the contents of any window. The Windows layer uses no `GetWindowText*` or title API at all, so this is true by construction, and a source-scan test enforces it. The app name is the foreground program's file name without `.exe`, cleaned like the server's `sanitizeApp` (control characters removed, spaces collapsed, at most 80 characters).
- **No unblurred pixels are ever kept.** A screenshot is captured in memory (all monitors), combined, scaled to at most 1600 px wide, blurred lightly, encoded as JPEG (quality 60, at most 300 KB) and only then may touch disk. The capture function returns only a `BlurredJpeg`; there is no code path that saves a raw capture. The blur is "not too strong" by the owner's choice: a lead can see what kind of screen it is (browser, spreadsheet, chat) and large headings, but ordinary body text is unreadable (measured in Task 3 and looked at by eye in Task 9). The strength is one constant so it can be tuned.
- **Only while the server says "working".** The app polls `GET /api/tracker/clock-state` every 30 seconds and samples only when `state = "working"` and `policy = true`; it records nothing on a break, when clocked out, or when the policy is off.
- **The app never clocks anyone by itself.** The only thing that sends a clock action is the person clicking Clock in, Start break, End break or Clock out (in the window or the tray menu). Start, idle, lock, sleep, sign-in, going offline and updates never clock anyone in or out. ELEVATE validates and timestamps every action; the app shows ELEVATE's own refusal message when it says no.
- **Network:** only the ELEVATE base URL (compile-time `ELEVATE_TRACKER_BASE_URL`, default the production address) and the storage links ELEVATE returns. HTTPS only (HTTP allowed only to `localhost` in debug builds). No analytics, no crash reporting, no third-party calls.
- **Secrets:** the device token lives only in Windows Credential Manager (`keyring`). It is never written to a file, a log or the queue. The update signing private key is never committed; only the public key is in `tauri.conf.json`.
- **Logs and local files hold no app names.** The log (a file under the app data folder, 1 MB, rotated) contains counts, states and error kinds only. The queue database holds app names and times (it is what is waiting to be sent) and nothing else.
- **Segments:** at most 30 minutes each; same program and state within 15 seconds of each other merge; a gap of more than 60 seconds between samples (sleep, lid closed) ends the segment at the last sample, and no time is invented across it. Sampling every 5 seconds; idle after the server's `idleTimeoutSeconds` (default 180) without input.
- **Screenshots:** one per 10-minute window at a random moment inside it, of **all monitors** laid out as on the desktop in one picture; a failed one is retried inside the same window, then skipped.
- **Windows 10 21H2 or newer, per-user install (no administrator rights needed).** Resource budget: under 1% of one CPU on average and under 80 MB of memory while tracking.
- **Version:** one source of truth, `apps/tracker/src-tauri/tauri.conf.json` (`version`), mirrored into `package.json` and `Cargo.toml` by a test. Sent on every request as `X-Tracker-Version` and in the User-Agent `ELEVATE-Tracker/<version>`.
- **Existing CI must keep passing.** `pnpm -r lint|typecheck|test` run in every workspace package on an Ubuntu runner with no Rust. `apps/tracker/package.json` therefore defines only a Node `typecheck` (the TypeScript window); the Rust tests run as `test:rust` in their own Windows workflow.
- **Not in this phase:** macOS (a stub `Platform` only; a coworker will test it in Phase 4), code signing certificates (Windows or Apple; builds are unsigned until they exist), switching client mid-shift from the app (use the web page), Linux. If the person's team requires a clock-in selfie, or the person's hours come from Jibble, the app's clock buttons are off with ELEVATE's reason ("clock in on the ELEVATE page").
- **Uninstalling is safe by default:** the uninstaller always removes the device's saved sign-in (Credential Manager), and offers a "Delete the application data" checkbox (unchecked) for the local queue and history. Deleting it only loses activity that was not yet sent: hours are unaffected, and HR would see a gap flagged "Tracker offline".

## Review Focus

- A window title, URL or any app name reaching a log, the queue's file name, an error message, or the network in any field other than `app` of a segment.
- A raw screenshot touching disk or being held after blurring; a blur that leaves text readable (the test uses a text-like pattern, and the live check looks at a real capture).
- Sleep and resume, the system clock moving backwards or forwards, a locked screen (the lock screen must count as idle, not as an app), and several monitors of different sizes, including one placed above or to the left of the main one (the combined picture must keep the layout and stay under 300 KB).
- The clock buttons: a double click sends one action, not two; an offline click says so and sends nothing; a refusal from ELEVATE (already clocked in, on leave, selfie needed, Jibble clock, rate limit) is shown in plain words; the server's time and IP are the ones recorded (the request carries no time); an out-of-date app can still clock someone in and out (time keeping is never blocked by the version floor); no automatic path (start, idle, lock, sleep, update, sign-in) ever sends a clock action.
- The server answers `out` or `break` mid-batch: sampling stops at once and nothing is recorded after it.
- 401 (token revoked), 403 (policy off), 426 (update required), 429 and 5xx or no network: no tight retry loops, no memory growth, the queue stays within its cap, and a crash between "sent" and "deleted" resends harmlessly (the server drops exact duplicates).
- The updater: never installs an older version, verifies its signature against the key in the app, uses HTTPS only, and the device token is not forwarded to the storage host when the update link redirects there.
- Two copies of the app, starting at login, closing the window (must hide to the tray, not quit), and uninstalling (offer to remove local data).
- Idle cost: CPU and memory over a 30-minute run.

---

### Task 0: The clock for the app (server side, in ELEVATE)

The app has no sign-in session, only a device token, so it cannot use the web clock's server actions. This task adds a device clock route that calls the same `performClock` the web clock uses, so every rule stays in one place.

**Files:**
- Create: `apps/elevate/src/app/api/tracker/clock/route.ts`
- Modify: `apps/elevate/src/modules/attendance/service.ts` (`ClockInput` gains `via?: "web" | "tracker_app"`, written into the audit row's metadata only), `apps/elevate/src/modules/activity/ingest.ts` (`clockStateFor` returns more), `apps/elevate/src/modules/activity/validators.ts` (`clockBodySchema`), `apps/elevate/src/modules/activity/route-helpers.ts` (nothing new, reused), `docs/modules/activity-tracker.md`
- Test: `apps/elevate/src/app/api/tracker/clock-route.test.ts`, `apps/elevate/tests/integration/activity-clock.test.ts`

**Interfaces:**
- `POST /api/tracker/clock` (device token; exempt from the version floor, so an out-of-date app can still keep time; rate limited like the web clock): body `{ action: "clock_in" | "break_start" | "break_end" | "clock_out", clientId?: uuid, breakMinutes?: 15 | 30 | 60 }` (Zod; any other field, including any time, is ignored). It loads the person from the device, calls `performClock({ id: userId, email }, action, { clientId, breakMinutes, via: "tracker_app" })`, and answers `200 { state, at, outsideAllowedRange }`. An `ActionFailure` from `performClock` (already clocked in, on leave, selfie required, Jibble clock, too many actions, not assigned to that client...) answers `409 { error: "refused", message }` with ELEVATE's own plain-English message. A device whose person has no people record or no linked sign-in: `403 { error: "no_person" }`. Time is the server's `clock_timestamp()` and the IP is the request's, exactly as for the web clock.
- `clockStateFor(employeeId)` additionally returns `clients: { id: string; name: string }[]` (the person's assigned clients, from `assignedClients`), `workingSince: string | null`, `onBreak: { startedAt: string; plannedMinutes: number | null } | null`, and `clockBlockedReason: "jibble" | "selfie" | null` (so the app can switch its clock buttons off and say why).

- [ ] **Step 1: Write failing tests.** Route tests (mocked service): 401 without a token; 400 for an unknown action or a bad `breakMinutes`; the body's extra fields (`at`, `occurredAt`, `ip`) never reach `performClock`; 200 body shape; a refusal becomes `409 { error: "refused", message }`; a 426-floor header does not block it; the route is not rate-limited by the ingest policy (the clock has its own). Integration tests with real data (mock `next/headers` for the request IP as in `tests/integration/attendance.test.ts`): clock in records one event with the server's time and the request's IP and `source = 'web'`, and the audit row says `via: "tracker_app"`; a second clock in is refused with the web clock's message; start break then end break; clock out while on a break ends the break too; a person with two assigned clients must send `clientId` and an unassigned client is refused; a Jibble-clock person is refused with the Jibble message and `clockStateFor` reports `clockBlockedReason: "jibble"`; a team that requires a selfie is refused and reported as `"selfie"`; a person on approved leave is refused; a revoked device gets 401; `clockStateFor` returns `onBreak` while on a break and the clients list.
- [ ] **Step 2: Run** `pnpm vitest run src/app/api/tracker/clock-route.test.ts` and `pnpm vitest run --config vitest.integration.config.mts activity-clock`; confirm FAIL.
- [ ] **Step 3: Implement** the route (using `deviceRoute` with `exemptFromFloor: true`), the schema, the `via` field and the richer `clockStateFor`. Add `revalidatePath("/attendance")` and `"/dashboard"` after a successful clock action, as the web clock does.
- [ ] **Step 4: Run** the new tests, the existing attendance and activity integration tests (`pnpm vitest run --config vitest.integration.config.mts attendance activity`), `pnpm typecheck` and `pnpm lint`; confirm PASS.
- [ ] **Step 5: Commit** `feat(activity): device clock route for the tracker app`.

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
- `trait Platform { fn foreground_app(&self) -> Option<String>; fn idle_seconds(&self) -> u32; fn capture_all_monitors(&self) -> Result<Vec<MonitorShot>, CaptureError>; }` with `struct MonitorShot { x: i32, y: i32, width: u32, height: u32, rgba: Vec<u8> }` (the monitor's position on the virtual desktop; never leaves the `capture` module).
- `windows.rs`: `foreground_app` = `GetForegroundWindow` -> `GetWindowThreadProcessId` -> `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` -> `QueryFullProcessImageNameW` -> `app_from_exe_path`; the lock screen (`LockApp`, `LogonUI`) and no foreground window are reported as `Some("Locked")`/`None` and the engine treats them as idle. `idle_seconds` = `GetLastInputInfo` with `GetTickCount64` (correct across the 49-day wrap). `capture_all_monitors` uses `xcap` to capture every monitor with its position. **No call that reads a window title.**
- `blur.rs`: `struct BlurredJpeg(Vec<u8>)`; `fn compose(shots: Vec<MonitorShot>) -> Result<RawCanvas, BlurError>` (places the monitors on one canvas by their desktop positions, black where there is no monitor); `fn blur_and_encode(canvas: RawCanvas) -> Result<BlurredJpeg, BlurError>` (scale down uniformly so the width is at most 1600 px, never up; Gaussian blur with `BLUR_SIGMA = 2.5` at that output size; JPEG quality 60, lowered in steps to 35 if the result is over 300 KB, then an error); `fn capture_blurred(p: &dyn Platform) -> Result<BlurredJpeg, CaptureError>` is the only public way to get a screenshot out. `BLUR_SIGMA` is one named constant so the owner can tune it after looking at real captures.

- [ ] **Step 1: Write failing tests.** `compose`: two 1920x1080 monitors side by side become a 3840x1080 canvas; a second monitor placed above the first (negative y) and one to the left (negative x) keep their relative positions; a gap between monitors is black; no monitors is an error. `blur_and_encode`: a 1920x1080 white image with **thin text-like strokes** (1 px lines every 4 px in blocks) comes out at most 1600 px wide, starts with the JPEG bytes `FF D8 FF`, is under 300 KB, and its edge energy (sum of absolute neighbour differences) is under 15% of the same image without blur at the same size (body text is unreadable); the same image with **wide bars** (24 px thick, a heading's size) keeps at least 50% of its edge energy (big shapes and large headings survive, which is the "not too strong" requirement); a flat colour image keeps its colour; a 0 x 0 canvas errors instead of panicking; a noisy 3840x1080 canvas (worst case for size) still ends under 300 KB. Platform smoke test (`#[ignore]`): on a desktop session `foreground_app()` returns a non-empty name without `.exe`, `idle_seconds()` is a small number right after the test starts, and `capture_blurred` returns bytes with the JPEG header and a width of at most 1600.
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
- `async fn clock_state(&self, token) -> Result<ClockState, ApiError>` (`state: working|break|out`, `policy: bool`, `idleTimeoutSeconds`, plus Task 0's `clients`, `workingSince`, `onBreak`, `clockBlockedReason`).
- `async fn clock(&self, token, action: ClockAction) -> Result<ClockReply, ApiError>` (`POST /api/tracker/clock`; `ClockAction` is `ClockIn { client_id: Option<String> }`, `StartBreak { minutes: Option<u8> }`, `EndBreak`, `ClockOut`; the body holds nothing else, never a time). A 409 `refused` becomes `ApiError::Refused { message }` carrying ELEVATE's own sentence.
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
- `commands.rs` (Tauri commands): `enroll(code)`, `clock_in(client_id: Option<String>)`, `start_break(minutes: Option<u8>)`, `end_break()`, `clock_out()` (each sends exactly one `POST /clock`, refuses a second click while one is in flight, answers with ELEVATE's new state or its refusal sentence, and refreshes `clock_state` at once; an offline click returns "You are offline. Try again when you are connected." and sends nothing), `status() -> StatusView { signed_in, state, policy, last_sent_ms, queue_len, version, update_required, clients, working_since, on_break, clock_blocked_reason }`, `captured_today() -> Vec<{ app, start_ms, minutes }>` (from a local 24-hour history table of finished segments; app names and times only) and `last_shot_thumbnail() -> Option<Vec<u8>>`, `disconnect()` (clears the token and the queue after a confirmation in the window).
- Tray: icon with four states (tracking, waiting/clocked out, offline, needs update), menu "Open", then the clock actions that fit the state ("Clock in", or "Start break" with 15 minutes, 30 minutes, 1 hour and no limit, or "End break", and "Clock out"; greyed out with the reason when `clock_blocked_reason` is set), "Check for updates", "Quit". The window's Clock panel shows the same: the state in words ("Working since 9:05 AM", "On a break since 11:30 AM, 30 minutes"), a client choice when the person has more than one client, and the buttons. Closing the window hides it. `tauri-plugin-single-instance` (a second start shows the window) and `tauri-plugin-autostart` (turned on after a successful enrollment).
- `log.rs`: a file logger (1 MB, one rotation) with a type-restricted API: `log_event(Event)` where `Event` is an enum of counts, states and error kinds with no string fields that could hold an app name.
- `privacy_guard.rs`: reads every `.rs` file under `src/` and fails if it finds `GetWindowText`, `window_title`, `.title(` on a foreground-window value, `println!`, `eprintln!`, `dbg!`, or a `log_event`/`tracing`/`log::` call whose arguments mention `app` or `segment` outside an allowlist file; and fails if `capture/` exports anything that returns a `RawCapture` outside the module.

- [ ] **Step 1: Write failing tests**: with a fake platform and a mock server (`working` for 2 minutes, then `out`): segments appear in the queue and are sent; after `out` no more samples are taken (assert the fake platform is not called again); a `break` answer does the same; a 426 answer stops sending and sets `update_required`; a 401 answer clears the token; with the fake clock jumping 10 minutes (sleep) no segment spans the gap; the lock screen app name produces idle time; `enroll` with a good code stores the token and a following `clock_state` call uses it; `captured_today` returns only app names and minutes. Clock controls: clicking Clock in sends exactly one `POST /clock` with `{ action: "clock_in" }` (and the chosen client when there are several); a double click still sends one; a 409 shows ELEVATE's message and changes nothing; an offline click sends nothing and says so; **over a whole simulated day of starting, sleeping, locking, going idle, signing in, updating and going offline, no clock request is ever sent unless a command was invoked** (the mock server counts `/clock` calls); the clock buttons are off with the reason when `clock_blocked_reason` is set. `privacy_guard` first fails on a deliberately planted `println!` in a scratch copy of the check (a test of the test), then passes on the real source.
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
- Uninstall behaviour: an NSIS hook (`installerHooks`, `NSIS_HOOK_POSTUNINSTALL`) always removes the saved device sign-in from Credential Manager (`cmdkey /delete:` the target the `keyring` crate uses, `device.ELEVATE Tracker App`), and Tauri's built-in "Delete the application data" checkbox (unchecked by default) offers to remove the queue and history in the app data folders. The checkbox text is shown as is; the README and the help guide say what deleting loses (activity not yet sent) and what it does not touch (hours).
- `config_guard.rs`: asserts `tauri.conf.json` has per-user NSIS install, updater `pubkey` non-empty, endpoints HTTPS (the dev override is code-only), `createUpdaterArtifacts` true, no `devtools` in the release config, and that the uninstall hook file exists, deletes the credential and names the same target the token store uses.
- Hand-off documented in `apps/tracker/README.md`: download the run's artifacts, then `pnpm tracker:build --kind installer` (the setup file) and `pnpm tracker:build --kind update` (the same setup file with `--sig`) for the release the owner created as a draft, then Publish.

- [ ] **Step 1: Write the failing test** `config_guard.rs`.
- [ ] **Step 2: Run** `pnpm --filter elevate-tracker test:rust`; confirm FAIL.
- [ ] **Step 3: Implement** the config changes, the workflow and the README. Run `pnpm --filter elevate-tracker build:win` locally with the signing key in the environment (owner supplies it for this one command) and confirm it produces `*-setup.exe` and `.sig` under `src-tauri/target/release/bundle/nsis/`.
- [ ] **Step 4: Run** the tests; confirm PASS; run the produced installer on this machine (it is unsigned, so Windows SmartScreen will show its warning: record exactly what it shows) and confirm it installs without an administrator prompt, creates a Start menu entry, and uninstalls cleanly: the sign-in is gone from Credential Manager afterwards (`cmdkey /list` no longer shows it), the "Delete the application data" box is unchecked by default, and with it checked the queue folder is gone.
- [ ] **Step 5: Commit** `feat(tracker): installer and build workflow`.

---

### Task 9: End to end against the local ELEVATE, documents, and measurements

**Files:**
- Modify: `docs/modules/activity-tracker.md`, `CLAUDE.md` (one line), `docs/RUNBOOK.md`, `content/help/attendance/your-tracker-day.md` (real install steps, including what an unsigned build shows), create `apps/elevate/content/help/attendance/tracker-troubleshooting.md`
- Test: manual, recorded in the module notes

- [ ] **Step 1: Prepare the local stack** (ask the owner before touching the shared dev database): `pnpm db:migrate`, publish a monitoring policy locally, `pnpm storage:setup`, start `pnpm dev`, sign in as a seed employee, clock in, create an enrollment code.
- [ ] **Step 2: Run the installed app** (build the release, install it, point it at the local server with the debug-only base URL override), enter the code, and watch: the status window turns to "Recording"; use two or three programs for about 15 minutes; then in ELEVATE look at My day (timeline, apps, a blurred screenshot) and the Live floor as the lead; **open the stored screenshot and check by eye that on-screen text cannot be read.**
- [ ] **Step 3: Check the hard cases** by hand: clock in from the app, start a 15-minute break and end it, clock out (ELEVATE's Attendance page shows each event with the right time, and the audit row says it came from the tracker app); try to clock in twice and with the team's selfie rule switched on (ELEVATE's message appears in the app); use **two monitors** (the screenshot shows both, in their real arrangement, and the stored picture's body text is unreadable while large headings can be made out; if the owner wants it lighter or heavier, change `BLUR_SIGMA` and look again); lock the screen for 5 minutes (shows as idle), put the laptop to sleep and wake it (no segment across the gap), take it offline for 5 minutes then reconnect (the queue drains, no duplicates in My day), clock out and in again (recording stops and resumes at once), revoke the device from the Devices page (the app returns to sign-in), publish a newer release and watch the app update (and show What's new), publish a "Required update" and watch the app refuse to send until it updates.
- [ ] **Step 3b: Measure**: with Task Manager or `Get-Process`, record CPU and memory over 30 minutes of tracking; confirm the budget in Global Constraints. Check Windows Security shows no detection, and note any warning verbatim.
- [ ] **Step 4: Write** the docs and guides with the real button names and the measured numbers; record what was and was not tested (including: macOS not tested, no code signing, which Windows versions were tried).
- [ ] **Step 5: Full gate**: `cargo test`, `pnpm lint && pnpm typecheck && pnpm test` at the root, `pnpm test:integration`, and the GitHub Actions run on the owner's push. Commit `docs(tracker): windows app guides and live check`.

---

## Self-review

- **Spec coverage:** active app and idle recording while clocked in (Tasks 2, 3, 6); blurred screenshots about every 10 minutes (Tasks 2, 3, 5, 6); offline queue and safe resend (Task 5); enrolling with a code and a revocable token (Tasks 4, 6); app-name-only and no title ever (Global Constraints, Task 3, the privacy guard in Task 6); "What was captured" for the person (Task 6); updates, "What's new" and the required-update floor (Task 7); installer, per-user, build workflow, update signing (Task 8); the SmartScreen reality of an unsigned build is recorded, not hidden (Tasks 8 and 9). **Not here, by decision:** macOS (a stub only; the coworker will test it in Phase 4), signing certificates, an in-app pause button, Linux.
- **Types:** `Segment`, `Sample`, `State`, `ShotPlan`, `BlurredJpeg`, `Platform`, `ApiError`, `SendOutcome`, `StatusView` are each defined once and used by name in later tasks; `Segment` serializes to the server's `start`, `end`, `app`, `state`.
- **Honest limits:** the Windows layer and the blur are covered by unit tests plus one by-eye check of a real capture. Whether antivirus products react, how it behaves on other Windows versions, DPI and multi-monitor setups, and any Mac behavior can only be learned by running it on other computers, which Task 9 and the coworker are for. The updater's behavior (including dropping `Authorization` on a cross-host redirect) is tested against a mock; it must also be seen working once against the real ELEVATE routes. The Tauri configuration keys and plugin APIs named here follow the Tauri 2 documentation checked on 2026-11-20 and may need small adjustments when written.
- **Decisions made with the owner (2026-11-20):** (1) screenshots show all monitors; (2) the blur is "not too strong" (up to 1600 px wide, sigma 2.5): a lead can see the kind of screen and large headings, ordinary text is unreadable. The trade-off is real: the lighter the blur, the more likely a large patient name in an on-screen banner stays readable, so Task 9 looks at real captures and the strength is one constant; (3) the lock screen counts as idle; (4) clock in, breaks and clock out are in the app (this adds Task 0: a device clock route, reusing the web clock's rules and writing `via: "tracker_app"` in the audit log; no new clock event source and no migration); (5) uninstalling always removes the saved sign-in and offers to delete the local data (unchecked by default), which is safe because it only loses activity not yet sent.
- **Also decided in writing the plan (change if you disagree):** the clock route is exempt from the version floor so an out-of-date app can still keep time; the app does not switch client mid-shift (the web page does); a team that requires a clock-in selfie, or a person whose hours come from Jibble, clocks in on the web page and the app says so.
