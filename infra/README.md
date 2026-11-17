# infra

Terraform for S+ Dental web (GCP project `splusdental`, region `us-west1`). Stephen runs `apply`.
Layout and bootstrap steps are filled in by the Terraform foundation work (issue #4).

Rules: no `.tfstate` or real `.tfvars` in git; state lives in GCS; every resource name is prefixed
`splus-web` / `splusweb` so it never collides with kiwidental or other workloads in the shared project.
