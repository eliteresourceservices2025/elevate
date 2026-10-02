# Safe Voice

The anonymous reporting app for ELEVATE (Phase 4.2). A separate minimal Next.js app, deployed as its own project on its own
subdomain, so the browser never sends ELEVATE login cookies with a report.

- It never reads or sets a cookie, never reads the user agent or referrer, never stores a user id, network address, device data,
  file name or time of day (only the UTC day). `src/proxy.ts` strips cookies and identifying headers before any route runs.
- It talks to one database role (`safevoice_app`) that can only reach `ops.safevoice_reports`, `ops.safevoice_messages` and
  `ops.safevoice_attachments`.
- Reporters get a random case code and passphrase (hashed with a pepper) and use them for every follow-up request. No account.
- Handlers read and answer cases inside ELEVATE (`/safe-voice-cases`), through their own restricted role.

```bash
pnpm --filter safe-voice dev      # http://localhost:3100 (needs .env.local, see .env.example)
pnpm --filter safe-voice test
```

Setup and deployment: `docs/SETUP.md` ("Safe Voice"). Operations: `docs/RUNBOOK.md` ("Safe Voice problems").
Design, decisions and limits: the "Safe Voice (Phase 4.2)" section of `CLAUDE.md`.
