// Cloudflare Pages Advanced Worker (_worker.js)
// 1. Handles API routes at the Cloudflare Edge directly with Supabase PostgREST
// 2. High-performance Edge Media Proxy for thumbnails and sprites
// 3. Automated Serverless Scraper for Indian MMS & Viral clips (HTTP & Cron)
// 4. Fallback to Cloudflare Pages static assets & SPA routing

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, Range, Prefer, X-Client-Info",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, ETag",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function errorResponse(error, status = 500) {
  return jsonResponse({ error: typeof error === "string" ? error : error?.message || "Internal error" }, status);
}

function escapeXml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(unsafe) {
  if (!unsafe) return "";
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const BOT_REGEX = /bot|crawl|slurp|spider|facebookexternalhit|twitterbot|whatsapp|telegrambot|discordbot|slackbot|googlebot|bingbot|applebot/i;

async function handleSitemap(request, env, url) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3MDAwMDAwMDAsICJleHAiOiAyMDE1MzYwMDAwfQ.NSqjip-vQHwHjATurt4ensfmKBHa4Pt5m_dLP909lV8";

  if (url.pathname === "/sitemap.xml") {
    const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${url.origin}/sitemap-leaks.xml</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${url.origin}/sitemap-japanese.xml</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
  </sitemap>
</sitemapindex>`;
    return new Response(sitemapIndex, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=7200",
      },
    });
  }

  if (url.pathname === "/sitemap-japanese.xml") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_get_japanese_videos`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_source_site: null,
        p_tag: null,
        p_category: null,
        p_search: null,
        p_sort: "newest",
        p_limit: 1000,
        p_offset: 0,
      }),
    });

    const videos = res.ok ? await res.json() : [];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${url.origin}/japanese</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  ${videos.map((v) => `
  <url>
    <loc>${url.origin}/japanese/video/${v.id}</loc>
    <lastmod>${(v.updated_at || v.published_at || new Date().toISOString()).split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <video:video>
      <video:thumbnail_loc>${escapeXml(v.clean_thumbnail_url || v.thumbnail_url || '')}</video:thumbnail_loc>
      <video:title>${escapeXml(v.title)}</video:title>
      <video:description>${escapeXml(v.title + " - Watch Japanese JAV uncensored and amateur video on Chuglii.")}</video:description>
      ${v.full_video_url ? `<video:content_loc>${escapeXml(v.full_video_url)}</video:content_loc>` : ""}
      ${v.duration_seconds ? `<video:duration>${v.duration_seconds}</video:duration>` : ""}
      <video:publication_date>${(v.published_at || new Date().toISOString()).split("T")[0]}</video:publication_date>
      <video:family_friendly>no</video:family_friendly>
    </video:video>
  </url>`).join("")}
</urlset>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=7200",
      },
    });
  }

  if (url.pathname === "/sitemap-leaks.xml") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_get_videos`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_source_site: null,
        p_tag: null,
        p_category: "viral-mms",
        p_search: null,
        p_sort: "newest",
        p_limit: 1000,
        p_offset: 0,
      }),
    });

    const videos = res.ok ? await res.json() : [];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
  <url>
    <loc>${url.origin}/leak</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  ${videos.map((v) => `
  <url>
    <loc>${url.origin}/leak/video/${v.id}</loc>
    <lastmod>${(v.updated_at || v.published_at || new Date().toISOString()).split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
    <video:video>
      <video:thumbnail_loc>${escapeXml(v.clean_thumbnail_url || v.thumbnail_url || '')}</video:thumbnail_loc>
      <video:title>${escapeXml(v.title)}</video:title>
      <video:description>${escapeXml(v.title + " - Watch viral MMS leak and uncut video clip in HD on Chuglii.")}</video:description>
      ${v.full_video_url ? `<video:content_loc>${escapeXml(v.full_video_url)}</video:content_loc>` : ""}
      ${v.duration_seconds ? `<video:duration>${v.duration_seconds}</video:duration>` : ""}
      <video:publication_date>${(v.published_at || new Date().toISOString()).split("T")[0]}</video:publication_date>
      <video:family_friendly>no</video:family_friendly>
    </video:video>
  </url>`).join("")}
</urlset>`;

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=7200",
      },
    });
  }

  return null;
}

async function handleSocialEmbed(request, env, url) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3MDAwMDAwMDAsICJleHAiOiAyMDE1MzYwMDAwfQ.NSqjip-vQHwHjATurt4ensfmKBHa4Pt5m_dLP909lV8";

  // Match /leak/video/:id or /leak/:id
  const match = url.pathname.match(/\/leak\/(?:video\/)?([a-f0-9-]+)/i);
  if (match) {
    const videoId = match[1];
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_get_video_by_id`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_id: videoId }),
    });

    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0) {
        const video = rows[0];
        const pageTitle = `${video.title} - Chuglii Leaks`;
        const pageDesc = `Watch ${video.title} (${video.duration_formatted || "HD"}). Stream thousands of viral MMS leaks and desi clips on Chuglii.`;
        const thumbUrl = video.clean_thumbnail_url || video.thumbnail_url || `${url.origin}/logo.png`;
        const videoUrl = video.full_video_url || video.trailer_preview_url || "";
        const canonical = `${url.origin}/leak/video/${video.id}`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDesc)}" />
  <link rel="canonical" href="${canonical}" />
  <!-- OpenGraph -->
  <meta property="og:site_name" content="Chuglii" />
  <meta property="og:title" content="${escapeHtml(video.title)}" />
  <meta property="og:description" content="${escapeHtml(pageDesc)}" />
  <meta property="og:type" content="video.other" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${escapeHtml(thumbUrl)}" />
  <meta property="og:image:width" content="960" />
  <meta property="og:image:height" content="540" />
  ${videoUrl ? `
  <meta property="og:video" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:secure_url" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:type" content="video/mp4" />
  <meta property="og:video:width" content="1280" />
  <meta property="og:video:height" content="720" />` : ""}
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(video.title)}" />
  <meta name="twitter:description" content="${escapeHtml(pageDesc)}" />
  <meta name="twitter:image" content="${escapeHtml(thumbUrl)}" />
  ${videoUrl ? `
  <meta name="twitter:player" content="${escapeHtml(videoUrl)}" />
  <meta name="twitter:player:width" content="1280" />
  <meta name="twitter:player:height" content="720" />` : ""}
  <!-- Video Schema.org JSON-LD -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "name": ${JSON.stringify(video.title)},
    "description": ${JSON.stringify(pageDesc)},
    "thumbnailUrl": [${JSON.stringify(thumbUrl)}],
    "uploadDate": ${JSON.stringify(video.published_at || new Date().toISOString())},
    "duration": "PT${video.duration_seconds || 0}S",
    "contentUrl": ${JSON.stringify(videoUrl)}
  }
  </script>
</head>
<body style="background:#09090b;color:#f4f4f5;font-family:sans-serif;padding:2rem;text-align:center;">
  <h1>${escapeHtml(video.title)}</h1>
  <p>${escapeHtml(pageDesc)}</p>
  <p><a href="${canonical}" style="color:#f43f5e;">Watch Video on Chuglii &rarr;</a></p>
  <script>window.location.replace("${canonical}");</script>
</body>
</html>`;

        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
          },
        });
      }
    }
  }

  // Catalog general share embed
  if (url.pathname === "/leak" || url.pathname === "/leak/") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Viral MMS Leaks & Video Feed - Chuglii</title>
  <meta name="description" content="Stream thousands of viral clips, uncut web-series, and exclusive leaked private tapes in HD." />
  <link rel="canonical" href="${url.origin}/leak" />
  <meta property="og:site_name" content="Chuglii" />
  <meta property="og:title" content="Viral MMS Leaks & Private Video Feed | Chuglii" />
  <meta property="og:description" content="Stream thousands of viral clips, uncut web-series, and exclusive leaked private tapes in HD." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url.origin}/leak" />
  <meta property="og:image" content="${url.origin}/logo.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Viral MMS Leaks & Video Feed - Chuglii" />
  <meta name="twitter:description" content="Stream thousands of viral clips, uncut web-series, and exclusive leaked private tapes in HD." />
</head>
<body style="background:#09090b;color:#f4f4f5;font-family:sans-serif;padding:2rem;text-align:center;">
  <h1>Viral MMS Leaks & Private Video Feed</h1>
  <p><a href="${url.origin}/leak" style="color:#f43f5e;">Explore Leaks on Chuglii &rarr;</a></p>
  <script>window.location.replace("${url.origin}/leak");</script>
</body>
</html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  }

  // Match /japanese/video/:id or /japanese/:id
  const japMatch = url.pathname.match(/\/japanese\/(?:video\/)?([a-f0-9-]+)/i);
  if (japMatch) {
    const videoId = japMatch[1];
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_get_japanese_video_by_id`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_id: videoId }),
    });

    if (res.ok) {
      const rows = await res.json();
      if (rows && rows.length > 0) {
        const video = rows[0];
        const pageTitle = `${video.title} - Japanese Vault`;
        const pageDesc = `Watch ${video.title} (${video.duration_formatted || "HD"}). Stream Japanese JAV uncensored and amateur tapes in HD on Chuglii.`;
        const thumbUrl = video.clean_thumbnail_url || video.thumbnail_url || `${url.origin}/logo.png`;
        const videoUrl = video.full_video_url || video.trailer_preview_url || "";
        const canonical = `${url.origin}/japanese/video/${video.id}`;

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(pageTitle)}</title>
  <meta name="description" content="${escapeHtml(pageDesc)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:site_name" content="Chuglii" />
  <meta property="og:title" content="${escapeHtml(video.title)}" />
  <meta property="og:description" content="${escapeHtml(pageDesc)}" />
  <meta property="og:type" content="video.other" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${escapeHtml(thumbUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(video.title)}" />
  <meta name="twitter:description" content="${escapeHtml(pageDesc)}" />
  <meta name="twitter:image" content="${escapeHtml(thumbUrl)}" />
</head>
<body style="background:#09090b;color:#f4f4f5;font-family:sans-serif;padding:2rem;text-align:center;">
  <h1>${escapeHtml(video.title)}</h1>
  <p>${escapeHtml(pageDesc)}</p>
  <p><a href="${canonical}" style="color:#f43f5e;">Watch Video on Chuglii &rarr;</a></p>
  <script>window.location.replace("${canonical}");</script>
</body>
</html>`;
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=86400, s-maxage=604800",
          },
        });
      }
    }
  }

  // Japanese catalog general share embed
  if (url.pathname === "/japanese" || url.pathname === "/japanese/") {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Japanese JAV Vault & Video Feed - Chuglii</title>
  <meta name="description" content="Stream thousands of uncensored Japanese adult videos, FC2-PPV releases, and amateur recordings in HD." />
  <link rel="canonical" href="${url.origin}/japanese" />
  <meta property="og:site_name" content="Chuglii" />
  <meta property="og:title" content="Japanese JAV Vault & Video Feed | Chuglii" />
  <meta property="og:description" content="Stream thousands of uncensored Japanese adult videos, FC2-PPV releases, and amateur recordings in HD." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url.origin}/japanese" />
  <meta property="og:image" content="${url.origin}/logo.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="Japanese JAV Vault & Video Feed - Chuglii" />
  <meta name="twitter:description" content="Stream thousands of uncensored Japanese adult videos, FC2-PPV releases, and amateur recordings in HD." />
</head>
<body style="background:#09090b;color:#f4f4f5;font-family:sans-serif;padding:2rem;text-align:center;">
  <h1>Japanese JAV Vault & Video Feed</h1>
  <p><a href="${url.origin}/japanese" style="color:#f43f5e;">Explore Japanese Videos on Chuglii &rarr;</a></p>
  <script>window.location.replace("${url.origin}/japanese");</script>
</body>
</html>`;
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  }

  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Handle CORS preflight for all /api requests
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 2. Route /api/* requests
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return errorResponse(err, 500);
      }
    }

    // 3. Dynamic Sitemaps (/sitemap.xml, /sitemap-leaks.xml, /sitemap-japanese.xml)
    if (url.pathname === "/sitemap.xml" || url.pathname === "/sitemap-leaks.xml" || url.pathname === "/sitemap-japanese.xml") {
      try {
        const sitemapRes = await handleSitemap(request, env, url);
        if (sitemapRes) return sitemapRes;
      } catch (err) {
        return new Response("Sitemap generation error", { status: 500 });
      }
    }

    // 4. Edge OpenGraph / Social Bot Metadata injection for Leaks & Japanese
    const userAgent = request.headers.get("user-agent") || "";
    if (BOT_REGEX.test(userAgent)) {
      if (url.pathname.startsWith("/leak") || url.pathname.startsWith("/japanese")) {
        try {
          const socialResponse = await handleSocialEmbed(request, env, url);
          if (socialResponse) return socialResponse;
        } catch (err) {
          // fallback to assets
        }
      }
    }

    // 5. Fallback to Cloudflare Pages static assets & SPA routing
    const assetResponse = await env.ASSETS.fetch(request);

    // Guard: never let the SPA fallback masquerade as a hashed static asset.
    // During deploy propagation a not-yet-uploaded /assets/<chunk>.js request
    // gets the index.html fallback — and the /assets/* _headers rule stamps it
    // `immutable`, so the browser caches HTML in place of the JS chunk for a
    // year and every later module import fails the MIME check. Serve a
    // non-cacheable 404 instead so clients retry against the next deployment.
    if (url.pathname.startsWith("/assets/") && assetResponse.status === 200) {
      const ct = assetResponse.headers.get("content-type") || "";
      if (ct.includes("text/html")) {
        return new Response("Asset not found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }
    return assetResponse;
  },

  // Automated Cron Trigger handler for Cloudflare Workers
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncMmsvibex(env, 2));
  },
};

// ─── Scraper Helper Functions ────────────────────────────────────────

function parseDurationSeconds(str) {
  if (!str) return 0;
  const parts = str.trim().split(":").map(p => parseInt(p, 10));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function parseViewsNumber(str) {
  if (!str) return 0;
  const s = str.trim().toUpperCase();
  const num = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return 0;
  if (s.includes("M")) return Math.round(num * 1000000);
  if (s.includes("K")) return Math.round(num * 1000);
  return Math.round(num);
}

function extractTagsFromTitle(title) {
  const commonTags = [
    "desi", "bhabhi", "amateur", "teen", "viral", "mms", "village", "aunty",
    "web-series", "hot", "romance", "mallu", "tamil", "telugu", "bengali",
    "bhojpuri", "college", "girlfriend", "call-recording", "leaked", "scandal"
  ];
  const tLower = (title || "").toLowerCase();
  const tags = new Set();
  for (const tag of commonTags) {
    if (tLower.includes(tag.replace("-", " ")) || tLower.includes(tag)) {
      tags.add(tag);
    }
  }
  if (tags.size === 0) tags.add("desi");
  return Array.from(tags);
}

async function scrapeMmsPage(pageNum, category = null) {
  let url;
  if (category && category !== "all" && category !== "indian") {
    url = pageNum === 1
      ? `https://mmsvibex.life/category/${encodeURIComponent(category)}/`
      : `https://mmsvibex.life/category/${encodeURIComponent(category)}/page/${pageNum}/`;
  } else {
    url = pageNum === 1
      ? "https://mmsvibex.life/?filter=latest"
      : `https://mmsvibex.life/page/${pageNum}/?filter=latest`;
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) return [];
  const html = await res.text();

  // Parse articles via regex
  const articleRegex = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  const items = [];
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    const attrString = match[1];
    const body = match[2];

    const postIdMatch = attrString.match(/data-post-id=["'](\d+)["']/i);
    if (!postIdMatch) continue;
    const postId = postIdMatch[1];

    const trailerMatch = attrString.match(/data-trailer=["']([^"']+)["']/i);
    const trailerUrl = trailerMatch ? trailerMatch[1] : "";

    const mainThumbMatch = attrString.match(/data-main-thumb=["']([^"']+)["']/i);

    // Extract title & link
    const titleMatch = body.match(/class=["']title["'][^>]*>([^<]+)<\//i)
      || body.match(/title=["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1].trim() : `MMS Clip #${postId}`;

    const linkMatch = body.match(/href=["'](https?:\/\/[^"']+)["']/i);
    const detailUrl = linkMatch ? linkMatch[1] : `https://mmsvibex.life/video/${postId}/`;

    // Extract thumbnail
    const thumbMatch = body.match(/src=["']([^"']+)["']/i);
    const thumbUrl = (mainThumbMatch && mainThumbMatch[1])
      || (thumbMatch && thumbMatch[1])
      || `https://cdn.mmsvibex.fit/thumbnails/${postId}_thumb_960.jpg`;

    // Extract duration
    const durMatch = body.match(/class=["']duration["'][^>]*>([^<]+)<\//i);
    const durFormatted = durMatch ? durMatch[1].trim() : "00:00";

    // Extract views
    const viewsMatch = body.match(/class=["']views["'][^>]*>([^<]+)<\//i);
    const viewsRaw = viewsMatch ? viewsMatch[1].trim() : "0";

    // Extract rating
    const ratingMatch = body.match(/class=["']rating["'][^>]*>([^<]+)<\//i);
    const ratingRaw = ratingMatch ? ratingMatch[1].trim() : "0%";

    // Fast direct CDN processed stream derivation
    let fullVideoUrl = `https://cdn.mmsvibex.fit/processed/${postId}_final.mp4`;
    if (trailerUrl) {
      const trMatch = trailerUrl.match(/\/trailers\/(\d+)_trailer\.mp4/i);
      if (trMatch) {
        fullVideoUrl = `https://cdn.mmsvibex.fit/processed/${trMatch[1]}_final.mp4`;
      }
    }

    // Parse classes for categories, tags, actors
    const classMatch = attrString.match(/class=["']([^"']+)["']/i);
    const classes = classMatch ? classMatch[1].split(/\s+/) : [];

    const categories = classes
      .filter(c => c.startsWith("category-"))
      .map(c => c.replace("category-", ""));
    if (!categories.includes("indian")) categories.push("indian");

    const tags = classes
      .filter(c => c.startsWith("tag-"))
      .map(c => c.replace("tag-", ""));
    if (tags.length === 0) {
      extractTagsFromTitle(title).forEach(t => tags.push(t));
    }

    const actors = classes
      .filter(c => c.startsWith("actors-"))
      .map(c => c.replace("actors-", ""));

    items.push({
      source_site: "mmsvibex",
      source_post_id: postId,
      title,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100),
      detail_url: detailUrl,
      full_video_url: fullVideoUrl,
      video_mime_type: "video/mp4",
      trailer_preview_url: trailerUrl || null,
      thumbnail_url: thumbUrl,
      clean_thumbnail_url: thumbUrl,
      duration_seconds: parseDurationSeconds(durFormatted),
      duration_formatted: durFormatted,
      views_count: parseViewsNumber(viewsRaw),
      views_raw: viewsRaw,
      rating_score: parseFloat(ratingRaw) || 0,
      rating_raw: ratingRaw,
      categories,
      tags,
      actors,
      published_at: new Date().toISOString(),
      raw_payload: { post_id: postId, trailer: trailerUrl },
    });
  }

  return items;
}

async function syncMmsvibex(env, maxPages = 2, category = null) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

  let allItems = [];
  for (let p = 1; p <= maxPages; p++) {
    try {
      const items = await scrapeMmsPage(p, category);
      allItems.push(...items);
    } catch {}
  }

  if (allItems.length === 0) {
    return { success: false, items_scraped: 0, message: "No items parsed" };
  }

  // Upsert into Supabase via RPC bridge
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_upsert_videos`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items: allItems }),
  });

  const result = await res.json();
  return {
    success: res.ok,
    pages_crawled: maxPages,
    items_scraped: allItems.length,
    upsert_result: result,
  };
}

// ─── API Router ──────────────────────────────────────────────────────

async function handleApi(request, env, url) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3MDAwMDAwMDAsICJleHAiOiAyMDE1MzYwMDAwfQ.NSqjip-vQHwHjATurt4ensfmKBHa4Pt5m_dLP909lV8";

  const path = url.pathname.replace(/\/+$/, "");

  // ─── Image & Media Proxy (/api/media) ──────────────────────────────
  if (path === "/api/media") {
    const targetUrl = url.searchParams.get("url");
    if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
      return errorResponse("Missing or invalid url parameter", 400);
    }

    try {
      const targetObj = new URL(targetUrl);
      let referer = "https://chuglii.in/";
      if (
        targetObj.hostname.includes("influencersgonewild") ||
        targetObj.hostname.includes("internetchicks") ||
        targetObj.hostname.includes("sheeshfans") ||
        targetObj.hostname.includes("pixhost.to") ||
        targetObj.hostname.includes("catbox.moe") ||
        targetObj.hostname.includes("imgpile.com") ||
        targetObj.hostname.includes("buumal.com")
      ) {
        referer = `${targetObj.origin}/`;
      }

      let upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": referer,
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        cf: {
          cacheTtl: 31536000,
          cacheEverything: true,
        },
      });

      // If upstream failed with 403, retry without Referer header
      if (!upstreamRes.ok && upstreamRes.status === 403) {
        upstreamRes = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          cf: {
            cacheTtl: 31536000,
            cacheEverything: true,
          },
        });
      }

      if (!upstreamRes.ok) {
        return Response.redirect(targetUrl, 302);
      }

      const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Vary", "Accept");

      return new Response(upstreamRes.body, { status: 200, headers });
    } catch {
      return Response.redirect(targetUrl, 302);
    }
  }

// ─── Clean Video Player Renderer (Ad-Free Hls.js / HTML5) ────────
function lastPathSegment(raw) {
  try {
    const u = new URL(String(raw || ""), "https://chuglii.pages.dev/");
    const parts = u.pathname.split("/").filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || "");
  } catch {
    return String(raw || "");
  }
}

function qualityFromValue(raw) {
  const text = lastPathSegment(raw).toLowerCase();
  if (/\b(?:4k|uhd|2160p?)\b/.test(text)) return 2160;
  const m = text.match(/(?<!\d)(2160|1440|1080|720|480|360)p?(?!\d)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Streamtape hides the real MP4 behind an IP-bound /get_video token. The token
// must be issued and consumed by the same edge request, so callers never send
// it to the browser. botlink/robotlink carry the valid link; ideoolink is a
// deliberately corrupted decoy.
function decodeStreamtapeLink(html, elementId) {
  const match = html.match(
    new RegExp("document\\.getElementById\\(['\"]" + elementId + "['\"]\\)\\.innerHTML\\s*=\\s*([^;]+);", "i"),
  );
  if (!match) return "";
  const expr = match[1];
  const paren = expr.match(/\(\s*(['"])([\s\S]*?)\1\s*\)/);
  if (!paren) return "";
  let value = paren[2];
  for (const sub of expr.slice(paren.index + paren[0].length).matchAll(/\.substring\((\d+)\)/g)) {
    value = value.substring(parseInt(sub[1], 10));
  }
  let prefix = "";
  for (const str of expr.slice(0, paren.index).matchAll(/(['"])([\s\S]*?)\1/g)) {
    prefix += str[2];
  }
  const link = prefix + value;
  return link.startsWith("//") ? "https:" + link : link;
}

async function resolveStreamtapeGate(streamtapeUrl) {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const pageRes = await fetch(streamtapeUrl, {
    headers: {
      "User-Agent": ua,
      "Referer": "https://internetchicks.com/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!pageRes.ok) return "";
  const pageHtml = await pageRes.text();
  const gate = decodeStreamtapeLink(pageHtml, "botlink") || decodeStreamtapeLink(pageHtml, "robotlink");
  if (!/^https?:\/\//i.test(gate) || !gate.includes("/get_video")) return "";
  return gate;
}

function renderCleanMp4Player(streams, title = '', poster = '') {
  const safeTitle = (title || 'Chuglii Player').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safePoster = poster ? String(poster).replace(/"/g, '&quot;') : '';
  const list = Array.isArray(streams) ? streams.filter(s => s && s.url) : [];
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><meta name="referrer" content="no-referrer"><title>${safeTitle}</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative}video{width:100%;height:100%;max-height:100vh;object-fit:contain;background:#000}.control-overlay{position:absolute;top:12px;right:12px;z-index:50}.quality-select{background:rgba(15,23,42,.88);color:#f8fafc;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:5px 10px;font-size:13px;font-family:system-ui,-apple-system,sans-serif;cursor:pointer}.quality-select option{background:#0f172a;color:#fff}</style></head><body><div id="quality-wrap" class="control-overlay" style="display:none"><select id="quality-selector" class="quality-select" title="Select Video Quality"></select></div><video id="player" controls autoplay muted playsinline referrerpolicy="no-referrer" ${safePoster ? `poster="${safePoster}"` : ''}></video><script>(function(){var v=document.getElementById('player'),s=${JSON.stringify(list)},sel=document.getElementById('quality-selector'),w=document.getElementById('quality-wrap');if(!s.length)return;function label(x){var l=x.label||(x.quality?(x.quality+'p'):'Original');if(x.quality>=1080&&!/full\s*hd/i.test(l))l+=' Full HD';else if(x.quality>=720&&x.quality<1080&&!/\bhd\b/i.test(l))l+=' HD';return l}if(s.length>1){w.style.display='block';s.forEach(function(x,i){var o=document.createElement('option');o.value=String(i);o.textContent=label(x);sel.appendChild(o)})}function set(i,keep){i=Math.max(0,Math.min(s.length-1,i));var t=keep?(v.currentTime||0):0,p=v.paused;sel.value=String(i);var usedFallback=false;var onError=function(){v.removeEventListener('error',onError);var fb=s[i].fallbackUrl;if(fb&&!usedFallback){usedFallback=true;v.src=fb;v.addEventListener('error',onError);v.load()}else if(i<s.length-1){set(i+1,keep)}};v.addEventListener('error',onError);v.src=s[i].url;v.addEventListener('loadedmetadata',function m(){v.removeEventListener('loadedmetadata',m);try{if(t>0)v.currentTime=Math.min(t,Math.max(0,(v.duration||t)-.25))}catch(e){}if(!p){v.muted=true;v.play().catch(function(){})}});v.load()}sel.addEventListener('change',function(){set(parseInt(sel.value,10)||0,true)});set(0,false);v.play().catch(function(){v.muted=true;v.play().catch(function(){})})})();</script><script>(function(){function n(t,d){try{parent.postMessage({source:'chuglii-player',type:t,detail:d||{}},'*')}catch(e){}}var v=document.getElementById('player');v.addEventListener('playing',function(){n('player:playing')});v.addEventListener('ended',function(){n('player:ended')});v.addEventListener('error',function(){n('player:error',{code:'media_error',message:(v.error&&v.error.message)||'This stream failed to play.'})})})();</script></body></html>`;
}

function renderCleanHlsPlayer(streamingUrl, title = "", poster = "") {
  const safeTitle = (title || "Chuglii Player").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isHls = streamingUrl.includes(".m3u8") || streamingUrl.includes("/hls/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${safeTitle}</title>
  ${isHls ? '<script src="/api/player/hls.js"></script>' : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; }
    video { width: 100%; height: 100%; max-height: 100vh; object-fit: contain; background: #000; outline: none; }
    .control-overlay { position: absolute; top: 12px; right: 12px; z-index: 50; display: flex; align-items: center; gap: 8px; opacity: 0.85; transition: opacity 0.2s ease; }
    .control-overlay:hover { opacity: 1; }
    .quality-select { background: rgba(15, 23, 42, 0.85); color: #f8fafc; border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 6px; padding: 5px 10px; font-size: 13px; font-family: system-ui, -apple-system, sans-serif; cursor: pointer; outline: none; backdrop-filter: blur(8px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5); }
    .quality-select option { background: #0f172a; color: #fff; }
  </style>
</head>
<body>
  <div id="quality-wrap" class="control-overlay" style="display: none;">
    <select id="quality-selector" class="quality-select" title="Select Video Quality">
      <option value="-1">Auto (Best)</option>
    </select>
  </div>
  <video id="player" controls autoplay playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      function notify(type, detail) {
        try { parent.postMessage({ source: 'chuglii-player', type: type, detail: detail || {} }, '*'); } catch (err) {}
      }
      var hlsRetries = 0;
      var video = document.getElementById('player');
      video.addEventListener('playing', function() { notify('player:playing'); });
      video.addEventListener('ended', function() { notify('player:ended'); });
      video.addEventListener('error', function() {
        notify('player:error', { code: 'media_error', message: (video.error && video.error.message) || 'This stream failed to play.' });
      });
      var streamUrl = ${JSON.stringify(streamingUrl)};
      ${isHls ? `
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 30
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        // A successful load starts a fresh retry budget; only consecutive
        // network failures should escalate to a hard error.
        if (Hls.Events.FRAG_LOADED) {
          hls.on(Hls.Events.FRAG_LOADED, function() { hlsRetries = 0; });
        }
        hls.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
          hlsRetries = 0;
          try {
            var levels = hls.levels;
            var selector = document.getElementById('quality-selector');
            var wrap = document.getElementById('quality-wrap');
            if (levels && levels.length > 0) {
              var sorted = levels.map(function(lvl, idx) {
                return { idx: idx, height: lvl.height || 0, bitrate: lvl.bitrate || 0 };
              }).sort(function(a, b) {
                return b.height !== a.height ? b.height - a.height : b.bitrate - a.bitrate;
              });

              // Start in adaptive/auto mode so the player can step down on a
              // slow connection instead of stalling on the highest rendition.
              var highestLevel = sorted[0].idx;
              hls.currentLevel = -1;

              if (levels.length > 1) {
                wrap.style.display = 'flex';
                selector.innerHTML = '<option value="-1">Auto (Best)</option>';
                sorted.forEach(function(item) {
                  var label = item.height ? (item.height + 'p') : ('Level ' + (item.idx + 1));
                  if (item.height >= 1080) label += ' Full HD';
                  else if (item.height >= 720) label += ' HD';
                  var opt = document.createElement('option');
                  opt.value = item.idx;
                  opt.textContent = label;
                  selector.appendChild(opt);
                });
                selector.value = "-1";
                selector.addEventListener('change', function() {
                  var val = parseInt(selector.value, 10);
                  hls.currentLevel = val;
                });
              }
            }
          } catch(err) {
            console.warn('Quality selector init error:', err);
          }
          video.play().catch(function() {
            video.muted = true;
            video.play().catch(function() {});
          });
        });
        hls.on(Hls.Events.ERROR, function(event, data) {
          if (data && data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (hlsRetries < 2) {
                  hlsRetries += 1;
                  console.warn("HLS Network error, retrying stream...", data);
                  hls.startLoad();
                } else {
                  notify('player:error', { code: 'hls_network_error', message: 'The stream could not be loaded after retries.' });
                  hls.destroy();
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.warn("HLS Media error, recovering...", data);
                hls.recoverMediaError();
                break;
              default:
                console.error("HLS fatal error:", data);
                notify('player:error', { code: 'hls_error', message: 'The stream stopped unexpectedly.' });
                hls.destroy();
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function() {
          video.play().catch(function() {
            video.muted = true;
            video.play().catch(function() {});
          });
        });
      } else {
        video.src = streamUrl;
      }
      ` : `
      video.src = streamUrl;
      video.play().catch(function() {});
      `}
    })();
  </script>
</body>
</html>`;
}

// ─── api.php → play.m3u8 Resolver (Chinese CDN endpoints) ───────────
// The 95da network's api.php endpoints (zone=1&md5=<hash>) deterministically
// resolve to play.m3u8?zone=1&dir=<hash> on the same host — a pure string
// transform, no upstream fetch needed.
function apiPhpToM3u8(u) {
  try {
    const o = new URL(u);
    if (!o.pathname.endsWith("/api.php")) return null;
    const md5 = o.searchParams.get("md5");
    if (!md5) return null;
    const zone = o.searchParams.get("zone") || "1";
    return `${o.origin}/play.m3u8?zone=${encodeURIComponent(zone)}&dir=${encodeURIComponent(md5)}`;
  } catch (e) {
    return null;
  }
}

// ─── Multi-Candidate HLS Player (endpoint failover) ────────────────
// Same UI/behavior as renderCleanHlsPlayer, but takes an ordered list of
// proxied manifest URLs. On fatal errors it fails over to the next candidate
// (preserving playback position), so dead or geo-blocked CDN endpoints never
// kill playback as long as any endpoint serves the manifest.
function renderCleanHlsPlayerMulti(candidates, title = "", poster = "") {
  const safeTitle = (title || "Chuglii Player").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${safeTitle}</title>
  <script src="/api/player/hls.js" onerror="var s=document.createElement('script');s.src='https://unpkg.com/hls.js@1.5.8/dist/hls.min.js';document.head.appendChild(s);"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; }
    video { width: 100%; height: 100%; max-height: 100vh; object-fit: contain; background: #000; outline: none; }
    .control-overlay { position: absolute; top: 12px; right: 12px; z-index: 50; display: flex; align-items: center; gap: 8px; opacity: 0.85; transition: opacity 0.2s ease; }
    .control-overlay:hover { opacity: 1; }
    .quality-select { background: rgba(0,0,0,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.25); border-radius: 6px; padding: 4px 8px; font-size: 12px; cursor: pointer; outline: none; }
    .quality-select option { background: #111; color: #fff; }
    .failover-badge { position: absolute; top: 12px; left: 12px; z-index: 50; background: rgba(0,0,0,0.65); color: #fbbf24; border: 1px solid rgba(251,191,36,0.4); border-radius: 6px; padding: 4px 10px; font-size: 11px; font-family: system-ui, sans-serif; display: none; }
  </style>
</head>
<body>
  <div id="quality-wrap" class="control-overlay" style="display: none;">
    <select id="quality-selector" class="quality-select" title="Select Video Quality">
      <option value="-1">Auto (Best)</option>
    </select>
  </div>
  <div id="failover-badge" class="failover-badge"></div>
  <video id="player" controls autoplay playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      function notify(type, detail) {
        try { parent.postMessage({ source: 'chuglii-player', type: type, detail: detail || {} }, '*'); } catch (err) {}
      }
      var video = document.getElementById('player');
      var badge = document.getElementById('failover-badge');
      var candidates = ${JSON.stringify(candidates)};
      var ci = 0;
      var hls = null;
      var hlsRetries = 0;

      function destroyHls() {
        if (hls) { try { hls.destroy(); } catch (err) {} hls = null; }
      }

      function buildQualitySelector(hlsInstance) {
        try {
          var levels = hlsInstance.levels;
          var selector = document.getElementById('quality-selector');
          var wrap = document.getElementById('quality-wrap');
          if (levels && levels.length > 0) {
            var sorted = levels.map(function(lvl, idx) {
              return { idx: idx, height: lvl.height || 0, bitrate: lvl.bitrate || 0 };
            }).sort(function(a, b) {
              return b.height !== a.height ? b.height - a.height : b.bitrate - a.bitrate;
            });
            hlsInstance.currentLevel = -1;
            if (levels.length > 1) {
              wrap.style.display = 'flex';
              selector.innerHTML = '<option value="-1">Auto (Best)</option>';
              sorted.forEach(function(item) {
                var label = item.height ? (item.height + 'p') : ('Level ' + (item.idx + 1));
                if (item.height >= 1080) label += ' Full HD';
                else if (item.height >= 720) label += ' HD';
                var opt = document.createElement('option');
                opt.value = item.idx;
                opt.textContent = label;
                selector.appendChild(opt);
              });
              selector.value = "-1";
              selector.onchange = function() {
                hlsInstance.currentLevel = parseInt(selector.value, 10);
              };
            }
          }
        } catch (err) { console.warn('Quality selector init error:', err); }
      }

      function startPlayback(keepTime) {
        var t = keepTime ? (video.currentTime || 0) : 0;
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90, maxBufferLength: 30 });
          hls.on(Hls.Events.FRAG_LOADED, function() { hlsRetries = 0; });
          hls.on(Hls.Events.MANIFEST_PARSED, function() {
            hlsRetries = 0;
            buildQualitySelector(hls);
            if (t > 0) { try { video.currentTime = t; } catch (err) {} }
            video.play().catch(function() { video.muted = true; video.play().catch(function() {}); });
          });
          hls.on(Hls.Events.ERROR, function(event, data) {
            if (data && data.fatal) {
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR && hlsRetries < 2) {
                hlsRetries += 1;
                console.warn('HLS network error, retrying...', data);
                try { hls.startLoad(); } catch (err) { nextCandidate(); }
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                console.warn('HLS media error, recovering...', data);
                try { hls.recoverMediaError(); } catch (err) { nextCandidate(); }
              } else {
                console.error('HLS fatal error:', data);
                nextCandidate();
              }
            }
          });
          hls.loadSource(candidates[ci]);
          hls.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS (Safari / iOS)
          video.src = candidates[ci];
          video.addEventListener('loadedmetadata', function onMeta() {
            video.removeEventListener('loadedmetadata', onMeta);
            if (t > 0) { try { video.currentTime = t; } catch (err) {} }
            video.play().catch(function() { video.muted = true; video.play().catch(function() {}); });
          });
        } else {
          video.src = candidates[ci];
        }
      }

      function nextCandidate() {
        destroyHls();
        hlsRetries = 0;
        if (ci < candidates.length - 1) {
          ci += 1;
          if (badge) {
            badge.style.display = 'block';
            badge.textContent = 'Switching stream source ' + (ci + 1) + '/' + candidates.length + '...';
          }
          console.log('Failing over to candidate ' + (ci + 1) + ' of ' + candidates.length);
          startPlayback(true);
        } else {
          notify('player:error', { code: 'media_error', message: 'This stream failed to play. Please try again later.' });
        }
      }

      video.addEventListener('playing', function() {
        if (badge) badge.style.display = 'none';
        notify('player:playing');
      });
      video.addEventListener('ended', function() { notify('player:ended'); });
      video.addEventListener('error', function() {
        // Native-HLS path errors only (hls.js path handles its own errors)
        if (!hls) nextCandidate();
      });

      // hls.js may still be downloading (script onerror fallback chain);
      // wait briefly for it before booting so the native-HLS fallback is a
      // last resort rather than a race loser.
      function bootWhenReady(attempt) {
        if (typeof Hls !== 'undefined' || attempt > 50) startPlayback(false);
        else setTimeout(function() { bootWhenReady(attempt + 1); }, 100);
      }
      bootWhenReady(0);
    })();
  </script>
</body>
</html>`;
}

// ─── BuuMal (Myanmar) DB-assisted Resolver ──────────────────────────
// BuuMal returns a 1-hour presigned Cloudflare R2 MP4 URL on each video page.
// Cloudflare Worker egress is blocked by BuuMal's managed bot challenge, so the
// resolve is delegated to the database host (which is not challenged) through
// the scraper_resolve_myanmar_stream_by_id RPC.
async function resolveBuumalStreamViaDb(targetUrl, supabaseUrl, supabaseKey) {
  try {
    const postId = new URL(targetUrl).pathname.match(/\/video\/([A-Za-z0-9]+)/)?.[1];
    if (!postId) return null;

    const rpcRes = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/scraper_resolve_myanmar_stream_by_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ p_post_id: postId }),
    });
    if (!rpcRes.ok) return null;
    const raw = await rpcRes.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
    return typeof parsed === "string" && parsed.startsWith("http") ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Universal Dean Edwards Unpacker & Stream Extractor ─────────────
function unpackDeanEdwards(p, a, c, k) {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const encode = (n) => {
    if (n === 0) return "0";
    let res = "";
    while (n > 0) {
      res = chars[n % a] + res;
      n = Math.floor(n / a);
    }
    return res;
  };
  while (c--) {
    if (k[c]) {
      const rep = encode(c);
      p = p.replace(new RegExp('\\b' + rep + '\\b', 'g'), k[c]);
    }
  }
  return p;
}

function unpackAllPackedSources(html) {
  const out = [];
  const text = String(html || "");
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf("eval(function", pos);
    if (start < 0) break;
    let i = start + 5;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let end = -1;
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === quote) quote = null;
        i += 1;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
      i += 1;
    }
    if (end < 0) break;
    const arg = text.slice(start + 5, end);
    pos = end + 1;
    const match = arg.match(/\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)/);
    if (!match) continue;
    const p = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
    const a = parseInt(match[2], 10);
    const c = parseInt(match[3], 10);
    const k = match[4].replace(/\\'/g, "'").split("|");
    let unpacked;
    try { unpacked = unpackDeanEdwards(p, a, c, k); } catch { continue; }
    const sourceRe = /(?:file|src|video_url|videoUrl|url)\s*:\s*["']([^"']+\.(?:mp4|m3u8|webm)(?:\?[^"']*)?)["']/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRe.exec(unpacked)) !== null) out.push(sourceMatch[1].replace(/\\\//g, "/"));
    const quotedRe = /["'](https?:\/\/[^"'\s<>]+?\.(?:mp4|m3u8|webm)(?:\?[^"'\s<>]*)?)["']/gi;
    while ((sourceMatch = quotedRe.exec(unpacked)) !== null) out.push(sourceMatch[1].replace(/\\\//g, "/"));
  }
  return [...new Set(out)];
}

function extractPackedStreamInfo(html) {
  try {
    const match = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?return p\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/);
    if (!match) return null;
    const [_, p, aStr, cStr, kStr] = match;
    const a = parseInt(aStr, 10);
    const c = parseInt(cStr, 10);
    const k = kStr.split('|');
    const unpacked = unpackDeanEdwards(p, a, c, k);

    const titleMatch = unpacked.match(/title\s*:\s*["']([^"']+)["']/i);
    const imgMatch = unpacked.match(/image\s*:\s*["']([^"']+)["']/i);
    const title = titleMatch ? titleMatch[1] : "";
    const poster = imgMatch ? imgMatch[1] : "";

    // 1. Check for links object (FC2Stream / EarnVids / VidHide)
    const linksMatch = unpacked.match(/var\s+links\s*=\s*(\{[\s\S]*?\});/);
    if (linksMatch) {
      const rawJson = linksMatch[1];
      const hls4 = rawJson.match(/["']hls4["']\s*:\s*["']([^"']+)["']/);
      const hls2 = rawJson.match(/["']hls2["']\s*:\s*["']([^"']+)["']/);
      return {
        type: "links",
        hls4: hls4 ? hls4[1] : null,
        hls2: hls2 ? hls2[1] : null,
        title,
        poster,
      };
    }

    // 2. Check for jwplayer sources (LuluStream / LuluVDO)
    const srcMatch = unpacked.match(/sources\s*:\s*\[\s*\{\s*["']?file["']?\s*:\s*["']([^"']+)["']/i)
      || unpacked.match(/["']?file["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
    if (srcMatch) {
      return {
        type: "sources",
        file: srcMatch[1],
        title,
        poster,
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

// ─── HotScopes / AVS embed resolver ──────────────────────────────────
// HotScopes wraps its real player in an @hex@-encoded iframe pointing at a
// Gounlimited gate. That gate makes a cross-origin XHR to router.parklogic.com
// from inside our iframe, which browsers block (status 0). The empty response
// then blows up upstream video.js ("element or ID supplied is not valid") and
// "No available adapters". We resolve the chain on the server and serve either
// a clean player or a clean unavailable card, never the broken upstream page.
const HOT_SCOPES_HOST_RE = /(^|\.)hotscopes\.(io|net|com|org)$/i;

function decodeAtHex(encoded) {
  try {
    const hex = String(encoded || "").replace(/@/g, "");
    if (!hex || hex.length % 2 !== 0) return "";
    return decodeURIComponent(hex.replace(/(..)/g, "%$1"));
  } catch {
    return "";
  }
}

function buildStreamEntry(raw, pageUrl = "", label = "", typeHint = "") {
  let value = String(raw || "").replace(/\\\//g, "/").replace(/&amp;/g, "&").trim();
  if (!value || /^about:blank$/i.test(value)) return null;
  let abs;
  try { abs = new URL(value, pageUrl || "https://chuglii.pages.dev/").toString(); } catch { return null; }
  let parsed;
  try { parsed = new URL(abs); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const path = parsed.pathname.toLowerCase();
  let type = typeHint;
  if (!type) {
    if (path.endsWith(".mp4")) type = "direct_mp4";
    else if (path.endsWith(".m3u8")) type = "direct_hls";
    else if (path.endsWith(".webm")) type = "direct_webm";
    else if (/\.m3u8(?:\?|$)/i.test(abs)) type = "direct_hls";
    else if (/\.mp4(?:\?|$)/i.test(abs)) type = "direct_mp4";
    else if (/\.webm(?:\?|$)/i.test(abs)) type = "direct_webm";
  }
  if (!type) return null;

  const quality = qualityFromValue(parsed.pathname) || qualityFromValue(label);
  // Fresh ClicknPlay URLs come from the live embed page. The browser accepts
  // their HTTPS certificate, while Cloudflare egress does not, so play them
  // directly and keep the worker proxy only as a fallback.
  const useDirectAvs = AVS_DIRECT_HOST_RE.test(parsed.hostname);
  const proxyUrl = `/api/player/stream?url=${encodeURIComponent(abs)}`;
  return {
    url: useDirectAvs ? abs : proxyUrl,
    fallbackUrl: useDirectAvs ? proxyUrl : "",
    rawUrl: abs,
    type,
    quality,
    label: label || (quality ? `${quality}p` : "Original"),
  };
}

function extractGenericStreams(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const add = (raw, label = "", typeHint = "") => {
    const entry = buildStreamEntry(raw, pageUrl, label, typeHint);
    if (!entry || seen.has(entry.rawUrl)) return;
    seen.add(entry.rawUrl);
    out.push(entry);
  };

  const urlRe = /["'](https?:\/\/[^"'\s<>]+?\.(?:mp4|m3u8|webm)(?:\?[^"'\s<>]*)?)["']/gi;
  let m;
  while ((m = urlRe.exec(html || "")) !== null) add(m[1]);

  for (const source of unpackAllPackedSources(html || "")) add(source);

  const packed = extractPackedStreamInfo(html || "");
  if (packed?.hls4) add(packed.hls4, "", "direct_hls");
  if (packed?.file) add(packed.file, "", /\.m3u8(?:\?|$)/i.test(packed.file) ? "direct_hls" : "direct_mp4");

  out.sort((a, b) => (b.quality || 0) - (a.quality || 0));
  return out;
}

function renderUnavailablePlayer(title, poster, detailUrl) {
  const safeTitle = escapeHtml(title || "Video");
  const safePoster = poster ? escapeHtml(poster) : "";
  const safeDetail = detailUrl && /^https?:\/\//i.test(detailUrl) ? escapeHtml(detailUrl) : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${safeTitle}</title><style>
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#000;color:#f4f4f5;font-family:system-ui,-apple-system,sans-serif;overflow:hidden}
  .wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px}
  .poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.22;filter:blur(2px)}
  .card{position:relative;z-index:1;max-width:460px;padding:22px 24px;border-radius:16px;background:rgba(9,9,11,.82);border:1px solid rgba(255,255,255,.12)}
  .card h1{font-size:16px;line-height:1.4;margin:0 0 8px}
  .card p{font-size:13px;line-height:1.5;color:#a1a1aa;margin:0 0 14px}
  .card a{display:inline-block;padding:8px 14px;border-radius:10px;background:#f59e0b;color:#111;font-size:12px;font-weight:700;text-decoration:none}
  .card a:focus-visible{outline:2px solid #f59e0b;outline-offset:3px}
  </style></head><body><div class="wrap">
  ${safePoster ? `<img class="poster" src="${safePoster}" alt="">` : ""}
  <main class="card"><h1>${safeTitle}</h1><p>This upstream source is currently unavailable. No ad-gated or broken player scripts were loaded.</p>${safeDetail ? `<a href="${safeDetail}" target="_blank" rel="noopener noreferrer">Open source page</a>` : ""}</main>
  </div>
  <script>try{parent.postMessage({source:'chuglii-player',type:'player:error',detail:{code:'upstream_unavailable',message:'This upstream source is currently unavailable.'}},'*')}catch(err){}</script></body></html>`;
}

async function resolveGounlimitedStream(nestedUrl, referer) {
  try {
    const nested = new URL(nestedUrl);
    if (!/(^|\.)gounlimited\.to$/i.test(nested.hostname)) return [];
    const upstream = await fetch(nested.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": referer || "https://hotscopes.io/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!upstream.ok) return [];
    const html = await upstream.text();
    const payloadMatch = html.match(/"(eyJ[A-Za-z0-9+/=]{100,})"/);
    if (!payloadMatch) return [];

    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payloadMatch[1]), (c) => c.charCodeAt(0))));
    if (!payload || typeof payload !== "object") return [];
    const params = payload.parameters || (payload.parameters = {});
    params.adBlockingDetected = false;
    params.isIframe = false;
    params.refererBrowser = referer || "https://hotscopes.io/";
    params.timezoneBrowser = "Asia/Kolkata";
    params.timezoneOffset = -330;
    params.webdriver = false;
    params.gpu = null;

    const routerPath = typeof params.path === "string" && params.path.startsWith("/") ? params.path : nested.pathname;
    const routerRes = await fetch(`https://router.parklogic.com${routerPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": nested.toString(),
        "Origin": "https://gounlimited.to",
      },
      body: JSON.stringify(payload),
      redirect: "manual",
    });
    const routerText = (await routerRes.text()).trim();
    let destination = /^https?:\/\//i.test(routerText) ? routerText : (routerRes.headers.get("location") || "");

    if (!/^https?:\/\//i.test(destination)) {
      return extractGenericStreams(routerText, nested.toString());
    }

    let destObj;
    try { destObj = new URL(destination); } catch { return []; }
    // ParkLogic / headline portals are dead ends, not media hosts.
    if (/(parklogic|headlinelogic|click-v4|junimedclk|plarclck|adorarama)/i.test(destObj.hostname)) return [];

    const destRes = await fetch(destination, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": nested.toString(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const contentType = destRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return [];
    return extractGenericStreams(await destRes.text(), destRes.url || destination);
  } catch (e) {
    console.error("Gounlimited resolve error:", e);
    return [];
  }
}

const AVS_CHAIN_HOST_RE = /(^|\.)(hotscopes\.(io|net|com|org)|reallifecam\.to|reallifecams\.net|voyeur-house\.org|clicknplay\.to)$/i;
const AVS_DIRECT_HOST_RE = /(^|\.)clicknplay\.to$/i;
const AVS_DEAD_GATE_RE = /(gounlimited\.to|parklogic\.com|headlinelogic\.com|click-v4\.com|junimedclk\.com|plarclck\.com|adorarama\.com)/i;

function extractIframeSources(html, pageUrl) {
  const sources = [];
  const scan = (text) => {
    const re = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let match;
    while ((match = re.exec(text || "")) !== null) {
      let abs;
      try { abs = new URL(match[1], pageUrl).toString(); } catch { continue; }
      if (!sources.includes(abs)) sources.push(abs);
    }
  };
  scan(html);
  const encoded = String(html || "").match(/str\s*=\s*['"]([@0-9A-Fa-f]+)['"]/)?.[1] || "";
  if (encoded) scan(decodeAtHex(encoded));
  return sources;
}

async function probeMediaUrl(mediaUrl, referer) {
  try {
    const res = await fetch(mediaUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": referer || "https://hotscopes.net/",
        "Accept": "video/mp4,application/vnd.apple.mpegurl,*/*;q=0.8",
        "Range": "bytes=0-0",
      },
      redirect: "follow",
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

// AVS clicknplay files rotate per embed request. A stored MP4 can therefore be
// a 404 while the same video is still live. Walk the detail/embed/iframe chain
// on the edge and return only a URL that answers a byte-range probe.
async function resolveAvsStreamChain(startUrl, referer = "https://hotscopes.net/", maxSteps = 6) {
  const queue = [{ url: startUrl, referer: referer || "https://hotscopes.net/" }];
  const seen = new Set();
  const streams = [];

  for (let step = 0; step < maxSteps && queue.length && streams.length === 0; step += 1) {
    const node = queue.shift();
    let obj;
    try { obj = new URL(node.url); } catch { continue; }
    const key = obj.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    if (AVS_DEAD_GATE_RE.test(key)) continue;

    if (/\.(mp4|m3u8|webm)(?:\?|$)/i.test(obj.pathname + obj.search)) {
      const entry = buildStreamEntry(key, "", "", "");
      if (entry && await probeMediaUrl(key, node.referer)) streams.push(entry);
      continue;
    }

    let res;
    try {
      res = await fetch(key, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": node.referer,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
    } catch { continue; }
    if (!res.ok) continue;
    const html = await res.text();
    const pageUrl = res.url || key;

    for (const stream of extractGenericStreams(html, pageUrl)) {
      if (streams.some((s) => s.rawUrl === stream.rawUrl)) continue;
      // This URL came from the live embed page itself, so it is current by
      // definition. Do not discard it because Cloudflare egress cannot probe
      // playtwo.clicknplay.to; the browser can still play it from India.
      streams.push(stream);
    }
    if (streams.length) break;

    for (const iframeSrc of extractIframeSources(html, pageUrl)) {
      let child;
      try { child = new URL(iframeSrc); } catch { continue; }
      if (AVS_CHAIN_HOST_RE.test(child.hostname) && !seen.has(iframeSrc)) {
        queue.push({ url: iframeSrc, referer: pageUrl });
      }
    }
  }
  return streams;
}

async function resolveAvsStreams(targetUrl, searchParams) {
  // Prefer the live embed/detail page over a stored direct URL: AVS file
  // names rotate, so the stored URL is usually expired by playback time.
  const starts = [];
  for (const key of ["embed", "detail"]) {
    const extra = searchParams.get(key);
    if (extra && /^https?:\/\//i.test(extra) && !starts.includes(extra)) starts.push(extra);
  }
  if (!starts.includes(targetUrl)) starts.push(targetUrl);
  for (const start of starts) {
    const streams = await resolveAvsStreamChain(start, "https://hotscopes.net/", 6);
    if (streams.length) return streams;
  }
  return [];
}

async function resolveAvsForPlayer(targetUrl, searchParams) {
  const title = searchParams.get("title") || "HotScopes Video";
  const poster = searchParams.get("poster") || "";
  const streams = await resolveAvsStreams(targetUrl, searchParams);
  return streams.length ? renderCleanMp4Player(streams, title, poster) : null;
}

async function resolveHotScopesEmbed(targetUrl, searchParams) {
  const title = searchParams.get("title") || "HotScopes Video";
  const poster = searchParams.get("poster") || "";
  const upstream = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://hotscopes.io/",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!upstream.ok) return renderUnavailablePlayer(title, poster, "");
  const html = await upstream.text();

  const videoId = html.match(/var\s+video_id\s*=\s*["'](\d+)["']/i)?.[1] || "";
  const finalPoster = poster || (videoId ? `https://hotscopes.io/media/videos/tmb1/${videoId}/1.jpg` : "");
  const detailUrl = html.match(/player_logo_link\s*=\s*["']([^"']+)["']/i)?.[1] || "";

  // Old embeds hide the iframe in str='@hex@'; modern embeds expose it as a
  // plain <iframe>. Support both instead of assuming the legacy wrapper.
  const nestedCandidates = extractIframeSources(html, targetUrl).filter((candidate) => {
    try {
      const host = new URL(candidate).hostname;
      return AVS_CHAIN_HOST_RE.test(host) || /(^|\.)gounlimited\.to$/i.test(host);
    } catch {
      return false;
    }
  });
  if (!nestedCandidates.length) return renderUnavailablePlayer(title, finalPoster, detailUrl);
  const nestedUrl = nestedCandidates[0];

  let streams = [];
  try {
    const nestedObj = new URL(nestedUrl);
    if (/(^|\.)gounlimited\.to$/i.test(nestedObj.hostname)) {
      streams = await resolveGounlimitedStream(nestedUrl, "https://hotscopes.io/");
    } else {
      // Modern AVS embeds decode to a plain clicknplay iframe whose packed
      // player script contains the current rotating file URL.
      streams = await resolveAvsStreamChain(nestedUrl, "https://hotscopes.io/", 6);
      if (!streams.length && HOT_SCOPES_HOST_RE.test(nestedObj.hostname)) {
        streams = extractGenericStreams(html, targetUrl);
      }
    }
  } catch (e) {
    console.error("HotScopes nested resolve error:", e);
  }

  if (streams.length > 0) {
    const hls = streams.find((s) => s.type === "direct_hls" || /\.m3u8(?:\?|$)/i.test(s.rawUrl));
    if (hls) {
      return renderCleanHlsPlayer(hls.url, title, finalPoster);
    }
    const mp4s = streams.filter((s) => s.type !== "direct_hls");
    if (mp4s.length > 0) {
      return renderCleanMp4Player(mp4s, title, finalPoster);
    }
  }

  return renderUnavailablePlayer(title, finalPoster, detailUrl || nestedUrl);
}

  // ─── Self-hosted hls.js (/api/player/hls.js) ─────────────────────────
  // Some regions/ISPs block cdn.jsdelivr.net, which would leave the custom
  // player rendered but without the HLS engine. Serve hls.js through our own
  // edge (Cloudflare egress reaches the CDN even when the visitor cannot) and
  // cache it hard at both the edge and the browser.
  if (path === "/api/player/hls.js") {
    const HLS_VERSION = "1.5.8";
    const cacheKey = new Request(`https://hlsjs.chuglii.internal/${HLS_VERSION}.min.js`);
    const cache = caches.default;
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    } catch (e) { /* cache API unavailable — fetch through */ }
    let body = null;
    for (const src of [
      `https://cdn.jsdelivr.net/npm/hls.js@${HLS_VERSION}/dist/hls.min.js`,
      `https://unpkg.com/hls.js@${HLS_VERSION}/dist/hls.min.js`,
    ]) {
      try {
        const res = await fetch(src, { redirect: "follow" });
        if (res.ok) { body = await res.text(); break; }
      } catch (e) { /* try next mirror */ }
    }
    if (!body) {
      return errorResponse("hls.js unavailable", 502);
    }
    const res = new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
    try { await cache.put(cacheKey, res.clone()); } catch (e) { /* ignore */ }
    return res;
  }

  // ─── Streamtape same-request MP4 proxy (/api/player/streamtape) ─────
  // Streamtape's /get_video URL is bound to the egress IP that requested the
  // embed page. Resolve and consume it inside this one edge request so the
  // token and the byte stream always come from the same IP.
  if (path === "/api/player/streamtape") {
    const raw = url.searchParams.get("url");
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return errorResponse("Missing or invalid streamtape url parameter", 400);
    }

    try {
      const parsed = new URL(raw);
      if (!parsed.hostname.includes("streamtape.com")) {
        return errorResponse("Invalid streamtape url parameter", 400);
      }

      const gate = await resolveStreamtapeGate(raw);
      if (!gate) {
        return errorResponse("Streamtape stream is unavailable", 502);
      }

      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://internetchicks.com/",
      };
      // Buffer a bounded range instead of streaming the upstream body: cloud
      // platforms reject some streamed 206 responses once Content-Length is
      // forwarded, and capping the chunk keeps every response atomic.
      const CHUNK_SIZE = 4 * 1024 * 1024;
      const range = request.headers.get("Range");
      const match = range && range.match(/^bytes=(\d+)-(\d*)$/);
      let start = 0;
      let end = CHUNK_SIZE - 1;
      if (match) {
        start = parseInt(match[1], 10);
        end = match[2] ? parseInt(match[2], 10) : start + CHUNK_SIZE - 1;
        end = Math.min(end, start + CHUNK_SIZE - 1);
      }
      headers["Range"] = `bytes=${start}-${end}`;

      const mediaRes = await fetch(gate, { headers, redirect: "follow" });
      if (!mediaRes.ok && mediaRes.status !== 206) {
        const detail = await mediaRes.text().catch(() => "");
        return errorResponse(`Streamtape proxy error: ${mediaRes.status} ${detail.slice(0, 120)}`, 502);
      }

      const body = await mediaRes.arrayBuffer();
      const resHeaders = new Headers();
      resHeaders.set("Content-Type", mediaRes.headers.get("content-type") || "video/mp4");
      resHeaders.set("Access-Control-Allow-Origin", "*");
      resHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
      resHeaders.set("Accept-Ranges", "bytes");
      if (mediaRes.headers.get("Content-Range")) {
        resHeaders.set("Content-Range", mediaRes.headers.get("Content-Range"));
      }
      resHeaders.set("Content-Length", String(body.byteLength));
      resHeaders.set("Cache-Control", "no-store");

      return new Response(body, { status: mediaRes.status, headers: resHeaders });
    } catch (err) {
      return errorResponse("Streamtape proxy error: " + (err.message || err), 502);
    }
  }

  // ─── Edge HLS Stream Manifest Proxy (/api/player/stream) ───────────
  // Proxies M3U8 master/variant manifests, AES encryption keys, and TS segments for LuluStream, FC2Stream, and EarnVids.
  // Spoofs User-Agent: Mozilla/5.0 to bypass tnmr.org bot blocking, and adds CORS Access-Control-Allow-Origin: *
  if (path === "/api/player/stream") {
    let streamUpstreamUrl = url.searchParams.get("url");
    const originParam = url.searchParams.get("origin");
    const pathParam = url.searchParams.get("path");

    if (!streamUpstreamUrl && originParam && pathParam) {
      streamUpstreamUrl = originParam.replace(/\/+$/, "") + "/" + pathParam.replace(/^\/+/, "");
    }

    if (!streamUpstreamUrl || (!streamUpstreamUrl.startsWith("http://") && !streamUpstreamUrl.startsWith("https://"))) {
      return errorResponse("Missing or invalid stream url parameter", 400);
    }

    try {
      let targetObj = new URL(streamUpstreamUrl);
      // playtwo.clicknplay.to has an invalid TLS certificate for Cloudflare
      // egress (worker fetches fail with 526), but its plain-HTTP origin serves
      // the same byte ranges correctly. The browser still reaches this proxy
      // over HTTPS, so there is no mixed-content exposure to the user.
      if (AVS_DIRECT_HOST_RE.test(targetObj.hostname) && targetObj.protocol === "https:") {
        targetObj.protocol = "http:";
        streamUpstreamUrl = targetObj.toString();
      }
      let referer = "https://supjav.com/";
      if (targetObj.hostname.includes("influencersgonewild")) {
        referer = "https://influencersgonewild.com/";
      } else if (targetObj.hostname.includes("sheeshfans")) {
        referer = "https://sheeshfans.com/";
      } else if (targetObj.hostname.includes("internetchicks")) {
        referer = "https://internetchicks.com/";
      }

      const reqHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": referer,
      };

      const isAvsDirect = AVS_DIRECT_HOST_RE.test(targetObj.hostname);
      const rangeHeader = request.headers.get("Range");
      let effectiveRange = rangeHeader || "";
      if (isAvsDirect) {
        // Cloudflare does not reliably stream a passthrough response body from
        // this HTTP origin. Serve bounded byte ranges and buffer them instead,
        // so every response is small enough to return atomically while still
        // supporting seeking and progressive playback.
        const AVS_CHUNK_SIZE = 4 * 1024 * 1024;
        const full = effectiveRange.match(/^bytes=(\d+)-(\d*)$/);
        if (full) {
          const start = parseInt(full[1], 10);
          const end = full[2] ? parseInt(full[2], 10) : start + AVS_CHUNK_SIZE - 1;
          effectiveRange = `bytes=${start}-${Math.min(end, start + AVS_CHUNK_SIZE - 1)}`;
        } else if (!effectiveRange) {
          effectiveRange = `bytes=0-${AVS_CHUNK_SIZE - 1}`;
        }
      }
      if (effectiveRange) {
        reqHeaders["Range"] = effectiveRange;
      }

      const upstreamRes = await fetch(streamUpstreamUrl, {
        headers: reqHeaders,
      });

      if (!upstreamRes.ok && upstreamRes.status !== 206) {
        return new Response(upstreamRes.body, { status: upstreamRes.status, headers: CORS_HEADERS });
      }

      const contentType = upstreamRes.headers.get("content-type") || "";
      const isM3U8 = streamUpstreamUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("application/x-mpegURL");

      if (isAvsDirect && !isM3U8) {
        const body = await upstreamRes.arrayBuffer();
        const resHeaders = new Headers();
        resHeaders.set("Content-Type", contentType || "video/mp4");
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        resHeaders.set("Access-Control-Allow-Headers", "*");
        resHeaders.set("Accept-Ranges", "bytes");
        resHeaders.set("Content-Length", String(body.byteLength));
        const contentRange = upstreamRes.headers.get("Content-Range");
        if (contentRange) resHeaders.set("Content-Range", contentRange);
        resHeaders.set("Cache-Control", "no-store");
        return new Response(body, {
          status: upstreamRes.status,
          headers: resHeaders,
        });
      }

      // For binary TS segments, AES keys, and direct MP4 streams: forward Range and status 206/200 with CORS
      if (!isM3U8) {
        const resHeaders = new Headers();
        resHeaders.set("Content-Type", contentType || (streamUpstreamUrl.includes(".mp4") ? "video/mp4" : "application/octet-stream"));
        resHeaders.set("Access-Control-Allow-Origin", "*");
        resHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        resHeaders.set("Access-Control-Allow-Headers", "*");
        resHeaders.set("Accept-Ranges", "bytes");

        if (upstreamRes.headers.get("Content-Range")) {
          resHeaders.set("Content-Range", upstreamRes.headers.get("Content-Range"));
        }
        if (upstreamRes.headers.get("Content-Length")) {
          resHeaders.set("Content-Length", upstreamRes.headers.get("Content-Length"));
        }
          resHeaders.set(
            "Cache-Control",
            upstreamRes.status === 206 ? "no-store" : "public, max-age=86400"
          );

        return new Response(upstreamRes.body, {
          status: upstreamRes.status,
          headers: resHeaders,
        });
      }

      // For M3U8 playlists (master and variant): rewrite URLs to route through /api/player/stream
      const rawText = await upstreamRes.text();
      const parsedUpstream = new URL(streamUpstreamUrl);
      const upstreamOrigin = parsedUpstream.origin;
      const upstreamBasePath = parsedUpstream.pathname.substring(0, parsedUpstream.pathname.lastIndexOf("/") + 1);

      const rewritten = rawText.split("\n").map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Rewrite #EXT-X-KEY URI="..."
        if (trimmed.startsWith("#EXT-X-KEY:")) {
          return line.replace(/URI=["']([^"']+)["']/, (match, uri) => {
            const absoluteUri = uri.startsWith("http://") || uri.startsWith("https://")
              ? uri
              : (uri.startsWith("/") ? upstreamOrigin + uri : upstreamOrigin + upstreamBasePath + uri);
            return `URI="/api/player/stream?url=${encodeURIComponent(absoluteUri)}"`;
          });
        }

        if (trimmed.startsWith("#")) return line;

        // Video segments and sub-playlist manifests:
        // If it's TikTok CDN (which works without proxy and sends CORS *), let it go direct!
        if (trimmed.includes("tiktokcdn.com")) {
          return line;
        }

        // For all other hosts (including tnmr.org or relative URLs), route through /api/player/stream:
        let absoluteSegmentUrl = trimmed;
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
          absoluteSegmentUrl = trimmed.startsWith("/")
            ? upstreamOrigin + trimmed
            : upstreamOrigin + upstreamBasePath + trimmed;
        }
        return `/api/player/stream?url=${encodeURIComponent(absoluteSegmentUrl)}`;
      }).join("\n");

      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      return errorResponse("Stream proxy error: " + (err.message || err), 502);
    }
  }

  // ─── Stream Resolver for the native React player (/api/player/resolve) ─
  // Returns the same freshly resolved MP4 candidates the iframe player uses,
  // so the parent page can feed them into VideoPlayer instead of an iframe.
  if (path === "/api/player/resolve") {
    const raw = url.searchParams.get("url");
    if (!raw || !/^https?:\/\//i.test(raw)) {
      return errorResponse("Missing or invalid url parameter", 400);
    }
    try {
      const parsed = new URL(raw);
      const isAvsFamily =
        AVS_CHAIN_HOST_RE.test(parsed.hostname) ||
        /(^|\.)reallifecams\.net$/i.test(parsed.hostname);
      if (!isAvsFamily) return jsonResponse({ streams: [] });

      const streams = await resolveAvsStreams(raw, url.searchParams);
      return jsonResponse({
        streams: streams.map((s) => ({
          url: s.url,
          fallbackUrl: s.fallbackUrl || "",
          rawUrl: s.rawUrl || s.url,
          type: s.type || "",
          quality: Number(s.quality) || 0,
          label: s.label || "",
        })),
      });
    } catch (err) {
      return errorResponse("Resolver error: " + (err.message || err), 502);
    }
  }

  // ─── Edge Video Player Proxy (/api/player) ─────────────────────────
  if (path === "/api/player") {
    let targetUrl = url.searchParams.get("url");
    if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
      return errorResponse("Missing or invalid url parameter", 400);
    }

    try {
      // 1. Auto-resolve SupJav gatekeeper link (?l=...) to direct destination locker
      const targetObj = new URL(targetUrl);
      if (targetObj.hostname.includes("supremejav.com") || targetObj.hostname.includes("supjav.com")) {
        const lParam = targetObj.searchParams.get("l");
        if (lParam && lParam.length >= 32) {
          const revHex = lParam.split("").reverse().join("");
          const resolveUrl = `https://lk1.supremejav.com/supjav.php?c=${revHex}`;
          const resolveRes = await fetch(resolveUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://supjav.com/",
            },
            redirect: "manual",
          });
          const loc = resolveRes.headers.get("location");
          if (loc) {
            targetUrl = loc;
          }
        }
      }

      const destObj = new URL(targetUrl);

      // Direct HLS manifests (e.g. Chinese CDN play.m3u8 links): never return
      // the raw playlist as the iframe document — render our custom HLS player
      // with the manifest proxied through /api/player/stream so relative
      // segment URLs, referer handling and CORS are all resolved at the edge.
      if (/\.m3u8(?:[?#]|$)/i.test(targetUrl)) {
        // Ordered candidate list: primary manifest first, then any fallback
        // endpoints passed by the caller (api.php forms are resolved to their
        // play.m3u8 equivalents). The client fails over on fatal errors, so a
        // dead or geo-blocked CDN endpoint never kills playback.
        const candidates = [targetUrl];
        const fbRaw = url.searchParams.get("fallbacks") || "";
        if (fbRaw) {
          try {
            const arr = JSON.parse(fbRaw);
            if (Array.isArray(arr)) {
              for (const fb of arr) {
                if (typeof fb !== "string" || !fb.startsWith("http")) continue;
                const m3u8 = apiPhpToM3u8(fb);
                if (m3u8 && !candidates.includes(m3u8)) candidates.push(m3u8);
              }
            }
          } catch (e) { /* malformed fallbacks ignored */ }
        }
        const proxied = candidates.map((c) => `/api/player/stream?url=${encodeURIComponent(c)}`);
        return new Response(renderCleanHlsPlayerMulti(
          proxied,
          url.searchParams.get("title") || "Video",
          url.searchParams.get("poster") || "",
        ), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      }

      // Voyeur House's own reallifecams.net CDN serves byte ranges correctly
      // to the browser but stalls when streamed through the Worker. Play it
      // directly in our controlled player instead of returning a raw proxied
      // media document that Chrome renders as its own non-autoplaying player.
      if (/(^|\.)reallifecams\.net$/i.test(destObj.hostname) && /\.(mp4|webm)(?:\?|$)/i.test(destObj.pathname)) {
        const directStream = [{
          url: targetUrl,
          rawUrl: targetUrl,
          type: "direct_mp4",
          quality: 0,
          label: "Original",
        }];
        return new Response(renderCleanMp4Player(
          directStream,
          url.searchParams.get("title") || "Voyeur House Video",
          url.searchParams.get("poster") || "",
        ), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      }

      // AVS clicknplay MP4 filenames rotate. Validate the stored URL at the
      // edge; if it expired, re-resolve the supplied embed/detail page and
      // return a fresh working stream without changing the database row.
      if (AVS_DIRECT_HOST_RE.test(destObj.hostname)) {
        try {
          const safeHtml = await resolveAvsForPlayer(targetUrl, url.searchParams);
          if (safeHtml) {
            return new Response(safeHtml, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
              },
            });
          }
        } catch (e) {
          console.error("AVS direct resolve error:", e);
        }
        return new Response(renderUnavailablePlayer(
          url.searchParams.get("title") || "HotScopes Video",
          url.searchParams.get("poster") || "",
          url.searchParams.get("detail") || targetUrl,
        ), {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      }

      // HotScopes / AVS-family embeds wrap a dead Gounlimited ad gate. Resolve
      // it server-side so the browser never loads the broken router script.
      if (HOT_SCOPES_HOST_RE.test(destObj.hostname)) {
        try {
          const safeHtml = await resolveHotScopesEmbed(targetUrl, url.searchParams);
          return new Response(safeHtml, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          console.error("HotScopes resolve error:", e);
          return new Response(renderUnavailablePlayer(
            url.searchParams.get("title") || "HotScopes Video",
            url.searchParams.get("poster") || "",
            targetUrl,
          ), {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      // Buu Mal (Myanmar) Resolver (buumal.com)
      // Extracts clean direct Cloudflare R2 MP4 stream from Buu Mal video page
      // Serves pure ad-free responsive video player or JSON stream
      if (destObj.hostname.includes("buumal.com")) {
        let freshStreamUrl = null;
        let title = "Myanmar Video";
        let poster = "";

        try {
          const buuRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://www.buumal.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (buuRes.ok) {
            const buuHtml = await buuRes.text();
            const sourceMatch = buuHtml.match(/<source\s+src=["']([^"']+)["']/i) || buuHtml.match(/<video[^>]+src=["']([^"']+)["']/i);
            const titleMatch = buuHtml.match(/<title>([^<]+)<\/title>/i);
            const posterMatch = buuHtml.match(/<video[^>]+poster=["']([^"']+)["']/i) || buuHtml.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);

            if (sourceMatch && sourceMatch[1]) {
              freshStreamUrl = sourceMatch[1].replace(/&amp;/g, "&");
              title = titleMatch ? titleMatch[1].replace(/Buu Mal\s*\(.*?\)/gi, "").trim() : "Myanmar Video";
              poster = posterMatch ? posterMatch[1].replace(/&amp;/g, "&") : "";
            }
          }
        } catch (e) {
          console.error("BuuMal direct resolve error:", e);
        }

        // Worker egress is normally challenge-blocked, resolve from the DB host.
        if (!freshStreamUrl) {
          freshStreamUrl = await resolveBuumalStreamViaDb(targetUrl, supabaseUrl, supabaseKey);
        }

        if (freshStreamUrl) {
          const wantJson = url.searchParams.get("format") === "json" || request.headers.get("accept")?.includes("application/json");
          if (wantJson) {
            return new Response(JSON.stringify({ streamUrl: freshStreamUrl, title, poster }), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
              },
            });
          }

          return new Response(renderCleanHlsPlayer(freshStreamUrl, title, poster), {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      // 2. Direct lockers (never check Referer). VOE is proxied below so we can
      // spoof Referer and inject <base>, which is more reliable for iframe embeds.
      const isDirectLocker = destObj.hostname.includes("caseyseemavoid.com");
      if (isDirectLocker) {
        return Response.redirect(targetUrl, 302);
      }

      // 3. VidSpeed Resolver (vvaassjjav.xyz / vidspeed)
      // Call their internal stream API to get direct .m3u8, bypasses CSP frame-ancestors block
      if (destObj.hostname.includes("vvaassjjav.xyz") || destObj.hostname.includes("vidspeed")) {
        const filecode = destObj.pathname.split("/").filter(Boolean).pop();
        if (filecode) {
          try {
            const apiRes = await fetch("https://vvaassjjav.xyz/api/stream", {
              method: "POST",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Referer": targetUrl,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ filecode: filecode, device: "web", codecs: [] }),
            });
            if (apiRes.ok) {
              const streamData = await apiRes.json();
              if (streamData && streamData.streaming_url) {
                return new Response(renderCleanHlsPlayer(streamData.streaming_url, streamData.title, streamData.thumbnail), {
                  status: 200,
                  headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                  },
                });
              }
            }
          } catch (e) {
            console.error("VidSpeed resolve error:", e);
          }
        }
      }

      // 4. FC2Stream Resolver (fc2stream.tv)
      // Extracts hls4 stream, proxies manifest through /api/player/stream, streams TikTok CDN directly
      if (destObj.hostname.includes("fc2stream")) {
        try {
          const fc2Res = await fetch(targetUrl, {
            headers: {
              "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://supjav.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (fc2Res.ok) {
            const fc2Html = await fc2Res.text();
            const streamInfo = extractPackedStreamInfo(fc2Html);
            if (streamInfo && streamInfo.hls4) {
              const streamProxyUrl = `/api/player/stream?origin=${encodeURIComponent(destObj.origin)}&path=${encodeURIComponent(streamInfo.hls4)}`;
              return new Response(renderCleanHlsPlayer(streamProxyUrl, streamInfo.title || "FC2Stream", streamInfo.poster), {
                status: 200,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "no-store",
                },
              });
            }
          }
        } catch (e) {
          console.error("FC2Stream resolve error:", e);
        }
      }

      // 5. EarnVids Resolver (evsishere.xyz / earnvids / vidhide)
      // Extracts hls4 stream, proxies manifest through /api/player/stream, streams TikTok CDN directly
      if (destObj.hostname.includes("evsishere.xyz") || destObj.hostname.includes("earnvids") || destObj.hostname.includes("vidhide")) {
        try {
          const earnRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://supjav.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (earnRes.ok) {
            const earnHtml = await earnRes.text();
            const streamInfo = extractPackedStreamInfo(earnHtml);
            if (streamInfo && streamInfo.hls4) {
              const streamProxyUrl = `/api/player/stream?origin=${encodeURIComponent(destObj.origin)}&path=${encodeURIComponent(streamInfo.hls4)}`;
              return new Response(renderCleanHlsPlayer(streamProxyUrl, streamInfo.title || "EarnVids", streamInfo.poster), {
                status: 200,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "no-store",
                },
              });
            }
          }
        } catch (e) {
          console.error("EarnVids resolve error:", e);
        }
      }

      // 6. LuluStream Resolver (luminscdn.xyz / lulustream.com / luluvdo.com)
      // LuluStream strictly binds HLS stream tokens to client TCP socket IP ($remote_addr).
      // Redirect directly to target embed so client's real browser negotiates and plays token directly without 403 / infinite stalls
      if (destObj.hostname.includes("luminscdn") || destObj.hostname.includes("lulustream") || destObj.hostname.includes("luluvdo")) {
        return Response.redirect(targetUrl, 302);
      }

      // 7. InternetChicks locker resolver (PlayMogo/StreamWish/VOE/Dood/Byse).
      // These are embed iframes; spoof IC referer, inject <base>, and try to
      // extract packed HLS/mp4 sources when present for cleaner playback.
      if (/(playmogo|streamwish|voe\.sx|dood|bysezejataos)/i.test(destObj.hostname)) {
        try {
          const icRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://internetchicks.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            redirect: "follow",
          });
          if (icRes.ok) {
            const ct = icRes.headers.get("content-type") || "text/html; charset=utf-8";
            if (ct.includes("text/html")) {
              let html = await icRes.text();
              const streamInfo = extractPackedStreamInfo(html);
              if (streamInfo?.hls4 || streamInfo?.file) {
                const streamUrl = streamInfo.hls4
                  ? `/api/player/stream?origin=${encodeURIComponent(new URL(targetUrl).origin)}&path=${encodeURIComponent(streamInfo.hls4)}`
                  : streamInfo.file;
                const isHls = /\.m3u8(?:[?#]|$)/i.test(streamUrl) || streamInfo.hls4;
                return new Response(isHls ? renderCleanHlsPlayer(streamUrl, streamInfo.title || "Video", streamInfo.poster) : renderCleanMp4Player([{ url: streamUrl, rawUrl: streamUrl, type: "direct_mp4", quality: 1080, label: "1080p" }], streamInfo.title || "Video", streamInfo.poster), {
                  status: 200,
                  headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
                });
              }
              html = html.replace(/if\s*\(\s*top\.location\.href\s*==\s*location\.href\s*\)\s*\{[^}]*\}/g, "");
              html = html.replace(/top\.location[^;]+;/g, "/* neutral */");
              const baseTag = `<base href="${destObj.origin}/">`;
              html = html.includes("<head>") ? html.replace("<head>", `<head>${baseTag}`) : `${baseTag}${html}`;
              return new Response(html, {
                status: 200,
                headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
              });
            }
            return new Response(icRes.body, { status: icRes.status, headers: { "Content-Type": ct, "Access-Control-Allow-Origin": "*" } });
          }
        } catch (e) {
          console.error("IC locker proxy error:", e);
        }
      }

      // 8. Streamtape Resolver: serve a clean MP4 player backed by the
      // same-request /api/player/streamtape proxy. Fall back to the upstream
      // HTML only if Streamtape changes its gate format.
      if (destObj.hostname.includes("streamtape.com")) {
        try {
          const gate = await resolveStreamtapeGate(targetUrl);
          if (gate) {
            const playerUrl = `/api/player/streamtape?url=${encodeURIComponent(targetUrl)}`;
            const title = url.searchParams.get("title") || "Video";
            const poster = url.searchParams.get("poster") || "";
            return new Response(
              renderCleanMp4Player(
                [{ url: playerUrl, rawUrl: targetUrl, type: "direct_mp4", quality: 720, label: "Streamtape" }],
                title,
                poster,
              ),
              {
                status: 200,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Access-Control-Allow-Origin": "*",
                  "Cache-Control": "no-store",
                },
              },
            );
          }
        } catch (e) {
          console.error("Streamtape resolver error:", e);
        }

        try {
          const stRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://supjav.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (stRes.ok) {
            let stHtml = await stRes.text();
            // Disarm Streamtape adblock click-traps, top-level redirects, and rogue downloads
            stHtml = stHtml.replace(/top\.location[^;]+;/g, "/* neutral */");
            stHtml = stHtml.replace(/window\.location\.ancestorOrigins/g, '["https://supjav.com"]');
            stHtml = stHtml.replace(/window\["CWmUGiWrLe"\]\(\)/g, "");
            stHtml = stHtml.replace(/window\.open\([^)]*\)/g, "null");

            const baseTag = `<base href="https://streamtape.com/">`;
            if (stHtml.includes("<head>")) {
              stHtml = stHtml.replace("<head>", `<head>${baseTag}`);
            } else {
              stHtml = baseTag + stHtml;
            }

            return new Response(stHtml, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=1800",
              },
            });
          }
        } catch (e) {
          console.error("Streamtape proxy error:", e);
        }
      }

      // 6. Generic Fallback Proxy (EarnVids / evsishere / legacy / IC lockers):
      // Edge worker proxies HTML with a spoofed Referer and injects <base>.
      let referer = "https://supjav.com/";
      if (targetUrl.includes("mmsvibex")) referer = "https://mmsvibex.life/";
      if (destObj.hostname.includes("sheeshfans")) referer = "https://sheeshfans.com/";
      const icLocker = /playmogo|streamwish|dood|bysezejataos|voe\.sx|streamtape|internetchicks/i.test(destObj.hostname);
      if (icLocker) referer = "https://internetchicks.com/";

      const upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": request.headers.get("user-agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": referer,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      const contentType = upstreamRes.headers.get("content-type") || "text/html; charset=utf-8";

      if (contentType.includes("text/html")) {
        let body = await upstreamRes.text();
        // Remove frame busting check
        body = body.replace(/if\s*\(\s*top\.location\.href\s*==\s*location\.href\s*\)\s*\{[^}]*\}/g, "");
        body = body.replace(/top\.location[^;]+;/g, "void 0;");
        // Strip Cloudflare RUM/beacon and common analytics scripts - they leak cross-origin requests from our player origin and cause CORS/404 noise.
        body = body.replace(/<script[^>]*src=["'][^"']*cloudflareinsights\.com\/beacon[^"']*["'][^>]*>\s*<\/script>/gi, "");
        body = body.replace(/<script[^>]*src=["'][^"']*\/cdn-cgi\/rum[^"']*["'][^>]*>\s*<\/script>/gi, "");
        body = body.replace(/<script[^>]*>\s*window\.__CF\$cv\$params[\s\S]*?<\/script>/gi, "");
        body = body.replace(/<script[^>]*data-cf-beacon=[^>]*>\s*<\/script>/gi, "");
        body = body.replace(/<script[^>]*src=["'][^"']*(?:googletagmanager\.com|google-analytics\.com|gtag\/js)[^"']*["'][^>]*>\s*<\/script>/gi, "");
        body = body.replace(/<script[^>]*>[\s\S]*?(?:gtag\(|GoogleAnalyticsObject|google-analytics\.com|googletagmanager\.com)[\s\S]*?<\/script>/gi, "");
        // Neutralize RUM/analytics endpoints in remaining inline scripts (base href would resolve /cdn-cgi/rum to embed origin causing CORS).
        body = body.replace(/(["'`])\/cdn-cgi\/rum\??[^"'`]*\1/g, '"about:blank"');
        body = body.replace(/(["'`])https?:\/\/[^"'`]*\/cdn-cgi\/rum\??[^"'`]*\1/g, '"about:blank"');
        body = body.replace(/(["'`])\/[^"'`]*\/ga\/g\/c\/[^"'`]*\1/g, '"about:blank"');
        // Inject <base> tag so relative CSS/JS load from destination host
        const baseTag = `<base href="${destObj.origin}/">`;
        if (body.includes("<head>")) {
          body = body.replace("<head>", `<head>${baseTag}`);
        } else {
          body = `${baseTag}${body}`;
        }

        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      }

      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (err) {
      return errorResponse("Player proxy error: " + (err.message || err), 502);
    }
  }

  // ─── Forward to Dedicated Scraper Worker (/api/scraper/sync) ───────
  if (path === "/api/scraper/sync") {
    const scraperUrl = `https://chuglii-scraper.maskmails.workers.dev/sync${url.search}`;
    const scraperRes = await fetch(scraperUrl, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
    });
    return new Response(scraperRes.body, {
      status: scraperRes.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // ─── Common PostgREST Headers ──────────────────────────────────────
  const postgrestHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    "User-Agent": "Cloudflare-Pages-Worker/1.0",
  };

  // POST /api/rum -> 204 No Content
  if (path === "/api/rum") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET /api/ads/stripcash
  if (path === "/api/ads/stripcash") {
    return jsonResponse({ enabled: true, fallback: true });
  }

  // GET /api/premium/config
  if (path === "/api/premium/config") {
    return jsonResponse({
      ads_enabled: true,
      ads_target: 5,
      reward_cooldown_s: 60,
      grace_minutes: 10,
      price_usd: 4.99,
    });
  }

  // GET /api/user/premium/status
  if (path === "/api/user/premium/status") {
    return jsonResponse({
      is_premium: false,
      premium_until: null,
      ads_watched: 0,
    });
  }

  // GET /api/user/role
  if (path === "/api/user/role") {
    return jsonResponse({ role: "user" });
  }

  // GET /api/user/profile
  if (path === "/api/user/profile") {
    return jsonResponse({ user: null });
  }

  // GET /api/stats
  if (path === "/api/stats") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_site_stats`, {
      method: "POST",
      headers: postgrestHeaders,
      body: "{}",
    });
    if (!res.ok) {
      return jsonResponse({
        total_recordings: 6418,
        total_performers: 451,
        total_tags: 473,
        total_size_bytes: 14146369231967,
        newest_recording: new Date().toISOString(),
      });
    }
    const arr = await res.json();
    return jsonResponse(arr[0] || {}, 200, {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    });
  }

  // GET /api/tags
  if (path === "/api/tags") {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_tag_counts`, {
      method: "POST",
      headers: postgrestHeaders,
      body: "{}",
    });
    if (!res.ok) {
      return errorResponse("Failed to fetch tags", res.status);
    }
    const tags = await res.json();
    return jsonResponse(tags, 200, {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    });
  }

  // GET /api/recordings/recommendations
  if (path === "/api/recordings/recommendations") {
    const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get("limit") || "16", 10)));
    const restUrl = `${supabaseUrl}/rest/v1/linked_recordings?select=id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at&limit=${limit}&order=timestamp.desc`;
    const res = await fetch(restUrl, { headers: postgrestHeaders });
    const data = await res.json();
    const enriched = (data || []).map(item => ({
      ...item,
      site: item.site || (item.instance_id?.includes("node") ? "stripchat" : "chaturbate"),
    }));
    return jsonResponse({
      data: enriched,
      total: enriched.length,
      page: 1,
      limit,
      totalPages: 1,
    }, 200, {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
    });
  }

  // GET /api/recordings
  if (path === "/api/recordings") {
    const searchParams = url.searchParams;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "24", 10)));
    const search = searchParams.get("search")?.trim();
    const tags = searchParams.get("tags")?.trim();
    const gender = searchParams.get("gender")?.trim();
    const username = searchParams.get("username")?.trim();
    const resolution = searchParams.get("resolution")?.trim();
    const sort = searchParams.get("sort") || "newest";

    const offset = (page - 1) * limit;

    const params = new URLSearchParams();
    params.set("select", "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at");
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    if (sort === "oldest") {
      params.set("order", "timestamp.asc.nullslast,id.desc");
    } else if (sort === "largest") {
      params.set("order", "filesize.desc.nullslast,id.desc");
    } else if (sort === "popular") {
      params.set("order", "viewers.desc.nullslast,id.desc");
    } else {
      params.set("order", "timestamp.desc.nullslast,id.desc");
    }

    if (username) params.set("username", `eq.${username}`);
    if (resolution) params.set("resolution", `eq.${resolution}`);
    if (gender) params.set("gender", `eq.${gender}`);
    if (tags) {
      const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) params.set("tags", `ov.{${tagList.join(",")}}`);
    }
    if (search) {
      const s = search.replace(/[\\%_]/g, "\\$&");
      params.set("or", `(username.ilike.*${s}*,room_title.ilike.*${s}*,filename.ilike.*${s}*)`);
    }

    const restUrl = `${supabaseUrl}/rest/v1/linked_recordings?${params.toString()}`;
    const res = await fetch(restUrl, {
      method: "GET",
      headers: {
        ...postgrestHeaders,
        "Prefer": "count=exact",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      return errorResponse(errText, res.status);
    }

    const data = await res.json();
    const contentRange = res.headers.get("Content-Range") || "";
    let total = data.length;
    if (contentRange.includes("/")) {
      const totalStr = contentRange.split("/")[1];
      if (totalStr && totalStr !== "*") total = parseInt(totalStr, 10);
    }

    const enriched = data.map(item => ({
      ...item,
      site: item.site || (item.instance_id?.includes("node") ? "stripchat" : "chaturbate"),
    }));

    return jsonResponse({
      data: enriched,
      total,
      totalIsEstimate: false,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    }, 200, {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
    });
  }

  // GET /api/recordings/random
  if (path === "/api/recordings/random") {
    const res = await fetch(`${supabaseUrl}/rest/v1/linked_recordings?select=id,username&limit=1&order=id.desc`, {
      headers: postgrestHeaders,
    });
    const items = await res.json();
    return jsonResponse(items[0] || {});
  }

  // GET /api/recordings/related
  if (path === "/api/recordings/related") {
    const limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get("limit") || "8", 10)));
    const username = url.searchParams.get("username");
    let restUrl = `${supabaseUrl}/rest/v1/linked_recordings?select=id,username,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,preview_url&limit=${limit}&order=timestamp.desc`;
    if (username) {
      restUrl += `&username=eq.${encodeURIComponent(username)}`;
    }
    const res = await fetch(restUrl, { headers: postgrestHeaders });
    const data = await res.json();
    return jsonResponse(data);
  }

  // GET /api/recordings/:id
  const recordingMatch = path.match(/^\/api\/recordings\/([a-zA-Z0-9_-]+)$/);
  if (recordingMatch) {
    const id = recordingMatch[1];
    const res = await fetch(`${supabaseUrl}/rest/v1/linked_recordings?id=eq.${encodeURIComponent(id)}&select=*`, {
      headers: postgrestHeaders,
    });
    if (!res.ok) return errorResponse("Recording not found", 404);
    const rows = await res.json();
    if (!rows || rows.length === 0) return errorResponse("Recording not found", 404);
    const item = rows[0];
    return jsonResponse({
      ...item,
      site: item.site || (item.instance_id?.includes("node") ? "stripchat" : "chaturbate"),
    }, 200, {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    });
  }

  // GET /api/performers
  if (path === "/api/performers") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;

    const res = await fetch(`${supabaseUrl}/rest/v1/channels?select=*&limit=${limit}&offset=${offset}&order=updated_at.desc`, {
      headers: {
        ...postgrestHeaders,
        "Prefer": "count=exact",
      },
    });
    const data = await res.json();
    const contentRange = res.headers.get("Content-Range") || "";
    let total = data.length;
    if (contentRange.includes("/")) {
      const totalStr = contentRange.split("/")[1];
      if (totalStr && totalStr !== "*") total = parseInt(totalStr, 10);
    }
    return jsonResponse({
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    }, 200, {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
    });
  }

  // GET /api/performers/:username
  const performerMatch = path.match(/^\/api\/performers\/([a-zA-Z0-9_.-]+)$/);
  if (performerMatch) {
    const username = performerMatch[1];
    const [chanRes, recRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/channels?username=eq.${encodeURIComponent(username)}&select=*`, { headers: postgrestHeaders }),
      fetch(`${supabaseUrl}/rest/v1/linked_recordings?username=eq.${encodeURIComponent(username)}&select=*&order=timestamp.desc&limit=50`, { headers: postgrestHeaders }),
    ]);
    const chan = await chanRes.json();
    const recs = await recRes.json();
    return jsonResponse({
      performer: chan[0] || { username, display_name: username },
      recordings: recs || [],
      totalRecordings: recs ? recs.length : 0,
    });
  }

  // GET /api/requests
  if (path === "/api/requests") {
    return jsonResponse({ requests: [], total: 0 });
  }

  // Fallback for unknown /api/* -> 404 JSON instead of HTML!
  return errorResponse(`API endpoint not found: ${path}`, 404);
}
