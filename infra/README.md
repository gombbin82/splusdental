# infra

Terraform for S+ Dental web (GCP project `splusdental`, region `us-west1`). **Stephen runs `apply`.**

Rules: no `.tfstate` or real `.tfvars` in git (only `*.tfvars.example`); state lives in GCS; every resource
is named `splus-web…` so it never collides with kiwidental or other workloads in the shared project.
Terraform here never imports or modifies pre-existing resources (kiwidental Cloud Run services, the WIF pools
`github` / `splus-pool` / `my-pool`, existing secrets). APIs are enabled with `disable_on_destroy = false`.

## Layout

| Dir | State | What |
|-----|-------|------|
| `bootstrap/` | local (not committed) | GCS state bucket `splusdental-tfstate` (versioned, uniform access, public access prevention). Shared with kiwidental, which uses prefix `kiwidental/...`. |
| `shared/` | `gs://splusdental-tfstate/splus-web/shared` | APIs, Artifact Registry repo `splus-web`, deployer SA `splus-web-deploy`, WIF pool `splus-web-github` / provider `github-oidc`, Firebase on the project, project budget alert. |
| `envs/staging/` | `.../splus-web/staging` | `modules/env` with `env = "staging"` |
| `envs/prod/` | `.../splus-web/prod` | `modules/env` with `env = "prod"` |
| `modules/env/` | — | Per env: runtime SA `splus-web-api-<env>`, secrets `splus-web-<env>-stripe-{secret-key,webhook-secret}` (empty shells), Cloud Run service `splus-web-api-<env>` (behind `enable_service`), Firebase Hosting sites for the public site and the staff admin, optional public custom domains (behind `enable_custom_domains`), optional admin domain (behind `enable_admin_domain`), and the deployer's env-scoped IAM. |

### Names other code depends on

| Thing | Name |
|-------|------|
| API image | `us-west1-docker.pkg.dev/splusdental/splus-web/api` |
| Cloud Run services | `splus-web-api-staging`, `splus-web-api-prod` (us-west1) |
| Runtime SAs | `splus-web-api-<env>@splusdental.iam.gserviceaccount.com` |
| Deployer SA | `splus-web-deploy@splusdental.iam.gserviceaccount.com` |
| WIF provider | `projects/<number>/locations/global/workloadIdentityPools/splus-web-github/providers/github-oidc` |
| Hosting sites (public) | `splus-dental` (prod), `splus-dental-staging` (staging) — firebase.json targets `prod` / `staging` |
| Hosting sites (admin) | `splus-dental-admin` (prod), `splus-dental-admin-staging` (staging) — targets `admin-prod` / `admin-staging` |
| Admin domains | `admin.splus.dental` (prod), `admin-staging.splus.dental` (staging) |
| Secrets | `splus-web-<env>-stripe-secret-key`, `splus-web-<env>-stripe-webhook-secret` |
| Cloud Run env | `APP_ENV`, `ADMIN_EMAILS`, `STAFF_EMAILS`, `GMAIL_SENDER`, `RUNTIME_SA_EMAIL`, `GOOGLE_OAUTH_CLIENT_ID`, `PUBLIC_SITE_URL`, `STRIPE_SECRET_KEY` (secret, `latest`) |

### Who owns what on the Cloud Run service

Terraform owns everything **except the container image** (`lifecycle.ignore_changes` on
`template[0].containers[0].image`, `client`, `client_version`). GitHub Actions deploys must change only the
image (e.g. `gcloud run deploy splus-web-api-staging --image … --region us-west1`), never env vars, scaling,
SA or IAM (`--allow-unauthenticated` is not needed and the deployer can't set IAM anyway) — otherwise the
next `apply` reverts them.

### Deployer permissions (least privilege)

- `roles/artifactregistry.writer` on the `splus-web` repo only
- `roles/run.developer` on `splus-web-api-staging` and `splus-web-api-prod` only
- `roles/iam.serviceAccountUser` on the two runtime SAs only
- `roles/firebasehosting.admin` on the project (Hosting has no per-site IAM)
- `roles/serviceusage.serviceUsageViewer` + `serviceUsageConsumer` on the project (firebase-tools checks the Hosting API)
- Impersonable only by GitHub OIDC tokens whose `repository == "gombbin82/splusdental"`

## Prerequisites

- Terraform ≥ 1.6, `gcloud`, and Owner (or equivalent) on `splusdental`; Billing Account Administrator /
  Costs Manager on the billing account for the budget.
- `gcloud auth application-default login` (providers use `user_project_override` with `splusdental` as quota
  project, which the Firebase and Billing Budgets APIs require with user credentials).

## Apply order

1. **State bucket** (once; skip if `gs://splusdental-tfstate` already exists, e.g. kiwidental made it):
   ```sh
   terraform -chdir=infra/bootstrap init
   terraform -chdir=infra/bootstrap apply
   ```
   Local state stays in `infra/bootstrap/terraform.tfstate` (git-ignored); you can delete it afterwards —
   the bucket has `prevent_destroy` and doesn't need further management. Equivalent one-liner instead:
   ```sh
   gcloud storage buckets create gs://splusdental-tfstate --project=splusdental --location=us-west1 \
     --uniform-bucket-level-access --public-access-prevention && \
   gcloud storage buckets update gs://splusdental-tfstate --versioning
   ```
2. **Shared foundation**:
   ```sh
   cp infra/shared/terraform.tfvars.example infra/shared/terraform.tfvars   # set billing_account_id
   terraform -chdir=infra/shared init
   terraform -chdir=infra/shared apply
   ```
   Newly enabled APIs can take a minute to propagate; if the budget, Firebase or WIF resources fail with
   "API not enabled", re-run `apply`.
3. **OAuth client** (manual, below) → put the client ID into `envs/*/terraform.tfvars`.
4. **Envs, first pass** (`enable_service = false`): creates runtime SAs, empty secrets, Hosting sites
   (public site and staff admin site per env).
   ```sh
   for env in staging prod; do
     cp infra/envs/$env/terraform.tfvars.example infra/envs/$env/terraform.tfvars   # edit
     terraform -chdir=infra/envs/$env init
     terraform -chdir=infra/envs/$env apply
   done
   ```
5. **Secret versions** (below). Cloud Run refuses to deploy a revision that references a secret with no
   version, which is why the service is gated.
6. **Envs, second pass**: set `enable_service = true` in each env's `terraform.tfvars` and `apply` again. This
   creates the Cloud Run service with the placeholder image `us-docker.pkg.dev/cloudrun/container/hello`,
   the public invoker binding and the deployer's `run.developer`. GitHub Actions then deploys the real image.
7. **GitHub repo variables** (below).
8. **Custom domains** — only after the DNS plan in issue #10: set `enable_custom_domains = true`, apply, and
   create the records from the `custom_domain_dns_updates` output. Prod attaches `splus.dental` and
   redirects `www.splus.dental` → apex; staging attaches `staging.splus.dental`. **Never touch the MX / Google
   Workspace records.**

## Prod first deploy

Prod mirrors staging: same steps, `envs/prod`, deployed by a manual workflow run instead of a push.

```sh
cp infra/envs/prod/terraform.tfvars.example infra/envs/prod/terraform.tfvars   # set admin_emails, staff_emails
terraform -chdir=infra/envs/prod init
terraform -chdir=infra/envs/prod apply            # first pass: runtime SA, secrets, both Hosting sites

# Placeholder until the practice's Stripe account exists (issue #9); swap for the live key at go-live.
printf 'sk_test_placeholder' | gcloud secrets versions add splus-web-prod-stripe-secret-key --project=splusdental --data-file=-

sed -i '' 's/^enable_service = false/enable_service = true/' infra/envs/prod/terraform.tfvars
terraform -chdir=infra/envs/prod apply            # second pass: Cloud Run service

gh workflow run deploy.yml -R gombbin82/splusdental --ref main   # builds, then deploys API + hosting:prod + hosting:admin-prod
```

The prod job uses the GitHub `production` environment, which GitHub creates on first use. Optional: in repo
Settings → Environments → production add yourself as a required reviewer and restrict it to `main` and `v*`
tags; each prod run then waits for your approval.

Result: public site at `https://splus-dental.web.app`, admin at `https://splus-dental-admin.web.app`. Those
URLs work before any DNS change, so DNS can later be pointed at them (apex/www via issue #10; admin below).
Until the admin domain is attached, `https://splus-dental.web.app/admin` redirects to
`https://admin.splus.dental`, which won't resolve yet — use the `*-admin.web.app` URL directly.

## Admin domain (admin.splus.dental)

The admin app has its own Hosting site per env, so its hostname can go live independently of the public
site's apex/www cutover (issue #10). It only adds records for a new host name.

1. In `infra/envs/<env>/terraform.tfvars` set `enable_admin_domain = true`, then apply.
2. `terraform -chdir=infra/envs/<env> output admin_domain_dns_updates` lists the records Firebase wants
   (usually a TXT for ownership plus A/CNAME for the host).
3. Squarespace → Domains → splus.dental → DNS → **Custom records**: add exactly those records for host
   `admin` (prod) or `admin-staging` (staging). **Do not touch** the Google Workspace records (MX, SPF, DKIM),
   `www`, or the apex domain forwarding.
4. Firebase verifies and issues the certificate (minutes to ~24 h). Re-run the `output` command to see status.

## Managing access (admin / staff)

The staff admin (`admin.splus.dental`; staging `admin-staging.splus.dental`) uses Google sign-in, then an exact-email allowlist per env (no database):

- `admin_emails` — full access (payment links + settings, reports, later traffic reports).
- `staff_emails` — payment links: create, list, deactivate.
- Anyone else, even a verified `@splus.dental` account, gets 403. An email on both lists is admin.

Edit the lists in `infra/envs/<env>/terraform.tfvars` (git-ignored — real emails never go in the repo) and
apply; Cloud Run rolls a new revision with the updated `ADMIN_EMAILS` / `STAFF_EMAILS` in about a minute:

```sh
terraform -chdir=infra/envs/staging apply
```

## Secret versions

Values never go through Terraform (they would land in state). Use Stripe **test** keys for staging.

Use a Stripe **restricted key** (`rk_test_…` / `rk_live_…`, Developers → API keys → Create
restricted key) with only what the API calls:

| Stripe resource | Access | Used for |
|---|---|---|
| Payment Links | Write | create, list, deactivate, record "emailed" metadata |
| Prices | Write | the per-link price (inline product) |
| Products | Write | inline `product_data` (name + logo) |
| PaymentIntents | Write | list payments, approve (capture) / release (cancel) held payments |
| Charges | Read | payer name/email and card on the Payments page |
| Everything else | None | |

```sh
# paste the key, then Enter and Ctrl-D (keeps it out of shell history)
gcloud secrets versions add splus-web-staging-stripe-secret-key --project=splusdental --data-file=-
gcloud secrets versions add splus-web-staging-stripe-webhook-secret --project=splusdental --data-file=-
# prod: same with splus-web-prod-…, live keys only when going live (issue #9)
```

Cloud Run reads `latest` at instance start, so after rotating a key deploy a new revision (or wait for
instances to recycle). `STRIPE_WEBHOOK_SECRET` is not wired into Cloud Run yet: add an `env` block in
`modules/env/main.tf` once the webhook exists and the secret has a version.

## Email (Gmail via domain-wide delegation)

Staff can email a payment link to a patient. Mail goes out through the Gmail API **as `gmail_sender`**
(e.g. the practice's `info@` mailbox) and lands in that mailbox's Sent folder. No key files: the Cloud
Run runtime SA signs its own JWT with IAM Credentials `signJwt` (Terraform grants it
`roles/iam.serviceAccountTokenCreator` on itself only), with `sub = gmail_sender` and scope
`gmail.send`, and trades it for a Gmail token.

One-time, per env (staging and prod have different runtime SAs):

1. Set `gmail_sender = "info@…"` in `envs/<env>/terraform.tfvars` and `apply`. It must be a real,
   licensed mailbox in the Workspace domain (not an alias or group).
2. Get the SA's client ID: `terraform -chdir=infra/envs/<env> output -raw runtime_sa_unique_id`.
3. A **Workspace super admin**: admin.google.com → Security → Access and data control → API controls →
   **Manage Domain Wide Delegation** → Add new → Client ID = that number, OAuth scopes =
   `https://www.googleapis.com/auth/gmail.send` (only this one) → Authorize.
4. Test from the admin: Payment links → Email link. Staging emails have a `[TEST]` subject prefix.

Security notes: delegation for `gmail.send` would let this SA send as *any* user in the domain; the API
only ever uses `GMAIL_SENDER`, the SA has no key, and only Cloud Run (running as that SA) can sign for it.
Recipient addresses are never logged or stored (Stripe metadata only gets `last_emailed_at` and
`emailed_count`). Each staff member can send at most 20 emails per hour per instance. Leave
`gmail_sender` empty to turn email off (the admin hides the controls).

## Stripe Dashboard branding

Checkout already shows the S+ logo next to the line item (`product_data.images`, from
`<site>/logo.png`) and a "Questions about your balance? Call …" note under the Pay button. For the page
chrome, set branding once per Stripe account (it applies to test and live mode):

- Settings → Business → **Branding**: Icon and Logo → upload `site/public/logo.png`.
- Brand color `#3458a6` (left panel background) and Accent color for buttons (e.g. `#3458a6`).
- Public business name "S+ Dental", support phone and email (Settings → Business → Public details);
  statement descriptor "S+ DENTAL".

## OAuth client (manual)

Terraform can't create a standard OAuth Web client, so do it once in the console (project `splusdental`):

1. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding/Audience): user type
   **External** (the project isn't under a `splus.dental` org — see `docs/architecture.md` decision 7). App
   name "S+ Dental Staff", support email an `@splus.dental` address, authorized domain `splus.dental`. Scopes:
   `openid`, `email`, `profile` only (non-sensitive, so no verification is needed). Publish the app (In
   production) so sign-in isn't limited to test users. The server only admits emails on `admin_emails` / `staff_emails`.
2. **Credentials → Create credentials → OAuth client ID → Web application**, name `splus-web`.
   Authorized JavaScript origins:
   - `https://splus.dental`
   - `https://www.splus.dental`
   - `https://staging.splus.dental`
   - `https://splus-dental.web.app`, `https://splus-dental.firebaseapp.com`
   - `https://admin.splus.dental`
   - `https://admin-staging.splus.dental`
   - `https://splus-dental-admin.web.app`, `https://splus-dental-admin.firebaseapp.com`
   - `https://splus-dental-admin-staging.web.app`, `https://splus-dental-admin-staging.firebaseapp.com`
   - `http://localhost:4322` (local `pnpm dev:admin`)

   Sign-in only happens on the admin hosts; the public-site origins (`splus.dental`, `www`, `staging`,
   `splus-dental*.web.app`) don't need to be listed, but listing them is harmless. (Use the real site IDs if
   you overrode `hosting_site_id` / `admin_hosting_site_id`.) No redirect URIs are needed for the Google
   Identity Services button. Ignore the client secret — the ID-token flow doesn't use it; don't store it.
3. Put the client ID (not secret, but keep it out of git anyway) in `oauth_client_id` in both
   `envs/*/terraform.tfvars`.

## GitHub repo variables

After `shared` is applied:

```sh
gh variable set GCP_WIF_PROVIDER -R gombbin82/splusdental --body "$(terraform -chdir=infra/shared output -raw gcp_wif_provider)"
gh variable set GCP_DEPLOY_SA   -R gombbin82/splusdental --body "$(terraform -chdir=infra/shared output -raw gcp_deploy_sa)"
```

Workflows need `permissions: id-token: write` and `google-github-actions/auth` with those two values.

## Notes

- **Hosting site IDs are globally unique.** If `splus-dental` / `splus-dental-staging` are taken when you
  apply, set `hosting_site_id` (e.g. `splusdental-web`, `splusdental-web-staging`) and update the targets in
  `firebase.json` / `.firebaserc` and the OAuth origins.
- **WIF pools are soft-deleted for 30 days** after destroy; recreating `splus-web-github` within that window
  fails — undelete it (`gcloud iam workload-identity-pools undelete`) and `terraform import` it.
- The budget covers the **whole project** (kiwidental dev and other workloads included). Alerts email the
  billing account admins. Budgets alert only; they don't cap spend.
- Firebase was not enabled on `splusdental` as of 2026-11-16, so `google_firebase_project` creates it. If it
  has been added since, import first: `terraform -chdir=infra/shared import google_firebase_project.this projects/splusdental`.
- Prod Cloud Run has `deletion_protection = true`; staging doesn't.
- CI runs `terraform fmt -check`, `validate` (with `init -backend=false`) and `tflint` on every root here.
  Provider lock files (`.terraform.lock.hcl`) are committed.
