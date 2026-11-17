# splusdental

Website and staff tools for [S+ Dental](https://splus.dental), Mountlake Terrace, WA.

- **Public site** — modern replacement for the current Google Sites site.
- **Staff admin** (`admin.splus.dental`, `admin/`) — Google sign-in limited to an allowlist; roles admin (everything) and staff (payment links).
- **Payment links** — staff create Stripe Payment Links (fixed or patient-entered amount, one-time use, reference metadata).
- Hosted on **GCP** (Firebase Hosting + Cloud Run), infra in Terraform, deployed by GitHub Actions.

Docs: [context](docs/context.md) · [architecture & open decisions](docs/architecture.md) · [current site content](docs/content/current-site.md)

Work is tracked in [issues](https://github.com/gombbin82/splusdental/issues).

> This repo is public — no secrets, no patient information. See [CLAUDE.md](CLAUDE.md).
