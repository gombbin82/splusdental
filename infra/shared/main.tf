# Project-level foundation for splus-web (issue #4). Everything here is created by and named for this
# repo; nothing pre-existing in the shared `splusdental` project is referenced or modified.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  apis = toset([
    "analyticsdata.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "gmail.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ])
}

# Other workloads use these APIs too: never disable them on destroy.
resource "google_project_service" "apis" {
  for_each = local.apis

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry -------------------------------------------------------------------------

resource "google_artifact_registry_repository" "web" {
  project       = var.project_id
  location      = var.region
  repository_id = "splus-web"
  format        = "DOCKER"
  description   = "splus-web container images (api)."

  depends_on = [google_project_service.apis]
}

# --- Deployer service account + Workload Identity Federation for GitHub Actions ---------------

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = "splus-web-deploy"
  display_name = "splus-web GitHub Actions deployer"
  description  = "Impersonated by GitHub Actions (${var.github_repository}) via WIF. No keys."

  depends_on = [google_project_service.apis]
}

resource "google_artifact_registry_repository_iam_member" "deploy_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.web.location
  repository = google_artifact_registry_repository.web.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deploy.member
}

# Firebase Hosting deploys (both sites). Hosting has no per-site IAM, so this is project-level.
resource "google_project_iam_member" "deploy_hosting" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = google_service_account.deploy.member
}

# firebase-tools checks that firebasehosting.googleapis.com is enabled (serviceusage.services.get)
# and bills API calls to the project (serviceusage.services.use). Both roles are read/use-only.
resource "google_project_iam_member" "deploy_serviceusage" {
  for_each = toset(["roles/serviceusage.serviceUsageViewer", "roles/serviceusage.serviceUsageConsumer"])
  project  = var.project_id
  role     = each.value
  member   = google_service_account.deploy.member
}

# run.developer on each Cloud Run service and serviceAccountUser on each runtime SA are granted in
# the env roots (infra/modules/env), scoped to that env's resources only.

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "splus-web-github"
  display_name              = "splus-web GitHub Actions"
  description               = "OIDC from GitHub Actions, restricted to ${var.github_repository}."

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
    "attribute.actor"      = "assertion.actor"
  }
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deploy_wif" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# --- Firebase ----------------------------------------------------------------------------------

# Adds Firebase to the existing GCP project (it was not a Firebase project as of 2026-11-16).
# Hosting sites are created per env in infra/envs/*.
resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.apis]
}

# --- Budget alert ------------------------------------------------------------------------------

# Covers the whole project (all workloads, not only splus-web). Emails go to billing account
# admins/users by default.
resource "google_billing_budget" "project" {
  billing_account = var.billing_account_id
  display_name    = "splusdental project monthly budget (splus-web tf)"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_amount_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  depends_on = [google_project_service.apis]
}

# --- Cloud SQL (Postgres) ----------------------------------------------------------------------
# One small instance for splus-web; staging and prod each get their own database, user and password
# (infra/modules/env). Not kiwidental's instance. Cloud Run connects through the built-in Cloud SQL
# connector (unix socket, IAM-authorized), so there are no authorized networks and no public access
# beyond the connector. Patient data lives here: sign Google Cloud's HIPAA BAA before real PHI.

resource "google_sql_database_instance" "pg" {
  project             = var.project_id
  name                = "splus-web-pg"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    edition           = "ENTERPRISE"
    tier              = var.db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "10:00" # UTC, ~2-3am Pacific
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled = true # needed by the Cloud SQL connector; no authorized networks
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 11
    }

    user_labels = {
      app        = "splus-web"
      managed-by = "terraform"
    }
  }

  depends_on = [google_project_service.apis]
}
