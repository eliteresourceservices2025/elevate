# ELEVATE

ELITE Life & VA Engagement / Talent Experience — the internal HRIS for Elite Resource Services.

- Design: [docs/architecture-plan.md](docs/architecture-plan.md)
- Setup: [docs/SETUP.md](docs/SETUP.md)
- Build order: [docs/BUILD-PROMPTS.md](docs/BUILD-PROMPTS.md)
- Rules for Claude Code: [CLAUDE.md](CLAUDE.md)

```bash
pnpm install
cp apps/elevate/.env.example apps/elevate/.env.local
pnpm dev            # http://localhost:3000
pnpm lint && pnpm typecheck && pnpm test
```

Real employee data exists only in production. Never commit `.env*` files.
