// Cloudflare Pages Advanced Worker (_worker.js)
// Handles API routes at the Cloudflare Edge directly with Supabase & media proxying,
// and passes all other asset / SPA routes to env.ASSETS.fetch(request).

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
};

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
      // Determine appropriate Referer for hotlink-protected hosts
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
        // Fallback: redirect directly to target if proxying fails
        return Response.redirect(targetUrl, 302);
      }

      const contentType = upstreamRes.headers.get("content-type") || "image/jpeg";
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Vary", "Accept");

      return new Response(upstreamRes.body, {
        status: 200,
        headers,
      });
    } catch {
      return Response.redirect(targetUrl, 302);
    }
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
        total_recordings: 6415,
        total_performers: 451,
        total_tags: 473,
        total_size_bytes: 14141535727356,
        newest_recording: new Date().toISOString(),
      });
    }
    const arr = await res.json();
    return jsonResponse(arr[0] || {});
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
    return jsonResponse(tags);
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

    // Build PostgREST query parameters
    const params = new URLSearchParams();
    params.set("select", "id,channel_id,username,filename,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,embed_url,preview_url,instance_id,created_at,updated_at");
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    // Sort order
    if (sort === "oldest") {
      params.set("order", "timestamp.asc.nullslast,id.desc");
    } else if (sort === "largest") {
      params.set("order", "filesize.desc.nullslast,id.desc");
    } else if (sort === "popular") {
      params.set("order", "viewers.desc.nullslast,id.desc");
    } else {
      params.set("order", "timestamp.desc.nullslast,id.desc");
    }

    // Filters
    if (username) {
      params.set("username", `eq.${username}`);
    }
    if (resolution) {
      params.set("resolution", `eq.${resolution}`);
    }
    if (gender) {
      params.set("gender", `eq.${gender}`);
    }
    if (tags) {
      const tagList = tags.split(",").map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        params.set("tags", `ov.{${tagList.join(",")}}`);
      }
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
      if (totalStr && totalStr !== "*") {
        total = parseInt(totalStr, 10);
      }
    }

    // Enrich items with origin site field if missing
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
