# SEO indexing and content-removal operations

## Indexing policy

Every public route is indexable by default: the homepage, browse, performers,
tags, premium, playlists, recording and performer detail pages, and tag
landings. Search traffic is the primary discovery channel for the archive, so
detail pages are promoted rather than suppressed.

Optional kill switch: to temporarily suppress recording and performer detail
pages, set both Vercel Production environment variables to the string `false`:

- `SEO_INDEX_DETAIL_PAGES=false` (API server rendering and sitemap)
- `VITE_SEO_INDEX_DETAIL_PAGES=false` (client navigation metadata)

Redeploy after changing either variable. Leaving both unset (or `true`) keeps
detail pages indexable.

## Sitemap policy

- Core public landing pages are always listed.
- Recording and performer detail URLs are listed by default.
- Tag landing pages enter the sitemap when a tag has at least one catalogue
  entry.
- `lastmod` is emitted only from a real source timestamp, never a deployment
  timestamp.

## Content-removal intake

The public form is `/content-removal`. Reports are stored in
`content_removal_requests`; browser roles cannot read or write this table.
Service-role API handlers accept reports, and admin-only endpoints expose the
review queue:

- `GET /api/admin/content-removal-requests`
- `PATCH /api/admin/content-removal-requests/:id`

Apply `supabase/migrations/021-content-removal-requests.sql` to production
Supabase before relying on the form. Reports should be reviewed promptly; an
intake record is not itself a finding or automatic removal.

## Search Console verification

1. Connect the `https://chuglii.in/` or `sc-domain:chuglii.in` property to the
   SEO reporting integration.
2. Submit `https://chuglii.in/sitemap.xml`.
3. Inspect `/`, `/browse`, `/performers`, `/tags`, one tag landing page, one
   recording URL and one performer URL.
4. Confirm public pages return `index, follow` and appear in the sitemap.
5. Review crawled-not-indexed pages, canonical mismatches, 404s and soft 404s
   after Google recrawls the changed routes.
