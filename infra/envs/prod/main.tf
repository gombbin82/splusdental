terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.0"
    }
  }

  backend "gcs" {
    bucket = "splusdental-tfstate"
    prefix = "splus-web/prod"
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

module "env" {
  source = "../../modules/env"

  project_id          = var.project_id
  region              = var.region
  env                 = "prod"
  public_site_url     = "https://splus.dental"
  oauth_client_id     = var.oauth_client_id
  admin_emails        = var.admin_emails
  staff_emails        = var.staff_emails
  deployer_sa_email   = "splus-web-deploy@${var.project_id}.iam.gserviceaccount.com"
  hosting_site_id     = var.hosting_site_id
  enable_service      = var.enable_service
  deletion_protection = true

  enable_custom_domains = var.enable_custom_domains
  custom_domains = {
    "splus.dental"     = {}
    "www.splus.dental" = { redirect_target = "splus.dental" }
  }
}
