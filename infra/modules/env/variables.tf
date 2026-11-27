variable "project_id" {
  description = "GCP project."
  type        = string
}

variable "region" {
  description = "Cloud Run region."
  type        = string
}

variable "env" {
  description = "Environment name; used in every resource name."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.env)
    error_message = "env must be \"staging\" or \"prod\"."
  }
}

variable "public_site_url" {
  description = "Public origin of this env, without trailing slash (PUBLIC_SITE_URL)."
  type        = string
}

variable "admin_emails" {
  description = "Google account emails with the admin role (ADMIN_EMAILS). Full access incl. settings/reports."
  type        = list(string)
  default     = []
}

variable "staff_emails" {
  description = "Google account emails with the staff role (STAFF_EMAILS). Payment links only."
  type        = list(string)
  default     = []
}

variable "oauth_client_id" {
  description = "Google OAuth Web client ID (GOOGLE_OAUTH_CLIENT_ID). Not a secret; created manually, see infra/README.md."
  type        = string
  default     = ""
}

variable "deployer_sa_email" {
  description = "GitHub Actions deployer SA (created in infra/shared)."
  type        = string
}

variable "hosting_site_id" {
  description = "Firebase Hosting site ID (globally unique; becomes <id>.web.app)."
  type        = string
}

variable "enable_service" {
  description = "Create the Cloud Run service. Leave false until a version exists for the Stripe secret key secret."
  type        = bool
  default     = false
}

variable "placeholder_image" {
  description = "Image used when Terraform first creates the service. GitHub Actions owns the image afterwards."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "max_instances" {
  description = "Cloud Run max instance count."
  type        = number
  default     = 3
}

variable "deletion_protection" {
  description = "Terraform-level deletion protection for the Cloud Run service."
  type        = bool
  default     = true
}

variable "enable_custom_domains" {
  description = "Attach custom_domains to the Hosting site. Requires DNS changes: see issue #10 before enabling."
  type        = bool
  default     = false
}

variable "custom_domains" {
  description = "Custom domains for the Hosting site, keyed by hostname. redirect_target makes it a redirect to that domain."
  type = map(object({
    redirect_target = optional(string)
  }))
  default = {}
}

variable "admin_hosting_site_id" {
  description = "Firebase Hosting site ID for the staff admin app (globally unique; <id>.web.app)."
  type        = string
}

variable "enable_admin_domain" {
  description = "Attach admin_domain to the admin Hosting site. Only needs new DNS records for that host; independent of enable_custom_domains (apex/www, issue #10)."
  type        = bool
  default     = false
}

variable "admin_domain" {
  description = "Custom hostname for the staff admin app, e.g. admin.splus.dental."
  type        = string
}

variable "ga4_property_id" {
  description = "Numeric GA4 property ID for the admin traffic page (GA4_PROPERTY_ID). Empty disables it. The runtime SA needs Viewer on the property, see infra/README.md."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[0-9]*$", var.ga4_property_id))
    error_message = "ga4_property_id is the numeric property ID (GA → Admin → Property details), not the G-… measurement ID."
  }
}

variable "gmail_sender" {
  description = "Workspace mailbox payment-link emails are sent as (GMAIL_SENDER). Empty disables email. Needs domain-wide delegation, see infra/README.md."
  type        = string
  default     = ""
}

variable "enable_database" {
  description = "Create this env's Postgres database/user on the shared Cloud SQL instance and connect Cloud Run to it (DATABASE_URL)."
  type        = bool
  default     = false
}

variable "sql_instance_name" {
  description = "Shared Cloud SQL instance name (infra/shared output sql_instance_name). Required when enable_database."
  type        = string
  default     = ""
}

variable "sql_connection_name" {
  description = "Shared Cloud SQL connection name project:region:instance (infra/shared output sql_connection_name). Required when enable_database."
  type        = string
  default     = ""
}

variable "enable_seed" {
  description = "Pass the seed secret to Cloud Run as SEED_JSON (practice records added on startup if missing). Turn on only after the secret has a version, see infra/README.md."
  type        = bool
  default     = false
}
