output "runtime_sa_email" {
  description = "Cloud Run runtime service account."
  value       = google_service_account.runtime.email
}

output "runtime_sa_unique_id" {
  description = "Numeric client ID of the runtime SA: authorize it for gmail.send in Workspace domain-wide delegation."
  value       = google_service_account.runtime.unique_id
}

output "service_name" {
  description = "Cloud Run service name (also used in firebase.json rewrites)."
  value       = local.name
}

output "service_uri" {
  description = "Cloud Run service URL, or null while enable_service = false."
  value       = one(google_cloud_run_v2_service.api[*].uri)
}

output "secret_ids" {
  description = "Secret Manager secret IDs for this env."
  value       = { for k, s in google_secret_manager_secret.this : k => s.secret_id }
}

output "hosting_site_id" {
  description = "Firebase Hosting site ID."
  value       = google_firebase_hosting_site.this.site_id
}

output "hosting_default_url" {
  description = "Default Firebase Hosting URL (https://<site>.web.app)."
  value       = google_firebase_hosting_site.this.default_url
}

output "custom_domain_dns_updates" {
  description = "DNS records Firebase asks for, per custom domain (empty while custom domains are disabled)."
  value       = { for d, r in google_firebase_hosting_custom_domain.this : d => r.required_dns_updates }
}

output "admin_hosting_site_id" {
  description = "Firebase Hosting site ID of the staff admin app."
  value       = google_firebase_hosting_site.admin.site_id
}

output "admin_hosting_default_url" {
  description = "Default URL of the staff admin app (https://<site>.web.app)."
  value       = google_firebase_hosting_site.admin.default_url
}

output "admin_domain_dns_updates" {
  description = "DNS records Firebase asks for to serve admin_domain (null while enable_admin_domain = false)."
  value       = one(google_firebase_hosting_custom_domain.admin[*].required_dns_updates)
}
