# Architecture (proposed)

Status: **decided** (2026-11-16, issue #2). Update this doc as things change.

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

## Decisions (issue #2, 2026-11-16)
| # | Question | Decision |
|---|----------|----------|
| 1 | GCP project | **Reuse `splusdental`** (shared with kiwidental dev and other workloads). Region `us-west1`. All resources for this repo are prefixed `splus-web` (or `splusweb` where hyphens aren't allowed) and Terraform only manages its own resources — never import or modify kiwidental's. |
| 2 | Environments | **prod + staging** in the same project: separate Cloud Run services (`splus-web-api-prod`, `splus-web-api-staging`), separate Firebase Hosting sites, separate secrets (`splus-web-<env>-…`). `staging.splus.dental` is `noindex`. |
| 3 | Site framework | **Astro** (static output) in `site/`. |
| 4 | API | **Node 22 + TypeScript + Hono** on Cloud Run in `api/`. |
| 5 | Edge | **Firebase Hosting** (managed SSL apex + www, `/api/**` rewrite to Cloud Run). |
| 6 | Admin access | Any **verified `@splus.dental`** account (server checks `email_verified` and `hd`); allowlist/roles later. |
| 7 | OAuth consent screen | **External** — the project is not under a `splus.dental` Cloud org (owned by a personal account). Security is unchanged because the server enforces `hd == "splus.dental"`; the `hd` hint on the button is UX only. Revisit if the project moves into a Workspace org. |
| 8 | Stripe account | Pending owner (issue #9). Test mode until go-live. |
| 9 | Tooling | **pnpm** workspaces (via corepack), TypeScript strict, ESLint + Prettier, `terraform fmt`/`validate` + tflint; GitHub Actions CI on every PR. |
| 10 | Terraform state | GCS bucket `splusdental-tfstate` (versioned), prefixes `splus-web/<env>`; bootstrapped separately. |
| 11 | CI/CD auth | Dedicated Workload Identity pool for this repo (restricted to `gombbin82/splusdental`); no service-account keys. Existing pools (`github`, `splus-pool`, `my-pool`) are left alone. |

## Prototype
`prototype/` holds a first-pass static HTML/CSS redesign and admin UI mockup written before the stack was
chosen. Use as visual/content reference; it is not the production code.
