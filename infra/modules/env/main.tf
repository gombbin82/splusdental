# One splus-web environment (staging or prod): runtime SA, Stripe secrets, Cloud Run API service,
# Firebase Hosting site (+ optional custom domains), and the deployer's env-scoped permissions.

locals {
  name = "splus-web-api-${var.env}"

  secrets = toset(["stripe-secret-key", "stripe-webhook-secret"])

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
        name  = "ADMIN_HD"
        value = var.admin_hd
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

  depends_on = [google_secret_manager_secret_iam_member.runtime_access]
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
