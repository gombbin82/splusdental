# CLAUDE.md — splusdental

Website, staff admin, and small internal tools for **S+ Dental**, a general dentistry practice in
Mountlake Terrace, WA (https://splus.dental). Owner/dentist: Dr. Stephanie Kang. Maintainer: Stephen Kang
(GitHub `gombbin82`).

This repo is **separate** from `gombbin82/kiwidental` (the practice-management-software product). Don't
mix the two codebases.

Read `docs/context.md` for background and `docs/architecture.md` for the design and open decisions.
Work is tracked in GitHub issues.

## Short-term goals
1. Rebuild and improve the public website (currently Google Sites).
2. Staff admin area at `/admin`, Google sign-in limited to an allowlist of admin and staff emails.
3. Admin tool to create Stripe Payment Links with custom options.

## Hard rules
- **This repo is public.** Never commit secrets, API keys, OAuth client secrets, Stripe keys, service-account
  JSON, `.tfstate`, or `.tfvars` with real values. Secrets live in GCP Secret Manager.
- **No patient health information (PHI)** in code, fixtures, logs, Stripe metadata, or commits. Stripe is not
  a HIPAA business associate: payment descriptions stay generic ("S+ Dental — account balance"); use chart
  numbers/initials or invoice numbers, never procedure names or diagnoses.
- Admin auth must be enforced **server-side**: verify the Google ID token signature and audience, require
  `email_verified == true`, and allow only emails on the `ADMIN_EMAILS` / `STAFF_EMAILS` allowlists (role
  `admin` or `staff`); everyone else is 403. Admin-only routes use `requireAdmin`. The real email lists live
  only in git-ignored `terraform.tfvars` — never commit them.
- Stripe: develop in **test mode**; live keys only via Secret Manager in prod.
- Infra changes go through Terraform (`infra/`), not console click-ops. Stephen runs `terraform apply` himself.
- Don't change DNS for `splus.dental` without an explicit plan in an issue: the domain also carries Google
  Workspace email (MX) records.
