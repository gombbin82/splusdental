# One splus-web environment (staging or prod): runtime SA, Stripe secrets, Cloud Run API service,
# Firebase Hosting site (+ optional custom domains), and the deployer's env-scoped permissions.

locals {
  name = "splus-web-api-${var.env}"

  # Empty shells; versions are added with gcloud (infra/README.md). `seed` holds practice records
  # (providers, locations, payers) as JSON, never patient data.
  secrets = toset(["stripe-secret-key", "stripe-webhook-secret", "seed"])

  db_name = "splus_web_${var.env}"
  db_user = "splus-web-${var.env}"

  labels = {
    app        = "splus-web"
    env        = var.env
    managed-by = "terraform"
  }
}

# --- Runtime service account -------------------------------------------------------------------

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = local.name
  display_name = "splus-web API runtime (${var.env})"
  description  = "Cloud Run runtime identity for ${local.name}. Only reads this env's secrets."
}

# The deployer may deploy revisions that run as this SA (and only this env's runtime SA).
resource "google_service_account_iam_member" "deployer_act_as" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_sa_email}"
}

# Payment-link emails: the runtime SA signs its own JWT (IAM Credentials signJwt, no key file) to
# get a Gmail token for GMAIL_SENDER via Workspace domain-wide delegation. Granted on itself only.
resource "google_service_account_iam_member" "runtime_sign_self" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.runtime.member
}

# --- Secrets (empty shells; add versions with gcloud, see infra/README.md) ----------------------

resource "google_secret_manager_secret" "this" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = "splus-web-${var.env}-${each.key}"
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = local.secrets

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}

# --- Database (on the shared Cloud SQL instance) -----------------------------------------------

resource "google_sql_database" "app" {
  count = var.enable_database ? 1 : 0

  project  = var.project_id
  instance = var.sql_instance_name
  name     = local.db_name
}

resource "random_password" "db" {
  count = var.enable_database ? 1 : 0

  length  = 32
  special = false # goes into a connection URL
}

resource "google_sql_user" "app" {
  count = var.enable_database ? 1 : 0

  project  = var.project_id
  instance = var.sql_instance_name
  name     = local.db_user
  password = random_password.db[0].result
}

# DATABASE_URL for node-postgres over the Cloud SQL connector's unix socket. The password is in
# Terraform state (GCS bucket) and Secret Manager only.
resource "google_secret_manager_secret" "database_url" {
  count = var.enable_database ? 1 : 0

  project   = var.project_id
  secret_id = "splus-web-${var.env}-database-url"
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  count = var.enable_database ? 1 : 0

  secret      = google_secret_manager_secret.database_url[0].id
  secret_data = "postgresql://${local.db_user}:${random_password.db[0].result}@/${local.db_name}?host=/cloudsql/${var.sql_connection_name}"
}

resource "google_secret_manager_secret_iam_member" "runtime_database_url" {
  count = var.enable_database ? 1 : 0

  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}

# Cloud SQL Client can only be granted per project; the runtime can still only log in to this env's
# database (its own user/password).
resource "google_project_iam_member" "runtime_sql_client" {
  count = var.enable_database ? 1 : 0

  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.runtime.member
}

# --- Cloud Run service -------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  count = var.enable_service ? 1 : 0

  project             = var.project_id
  name                = local.name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = var.deletion_protection
  labels              = local.labels

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    dynamic "volumes" {
      for_each = var.enable_database ? [1] : []
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.sql_connection_name]
        }
      }
    }

    containers {
      image = var.placeholder_image

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "APP_ENV"
        value = var.env
      }
      env {
        name  = "ADMIN_EMAILS"
        value = join(",", var.admin_emails)
      }
      env {
        name  = "STAFF_EMAILS"
        value = join(",", var.staff_emails)
      }
      env {
        name  = "GMAIL_SENDER"
        value = var.gmail_sender
      }
      env {
        name  = "GA4_PROPERTY_ID"
        value = var.ga4_property_id
      }
      env {
        name  = "RUNTIME_SA_EMAIL"
        value = google_service_account.runtime.email
      }
      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.oauth_client_id
      }
      env {
        name  = "PUBLIC_SITE_URL"
        value = var.public_site_url
      }
      env {
        name = "STRIPE_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.this["stripe-secret-key"].secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_database ? [1] : []
        content {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url[0].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_database && var.enable_seed ? [1] : []
        content {
          name = "SEED_JSON"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.this["seed"].secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "volume_mounts" {
        for_each = var.enable_database ? [1] : []
        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  # GitHub Actions deploys own the image. Deploys must only change the image (no --set-env-vars),
  # otherwise the next apply reverts them.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.runtime_access,
    google_secret_manager_secret_iam_member.runtime_database_url,
    google_secret_manager_secret_version.database_url,
    google_project_iam_member.runtime_sql_client,
    google_sql_user.app,
  ]
}

# Public invoker: Firebase Hosting rewrites call the service anonymously; the app enforces auth.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.enable_service ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.api[0].location
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "deployer" {
  count = var.enable_service ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.api[0].location
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.deployer_sa_email}"
}

# --- Firebase Hosting --------------------------------------------------------------------------

resource "google_firebase_hosting_site" "this" {
  provider = google-beta

  project = var.project_id
  site_id = var.hosting_site_id
}

resource "google_firebase_hosting_custom_domain" "this" {
  provider = google-beta
  for_each = var.enable_custom_domains ? var.custom_domains : {}

  project               = var.project_id
  site_id               = google_firebase_hosting_site.this.site_id
  custom_domain         = each.key
  redirect_target       = each.value.redirect_target
  wait_dns_verification = false
}

# --- Staff admin host (admin.splus.dental) ------------------------------------------------------
# Separate Hosting site so the admin app lives on its own origin; /api/** rewrites to the same
# Cloud Run service (see firebase.json targets admin-<env>).

resource "google_firebase_hosting_site" "admin" {
  provider = google-beta

  project = var.project_id
  site_id = var.admin_hosting_site_id
}

resource "google_firebase_hosting_custom_domain" "admin" {
  provider = google-beta
  count    = var.enable_admin_domain ? 1 : 0

  project               = var.project_id
  site_id               = google_firebase_hosting_site.admin.site_id
  custom_domain         = var.admin_domain
  wait_dns_verification = false
}
