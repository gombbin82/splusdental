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

variable "admin_hd" {
  description = "Google Workspace domain allowed into /admin (ADMIN_HD)."
  type        = string
  default     = "splus.dental"
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
