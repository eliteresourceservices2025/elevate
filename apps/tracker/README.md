# ELEVATE Tracker App

A small Windows tray app (Tauri 2, Rust core, React window). Where it fits: ELEVATE stays the one ledger of hours. This app only
(1) lets a person clock in, take breaks and clock out through ELEVATE's own clock, and (2) while they are clocked in, notes which program
is in front and whether they are active or idle, and takes a **blurred** picture of all their screens about every 10 minutes.

Design and rules: `docs/superpowers/specs/2026-11-19-elevate-tracker-design.md`, the working notes in `docs/modules/activity-tracker.md`, and
the plan this was built from, `docs/superpowers/plans/2026-11-20-elevate-tracker-phase3-windows-app.md`.

## What it never does

- Reads a window title, a web address, a keystroke or the clipboard (a source scan fails the build if the code could).
- Clocks anyone by itself. Only a click sends a clock request.
- Keeps an unblurred picture: the blur happens in memory, before anything reaches the disk or the network.
- Sends the device token anywhere but ELEVATE.

## Develop

```powershell
pnpm install
pnpm --filter elevate-tracker tauri dev        # the app, talking to http://localhost:3000 (a debug build only)
pnpm --filter elevate-tracker dev              # just the window in a browser; ?mock=working|break|out|offline|blocked|signedout|update|whatsnew
pnpm --filter elevate-tracker typecheck        # the window's TypeScript (this is what CI runs for everyone)
pnpm --filter elevate-tracker test:rust        # the Rust tests (they need no desktop and no ELEVATE)
cargo test --manifest-path apps/tracker/src-tauri/Cargo.toml -- --ignored   # tests that need a real desktop / Credential Manager
```

Needs Rust (stable, MSVC) and the Visual Studio C++ Build Tools. The first build compiles Tauri and takes 10 to 20 minutes.

A release build talks to `https://elevate.eliteresourceservices.com`. To point a build somewhere else (a staging site) set
`ELEVATE_TRACKER_BASE_URL` when building. Plain `http` is only accepted for this computer, and only in a debug build.

## Build the installer

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "<path to your update signing key>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<its password>"
pnpm --filter elevate-tracker build:win
```

It produces, under `apps/tracker/src-tauri/target/release/bundle/nsis/`, `ELEVATE Tracker App_<version>_x64-setup.exe` and its
`.sig`. The installer is per-user: no administrator rights, a Start menu entry, and it appears in "Installed apps".

The same build runs on GitHub: **Actions > ELEVATE Tracker App (Windows build) > Run workflow** (or push a tag `tracker-v1.2.0`). It runs
the checks, builds, and keeps `*-setup.exe`, `*-setup.exe.sig` and `SHA256SUMS.txt` as run artifacts for 14 days. It never publishes.

### The update signing key (do this once, before the first real release)

The app only ever installs an update that is signed with the key whose **public** half is in `src-tauri/updater.pub`.

1. Make the key: `pnpm --filter elevate-tracker tauri signer generate -w "<a path outside the repository>"` and choose a strong password.
2. Replace the text in `src-tauri/updater.pub` with the new `.pub` file's contents and commit that (it is public).
3. Store the private key file and the password in the company password manager, and as GitHub Actions secrets named
   `TAURI_SIGNING_PRIVATE_KEY` (the key's contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

**If the private key is lost, installed copies can never be updated** (they would have to be installed again by hand). Never commit it,
print it in a log, or send it in chat. The key made while this was built is a development key with no password; do not use it.

### Windows code signing (not set up yet)

Without a code-signing certificate Windows SmartScreen warns before running the installer ("Windows protected your PC": More info > Run
anyway). Everything else works. Once the company has a certificate, add its `.pfx` (base64) and password as the secrets
`WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`; the workflow then signs inside the build, before the update signature is made
(the order matters: signing afterwards would break the update signature). That step has not been run yet.

## Release hand-off (from a build to people's computers)

1. In ELEVATE: **Settings > ELEVATE Tracker > Releases > New release**, with the version number (higher than every earlier one) and
   the notes (see `scripts/release-notes.md`). It starts as a draft.
2. Download the run's artifacts. From the repository root, register the two files on that draft:

   ```powershell
   pnpm tracker:build --version 1.2.0 --platform windows-x86_64 --kind installer --file "<setup file>"
   pnpm tracker:build --version 1.2.0 --platform windows-x86_64 --kind update    --file "<the same setup file>" --sig "<its .sig file>"
   ```

   The installer is what people download; the update file is what installed apps fetch (the same setup file, with its signature).
3. In ELEVATE, open the release and **Publish**. Installed apps are offered it within 6 hours, or at once from the tray's
   "Check for updates"; a required update installs immediately, an optional one when the person is not working.

A bad release is withdrawn in ELEVATE, never deleted; publish the fix as a new, higher version.

## Uninstalling

Settings > Apps > Installed apps > ELEVATE Tracker App > Uninstall.

- The saved sign-in (Windows Credential Manager) and the start-with-Windows entry are **always** removed.
- The uninstaller shows a box, **Delete the application data**, unchecked by default. Checked, it also deletes the waiting queue and the
  local history (`%APPDATA%\com.eliteresourceservices.elevate-tracker`). That loses only activity that was not yet sent, and HR would see a
  gap flagged "Tracker offline"; **hours in ELEVATE are never affected**.
- Nothing is removed during an update, so an update never signs anyone out.

For a quiet uninstall in a script: `"%LOCALAPPDATA%\ELEVATE Tracker App\uninstall.exe" /S`. A quiet uninstall removes the saved sign-in but
**never** the application data (this version of the installer only reads the box from its dialog); delete that folder by hand if needed.

## Where things are

| Path | What |
|---|---|
| `src-tauri/src/core/` | Pure rules: segments, app names, the screenshot schedule, backoff, versions |
| `src-tauri/src/platform/` | The Windows layer (front program name, idle time, screens); a stub elsewhere |
| `src-tauri/src/capture/` | Compose all monitors, scale, blur, JPEG: the only way a picture leaves |
| `src-tauri/src/api/` | The only door to ELEVATE, and the token store |
| `src-tauri/src/queue/` | The offline queue (SQLite) and the sender |
| `src-tauri/src/engine.rs` | What to do each second |
| `src-tauri/src/controller.rs` | Sign in, the clock buttons, disconnect |
| `src-tauri/src/updates.rs`, `update_task.rs` | Check, download, verify, install |
| `src-tauri/tests/` | Integration tests (mock ELEVATE), the privacy scan and the config guard |
| `src/` | The window (React) |

macOS is Phase 4: the platform layer has a stub so the crate builds there, and a coworker will test the Mac build.
