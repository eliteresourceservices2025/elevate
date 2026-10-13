@AGENTS.md
# ELEVATE Learn

The training app for ELEVATE (HIPAA training first). Read `docs/learn/` before building anything here; every rule below comes
from those documents and the decisions made with the owner.

## Non-negotiables

- **No Supabase keys, no service keys, no ELEVATE secrets, no passwords.** People arrive by a one-time POST handoff from ELEVATE
  (`docs/learn/02-architecture.md`). Never read an ELEVATE cookie.
- **The browser is never trusted** for time, score, user id, version id or "completed". The server computes all of them.
- **The answer key never leaves the database.** Grading is the `learn.grade_attempt` definer function; `learn_app` cannot read
  `correct_ids` or `rationale`. A test inspects every response for key fields.
- **Evidence is append-only** (attempts, answers, attestations, certificates, progress). Published course versions are frozen.
- **Leads see only status** (passed, not yet, overdue), never a score; scores are for the person, HR and the Privacy Officer.
- **Content is data, not HTML.** Validated JSON blocks rendered as React elements; no `dangerouslySetInnerHTML`.
- **No patient information anywhere**, including examples (invented people, obviously fake data) and free-text fields.
- **No third-party scripts, fonts or trackers.** The CSP in `next.config.ts` stays strict.
- Do not add a dependency without the owner's OK. Nothing goes in browser storage except the light/dark choice (kept by
  `next-themes`, as in ELEVATE) and the exam's unsynced local answers (never the time).
- **Look and feel is ELEVATE's:** the same fonts (Inter, Source Sans 3 headings, JetBrains Mono, via `next/font`), the same colour
  tokens and the same light / device / dark switch. Keep `src/app/globals.css` tokens identical to ELEVATE's `:root` and `.dark`.

## Commands

```bash
pnpm --filter learn dev        # http://localhost:3200
pnpm --filter learn typecheck
pnpm --filter learn lint
pnpm --filter learn test
```

Database migrations for the `learn` schema live in `apps/elevate/drizzle` (ELEVATE owns them, like Safe Voice's tables).
