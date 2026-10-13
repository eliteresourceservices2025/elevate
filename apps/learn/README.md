# ELEVATE Learn

The training app for ELEVATE (HIPAA training first). A separate minimal Next.js app, deployed as its own project on its own
subdomain (`learn.eliteresourceservices.com`), so its exam and training records stay apart from the HR app.

- People arrive from ELEVATE through a **one-time sign-in handoff** (a POST with a 60-second, single-use token). Learn has no
  Supabase keys, no passwords and never sees an ELEVATE cookie.
- It talks to one database role (`learn_app`) that can reach only the `learn` schema, and cannot read the exam answer key.
- Leads see only "passed / not yet"; scores belong to the person, HR and the designated Privacy Officer.

**Status: scaffold only.** Nothing is built yet beyond a placeholder page. The full plan is in `docs/learn/`.

```bash
pnpm --filter learn dev      # http://localhost:3200
pnpm --filter learn test
```

Plan and decisions: `docs/learn/README.md` (start there). Rules for working in this folder: `CLAUDE.md`.
