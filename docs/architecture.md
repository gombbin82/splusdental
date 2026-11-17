# Architecture (proposed)

Status: **draft** — open decisions at the bottom. Update this doc as decisions land.

```
                ┌───────────────────────────────┐
 patients ───▶  │  splus.dental / www (HTTPS)    │  static public site (Astro build)
 staff    ───▶  │  /admin  (static admin UI)     │
                │  /api/** ──rewrite──┐          │
                └─────────────────────┼──────────┘
                                      ▼
                           Cloud Run: splus-api (Node/TS)
                            ├─ Google ID token verification (hd=splus.dental)
                            ├─ Stripe API (Payment Links)
                            └─ secrets from Secret Manager
```

## Components
- **Public site** — static, generated with Astro (`site/`). Content from `docs/content/current-site.md`,
  rewritten and expanded. SEO basics: schema.org `Dentist` JSON-LD, meta/OG tags, sitemap, fast Lighthouse.
- **Hosting / edge** — Firebase Hosting in the GCP project (managed SSL for apex + www, CDN, `/api/**`
  rewrite to Cloud Run). Alternative: external HTTPS LB + Cloud CDN + bucket backend (more Terraform-native
  but costs a base monthly fee). Firebase Hosting is the default.
- **API** — `api/`, Node 22 + TypeScript (Express or Hono), container on Cloud Run, min instances 0.
  - `GET /api/config` — public client config (OAuth client ID, Stripe mode).
  - `GET/POST /api/payment-links`, `POST /api/payment-links/:id/deactivate` — admin only.
- **Admin UI** — `/admin`, Google Identity Services sign-in button with `hd=splus.dental` hint; sends the ID
  token as `Authorization: Bearer`. Server enforces `aud`, signature, `email_verified`, `hd`. Optional
  allowlist/role list later.
- **Payments** — Stripe Payment Links. Per link the server creates a Price (inline product) then a
  Payment Link:
  - fixed amount, or patient-entered amount (`custom_unit_amount` with optional preset/minimum)
  - generic description shown to patient
  - metadata: `source=splus-admin`, `patient_ref`, `invoice`, `created_by`, `amount_display`
  - one-time use via `restrictions.completed_sessions.limit = 1`
  - optional phone collection; optional custom field "Patient name"
  - redirect after payment → `https://splus.dental/thank-you`
  - list recent links (filtered by `metadata.source`) and deactivate
  - Later: webhook (`checkout.session.completed`) → notify front desk / record for posting into PMS.
- **Infra** — Terraform in `infra/` (state in a GCS bucket, not in git): project APIs, Artifact Registry,
  Cloud Run service + runtime service account, Secret Manager secrets, Firebase Hosting site, Workload
  Identity Federation for GitHub Actions deploys (no SA keys).
- **CI/CD** — GitHub Actions: lint/test on PR; deploy staging on merge to `main`; deploy prod on tag/manual.

## Open decisions
| # | Question | Default if undecided |
|---|----------|----------------------|
| 1 | GCP project: reuse `splusdental` (shared with kiwidental dev) or a dedicated project? | Dedicated project for the practice's production web presence |
| 2 | Environments | prod + staging (`staging.splus.dental`) |
| 3 | Site framework | Astro (static) |
| 4 | API framework | Node 22 + TypeScript + Hono |
| 5 | Edge | Firebase Hosting |
| 6 | Who may use admin | any verified `@splus.dental` account; allowlist later |
| 7 | Stripe account | confirm practice has one, owned by the business, test mode until go-live |

## Prototype
`prototype/` holds a first-pass static HTML/CSS redesign and admin UI mockup written before the stack was
chosen. Use as visual/content reference; it is not the production code.
