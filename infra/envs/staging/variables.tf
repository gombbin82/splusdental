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

variable "admin_hosting_site_id" {
  description = "Firebase Hosting site ID for the staff admin app (firebase.json target admin-staging)."
  type        = string
  default     = "splus-dental-admin-staging"
}

variable "enable_admin_domain" {
  description = "Attach admin-staging.splus.dental to the admin Hosting site (then add the admin_domain_dns_updates records in DNS)."
  type        = bool
  default     = false
}

variable "ga4_property_id" {
  description = "Numeric GA4 property ID for the admin traffic page. Empty disables it."
  type        = string
  default     = ""
}

variable "gmail_sender" {
  description = "Mailbox payment-link emails are sent as (e.g. the practice's info@ address). Empty disables email."
  type        = string
  default     = ""
}

variable "enable_database" {
  description = "Create this env's database on the shared Cloud SQL instance (apply infra/shared first) and connect the API to it."
  type        = bool
  default     = false
}

variable "enable_seed" {
  description = "Load practice records from the splus-web-<env>-seed secret on API startup. Add a secret version first (infra/README.md)."
  type        = bool
  default     = false
}
