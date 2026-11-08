import { Router, type Request, type Response } from "express";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

const router = Router();
const SITE_URL = "https://chuglii.in";
const DETAIL_INDEXING_ENABLED = process.env.SEO_INDEX_DETAIL_PAGES !== "false";
// Key the template cache on the Vercel deployment ID so stale HTML from a previous
// deployment is never served after a new deploy. Each new deployment gets a fresh
// function instance with a new VERCEL_DEPLOYMENT_ID, so the cache is implicitly cleared.
// Fall back to a short TTL (10 s) so local dev / non-Vercel envs self-heal quickly.
const DEPLOY_ID = process.env.VERCEL_DEPLOYMENT_ID ?? null;
const TEMPLATE_TTL_MS = DEPLOY_ID ? 300_000 : 10_000;
const templateCache = new Map<string, { html: string; deployId: string | null; expiresAt: number }>();

const INDEX_ROBOTS = "index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1";
const NOINDEX_ROBOTS = "noindex, follow";

interface SeoPage {
  title: string;
  description: string;
  canonical: string;
  heading: string;
  intro: string;
  indexable: boolean;
  image?: string;
  type?: "website" | "profile" | "video.other";
}

interface RecordingSeoRow {
  id: string;
  username: string | null;
  room_title: string | null;
  filename: string | null;
  tags: string[] | null;
  timestamp: string | null;
  thumbnail_url: string | null;
  preview_url: string | null;
  duration: number | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeImageUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function setMeta(html: string, attribute: "name" | "property", key: string, value: string): string {
  const pattern = new RegExp("<meta\\b(?=[^>]*\\b" + attribute + "=[\"']" + key + "[\"'])[^>]*>", "i");
  const tag = '<meta ' + attribute + '="' + escapeHtml(key) + '" content="' + escapeHtml(value) + '" />';
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace(/<\/head>/i, "  " + tag + "\n</head>");
}

function setCanonical(html: string, canonical: string): string {
  const pattern = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i;
  const tag = '<link rel="canonical" href="' + escapeHtml(canonical) + '" />';
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace(/<\/head>/i, "  " + tag + "\n</head>");
}

export function renderSeoDocument(template: string, page: SeoPage): string {
  const title = page.title.includes("VAULT") ? page.title : page.title + " | VAULT";
  const robots = page.indexable ? INDEX_ROBOTS : NOINDEX_ROBOTS;
  const image = page.image ?? SITE_URL + "/opengraph.jpg";
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": page.canonical + "#webpage",
    url: page.canonical,
    name: title,
    description: page.description,
    inLanguage: "en",
    isPartOf: { "@id": SITE_URL + "/#website" },
  };
  const jsonLd = JSON.stringify(schema).replace(/</g, "\\u003c");

  let html = template.replace(/<title>[\s\S]*?<\/title>/i, "<title>" + escapeHtml(title) + "</title>");
  html = setMeta(html, "name", "description", page.description);
  html = setMeta(html, "name", "robots", robots);
  html = setMeta(html, "name", "googlebot", robots);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", page.description);
  html = setMeta(html, "property", "og:url", page.canonical);
  html = setMeta(html, "property", "og:type", page.type ?? "website");
  html = setMeta(html, "property", "og:image", image);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", page.description);
  html = setMeta(html, "name", "twitter:image", image);
  html = setCanonical(html, page.canonical);

  const schemaTag = '<script type="application/ld+json" id="vault-server-seo">' + jsonLd + "</script>";
  const schemaPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/i;
  if (schemaPattern.test(html)) {
    html = html.replace(schemaPattern, schemaTag);
  } else {
    html = html.replace(/<\/head>/i, "  " + schemaTag + "\n</head>");
  }

  const fallback = '<main style="max-width:960px;margin:0 auto;padding:40px 20px;font:16px/1.6 system-ui,sans-serif;color:#e5e7eb">' +
    "<h1>" + escapeHtml(page.heading) + "</h1><p>" + escapeHtml(page.intro) + "</p>" +
    '<nav aria-label="Main links"><a href="/browse">Browse</a> Â· <a href="/performers">Performers</a> Â· <a href="/tags">Tags</a> Â· <a href="/content-removal">Report content / request removal</a></nav>' +
    "<p>Adults only (18+).</p></main>";
  html = html.replace(/<div\s+id=["']root["']\s*>\s*<\/div>/i, '<div id="root">' + fallback + "</div>");
  return html;
}

function requestOrigin(req: Request): string {
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const allowed = host === "chuglii.in" || host === "www.chuglii.in" || host.endsWith(".vercel.app");
  return allowed ? "https://" + host : SITE_URL;
}

async function getHtmlTemplate(origin: string): Promise<string> {
  const cached = templateCache.get(origin);
  // Invalidate the cache when a new Vercel deployment is live (DEPLOY_ID changed)
  // or when the TTL has expired. Prevents stale asset hashes from being served
  // after a deploy, which causes text/html MIME errors for .css/.js requests.
  if (cached && cached.deployId === DEPLOY_ID && cached.expiresAt > Date.now()) {
    return cached.html;
  }

  const response = await fetch(new URL("/index.html", origin), {
    headers: { Accept: "text/html", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Could not load frontend HTML template (" + response.status + ")");
  const html = await response.text();
  if (!html.includes('id="root"')) throw new Error("Frontend HTML template is missing #root");
  templateCache.set(origin, { html, deployId: DEPLOY_ID, expiresAt: Date.now() + TEMPLATE_TTL_MS });
  return html;
}

function basePage(
  title: string,
  description: string,
  canonical: string,
  heading: string,
  intro: string,
  indexable = true,
): SeoPage {
  return { title, description, canonical, heading, intro, indexable };
}

async function describePage(req: Request): Promise<SeoPage | null> {
  const requestUrl = new URL(req.originalUrl || req.url, SITE_URL);
  const path = requestUrl.pathname.replace(/\/+$/, "") || "/";
  const params = requestUrl.searchParams;

  if (path === "/") {
    return basePage(
      "Adult Cam Recording Archive & Performer Directory",
      "Search VAULT's public adult cam recording archive by performer, title and tag. Explore public listings and performer profiles. Adults only (18+).",
      SITE_URL + "/",
      "VAULT â€” Adult Cam Recording Archive & Performer Directory",
      "Discover public archive listings by performer, recording title and topic tag. Browse the catalogue, explore the performer directory, and find relevant listings. Adults only (18+).",
    );
  }

  if (path === "/browse") {
    const tags = (params.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
    const functionalKeys = ["search", "gender", "resolution", "sort", "page"];
    const hasOtherFilters = functionalKeys.some((key) => Boolean(params.get(key)));
    const isSingleTagLanding = tags.length === 1 && !hasOtherFilters;
    const canonical = isSingleTagLanding
      ? SITE_URL + "/browse?tags=" + encodeURIComponent(tags[0])
      : SITE_URL + "/browse";
    if (isSingleTagLanding) {
      const tag = tags[0];
      return basePage(
        "#" + tag + " Adult Cam Recordings",
        "Browse public adult cam recording listings tagged #" + tag + " in the VAULT archive. Explore matching entries and related topics. Adults only (18+).",
        canonical,
        "Adult Cam Recordings tagged #" + tag,
        "Explore public recordings associated with the " + tag + " topic tag. You can refine the catalogue by performer, resolution and other available filters.",
      );
    }
    const filtered = functionalKeys.some((key) => Boolean(params.get(key))) || tags.length > 1;
    return basePage(
      "Browse Adult Cam Recordings",
      "Search public VAULT recording listings by title, performer or tag. Filter and sort the catalogue to find relevant entries. Adults only (18+).",
      canonical,
      "Browse Adult Cam Recordings",
      "Search the public recording catalogue by title, performer or tag. Use filters to narrow the catalogue and explore related listings.",
      !filtered,
    );
  }

  if (path === "/performers") {
    return basePage(
      "Adult Performer Directory",
      "Browse the VAULT performer directory and discover public profile listings connected with the recording archive. Adults only (18+).",
      SITE_URL + "/performers",
      "Performer Directory",
      "Explore the performer directory and discover public profiles connected with the archive catalogue. Adults only (18+).",
    );
  }

  if (path === "/tags") {
    return basePage(
      "Browse Recording Tags",
      "Explore the VAULT archive by topic tags and use each tag to find matching public recording listings. Adults only (18+).",
      SITE_URL + "/tags",
      "Browse Recording Tags",
      "Discover catalogue categories and open a tag to view matching public listings. Adults only (18+).",
    );
  }

  if (path === "/premium") {
    return basePage(
      "VAULT Premium â€” Ad-Free Archive Access",
      "Learn about VAULT Premium and account benefits across the archive. Adults only (18+).",
      SITE_URL + "/premium",
      "VAULT Premium",
      "Learn about account benefits and premium access.",
    );
  }

  if (path === "/playlists") {
    return basePage(
      "Public Playlists",
      "Explore public VAULT playlists and curated collections of archive listings. Adults only (18+).",
      SITE_URL + "/playlists",
      "Public Playlists",
      "Explore playlists and curated collections available in the public catalogue.",
    );
  }

  if (path === "/content-removal") {
    return basePage(
      "Report Content or Request Removal",
      "Report a recording or performer listing that may violate privacy, consent, copyright or applicable law.",
      SITE_URL + "/content-removal",
      "Report Content or Request Removal",
      "Use this form to report a listing or request a review for privacy, consent, copyright or other legal concerns.",
      false,
    );
  }

  const videoMatch = path.match(/^\/video\/([^/]+)$/);
  if (videoMatch) {
    const id = decodeURIComponent(videoMatch[1]);
    if (!DETAIL_INDEXING_ENABLED) {
      return basePage(
        "Archived Recording",
        "View an archived recording listing with related public catalogue details. Adults only (18+).",
        SITE_URL + "/video/" + encodeURIComponent(id),
        "Archived Recording",
        "This recording page is available in the VAULT catalogue. Adults only (18+).",
        false,
      );
    }
    const { data, error } = await supabase
      .from("linked_recordings")
      .select("id,username,room_title,filename,tags,timestamp,thumbnail_url,preview_url,duration")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return basePage("Recording Not Found", "The requested recording listing was not found.", SITE_URL + "/video/" + encodeURIComponent(id), "Recording Not Found", "This listing may have been removed.", false);
    const row = data as RecordingSeoRow;
    const name = row.room_title?.trim() || row.filename?.trim() || "Archived Recording";
    const performer = row.username?.trim() || "Performer";
    const tags = (row.tags ?? []).slice(0, 5).map((tag) => "#" + tag).join(", ");
    return {
      ...basePage(
        name + " â€” " + performer,
        "View a public archive listing for " + performer + ". " + (tags ? "Topics: " + tags + ". " : "") + "Adults only (18+).",
        SITE_URL + "/video/" + encodeURIComponent(id),
        name,
        "Performer: " + performer + ". " + (tags ? "Topics: " + tags + ". " : "") + "This is a catalogue listing; playback availability can vary. Adults only (18+).",
        true,
      ),
      image: safeImageUrl(row.thumbnail_url || row.preview_url),
      type: "video.other",
    };
  }

  const performerMatch = path.match(/^\/performers\/([^/]+)$/);
  if (performerMatch) {
    const username = decodeURIComponent(performerMatch[1]);
    if (!DETAIL_INDEXING_ENABLED) {
      return basePage(
        "Adult Performer Profile",
        "Explore a public performer profile and related catalogue listings. Adults only (18+).",
        SITE_URL + "/performers/" + encodeURIComponent(username),
        "Adult Performer Profile",
        "This profile page is available in the VAULT performer directory. Adults only (18+).",
        false,
      );
    }
    const { data, count, error } = await supabase
      .from("linked_recordings")
      .select("id,username,room_title,filename,timestamp,thumbnail_url,preview_url", { count: "exact" })
      .eq("username", username)
      .order("timestamp", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return basePage("Performer Not Found", "The requested performer profile was not found.", SITE_URL + "/performers/" + encodeURIComponent(username), "Performer Not Found", "This profile may have been removed.", false);
    const row = data as { username: string; thumbnail_url?: string | null; preview_url?: string | null };
    const total = count ?? 1;
    return {
      ...basePage(
        username + " â€” " + total.toLocaleString() + " Archive Listings",
        "Explore the public VAULT catalogue for " + username + ", with " + total.toLocaleString() + " linked recording listings. Adults only (18+).",
        SITE_URL + "/performers/" + encodeURIComponent(username),
        username,
        "The VAULT catalogue currently contains " + total.toLocaleString() + " linked recording listings for this performer. Adults only (18+).",
        true,
      ),
      image: safeImageUrl(row.thumbnail_url || row.preview_url),
      type: "profile",
    };
  }

  return null;
}

router.get(
  ["/", "/browse", "/performers", "/tags", "/premium", "/playlists", "/content-removal", "/video/:id", "/performers/:username"],
  async (req: Request, res: Response, next) => {
    try {
      const page = await describePage(req);
      if (!page) {
        next();
        return;
      }
      const template = await getHtmlTemplate(requestOrigin(req));
      const html = renderSeoDocument(template, page);
      res.status(200);
      res.set("Content-Type", "text/html; charset=utf-8");
      // Use a short s-maxage so the CDN re-validates on every deploy.
      // s-maxage=0 forces the CDN to revalidate on every request; stale-while-revalidate
      // lets it serve stale while async revalidating but NOT across deployments since
      // the ETag changes. No stale-while-revalidate to avoid serving old asset-hash HTML.
      const cacheControl = DEPLOY_ID
        ? `public, max-age=0, s-maxage=60, no-cache`
        : "public, max-age=0, must-revalidate";
      res.set("Cache-Control", cacheControl);
      if (DEPLOY_ID) res.set("ETag", `"${DEPLOY_ID}"`);
      res.set("X-Robots-Tag", page.indexable ? "index, follow" : "noindex, follow");
      res.send(html);
    } catch (err) {
      logger.error({ err, path: req.path }, "SEO page render failed");
      res.status(503).type("text/plain").send("Page temporarily unavailable");
    }
  },
);

export default router;
