output "service_name" {
  description = "Cloud Run service name."
  value       = module.env.service_name
}

output "service_uri" {
  description = "Cloud Run URL (null until enable_service = true)."
  value       = module.env.service_uri
}

output "runtime_sa_email" {
  description = "Runtime service account."
  value       = module.env.runtime_sa_email
}

output "runtime_sa_unique_id" {
  description = "Client ID to authorize for gmail.send in Workspace domain-wide delegation."
  value       = module.env.runtime_sa_unique_id
}

output "secret_ids" {
  description = "Secrets to add versions to."
  value       = module.env.secret_ids
}

output "hosting_site_id" {
  description = "Firebase Hosting site ID (firebase.json target)."
  value       = module.env.hosting_site_id
}

output "hosting_default_url" {
  description = "Default Hosting URL."
  value       = module.env.hosting_default_url
}

output "custom_domain_dns_updates" {
  description = "DNS records required by Firebase for custom domains."
  value       = module.env.custom_domain_dns_updates
}

output "admin_hosting_default_url" {
  description = "Default URL of the staff admin app."
  value       = module.env.admin_hosting_default_url
}

output "admin_domain_dns_updates" {
  description = "DNS records required for the admin custom domain (null until enable_admin_domain = true)."
  value       = module.env.admin_domain_dns_updates
}
