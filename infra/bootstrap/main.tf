# One-time bootstrap: the GCS bucket that holds Terraform state for every root in this repo
# (prefix `splus-web/...`) and for kiwidental (prefix `kiwidental/...`). Local state on purpose;
# see infra/README.md. If the bucket already exists (e.g. kiwidental created it first), skip this root.

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }
}

variable "project_id" {
  description = "GCP project that owns the state bucket."
  type        = string
  default     = "splusdental"
}

variable "region" {
  description = "Bucket location."
  type        = string
  default     = "us-west1"
}

variable "bucket_name" {
  description = "State bucket name. Shared by splus-web and kiwidental (different prefixes)."
  type        = string
  default     = "splusdental-tfstate"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_storage_bucket" "tfstate" {
  name     = var.bucket_name
  location = upper(var.region)

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Keep the 20 most recent non-current versions of each state object.
  lifecycle_rule {
    condition {
      with_state         = "ARCHIVED"
      num_newer_versions = 20
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    purpose    = "terraform-state"
    managed-by = "terraform"
  }

  lifecycle {
    prevent_destroy = true
  }
}

output "bucket" {
  description = "State bucket name."
  value       = google_storage_bucket.tfstate.name
}
