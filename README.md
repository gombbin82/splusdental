# splusdental

Website and staff tools for [S+ Dental](https://splus.dental), Mountlake Terrace, WA.

- **Public site** — modern replacement for the current Google Sites site.
- **Staff admin** (`admin.splus.dental`, `admin/`) — Google sign-in limited to an allowlist; roles admin (everything) and staff (payment links).
- **Payment links** — staff create Stripe Payment Links (fixed or patient-entered amount, one-time use, reference metadata).
- Hosted on **GCP** (Firebase Hosting + Cloud Run), infra in Terraform, deployed by GitHub Actions.

## Local development

```sh
pnpm install
pnpm dev:api     # API on :8080 (needs api/.env, see api/.env.example)
pnpm dev:admin   # admin on :4322, proxies /api to the API
```

Locally the API stores data in an in-process Postgres (PGlite) under `api/.data/pg` (git-ignored).
Only one API process can open it; a restarting server waits for the old one to exit.

**Sample practice records.** Copy `api/seed.example.json` to `api/seed.local.json` (git-ignored)
and fill in the practice, dentists, locations and insurance companies. On startup the dev API adds
any that are missing; it never overwrites edits. Never put patient data in a seed file (the format
has no place for it and rejects unknown keys).

Docs: [context](docs/context.md) · [architecture & open decisions](docs/architecture.md) · [current site content](docs/content/current-site.md)

Work is tracked in [issues](https://github.com/gombbin82/splusdental/issues).

> This repo is public — no secrets, no patient information. See [CLAUDE.md](CLAUDE.md).
