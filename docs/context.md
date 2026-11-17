# Context

## The practice
- **S+ Dental** — general dentistry, opened June 2023. Dr. Stephanie Kang, DMD.
- 21005 44th Ave W Ste 103, Mountlake Terrace, WA 98043 · (425) 616-2331 · info@splus.dental
- Hours: Tue–Thu 8–5, Fri 7–2, Sat by appointment, Sun/Mon closed.
- Booking: Calendly — https://calendly.com/splus-manager/dental-appointment
- Facebook: https://www.facebook.com/splusdental
- Uses Google Workspace on the `splus.dental` domain (email, Drive).
- Practice-management system today: Fuse (Patterson). Insurance clearinghouse: DentalXChange.

## Current website (as of 2026-11-16)
- Built on **Google Sites**. Pages: Home, About Us, Services, New Patients (Your First Visit, Forms,
  Financing — "coming soon"), Patient Resources ("coming soon"), Contact Us.
- Full text captured in [`docs/content/current-site.md`](content/current-site.md) for migration.
- New-patient packet PDF is on Google Drive (linked from the Forms page).

## Domain / DNS findings (2026-11-16)
- Name servers: `ns-cloud-c{1..4}.googledomains.com`. The domain was registered through Google
  (Workspace / Google Domains); Google Domains moved to Squarespace, so DNS is managed via the Workspace
  Admin console → Domains, which may hand off to Squarespace Domains.
- `www.splus.dental` → CNAME `ghs.googlehosted.com` (Google Sites). Works over HTTPS.
- `splus.dental` (apex) → A `174.129.25.170`, an AWS IP that looks like a free "naked domain → www" HTTP
  redirector (e.g. wwwizer). It answers **HTTP only**:
  - `http://splus.dental` → redirects to `https://www.splus.dental` ✅
  - `https://splus.dental` → `ERR_CONNECTION_TIMED_OUT` ❌
- Chrome tries HTTPS first for typed bare domains, so typing `splus.dental` hangs. **Fix:** short-term,
  replace the apex A record with registrar domain forwarding (HTTPS-capable) to `https://www.splus.dental`.
  Long-term, the new hosting serves both apex and www with managed SSL (see issues).
- No AAAA record on the apex.

## People / roles
- Dr. Kang — practice owner; final say on content; first user of the admin tools.
- Front-desk staff — will use the admin payment-link tool.
- Stephen — builds and operates this; runs Terraform.
