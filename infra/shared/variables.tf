variable "project_id" {
  description = "GCP project (shared with kiwidental dev and other workloads)."
  type        = string
  default     = "splusdental"
}

variable "region" {
  description = "Default region."
  type        = string
  default     = "us-west1"
}

variable "github_repository" {
  description = "Only GitHub Actions runs from this owner/repo may impersonate the deployer SA."
  type        = string
  default     = "gombbin82/splusdental"
}

variable "billing_account_id" {
  description = "Billing account ID (XXXXXX-XXXXXX-XXXXXX) for the budget alert. Set in terraform.tfvars, never commit it."
  type        = string
}

variable "budget_amount_usd" {
  description = "Monthly budget for the whole project, in USD. Alerts at 50/90/100%."
  type        = number
  default     = 25
}

variable "db_tier" {
  description = "Cloud SQL machine tier. db-f1-micro is the cheapest (~$10/month); db-custom-1-3840 if it feels slow."
  type        = string
  default     = "db-f1-micro"
}
