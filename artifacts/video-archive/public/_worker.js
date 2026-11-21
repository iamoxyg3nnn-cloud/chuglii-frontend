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

    // 3. Fallback to Cloudflare Pages static assets & SPA routing
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

async function scrapeMmsPage(pageNum) {
  const url = pageNum === 1
    ? "https://mmsvibex.life/?filter=latest"
    : `https://mmsvibex.life/page/${pageNum}/?filter=latest`;

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

async function syncMmsvibex(env, maxPages = 2) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;

  let allItems = [];
  for (let p = 1; p <= maxPages; p++) {
    try {
      const items = await scrapeMmsPage(p);
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

  // ─── Serverless Scraper Sync (/api/scraper/sync) ────────────────────
  if (path === "/api/scraper/sync") {
    const pages = Math.min(5, Math.max(1, parseInt(url.searchParams.get("pages") || "2", 10)));
    const syncResult = await syncMmsvibex(env, pages);
    return jsonResponse(syncResult);
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
