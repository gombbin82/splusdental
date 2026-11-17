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
  description = "Firebase Hosting site ID. Globally unique: if taken, pick another (e.g. splusdental-web) and update firebase.json targets."
  type        = string
  default     = "splus-dental"
}

variable "enable_service" {
  description = "Create the Cloud Run service. Set true only after splus-web-prod-stripe-secret-key has a version."
  type        = bool
  default     = false
}

variable "enable_custom_domains" {
  description = "Attach splus.dental + www. Moves the live site off Google Sites: follow the DNS plan in issue #10 first (MX records must stay)."
  type        = bool
  default     = false
}
