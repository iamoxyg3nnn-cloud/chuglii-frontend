# SEO indexing and content-removal operations

## Safe default
Recording and individual performer pages are noindex, follow and omitted from the sitemap by default. Public visibility in the application is not treated as evidence that the people or rights holders depicted consented to search-engine promotion.

Do not enable detail indexing until a documented rights/consent review is complete and a takedown process is staffed.

## Enabling reviewed detail pages
Only after that review, set both Vercel Production environment variables to the string true:
- SEO_INDEX_DETAIL_PAGES=true (API/server rendering and sitemap)
- VITE_SEO_INDEX_DETAIL_PAGES=true (client navigation metadata)

Redeploy after changing either variable. Keep both unset/false while reviews are incomplete.

## Sitemap policy
- Core public landing pages remain listed.
- Filtered search pages are noindex by default.
- Tag landing pages enter the sitemap only when a tag has at least five catalogue entries.
- Detail URLs are included only when detail indexing is explicitly enabled.
- lastmod is emitted only from a real source timestamp, never a deployment timestamp.

## Content-removal intake
The public form is /content-removal. Reports are stored in content_removal_requests; browser roles cannot read or write this table. Service-role API handlers accept reports, and admin-only endpoints expose the review queue:
- GET /api/admin/content-removal-requests
- PATCH /api/admin/content-removal-requests/:id

Apply supabase/migrations/021-content-removal-requests.sql to production Supabase before relying on the form. Reports should be reviewed promptly; an intake record is not itself a finding or automatic removal.

## Search Console verification
1. Connect the https://chuglii.in/ or sc-domain:chuglii.in property to the SEO reporting integration.
2. Submit https://chuglii.in/sitemap.xml.
3. Inspect /, /browse, /performers, /tags, one tag landing page, one recording URL and one performer URL.
4. Confirm private and unreviewed pages show noindex and are omitted from the sitemap.
5. Review crawled-not-indexed pages, canonical mismatches, 404s and soft 404s after Google recrawls the changed routes.
