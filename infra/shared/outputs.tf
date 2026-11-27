output "gcp_wif_provider" {
  description = "Set as GitHub repo variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "gcp_deploy_sa" {
  description = "Set as GitHub repo variable GCP_DEPLOY_SA."
  value       = google_service_account.deploy.email
}

output "image_base" {
  description = "Docker image path for the API (tag or digest appended by CI)."
  value       = "${google_artifact_registry_repository.web.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.web.repository_id}/api"
}

output "project_number" {
  description = "Numeric project ID."
  value       = data.google_project.this.number
}

output "sql_instance_name" {
  description = "Cloud SQL instance name (pass to the env roots as sql_instance_name)."
  value       = google_sql_database_instance.pg.name
}

output "sql_connection_name" {
  description = "Cloud SQL connection name project:region:instance (env roots: sql_connection_name)."
  value       = google_sql_database_instance.pg.connection_name
}
