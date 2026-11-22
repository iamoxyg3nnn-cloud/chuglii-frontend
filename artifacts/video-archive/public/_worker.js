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
    return env.ASSETS.fetch(request);
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
      let referer = "https://chuglii.in/";
      if (targetUrl.includes("pixhost.to")) referer = "https://pixhost.to/";
      else if (targetUrl.includes("catbox.moe")) referer = "https://catbox.moe/";
      else if (targetUrl.includes("imgpile.com")) referer = "https://imgpile.com/";
      else if (targetUrl.includes("buumal.com")) referer = "https://www.buumal.com/";

      const upstreamRes = await fetch(targetUrl, {
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
function renderCleanHlsPlayer(streamingUrl, title = "", poster = "") {
  const safeTitle = (title || "Chuglii Player").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isHls = streamingUrl.includes(".m3u8") || streamingUrl.includes("/hls/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${safeTitle}</title>
  ${isHls ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>' : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    video { width: 100%; height: 100%; max-height: 100vh; object-fit: contain; background: #000; outline: none; }
  </style>
</head>
<body>
  <video id="player" controls autoplay playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      var video = document.getElementById('player');
      var streamUrl = ${JSON.stringify(streamingUrl)};
      ${isHls ? `
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() {
          video.play().catch(function() {});
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function() {
          video.play().catch(function() {});
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

// ─── EarnVids Unpacker & Stream Extractor ────────────────────────────
function extractEarnVidsStream(html) {
  try {
    const match = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?return p\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/);
    if (!match) return null;
    const [_, p, aStr, cStr, kStr] = match;
    const a = parseInt(aStr, 10);
    const c = parseInt(cStr, 10);
    const k = kStr.split('|');
    function baseN(num, b) {
      const digits = '0123456789abcdefghijklmnopqrstuvwxyz';
      let res = '';
      while (num > 0) {
        res = digits[num % b] + res;
        num = Math.floor(num / b);
      }
      return res || '0';
    }
    let unpacked = p;
    for (let i = c - 1; i >= 0; i--) {
      const key = baseN(i, a);
      const val = k[i] || key;
      unpacked = unpacked.replace(new RegExp('\\b' + key + '\\b', 'g'), val);
    }
    const hls2Match = unpacked.match(/"hls2"\s*:\s*"([^"]+)"/);
    const hls4Match = unpacked.match(/"hls4"\s*:\s*"([^"]+)"/);
    const titleMatch = unpacked.match(/title\s*:\s*"([^"]+)"/);
    const imgMatch = unpacked.match(/image\s*:\s*"([^"]+)"/);
    const stream = (hls2Match && hls2Match[1]) || (hls4Match && hls4Match[1]);
    if (!stream) return null;
    return {
      streamUrl: stream,
      title: titleMatch ? titleMatch[1] : "",
      image: imgMatch ? imgMatch[1] : ""
    };
  } catch (e) {
    return null;
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

      // 2. Direct lockers (VOE, LuluStream) can be redirected directly
      const isDirectLocker = destObj.hostname.includes("voe.sx") 
        || destObj.hostname.includes("caseyseemavoid.com")
        || destObj.hostname.includes("luminscdn.xyz");

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

      // 4. EarnVids Resolver (evsishere.xyz / earnvids / vidhide)
      // Unpack JW Player packed payload, extract clean hls2 master stream (avoids broken willowgrovelearning SSL)
      if (destObj.hostname.includes("evsishere.xyz") || destObj.hostname.includes("earnvids") || destObj.hostname.includes("vidhide")) {
        try {
          const earnRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://supjav.com/",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (earnRes.ok) {
            const earnHtml = await earnRes.text();
            const earnStream = extractEarnVidsStream(earnHtml);
            if (earnStream && earnStream.streamUrl) {
              return new Response(renderCleanHlsPlayer(earnStream.streamUrl, earnStream.title, earnStream.image), {
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

      // 5. Streamtape: Redirect directly to full embed URL (do NOT strip filename as it causes 404)
      if (destObj.hostname.includes("streamtape.com")) {
        return Response.redirect(targetUrl, 302);
      }

      // 6. Generic Fallback Proxy (EarnVids / evsishere / legacy):
      // Edge worker proxies the HTML with spoofed Referer: https://supjav.com/ and injects <base>
      let referer = "https://supjav.com/";
      if (targetUrl.includes("mmsvibex")) referer = "https://mmsvibex.life/";

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
