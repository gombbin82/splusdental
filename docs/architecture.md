# Architecture (proposed)

Status: **decided** (2026-11-16, issue #2). Update this doc as things change.

```
                ┌───────────────────────────────┐   ┌───────────────────────────────┐
 patients ───▶  │  splus.dental / www (HTTPS)    │   │  admin.splus.dental (HTTPS)   │ ◀─── staff
                │  site/ (Astro, static)         │   │  admin/ (Astro, static)       │
                │  /admin → 301 admin host       │   │  noindex everywhere           │
                │  /api/** ──rewrite──┐          │   │  /api/** ──rewrite──┐         │
                └─────────────────────┼──────────┘   └─────────────────────┼─────────┘
                                      └──────────────┬─────────────────────┘
                                                     ▼
                                  Cloud Run: splus-web-api-<env> (Node/TS, Hono)
                                   ├─ Google ID token verification + admin/staff email allowlists
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
  - `GET/POST /api/admin/{providers,payers,patients}`, `PUT/DELETE …/:id` — admin only (Postgres).
- **Admin UI** — `admin/`, its own Astro app served at the root of `admin.splus.dental` (staging:
  `admin-staging.splus.dental`; before DNS: `splus-dental-admin[-staging].web.app`), a separate Firebase
  Hosting site with the same `/api/**` rewrite. Google Identity Services sign-in; sends the ID token as
  `Authorization: Bearer`. Server enforces `aud`, signature, `email_verified` and the admin/staff allowlists.
  The public site's `/admin` 301s to the admin host.
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
- **Insurance claims (837D)** — admin-only page `/claims` builds an X12 5010 837D (005010X224A2) file
  **in the browser** (`admin/src/app/x12/837d.ts`, pure and portable to Kiwi Dental) for upload at
  DentalXChange → Batch Claim → Upload Claims. Billing provider, treating dentist and patient (with
  primary coverage) are picked from the database; "Enter manually…" shows the raw fields. The claim
  itself (procedures, the 837 file) is never sent to or stored by the API; clearinghouse settings are
  kept in localStorage. Primary insurance only for now (no COB/2320 loops, predeterminations,
  attachments).
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
| 6 | Admin access | **Email allowlist with two roles** (updated 2026-11-17). Google sign-in; server verifies the token and `email_verified`, then looks the email up in `ADMIN_EMAILS` (role `admin`: everything incl. settings, reports, traffic) or `STAFF_EMAILS` (role `staff`: create/list/deactivate payment links). Anyone else → 403. Lists are Terraform variables in git-ignored `terraform.tfvars`, passed to Cloud Run as env vars; change = edit + `terraform apply` (~1 min). No database. Non-Workspace accounts (e.g. a maintainer's Gmail) can be listed. |
| 7 | OAuth consent screen | **External** — the project is not under a `splus.dental` Cloud org (owned by a personal account). Fine because the server enforces the email allowlist (decision 6), and External also lets a listed non-Workspace account sign in. Revisit if the project moves into a Workspace org. |
| 8 | Stripe account | Pending owner (issue #9). Test mode until go-live. |
| 9 | Tooling | **pnpm** workspaces (via corepack), TypeScript strict, ESLint + Prettier, `terraform fmt`/`validate` + tflint; GitHub Actions CI on every PR. |
| 10 | Terraform state | GCS bucket `splusdental-tfstate` (versioned), prefixes `splus-web/<env>`; bootstrapped separately. |
| 11 | CI/CD auth | Dedicated Workload Identity pool for this repo (restricted to `gombbin82/splusdental`); no service-account keys. Existing pools (`github`, `splus-pool`, `my-pool`) are left alone. |
| 12 | Admin host | **Own hostname** `admin.splus.dental` (staging `admin-staging.splus.dental`), decided 2026-11-17: separate Firebase Hosting site per env (`splus-dental-admin`, `splus-dental-admin-staging`) built from `admin/`, same Cloud Run API via `/api/**` rewrite. Keeps the staff app on its own origin (strict CSP, always noindex) and lets its DNS go live independently of the apex/www cutover (#10). |
| 13 | Emailing links | **Gmail API as the practice mailbox** (`GMAIL_SENDER`, e.g. info@), decided 2026-11-17. Keyless domain-wide delegation: the runtime SA signs its own JWT (`signJwt`), scope `gmail.send` only, authorized once by a Workspace super admin. Sent mail is in the mailbox's Sent folder; replies go to the front desk. Recipient addresses are never logged or stored. Generic content only (no PHI). |
| 14 | Payment holds | **Stripe manual capture**, per-link checkbox (default on), decided 2026-11-17. The card is authorized at checkout and charged only when staff or an admin approves on the Payments page (full amount only), or released. Authorizations expire after ~7 days; the page shows the deadline. Releasing doesn't reopen a one-time link. |
| 15 | Analytics | **GA4 behind opt-in consent**, decided 2026-11-18. Loads only on prod and only after Accept (WA My Health My Data Act); GPC = decline; signals/ad personalization off; never on `/thank-you` or 404. Booking is on Calendly (not tracked). A Consumer Health Data Privacy Policy is linked from every footer. The admin "Website traffic" page (admin-only) reads aggregates from the GA4 Data API as the runtime SA (`GA4_PROPERTY_ID`), cached 10 min. |
| 16 | Database | **Postgres + Drizzle, same approach as kiwidental**, decided 2026-11-26. Local dev: PGlite in-process (`api/.data/pg`, git-ignored). Staging/prod: Cloud SQL instance `splus-web-pg` (not kiwidental's; `infra/shared`), one database per env behind `enable_database`, `DATABASE_URL` from Secret Manager; without it the DB-backed routes answer 503 rather than writing to Cloud Run's disk. Practice records can be seeded from the `splus-web-<env>-seed` secret (`SEED_JSON`, `enable_seed`), same format as the local `api/seed.local.json`. Schema `api/src/db/schema.ts`, migrations `api/drizzle/` run on startup. Tables: `providers` (practice + clinicians), `payers`, `patients` and `coverages` (PHI), all admin-only under `/api/admin/*`. PHI rules: logs carry row ids only, and database errors are logged as SQLSTATE codes because Drizzle puts query parameters in error messages. **Before real patient data goes to a hosted database, sign Google Cloud's HIPAA BAA and use only covered services (Cloud SQL and Cloud Run are covered).** |

## Prototype
`prototype/` holds a first-pass static HTML/CSS redesign and admin UI mockup written before the stack was
chosen. Use as visual/content reference; it is not the production code.
