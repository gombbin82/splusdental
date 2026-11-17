# SEO checklist

What the site already does, and what to do around launch (issue #10).

## Built into the site
- Unique `<title>` and meta description per page, written for local searches ("dentist in Mountlake
  Terrace", Lynnwood mentioned where it fits). One `<h1>` per page.
- Absolute canonical URLs on `https://splus.dental` with no trailing slash.
- Structured data (JSON-LD), from `site/src/data/practice.ts`:
  - `Dentist` (a LocalBusiness) on every indexable page: name, address, phone, email, hours, map link,
    Facebook and Google Maps links, areas served, founding date, and Dr. Kang (`Person`, Tufts alumna).
  - On `/services`, the 12 services as offers.
  - `WebSite` on the home page; `BreadcrumbList` on every other page.
  - No made-up ratings, review counts or map coordinates. Add `geo` only with coordinates copied from
    the Google Business Profile.
- Open Graph and Twitter card tags with a 1200×630 preview image (`site/public/og-image.png`, built
  from `site/scripts/og-image.html`).
- `sitemap-index.xml` (public pages only) and `robots.txt` that links to it. Staging builds
  (`PUBLIC_NOINDEX=true`) are `noindex` with a disallow-all robots.txt; `/thank-you`, `/404` and
  `/admin` are always `noindex`.
- 301 redirects in `firebase.json` from the old Google Sites paths (`/home`, `/about-us`,
  `/contact-us`, `/new-patients/your-first-visit`, `/new-patients/forms`,
  `/new-patients/financing`) so existing links and rankings carry over.
- The name, address and phone (NAP) are the same everywhere, in the Google Business Profile format:
  **S+ Dental · 21005 44th Ave W Ste 103, Mountlake Terrace, WA 98043 · (425) 616-2331**.

## At launch
- [ ] **Google Search Console**: add a Domain property for `splus.dental` and verify it with the DNS
      TXT record Google provides. The record goes in through the DNS plan in issue #10; don't touch
      the MX or other mail records.
- [ ] Submit `https://splus.dental/sitemap-index.xml` in Search Console.
- [ ] Use URL Inspection on the home page and request indexing.
- [ ] Run the [Rich Results Test](https://search.google.com/test/rich-results) on `/`, `/services`
      and `/contact`.

## Google Business Profile
- [ ] Set the website link to `https://splus.dental/` (and the booking link to the Calendly URL).
- [ ] Check the name, address, phone and hours match the site exactly. If the hours ever change,
      update both the profile and `site/src/data/practice.ts` at the same time.
- [ ] Add office photos and keep the category as "Dentist".

## Ongoing
- [ ] Ask happy patients for Google reviews; a short link or QR code at the front desk helps. Reply to
      reviews, and never include health details in replies.
- [ ] Keep the same NAP on Facebook, Yelp, insurance directories and other listings.
- [ ] Check Search Console monthly for crawl errors and which searches bring visitors.
- [ ] Fill the "coming soon" pages (Financing, Patient resources) when the content is ready; useful
      content there (FAQs, aftercare) helps search.
