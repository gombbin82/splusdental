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
| `modules/env/` | — | Per env: runtime SA `splus-web-api-<env>`, secrets `splus-web-<env>-stripe-{secret-key,webhook-secret}` (empty shells), Cloud Run service `splus-web-api-<env>` (behind `enable_service`), Firebase Hosting site, optional custom domains (behind `enable_custom_domains`), and the deployer's env-scoped IAM. |

### Names other code depends on

| Thing | Name |
|-------|------|
| API image | `us-west1-docker.pkg.dev/splusdental/splus-web/api` |
| Cloud Run services | `splus-web-api-staging`, `splus-web-api-prod` (us-west1) |
| Runtime SAs | `splus-web-api-<env>@splusdental.iam.gserviceaccount.com` |
| Deployer SA | `splus-web-deploy@splusdental.iam.gserviceaccount.com` |
| WIF provider | `projects/<number>/locations/global/workloadIdentityPools/splus-web-github/providers/github-oidc` |
| Hosting sites | `splus-dental` (prod), `splus-dental-staging` (staging) — variables, see below |
| Secrets | `splus-web-<env>-stripe-secret-key`, `splus-web-<env>-stripe-webhook-secret` |
| Cloud Run env | `APP_ENV`, `ADMIN_EMAILS`, `STAFF_EMAILS`, `GOOGLE_OAUTH_CLIENT_ID`, `PUBLIC_SITE_URL`, `STRIPE_SECRET_KEY` (secret, `latest`) |

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
4. **Envs, first pass** (`enable_service = false`): creates runtime SAs, empty secrets, Hosting sites.
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

## Managing access (admin / staff)

`/admin` uses Google sign-in, then an exact-email allowlist per env (no database):

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

```sh
# paste the key, then Enter and Ctrl-D (keeps it out of shell history)
gcloud secrets versions add splus-web-staging-stripe-secret-key --project=splusdental --data-file=-
gcloud secrets versions add splus-web-staging-stripe-webhook-secret --project=splusdental --data-file=-
# prod: same with splus-web-prod-…, live keys only when going live (issue #9)
```

Cloud Run reads `latest` at instance start, so after rotating a key deploy a new revision (or wait for
instances to recycle). `STRIPE_WEBHOOK_SECRET` is not wired into Cloud Run yet: add an `env` block in
`modules/env/main.tf` once the webhook exists and the secret has a version.

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
   - `https://splus-dental-staging.web.app`, `https://splus-dental-staging.firebaseapp.com`
   - `http://localhost:4321`

   (Use the real site IDs if you overrode `hosting_site_id`.) No redirect URIs are needed for the Google
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
