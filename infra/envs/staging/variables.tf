variable "project_id" {
  description = "GCP project."
  type        = string
  default     = "splusdental"
}

variable "region" {
  description = "Region."
  type        = string
  default     = "us-west1"
}

variable "oauth_client_id" {
  description = "Google OAuth Web client ID (not a secret). Created manually; see infra/README.md."
  type        = string
  default     = ""
}

variable "hosting_site_id" {
  description = "Firebase Hosting site ID. Globally unique: if taken, pick another (e.g. splus-dental-stg) and update firebase.json targets."
  type        = string
  default     = "splus-dental-staging"
}

variable "enable_service" {
  description = "Create the Cloud Run service. Set true only after splus-web-staging-stripe-secret-key has a version."
  type        = bool
  default     = false
}

variable "enable_custom_domains" {
  description = "Attach staging.splus.dental. Needs a DNS change: follow the plan in issue #10 first."
  type        = bool
  default     = false
}

variable "admin_emails" {
  description = "Admin Google accounts (full access). Keep real values in terraform.tfvars (git-ignored)."
  type        = list(string)
  default     = []
}

variable "staff_emails" {
  description = "Staff Google accounts (payment links). Keep real values in terraform.tfvars (git-ignored)."
  type        = list(string)
  default     = []
}
