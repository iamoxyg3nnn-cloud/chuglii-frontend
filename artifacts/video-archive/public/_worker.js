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

// ─── Origin site resolution (chaturbate vs stripchat) ───────────────────────
// `linked_recordings` has no `site` column, and `instance_id` identifies the
// recorder node ("node-1".."node-N") — NOT the cam site. Deriving the site
// from instance_id therefore labelled every node recording as Stripchat.
// Resolve the origin from channel_assignments (username -> site) instead,
// caching the map per isolate so this costs at most one query every 5 min.
let _siteMapCache = null;
let _siteMapExpires = 0;
const SITE_MAP_TTL_MS = 5 * 60 * 1000;

async function getSiteMap(supabaseUrl, postgrestHeaders) {
  const now = Date.now();
  if (_siteMapCache && now < _siteMapExpires) return _siteMapCache;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/channel_assignments?select=username,site`,
      { headers: postgrestHeaders },
    );
    if (res.ok) {
      const rows = await res.json();
      const map = new Map();
      for (const row of rows || []) {
        const username = String(row?.username || "").trim().toLowerCase();
        const site = String(row?.site || "").trim().toLowerCase();
        if (username && (site === "chaturbate" || site === "stripchat")) {
          map.set(username, site);
        }
      }
      _siteMapCache = map;
      _siteMapExpires = now + SITE_MAP_TTL_MS;
      return map;
    }
  } catch (_) {
    // Fall through to the stale cache (if any) below.
  }

  return _siteMapCache || new Map();
}

function resolveSite(item, siteMap) {
  const raw = String(item?.site || "").trim().toLowerCase();
  if (raw === "chaturbate" || raw === "stripchat") return raw;

  const username = String(item?.username || "").trim().toLowerCase();
  const mapped = username ? siteMap?.get(username) : null;
  if (mapped === "chaturbate" || mapped === "stripchat") return mapped;

  // Legacy/unmapped recordings: default to the majority platform.
  return "chaturbate";
}

function withResolvedSite(item, siteMap) {
  return { ...item, site: resolveSite(item, siteMap) };
}

// ─── Public playlists (user collections) helpers ─────────────────────────────
// user_collections / user_collection_items are RLS-protected, so these routes
// use the service-role key already preferred by handleApi. The response shape
// mirrors the Express API so the SPA can consume either backend unchanged.
const PLAYLIST_COLUMNS = "id,user_id,name,description,created_at,updated_at";
const PLAYLIST_MEDIA_COLUMNS = "id,thumbnail_url,thumbnail_mirrors,preview_url,preview_mirrors";

function postgrestCount(res, fallback) {
  const range = res.headers.get("Content-Range") || "";
  const total = range.split("/")[1];
  const count = total && total !== "*" ? parseInt(total, 10) : NaN;
  return Number.isFinite(count) ? count : fallback;
}

function parsePlaylistMetadata(raw) {
  if (typeof raw === "string") {
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
  return raw && typeof raw === "object" ? { ...raw } : {};
}

function playlistAuthor(profileMap, userId) {
  const p = profileMap.get(userId);
  if (!p) return null;
  return {
    display_name: p.display_name ?? null,
    avatar_url: p.avatar_url ?? null,
    username: p.username ?? null,
  };
}

async function fetchPlaylistProfiles(supabaseUrl, headers, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_profiles?select=user_id,display_name,avatar_url,username&user_id=in.(${ids.map(encodeURIComponent).join(",")})`,
    { headers },
  );
  if (!res.ok) return new Map();
  const rows = await res.json();
  return new Map((rows || []).map(p => [p.user_id, p]));
}

async function fetchPlaylistRecMap(supabaseUrl, headers, recordingIds) {
  const ids = [...new Set(recordingIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const inList = ids.map(encodeURIComponent).join(",");
  const [recRes, prevRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/recordings?select=${PLAYLIST_MEDIA_COLUMNS}&id=in.(${inList})`, { headers }),
    fetch(`${supabaseUrl}/rest/v1/preview_images?select=recording_id,thumbnail_mirrors,preview_mirrors&recording_id=in.(${inList})`, { headers }),
  ]);

  const recMap = new Map();
  if (recRes.ok) {
    for (const rec of await recRes.json()) recMap.set(rec.id, { ...rec });
  }
  if (prevRes.ok) {
    for (const prev of await prevRes.json()) {
      if (!prev?.recording_id) continue;
      const current = recMap.get(prev.recording_id) || { id: prev.recording_id };
      if (prev.thumbnail_mirrors) {
        current.thumbnail_mirrors = { ...(current.thumbnail_mirrors || {}), ...prev.thumbnail_mirrors };
      }
      if (prev.preview_mirrors) {
        current.preview_mirrors = { ...(current.preview_mirrors || {}), ...prev.preview_mirrors };
      }
      recMap.set(prev.recording_id, current);
    }
  }
  return recMap;
}

function enrichPlaylistItems(items, recMap) {
  return (items || []).map(item => {
    const rec = recMap.get(item.recording_id);
    if (!rec) return item;
    const metadata = parsePlaylistMetadata(item.metadata);
    if (rec.thumbnail_url) metadata.thumbnail_url = rec.thumbnail_url;
    if (rec.thumbnail_mirrors) metadata.thumbnail_mirrors = rec.thumbnail_mirrors;
    if (rec.preview_url) metadata.preview_url = rec.preview_url;
    if (rec.preview_mirrors) metadata.preview_mirrors = rec.preview_mirrors;
    return { ...item, metadata: JSON.stringify(metadata) };
  });
}

// ─── Authenticated user API helpers ──────────────────────────────────────────
// Every /api/user/* write is scoped to the JWT subject. The service-role key
// is used for PostgREST only after Supabase Auth has verified the bearer token.
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
const _authAttempts = new Map();

function rateLimitHit(key, limit = AUTH_MAX_ATTEMPTS, windowMs = AUTH_WINDOW_MS) {
  const now = Date.now();
  let bucket = _authAttempts.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    _authAttempts.set(key, bucket);
  }
  bucket.count += 1;
  if (_authAttempts.size > 1000) {
    for (const [k, v] of _authAttempts) {
      if (now - v.start >= windowMs) _authAttempts.delete(k);
    }
  }
  return bucket.count > limit;
}

function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

async function verifyBearerUser(request, supabaseUrl, anonKey) {
  const token = bearerToken(request);
  if (!token) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { "apikey": anonKey, "Authorization": `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    if (!user || typeof user.id !== "string" || !user.id) return null;
    return { user, token };
  } catch (_) {
    return null;
  }
}

const USER_ROLES = new Set(["user", "moderator", "admin"]);

async function resolveUserRole(supabaseUrl, headers, user) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
      { headers },
    );
    if (res.ok) {
      const rows = await res.json();
      if (USER_ROLES.has(rows?.[0]?.role)) return rows[0].role;
    }
  } catch (_) {
    // Fall back to trusted JWT metadata below.
  }
  const metaRole = user?.app_metadata?.role || user?.user_metadata?.role;
  return USER_ROLES.has(metaRole) ? metaRole : "user";
}

async function readJsonBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch (_) {
    return {};
  }
}

function decodeSegment(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

async function ownsCollection(supabaseUrl, headers, userId, collectionId) {
  if (!collectionId || !userId) return false;
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_collections?select=id&id=eq.${encodeURIComponent(collectionId)}` +
        `&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
      { headers },
    );
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (_) {
    return false;
  }
}

const NOTIFICATION_TYPES = ["request_submitted", "request_status", "recording_available"];

// Preferences live in auth user metadata: the deployed database predates the
// checked-in notification/sound preference columns, so writing to those tables
// would fail with PGRST204. Metadata is scoped to the verified user and works
// with the live schema.
async function updateAuthUserMetadata(supabaseUrl, serviceKey, userId, patch) {
  if (!serviceKey) return null;
  const headers = {
    "apikey": serviceKey,
    "Authorization": `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
  const endpoint = `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  try {
    const currentRes = await fetch(endpoint, { headers });
    const current = currentRes.ok ? await currentRes.json() : null;
    const res = await fetch(endpoint, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        user_metadata: { ...(current?.user_metadata || {}), ...patch },
      }),
    });
    return res.ok ? await res.json() : null;
  } catch (_) {
    return null;
  }
}

const DEFAULT_PREMIUM_SETTINGS = {
  ads_enabled: true,
  ads_target: 5,
  reward_cooldown_s: 60,
  grace_minutes: 10,
  price_usd: 4.99,
};

async function readPremiumSettings(supabaseUrl, headers) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/site_settings?select=key,value`, { headers });
    if (!res.ok) return DEFAULT_PREMIUM_SETTINGS;
    const rows = await res.json();
    const map = new Map((rows || []).map((row) => [row.key, row.value]));
    const toNumber = (value, fallback) => {
      const n = typeof value === "string" ? Number(value) : value;
      return typeof n === "number" && Number.isFinite(n) ? n : fallback;
    };
    return {
      ads_enabled: typeof map.get("ads_enabled") === "boolean"
        ? map.get("ads_enabled") : DEFAULT_PREMIUM_SETTINGS.ads_enabled,
      ads_target: Math.max(0, Math.round(toNumber(map.get("ads_target"), DEFAULT_PREMIUM_SETTINGS.ads_target))),
      reward_cooldown_s: Math.max(0, Math.round(toNumber(map.get("reward_cooldown_s"), DEFAULT_PREMIUM_SETTINGS.reward_cooldown_s))),
      grace_minutes: Math.max(0, Math.round(toNumber(map.get("grace_minutes"), DEFAULT_PREMIUM_SETTINGS.grace_minutes))),
      price_usd: toNumber(map.get("price_usd"), DEFAULT_PREMIUM_SETTINGS.price_usd) > 0
        ? toNumber(map.get("price_usd"), DEFAULT_PREMIUM_SETTINGS.price_usd)
        : DEFAULT_PREMIUM_SETTINGS.price_usd,
    };
  } catch (_) {
    return DEFAULT_PREMIUM_SETTINGS;
  }
}

function normalizeLoginUsername(value) {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9_-]{3,30}$/.test(username) ? username : null;
}

// ─── Authenticated /api/user/* API ────────────────────────────────────────────
// Mirrors the Express API contract. Authentication is verified with Supabase
// Auth on every request; the service-role key only touches PostgREST after
// that, and every query is scoped to the verified JWT subject.
async function handleUserApi(request, opts) {
  const { path, url, supabaseUrl, anonKey, serviceKey, postgrestHeaders } = opts;
  const method = request.method.toUpperCase();
  const noStore = { "Cache-Control": "private, no-store" };
  const ok = (status = 200) => jsonResponse({ ok: true }, status, noStore);
  const fail = (message = "Internal server error", status = 500) =>
    jsonResponse({ error: message }, status, noStore);
  const pg = (suffix, init = {}) =>
    fetch(`${supabaseUrl}/rest/v1/${suffix}`, { headers: postgrestHeaders, ...init });
  const returning = { ...postgrestHeaders, "Prefer": "return=representation" };

  // Public username sign-in. Never reveal whether a username exists.
  if (path === "/api/user/username-login" && method === "POST") {
    if (rateLimitHit(`username-login:${clientKey(request)}`)) {
      return fail("Too many attempts — please wait a moment and try again.", 429);
    }
    const body = await readJsonBody(request);
    const username = normalizeLoginUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const invalid = () => fail("Invalid username or password", 401);
    if (!username || password.length < 1 || password.length > 1024) return invalid();

    try {
      const profileRes = await pg(
        `user_profiles?select=user_id,email&username=eq.${encodeURIComponent(username)}&limit=1`,
      );
      if (!profileRes.ok) return fail("Sign-in service temporarily unavailable", 503);
      const profiles = await profileRes.json();
      const profile = profiles?.[0];
      if (!profile?.user_id || !profile?.email) return invalid();

      const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "apikey": anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: profile.email, password }),
      });
      if (!authRes.ok) {
        if (authRes.status >= 500) return fail("Sign-in service temporarily unavailable", 503);
        return invalid();
      }
      const auth = await authRes.json();
      if (!auth?.access_token || !auth?.refresh_token || auth.user?.id !== profile.user_id) {
        return invalid();
      }
      return jsonResponse({
        session: { access_token: auth.access_token, refresh_token: auth.refresh_token },
      }, 200, noStore);
    } catch (_) {
      return fail("Sign-in service temporarily unavailable", 503);
    }
  }

  const auth = await verifyBearerUser(request, supabaseUrl, anonKey);
  if (!auth) return fail("Unauthorized", 401);
  const user = auth.user;
  const uid = encodeURIComponent(user.id);

  // ─── Premium ──────────────────────────────────────────────────────────────
  if (path.startsWith("/api/user/premium/")) {
    const settings = await readPremiumSettings(supabaseUrl, postgrestHeaders);
    if (path === "/api/user/premium/status" && method === "GET") {
      const res = await pg(
        `user_premium?select=premium_expires_at,ads_seen_date,ads_seen_count,last_granted_date` +
          `&user_id=eq.${uid}&limit=1`,
      );
      if (!res.ok) return fail();
      const row = (await res.json())?.[0] ?? {};
      const premiumUntil = row.premium_expires_at ?? null;
      const isPremium = typeof premiumUntil === "string" && new Date(premiumUntil).getTime() > Date.now();
      const today = new Date().toISOString().slice(0, 10);
      return jsonResponse({
        is_premium: isPremium,
        premium_until: premiumUntil,
        ads_viewed_today: row.ads_seen_date === today ? Number(row.ads_seen_count ?? 0) || 0 : 0,
        reward_granted_today: row.last_granted_date === today,
        ads_target: settings.ads_target,
        can_earn: !isPremium,
        cooldown_s: settings.reward_cooldown_s,
        ads_enabled: settings.ads_enabled,
        grace_minutes: settings.grace_minutes,
      }, 200, noStore);
    }
    if (path === "/api/user/premium/reward" && method === "POST") {
      if (rateLimitHit(`premium-reward:${user.id}`, 8, 60_000)) {
        return jsonResponse({ error: "Too many requests" }, 429, noStore);
      }
      if (!settings.ads_enabled) {
        return jsonResponse({ error: "Ads are currently disabled", cooldown_ms: 0 }, 403, noStore);
      }
      try {
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_premium_reward`, {
          method: "POST",
          headers: postgrestHeaders,
          body: JSON.stringify({
            p_user_id: user.id,
            p_cooldown_s: settings.reward_cooldown_s,
            p_target: settings.ads_target,
          }),
        });
        if (!res.ok) return fail("Premium service unavailable", 500);
        const payload = await res.json();
        const raw = Array.isArray(payload) ? payload[0] : payload;
        const num = (value, fallback = 0) => {
          const n = Number(value);
          return Number.isFinite(n) ? n : fallback;
        };
        const result = {
          granted: raw?.granted === true,
          cooldown_ms: Math.max(0, Math.round(num(raw?.cooldown_ms))),
          already_granted_today: raw?.already_granted_today === true,
          ads_viewed_today: Math.max(0, Math.round(num(raw?.ads_viewed_today))),
          ads_target: Math.max(0, Math.round(num(raw?.ads_target, settings.ads_target))),
          premium_until: typeof raw?.premium_until === "string" ? raw.premium_until : null,
          is_premium: raw?.is_premium === true,
        };
        return jsonResponse(result, result.cooldown_ms > 0 ? 429 : 200, noStore);
      } catch (_) {
        return fail("Premium service unavailable", 500);
      }
    }
    if (path === "/api/user/premium/checkout" && method === "POST") {
      return jsonResponse({ error: "not_configured", provider: "stripe" }, 501, noStore);
    }
    return fail("API endpoint not found: " + path, 404);
  }

  // ─── Role ─────────────────────────────────────────────────────────────────
  if (path === "/api/user/role" && method === "GET") {
    return jsonResponse({ role: await resolveUserRole(supabaseUrl, postgrestHeaders, user) }, 200, noStore);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────
  const PROFILE_COLUMNS = "user_id,display_name,avatar_url,bio,created_at,updated_at,username,email";
  if (path === "/api/user/profile" && method === "GET") {
    try {
      const res = await pg(`user_profiles?select=${PROFILE_COLUMNS}&user_id=eq.${uid}&limit=1`);
      if (!res.ok) return fail();
      const rows = await res.json();
      if (rows?.length) return jsonResponse(rows[0], 200, noStore);

      const name = user.user_metadata?.username || user.email?.split("@")[0] || "User";
      const created = await pg("user_profiles", {
        method: "POST",
        headers: returning,
        body: JSON.stringify({
          user_id: user.id,
          display_name: name,
          username: user.user_metadata?.username ?? null,
          email: user.email ?? null,
        }),
      });
      if (!created.ok) return fail();
      const createdRows = await created.json();
      return jsonResponse(createdRows?.[0] ?? { user_id: user.id, display_name: name }, 200, noStore);
    } catch (_) {
      return fail();
    }
  }

  if (path === "/api/user/profile" && method === "PUT") {
    const body = await readJsonBody(request);
    if (
      body.avatar_url !== undefined && body.avatar_url !== null && body.avatar_url !== "" &&
      (typeof body.avatar_url !== "string" || body.avatar_url.length > 2048 ||
        !/^https?:\/\//i.test(body.avatar_url.trim()))
    ) {
      return fail("avatar_url must be a valid http(s) URL", 400);
    }
    if (
      body.username !== undefined && body.username !== null && String(body.username).trim() !== "" &&
      !/^[a-zA-Z0-9_-]{3,30}$/.test(String(body.username).trim())
    ) {
      return fail("username must be 3-30 characters (letters, numbers, underscores, or hyphens)", 400);
    }

    const updates = { updated_at: new Date().toISOString() };
    if (typeof body.display_name === "string") updates.display_name = body.display_name.trim().slice(0, 100);
    if (typeof body.avatar_url === "string") updates.avatar_url = body.avatar_url.trim() || null;
    if (typeof body.bio === "string") updates.bio = body.bio.trim().slice(0, 1000);
    if (typeof body.username === "string" && body.username.trim()) {
      updates.username = body.username.trim().toLowerCase();
    }
    if (user.email) updates.email = user.email;

    try {
      const res = await pg(`user_profiles?on_conflict=user_id`, {
        method: "POST",
        headers: { ...postgrestHeaders, "Prefer": "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: user.id, ...updates }),
      });
      if (res.status === 409) return fail("Username already taken", 409);
      if (!res.ok) return fail();
      const rows = await res.json();
      return jsonResponse(rows?.[0] ?? { user_id: user.id, ...updates }, 200, noStore);
    } catch (_) {
      return fail();
    }
  }

  // ─── Saved videos ─────────────────────────────────────────────────────────
  if (path === "/api/user/saved") {
    if (method === "GET") {
      const res = await pg(`saved_videos?select=recording_id,metadata,saved_at&user_id=eq.${uid}&order=saved_at.desc`);
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.recording_id !== "string" || !body.recording_id) return fail("recording_id required", 400);
      const res = await pg("saved_videos?on_conflict=user_id,recording_id", {
        method: "POST",
        headers: { ...postgrestHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify({
          user_id: user.id,
          recording_id: body.recording_id,
          metadata: typeof body.metadata === "string" ? body.metadata : null,
        }),
      });
      return res.ok ? ok(201) : fail();
    }
    if (method === "DELETE") {
      const res = await pg(`saved_videos?user_id=eq.${uid}`, { method: "DELETE" });
      return res.ok ? ok() : fail();
    }
  }
  const savedItemMatch = path.match(/^\/api\/user\/saved\/([^/]+)$/);
  if (savedItemMatch && method === "DELETE") {
    const recordingId = decodeSegment(savedItemMatch[1]);
    const res = await pg(`saved_videos?user_id=eq.${uid}&recording_id=eq.${encodeURIComponent(recordingId)}`, {
      method: "DELETE",
    });
    return res.ok ? ok() : fail();
  }

  // ─── Watch history ────────────────────────────────────────────────────────
  if (path === "/api/user/history/continue" && method === "GET") {
    const raw = parseInt(url.searchParams.get("limit") || "12", 10);
    const limit = Math.min(20, Math.max(1, Number.isFinite(raw) ? raw : 12));
    const res = await pg(
      `watch_history?select=recording_id,metadata,watched_at,progress,last_position_ms,total_watch_ms` +
        `&user_id=eq.${uid}&progress=gt.0&progress=lt.100&order=watched_at.desc&limit=${limit}`,
    );
    return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
  }

  if (path === "/api/user/history/stats" && method === "GET") {
    const toNum = (v) => Number(v ?? 0) || 0;
    try {
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_user_history_stats`, {
        method: "POST",
        headers: postgrestHeaders,
        body: JSON.stringify({ p_user_id: user.id }),
      });
      if (rpcRes.ok) {
        const payload = await rpcRes.json();
        const row = Array.isArray(payload) ? payload[0] : payload;
        if (row) {
          return jsonResponse({
            totalWatchMs: toNum(row.total_watch_ms),
            totalVideos: toNum(row.total_videos),
            completedVideos: toNum(row.completed_videos),
            avgProgress: toNum(row.avg_progress),
            topPerformers: row.top_performers ?? [],
            dayBuckets: row.day_buckets ?? [0, 0, 0, 0, 0, 0, 0],
            hourBuckets: row.hour_buckets ?? Array(24).fill(0),
          }, 200, noStore);
        }
      }
    } catch (_) {
      // Fall through to the JS compatibility fallback below.
    }

    const res = await pg(
      `watch_history?select=recording_id,progress,total_watch_ms,metadata,watched_at&user_id=eq.${uid}`,
    );
    if (!res.ok) return fail();
    const items = await res.json();
    const totalWatchMs = items.reduce((sum, i) => sum + toNum(i.total_watch_ms), 0);
    const totalVideos = items.length;
    const completedVideos = items.filter((i) => toNum(i.progress) >= 100).length;
    const avgProgress = totalVideos
      ? Math.round(items.reduce((sum, i) => sum + toNum(i.progress), 0) / totalVideos)
      : 0;
    const performerMap = new Map();
    for (const item of items) {
      try {
        const meta = typeof item.metadata === "string" ? JSON.parse(item.metadata) : item.metadata;
        const username = meta?.username ?? "unknown";
        const entry = performerMap.get(username) ?? { username, count: 0, watchMs: 0 };
        entry.count += 1;
        entry.watchMs += toNum(item.total_watch_ms);
        performerMap.set(username, entry);
      } catch (_) { /* skip malformed metadata */ }
    }
    const topPerformers = [...performerMap.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dayBuckets = [0, 0, 0, 0, 0, 0, 0];
    const hourBuckets = Array(24).fill(0);
    for (const item of items) {
      const time = new Date(item.watched_at).getTime();
      if (!Number.isFinite(time) || time < thirtyDaysAgo) continue;
      dayBuckets[new Date(time).getDay()] += toNum(item.total_watch_ms);
      hourBuckets[new Date(time).getHours()] += toNum(item.total_watch_ms);
    }
    return jsonResponse({
      totalWatchMs, totalVideos, completedVideos, avgProgress, topPerformers, dayBuckets, hourBuckets,
    }, 200, noStore);
  }

  if (path === "/api/user/history") {
    if (method === "GET") {
      const res = await pg(
        `watch_history?select=recording_id,metadata,watched_at&user_id=eq.${uid}&order=watched_at.desc&limit=200`,
      );
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.recording_id !== "string" || !body.recording_id) return fail("recording_id required", 400);
      const update = {
        user_id: user.id,
        recording_id: body.recording_id,
        metadata: typeof body.metadata === "string" ? body.metadata : null,
        watched_at: new Date().toISOString(),
      };
      const clamp = (v, min, max) => Math.min(max, Math.max(min, Math.round(toNumber(v))));
      const toNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      if (body.progress !== undefined) update.progress = clamp(body.progress, 0, 100);
      if (body.last_position_ms !== undefined) update.last_position_ms = clamp(body.last_position_ms, 0, Number.MAX_SAFE_INTEGER);
      if (body.total_watch_ms !== undefined) update.total_watch_ms = clamp(body.total_watch_ms, 0, Number.MAX_SAFE_INTEGER);
      const res = await pg("watch_history?on_conflict=user_id,recording_id", {
        method: "POST",
        headers: { ...postgrestHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(update),
      });
      return res.ok ? ok(201) : fail();
    }
    if (method === "DELETE") {
      const res = await pg(`watch_history?user_id=eq.${uid}`, { method: "DELETE" });
      return res.ok ? ok() : fail();
    }
  }

  // ─── Watch later ──────────────────────────────────────────────────────────
  if (path === "/api/user/watch-later") {
    if (method === "GET") {
      const res = await pg(`watch_later_items?select=recording_id,metadata,added_at&user_id=eq.${uid}&order=added_at.asc`);
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.recording_id !== "string" || !body.recording_id) return fail("recording_id required", 400);
      const res = await pg("watch_later_items?on_conflict=user_id,recording_id", {
        method: "POST",
        headers: { ...postgrestHeaders, "Prefer": "resolution=ignore-duplicates" },
        body: JSON.stringify({
          user_id: user.id,
          recording_id: body.recording_id,
          metadata: typeof body.metadata === "string" ? body.metadata : null,
          added_at: new Date().toISOString(),
        }),
      });
      return res.ok ? ok(201) : fail();
    }
    if (method === "DELETE") {
      const res = await pg(`watch_later_items?user_id=eq.${uid}`, { method: "DELETE" });
      return res.ok ? ok() : fail();
    }
  }
  const watchLaterMatch = path.match(/^\/api\/user\/watch-later\/([^/]+)$/);
  if (watchLaterMatch && method === "DELETE") {
    const recordingId = decodeSegment(watchLaterMatch[1]);
    const res = await pg(`watch_later_items?user_id=eq.${uid}&recording_id=eq.${encodeURIComponent(recordingId)}`, {
      method: "DELETE",
    });
    return res.ok ? ok() : fail();
  }

  // ─── Collections (private playlists) ──────────────────────────────────────
  if (path === "/api/user/collections") {
    if (method === "GET") {
      const res = await pg(
        `user_collections?select=id,name,description,created_at,updated_at&user_id=eq.${uid}&order=created_at.desc`,
      );
      if (!res.ok) return fail();
      const cols = await res.json();
      const enriched = await Promise.all((cols || []).map(async (col) => {
        const itemsRes = await pg(
          `user_collection_items?select=metadata&collection_id=eq.${encodeURIComponent(col.id)}` +
            `&order=added_at.asc&limit=4`,
          { headers: { ...postgrestHeaders, "Prefer": "count=exact" } },
        );
        const items = itemsRes.ok ? await itemsRes.json() : [];
        return {
          ...col,
          item_count: postgrestCount(itemsRes, items.length),
          first_item_metadata: items[0]?.metadata ?? null,
        };
      }));
      return jsonResponse(enriched, 200, noStore);
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return fail("name required", 400);
      const id = crypto.randomUUID();
      const res = await pg("user_collections", {
        method: "POST",
        headers: returning,
        body: JSON.stringify({
          id,
          user_id: user.id,
          name,
          description: typeof body.description === "string" ? body.description : null,
        }),
      });
      if (!res.ok) return fail();
      const rows = await res.json();
      return jsonResponse(rows?.[0] ?? { id, name }, 201, noStore);
    }
  }

  const collectionItemReorderMatch = path.match(/^\/api\/user\/collections\/([^/]+)\/items\/reorder$/);
  if (collectionItemReorderMatch && method === "PUT") {
    const collectionId = decodeSegment(collectionItemReorderMatch[1]);
    const body = await readJsonBody(request);
    const ids = body.recording_ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000 ||
        ids.some((id) => typeof id !== "string" || !id)) {
      return fail("recording_ids (non-empty array) required", 400);
    }
    if (new Set(ids).size !== ids.length) return fail("duplicate recording ids in payload", 400);
    if (!await ownsCollection(supabaseUrl, postgrestHeaders, user.id, collectionId)) return fail("Forbidden", 403);
    // The SQL RPC calls auth.uid(), which is null for service-role requests.
    // Ownership was just verified above, so apply the same ordering directly.
    for (let i = 0; i < ids.length; i += 1) {
      const res = await pg(
        `user_collection_items?collection_id=eq.${encodeURIComponent(collectionId)}` +
          `&recording_id=eq.${encodeURIComponent(ids[i])}`,
        { method: "PATCH", body: JSON.stringify({ position: i }) },
      );
      if (!res.ok) return fail();
    }
    await pg(`user_collections?id=eq.${encodeURIComponent(collectionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });
    return jsonResponse({ ok: true, updated: ids.length }, 200, noStore);
  }

  const collectionItemsMatch = path.match(/^\/api\/user\/collections\/([^/]+)\/items$/);
  if (collectionItemsMatch) {
    const collectionId = decodeSegment(collectionItemsMatch[1]);
    if (!await ownsCollection(supabaseUrl, postgrestHeaders, user.id, collectionId)) return fail("Not found", 404);
    if (method === "GET") {
      const res = await pg(
        `user_collection_items?select=recording_id,metadata,added_at,position` +
          `&collection_id=eq.${encodeURIComponent(collectionId)}` +
          `&order=position.asc.nullslast,added_at.desc`,
      );
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.recording_id !== "string" || !body.recording_id) return fail("recording_id required", 400);
      const existingRes = await pg(
        `user_collection_items?select=id&collection_id=eq.${encodeURIComponent(collectionId)}` +
          `&recording_id=eq.${encodeURIComponent(body.recording_id)}&limit=1`,
      );
      if (!existingRes.ok) return fail();
      if ((await existingRes.json()).length) return jsonResponse({ ok: true, alreadyExists: true }, 200, noStore);
      const res = await pg("user_collection_items", {
        method: "POST",
        headers: returning,
        body: JSON.stringify({
          collection_id: collectionId,
          recording_id: body.recording_id,
          metadata: typeof body.metadata === "string" ? body.metadata : null,
        }),
      });
      if (!res.ok) {
        if (res.status === 409) return jsonResponse({ ok: true, alreadyExists: true }, 200, noStore);
        return fail();
      }
      await pg(`user_collections?id=eq.${encodeURIComponent(collectionId)}`, {
        method: "PATCH",
        headers: postgrestHeaders,
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      });
      return ok(201);
    }
  }

  const collectionItemMatch = path.match(/^\/api\/user\/collections\/([^/]+)\/items\/([^/]+)$/);
  if (collectionItemMatch && method === "DELETE") {
    const collectionId = decodeSegment(collectionItemMatch[1]);
    const recordingId = decodeSegment(collectionItemMatch[2]);
    if (!await ownsCollection(supabaseUrl, postgrestHeaders, user.id, collectionId)) return fail("Forbidden", 403);
    const res = await pg(
      `user_collection_items?collection_id=eq.${encodeURIComponent(collectionId)}` +
        `&recording_id=eq.${encodeURIComponent(recordingId)}`,
      { method: "DELETE" },
    );
    return res.ok ? ok() : fail();
  }

  const collectionMatch = path.match(/^\/api\/user\/collections\/([^/]+)$/);
  if (collectionMatch) {
    const collectionId = decodeSegment(collectionMatch[1]);
    if (!await ownsCollection(supabaseUrl, postgrestHeaders, user.id, collectionId)) return fail("Not found", 404);
    if (method === "PUT") {
      const body = await readJsonBody(request);
      const updates = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") updates.name = body.name;
      if (body.description !== undefined) updates.description = body.description;
      const res = await pg(`user_collections?id=eq.${encodeURIComponent(collectionId)}&user_id=eq.${uid}`, {
        method: "PATCH",
        headers: returning,
        body: JSON.stringify(updates),
      });
      if (!res.ok) return fail();
      const rows = await res.json();
      return jsonResponse(rows?.[0] ?? {}, 200, noStore);
    }
    if (method === "DELETE") {
      await pg(`user_collection_items?collection_id=eq.${encodeURIComponent(collectionId)}`, { method: "DELETE" });
      const res = await pg(`user_collections?id=eq.${encodeURIComponent(collectionId)}&user_id=eq.${uid}`, {
        method: "DELETE",
      });
      return res.ok ? ok() : fail();
    }
  }

  // ─── Performer follows ────────────────────────────────────────────────────
  if (path === "/api/user/follows") {
    if (method === "GET") {
      const res = await pg(
        `performer_follows?select=performer_username,followed_at&user_id=eq.${uid}&order=followed_at.desc`,
      );
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      if (typeof body.performer_username !== "string" || !body.performer_username) {
        return fail("performer_username required", 400);
      }
      const res = await pg("performer_follows?on_conflict=user_id,performer_username", {
        method: "POST",
        headers: { ...postgrestHeaders, "Prefer": "resolution=ignore-duplicates" },
        body: JSON.stringify({
          user_id: user.id,
          performer_username: body.performer_username,
          followed_at: new Date().toISOString(),
        }),
      });
      return res.ok ? ok(201) : fail();
    }
  }
  const followMatch = path.match(/^\/api\/user\/follows\/([^/]+)$/);
  if (followMatch && method === "DELETE") {
    const username = decodeSegment(followMatch[1]);
    const res = await pg(
      `performer_follows?user_id=eq.${uid}&performer_username=eq.${encodeURIComponent(username)}`,
      { method: "DELETE" },
    );
    return res.ok ? ok() : fail();
  }

  // ─── Notifications ────────────────────────────────────────────────────────
  // Accurate totals even when the client has only loaded the first page.
  if (path === "/api/user/notifications/stats" && method === "GET") {
    const countHeaders = { ...postgrestHeaders, "Prefer": "count=exact" };
    const readCount = async (extra = "") => {
      const res = await pg(`user_notifications?select=id&user_id=eq.${uid}${extra}&limit=0`, {
        headers: countHeaders,
      });
      if (!res.ok) return null;
      const range = res.headers.get("content-range") || "";
      const total = Number(range.split("/").pop());
      return Number.isFinite(total) ? total : 0;
    };
    const [total, unread] = await Promise.all([readCount(), readCount("&is_read=eq.false")]);
    if (total === null || unread === null) return fail();
    return jsonResponse({ total, unread }, 200, noStore);
  }
  if (path === "/api/user/notifications") {
    if (method === "GET") {
      const rawLimit = parseInt(url.searchParams.get("limit") || "50", 10);
      const rawOffset = parseInt(url.searchParams.get("offset") || "0", 10);
      const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
      const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
      const res = await pg(
        `user_notifications?select=id,type,message,related_id,is_read,created_at` +
          `&user_id=eq.${uid}&order=created_at.desc&limit=${limit}&offset=${offset}`,
      );
      return res.ok ? jsonResponse(await res.json(), 200, noStore) : fail();
    }
    if (method === "DELETE") {
      const res = await pg(`user_notifications?user_id=eq.${uid}`, { method: "DELETE" });
      return res.ok ? ok() : fail();
    }
  }
  if (path === "/api/user/notifications/read-all" && method === "PUT") {
    const res = await pg(`user_notifications?user_id=eq.${uid}&is_read=eq.false`, {
      method: "PATCH",
      headers: postgrestHeaders,
      body: JSON.stringify({ is_read: true }),
    });
    return res.ok ? ok() : fail();
  }
  if (path === "/api/user/notifications/read-batch" && method === "PUT") {
    const body = await readJsonBody(request);
    const ids = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) return fail("ids array required", 400);
    const res = await pg(
      `user_notifications?user_id=eq.${uid}&id=in.(${ids.map((id) => encodeURIComponent(String(id))).join(",")})`,
      { method: "PATCH", headers: postgrestHeaders, body: JSON.stringify({ is_read: true }) },
    );
    return res.ok ? ok() : fail();
  }
  const notificationReadMatch = path.match(/^\/api\/user\/notifications\/([^/]+)\/read$/);
  if (notificationReadMatch && method === "PUT") {
    const id = encodeURIComponent(decodeSegment(notificationReadMatch[1]));
    const res = await pg(`user_notifications?id=eq.${id}&user_id=eq.${uid}`, {
      method: "PATCH", headers: postgrestHeaders, body: JSON.stringify({ is_read: true }),
    });
    return res.ok ? ok() : fail();
  }
  const notificationMatch = path.match(/^\/api\/user\/notifications\/([^/]+)$/);
  if (notificationMatch && method === "DELETE") {
    const id = encodeURIComponent(decodeSegment(notificationMatch[1]));
    const res = await pg(`user_notifications?id=eq.${id}&user_id=eq.${uid}`, { method: "DELETE" });
    return res.ok ? ok() : fail();
  }

  // ─── Notification preferences ─────────────────────────────────────────────
  if (path === "/api/user/notification-preferences") {
    const saved = user.user_metadata?.notification_preferences || {};
    if (method === "GET") {
      return jsonResponse(NOTIFICATION_TYPES.map((type) => ({
        type,
        enabled: saved[type]?.enabled !== false,
        email_enabled: saved[type]?.email_enabled === true,
      })), 200, noStore);
    }
    if (method === "PUT") {
      const body = await readJsonBody(request);
      const prefs = body.preferences;
      if (!Array.isArray(prefs) || prefs.length === 0) return fail("preferences array required", 400);
      if (prefs.some((p) => !p || !NOTIFICATION_TYPES.includes(p.type))) {
        return fail("Invalid notification type: " + (prefs.find((p) => !p || !NOTIFICATION_TYPES.includes(p.type))?.type ?? "unknown"), 400);
      }
      const updated = { ...saved };
      for (const pref of prefs) {
        updated[pref.type] = {
          enabled: pref.enabled !== false,
          email_enabled: pref.email_enabled === true,
        };
      }
      const result = await updateAuthUserMetadata(supabaseUrl, serviceKey, user.id, {
        notification_preferences: updated,
      });
      return result ? ok() : fail();
    }
  }

  // ─── Sound / vibration preferences ────────────────────────────────────────
  if (path === "/api/user/sound-preferences") {
    if (method === "GET") {
      return jsonResponse({
        sound_enabled: user.user_metadata?.sound_enabled !== false,
        vibration_enabled: user.user_metadata?.vibration_enabled !== false,
      }, 200, noStore);
    }
    if (method === "PUT") {
      const body = await readJsonBody(request);
      const patch = {};
      if (typeof body.sound_enabled === "boolean") patch.sound_enabled = body.sound_enabled;
      if (typeof body.vibration_enabled === "boolean") patch.vibration_enabled = body.vibration_enabled;
      if (!Object.keys(patch).length) return ok();
      const result = await updateAuthUserMetadata(supabaseUrl, serviceKey, user.id, patch);
      return result ? ok() : fail();
    }
  }

  return fail("API endpoint not found: " + path, 404);
}

// ─── Performer directory stats ───────────────────────────────────────────────
// The SPA reads `performers[]` (recording_count / latest_thumbnail / gender)
// from /api/performers. The raw `channels` table has none of those fields,
// so use the same get_performer_stats RPC the Express API uses.
let _performerStatsCache = null;
let _performerStatsExpires = 0;
const PERFORMER_STATS_TTL_MS = 5 * 60 * 1000;
const GENDER_BUCKETS = {
  female: ["female", "f", "females"],
  male: ["male", "m"],
  couple: ["couple", "malefemale"],
  group: ["group"],
  trans: ["trans", "transgender", "t"],
};

function genderMatches(raw, filter) {
  if (!raw) return false;
  const value = String(raw).trim().toLowerCase();
  const lower = filter.trim().toLowerCase();
  const matches = GENDER_BUCKETS[lower] || [lower];
  return matches.includes(value);
}

async function getPerformerStats(supabaseUrl, postgrestHeaders) {
  const now = Date.now();
  if (_performerStatsCache && now < _performerStatsExpires) return _performerStatsCache;

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_performer_stats`, {
      method: "POST",
      headers: {
        ...postgrestHeaders,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (res.ok) {
      const rows = await res.json();
      const list = (rows || [])
        .map(row => ({
          username: String(row?.username || ""),
          recording_count: Number(row?.recording_count || 0),
          gender: row?.gender ?? null,
          latest_timestamp: row?.latest_timestamp ?? null,
          latest_thumbnail: row?.latest_thumbnail ?? null,
          sprite_url: row?.sprite_url ?? null,
        }))
        .filter(row => row.username);
      _performerStatsCache = list;
      _performerStatsExpires = now + PERFORMER_STATS_TTL_MS;
      return list;
    }
  } catch (_) {
    // Fall through to the stale cache (if any) below.
  }

  return _performerStatsCache || [];
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Handle CORS preflight for all /api requests
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 2. Route /api/* requests
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url, ctx);
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

// ─── Search helpers ──────────────────────────────────────────────────
// The edge worker is the deployed API for this app, so search parsing lives
// here as well as in the Express contract. Queries support:
//   plain terms          -> AND across username/title/filename/tags
//   "quoted phrase"      -> one phrase/term
//   tag:name or #name    -> exact tag
//   performer:name       -> username substring
//   -term                -> exclude a term
function escapeIlike(value) {
  return String(value ?? "").replace(/[\\%_]/g, "\\$&");
}

function searchArrayLiteral(value) {
  const escaped = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function tokenizeSearch(raw) {
  const input = String(raw ?? "");
  const tokens = [];
  let i = 0;

  while (i < input.length && tokens.length < 8) {
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;

    let negated = false;
    if (input[i] === "-" && i + 1 < input.length && !/\s/.test(input[i + 1])) {
      negated = true;
      i++;
    }

    let value = "";
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i++];
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) i++;
        value += input[i++];
      }
      if (i < input.length) i++;
    } else {
      while (i < input.length && !/\s/.test(input[i])) {
        if ((input[i] === '"' || input[i] === "'") && /(^|:)$/.test(value)) {
          const quote = input[i++];
          while (i < input.length && input[i] !== quote) {
            if (input[i] === "\\" && i + 1 < input.length) i++;
            value += input[i++];
          }
          if (i < input.length) i++;
        } else {
          value += input[i++];
        }
      }
    }

    const lower = value.toLocaleLowerCase();
    let kind = "text";
    let term = value;
    if (lower.startsWith("tag:")) {
      kind = "tag";
      term = value.slice(4);
    } else if (lower.startsWith("performer:") || lower.startsWith("user:")) {
      kind = "performer";
      term = value.slice(value.indexOf(":") + 1);
    } else if (value.startsWith("#")) {
      kind = "tag";
      term = value.slice(1);
    }

    term = term.trim();
    if (term) tokens.push({ kind, term, negated });
  }

  return tokens;
}

function applyAdvancedSearch(params, raw) {
  const tokens = tokenizeSearch(raw);
  for (const token of tokens) {
    const key = token.negated ? "not.or" : "or";
    const like = `*${escapeIlike(token.term)}*`;
    if (token.kind === "tag") {
      params.append(key, `(tags.cs.{${searchArrayLiteral(token.term.toLocaleLowerCase())}})`);
    } else if (token.kind === "performer") {
      params.append(key, `(username.ilike.${like})`);
    } else {
      params.append(key, `(username.ilike.${like},room_title.ilike.${like},filename.ilike.${like},tags.cs.{${searchArrayLiteral(token.term.toLocaleLowerCase())}})`);
    }
  }
  return tokens.length;
}

function suggestionScore(label, query) {
  const value = normalizeSearchText(label);
  if (!value || !query) return Number.MAX_SAFE_INTEGER;
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (value.includes(query)) return 3;
  return Number.MAX_SAFE_INTEGER;
}

// ─── API Router ──────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// Live segment edge cache + read-ahead prefetch.
// The live streams' origin CDN throttles each connection (~0.15 MB/s —
// playback can barely keep up). Two fixes at the edge:
//   1. Segments are cached under a NORMALIZED key (auth_key query param
//      stripped) — the bytes for videos5/{md5}/xxx.ts are identical no
//      matter which token fetched them, so every viewer and every loop
//      shares one warm edge copy. First fetch is slow; every later one is
//      edge-speed.
//   2. When a playlist is served we remember its segment order and prefetch
//      the head (and, on each segment hit, the next few) via waitUntil —
//      turning the client's serial slow fetches into parallel edge warmups.
// ═══════════════════════════════════════════════════════════════════════════

const LIVE_SEG_MAX_BYTES = 8 * 1024 * 1024;
const LIVE_PREFETCH_ON_PLAYLIST = 8;
const LIVE_PREFETCH_READAHEAD = 4;
const livePlaylistOrder = new Map(); // base dir -> { urls: [], expires }
let livePrefetchActive = 0;

function isLiveSegmentUrl(targetObj) {
  if (!/\.(ts|key)$/i.test(targetObj.pathname)) return false;
  return targetObj.hostname.endsWith(".cn") && targetObj.pathname.includes("/videos");
}

function liveSegmentCacheKey(targetObj) {
  // Strip the rotating auth_key — content depends only on the path.
  // NOTE: cache.put/match only work for URLs on our own zone, so the key is
  // a synthetic path on the production host.
  return new Request(`https://chuglii.in/__live-seg${targetObj.pathname}`);
}

async function fetchAndCacheSegment(segUrl, log) {
  let targetObj;
  try {
    targetObj = new URL(segUrl);
  } catch {
    return null;
  }
  const cacheKey = liveSegmentCacheKey(targetObj);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  if (livePrefetchActive >= 6) return null; // don't stampede
  livePrefetchActive += 1;
  try {
    const res = await fetch(targetObj.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36", "Referer": "https://chuglii.in/" },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > LIVE_SEG_MAX_BYTES) return null;
    const cachedRes = new Response(buf, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "video/mp2t",
        "Cache-Control": "public, max-age=86400",
      },
    });
    try {
      await cache.put(cacheKey, cachedRes.clone());
    } catch { /* best effort */ }
    return cachedRes;
  } catch {
    return null;
  } finally {
    livePrefetchActive -= 1;
  }
}

function rememberPlaylistOrder(playlistText, playlistBase) {
  try {
    const urls = playlistText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        try { return new URL(l, playlistBase).toString(); } catch { return null; }
      })
      .filter(Boolean);
    if (!urls.length) return;
    const baseDir = playlistBase.slice(0, playlistBase.lastIndexOf("/") + 1);
    livePlaylistOrder.set(baseDir, { urls, expires: Date.now() + 30 * 60_000 });
    if (livePlaylistOrder.size > 40) {
      const oldest = livePlaylistOrder.keys().next().value;
      if (oldest) livePlaylistOrder.delete(oldest);
    }
  } catch { /* best effort */ }
}

function scheduleLivePrefetch(text, playlistBase, log, waitUntil) {
  try {
    const baseDir = playlistBase.slice(0, playlistBase.lastIndexOf("/") + 1);
    rememberPlaylistOrder(text, playlistBase);
    const entry = livePlaylistOrder.get(baseDir);
    if (!entry) return;
    const head = entry.urls.slice(0, LIVE_PREFETCH_ON_PLAYLIST).map((u) => fetchAndCacheSegment(u, log));
    waitUntil(Promise.allSettled(head));
  } catch { /* best effort */ }
}

function scheduleSegmentReadAhead(segUrl, log, waitUntil) {
  try {
    for (const [baseDir, entry] of livePlaylistOrder) {
      if (entry.expires < Date.now()) { livePlaylistOrder.delete(baseDir); continue; }
      if (!segUrl.startsWith(baseDir)) continue;
      const idx = entry.urls.indexOf(segUrl);
      if (idx < 0) return;
      const next = entry.urls.slice(idx + 1, idx + 1 + LIVE_PREFETCH_READAHEAD).map((u) => fetchAndCacheSegment(u, log));
      if (next.length) waitUntil(Promise.allSettled(next));
      return;
    }
  } catch { /* best effort */ }
}

async function handleApi(request, env, url, ctx) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3MDAwMDAwMDAsICJleHAiOiAyMDE1MzYwMDAwfQ.NSqjip-vQHwHjATurt4ensfmKBHa4Pt5m_dLP909lV8";

  const path = url.pathname.replace(/\/+$/, "");

  // ─── Watch Live (/api/live/*) ──────────────────────────────────────
  // Catalogue + metadata live in Supabase (live_streams, populated by the
  // GitHub-Actions live worker). Playback: remuxed HLS from object storage
  // when the worker has processed the video, otherwise the upstream feed
  // resolved live (the edge media proxy handles CORS + URI rewriting).
  if (path === "/api/live/streams") {
    return handleLiveStreams(env, url);
  }
  if (path === "/api/live/resolve") {
    return handleLiveResolve(request, env, url);
  }
  if (path.startsWith("/api/live/thumb")) {
    return handleLiveThumb(env, url);
  }
  if (path.startsWith("/api/live/live-thumb/")) {
    // Real-time frame thumbnails need a remux/origin — not part of the
    // storage-free deployment. Redirect to the decrypted static cover.
    const id = path.split("/").pop() || "";
    if (!/^\d{1,7}$/.test(id)) return new Response("Bad id", { status: 400 });
    try {
      const rows = await liveQuery(env, "id,thumbnail_url");
      const row = rows.find((r) => String(r.id) === id);
      if (row && row.thumbnail_url) {
        const target = new URL(
          `/api/live/thumb?url=${encodeURIComponent(row.thumbnail_url)}`,
          url.origin,
        );
        return Response.redirect(target.toString(), 302);
      }
    } catch {
      /* fall through */
    }
    return new Response("Not found", { status: 404 });
  }

  // ─── Preview Sprite Server (/api/preview/:table/:id/:sheet) ─────────
  // Serves storyboard sprite sheets generated by the scraper (Postgres
  // bytea via scraper_get_preview_sprite). Immutable content + edge cache:
  // one request per sheet per pop, then instant everywhere.
  if (path.startsWith("/api/preview/")) {
    const parts = path.split("/").filter(Boolean); // [api, preview, table, id, sheet]
    const table = parts[2] || "";
    const videoId = parts[3] || "";
    const sheet = Math.max(0, parseInt(parts[4] || "0", 10) || 0);
    const allowedTables = new Set([
      "chinese_videos", "videos", "japanese_videos", "myanmar_videos", "samusar_videos",
      "onlyfans_videos", "voyeurhouse_videos", "hotscopesvoyeurhouse_videos",
      "reallifecamto_videos", "hotscopesspygasm_videos", "hotscopesreallifecam_videos",
    ]);
    const uuidRe = /^[0-9a-fA-F-]{8,64}$/;
    if (!allowedTables.has(table) || !uuidRe.test(videoId)) {
      return errorResponse("Invalid preview request", 400);
    }
    const cacheKey = new Request(`https://sprite.cache/${table}/${videoId}/${sheet}`);
    const cache = caches.default;
    let cached = await cache.match(cacheKey);
    if (cached) return cached;
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/scraper_get_preview_sprite`, {
      method: "POST",
      headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_table: table, p_id: videoId, p_sheet: sheet }),
    });
    if (!rpcRes.ok) return errorResponse("Preview lookup failed", 502);
    const b64 = (await rpcRes.json()) || "";
    if (!b64) return new Response("Not found", { status: 404, headers: { "Cache-Control": "public, max-age=300" } });
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const res = new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
    try { await cache.put(cacheKey, res.clone()); } catch { /* cache best-effort */ }
    return res;
  }

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
        targetObj.hostname.includes("sheeshfans") ||
        targetObj.hostname.includes("pixhost.to") ||
        targetObj.hostname.includes("catbox.moe") ||
        targetObj.hostname.includes("imgpile.com") ||
        targetObj.hostname.includes("buumal.com") ||
        targetObj.hostname.includes("samusar.com")
      ) {
        referer = `${targetObj.origin}/`;
      }

      // Hosts that only serve bytes when the request carries THEIR referer.
      // content.zavastream.com (borntobefuck.com) answers 403 to every other
      // referer, so the default `https://chuglii.in/` above is guaranteed to
      // fail for it.
      const REFERER_OVERRIDES = {
        "content.zavastream.com": "https://borntobefuck.com/",
      };
      const hostMatches = (h) =>
        targetObj.hostname === h || targetObj.hostname.endsWith(`.${h}`);
      let refererLocked = false;
      for (const [h, r] of Object.entries(REFERER_OVERRIDES)) {
        if (hostMatches(h)) {
          referer = r;
          refererLocked = true;
          break;
        }
      }

      // Playlists and byte ranges are the player, not a thumbnail: they need
      // Range forwarding, no long-lived edge caching, and a Range/206 status
      // passed through instead of being flattened to 200.
      const rangeHeader = request.headers.get("range");
      const isPlaylist = /\.m3u8(\?|$)/i.test(targetObj.pathname);
      const isMediaStream =
        !!rangeHeader || isPlaylist || /\.(ts|m4s|mp4)(\?|$)/i.test(targetObj.pathname);

      // ── Live segment fast path ──────────────────────────────────────
      // Serve .ts/.key for the live CDN from the normalized-key edge cache
      // and trigger read-ahead prefetch. Range requests fall through.
      if (!rangeHeader && isLiveSegmentUrl(targetObj)) {
        const cacheKey = liveSegmentCacheKey(targetObj);
        const hit = await caches.default.match(cacheKey);
        if (hit) {
          const headers = new Headers(hit.headers);
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("X-Live-Seg", "edge-hit");
          if (ctx) scheduleSegmentReadAhead(targetObj.toString(), null, (p) => ctx.waitUntil(p));
          return new Response(hit.body, { status: 200, headers });
        }
        const segRes = await fetchAndCacheSegment(targetObj.toString(), null);
        if (segRes) {
          const headers = new Headers(segRes.headers);
          headers.set("Access-Control-Allow-Origin", "*");
          headers.set("X-Live-Seg", "fetched");
          if (ctx) scheduleSegmentReadAhead(targetObj.toString(), null, (p) => ctx.waitUntil(p));
          return new Response(segRes.body, { status: 200, headers });
        }
        // cache/fetch failed — fall through to the generic stream path
      }

      // Images are fetched under a cache-busted URL: the edge still holds 403s
      // cached back when this Worker sent the wrong referer, and `cf.cacheKey`
      // does not re-key SUBrequests. Changing the URL is the only thing that
      // reliably produces a fresh cache entry. The CDN ignores the parameter
      // (verified: same bytes, HTTP 200), and it is applied to images only so
      // stream byte ranges keep their upstream identity.
      const fetchUrl = isMediaStream
        ? targetUrl
        : `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}_cf=2`;

      let upstreamRes = await fetch(fetchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Referer": referer,
          ...(rangeHeader ? { "Range": rangeHeader } : {}),
          "Accept": isMediaStream
            ? "*/*"
            : "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        // Only streams get an explicit `cf` override (never edge-cache media
        // bytes). Images keep Cloudflare's default caching -- but under a
        // DIFFERENT cache key.
        //
        // Why the key: `cacheEverything: true` had cached the 403 produced
        // while this Worker still sent the wrong referer. After the referer
        // was fixed the edge kept replaying that cached 403
        // (`cf-cache-status: HIT`, a Bunny "403 Forbidden" page) for a URL
        // that now answers 200 to curl with byte-identical headers. A fresh
        // key abandons those poisoned entries; 4xx are not cached by default,
        // so they cannot come back.
        ...(isMediaStream ? { cf: { cacheTtl: 0, cacheEverything: false } } : {}),
      });

      // If upstream failed with 403, retry without Referer header. Several
      // CDNs accept an EMPTY referer but reject every foreign one -- the
      // zavastream CDN above is exactly this shape (no referer: 200,
      // borntobefuck.com: 200, anything else: 403).
      if (!upstreamRes.ok && upstreamRes.status === 403) {
        upstreamRes = await fetch(fetchUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            ...(rangeHeader ? { "Range": rangeHeader } : {}),
            "Accept": isMediaStream
              ? "*/*"
              : "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
          ...(isMediaStream ? { cf: { cacheTtl: 0, cacheEverything: false } } : {}),
        });
      }

      // 91dasj cover CDN (pic.biacea.cn): serves AES-128-CBC encrypted blobs
      // (content-type binary/octet-stream). The site's image.0821.js decrypts
      // client-side with a fixed key/iv; replicate that here so thumbnails
      // render. Plaintext is the raw JPEG.
      if (
        upstreamRes.ok &&
        (targetObj.hostname === "biacea.cn" || targetObj.hostname.endsWith(".biacea.cn"))
      ) {
        try {
          const encBuf = new Uint8Array(await upstreamRes.arrayBuffer());
          const ccDecode = (s) => s.split("_").map((a) => String.fromCharCode(parseInt(a))).join("");
          const rawKey = new TextEncoder().encode(
            ccDecode("102_53_100_57_54_53_100_102_55_53_51_51_54_50_55_48")
          );
          const rawIv = new TextEncoder().encode(
            ccDecode("57_55_98_54_48_51_57_52_97_98_99_50_102_98_101_49")
          );
          const aesKey = await crypto.subtle.importKey("raw", rawKey, "AES-CBC", false, ["decrypt"]);
          const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: rawIv }, aesKey, encBuf);
          return new Response(plain, {
            status: 200,
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=31536000, immutable",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch (decErr) {
          // fall through to the normal pass-through below
        }
      }

      if (!upstreamRes.ok) {
        // NEVER redirect a referer-locked or streaming URL to the raw origin:
        // the browser would re-request it with `Referer: https://chuglii.in/`
        // and the CDN answers 403. That redirect is what made every
        // borntobefuck thumbnail and stream fail in production.
        if (refererLocked || isMediaStream) {
          return new Response(null, {
            status: upstreamRes.status >= 400 ? upstreamRes.status : 502,
            headers: { "X-Content-Type-Options": "nosniff" },
          });
        }
        return Response.redirect(targetUrl, 302);
      }

      const rawType = (upstreamRes.headers.get("content-type") || "").toLowerCase();

      // HLS playlists from referer-locked CDNs carry RELATIVE variant/segment
      // URIs (`720p/video.m3u8`, `seg_00000.ts`). Streamed verbatim the browser
      // resolves those against OUR origin and 404s, so every URI is resolved
      // against the playlist URL and wrapped back through this proxy.
      if (rawType.includes("mpegurl") || isPlaylist) {
        const playlist = await upstreamRes.text();
        const playlistBase = upstreamRes.url || targetUrl;
        // Remember segment order + warm the head of the stream at the edge
        // so playback starts from cache instead of the slow origin.
        if (ctx) scheduleLivePrefetch(playlist, playlistBase, null, (p) => ctx.waitUntil(p));
        const toProxy = (uri) => {
          try {
            return `/api/media?url=${encodeURIComponent(new URL(uri, playlistBase).toString())}`;
          } catch {
            return uri;
          }
        };
        const rewritten = playlist
          .split(/\r?\n/)
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;
            if (trimmed.startsWith("#")) {
              return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${toProxy(uri)}"`);
            }
            return toProxy(trimmed);
          })
          .join("\n");
        return new Response(rewritten, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Cache-Control": "public, max-age=30",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      // Video bytes: pass the upstream status (206 for Range) and its
      // Content-Range straight through, so seeking works and a truncated body
      // is never reported as a complete 200.
      if (isMediaStream) {
        const streamHeaders = new Headers();
        streamHeaders.set("Content-Type", rawType || "application/octet-stream");
        streamHeaders.set("Accept-Ranges", "bytes");
        streamHeaders.set("Access-Control-Allow-Origin", "*");
        const contentRange = upstreamRes.headers.get("content-range");
        if (contentRange) streamHeaders.set("Content-Range", contentRange);
        const contentLength = upstreamRes.headers.get("content-length");
        if (contentLength) streamHeaders.set("Content-Length", contentLength);
        return new Response(upstreamRes.body, {
          status: upstreamRes.status === 206 ? 206 : 200,
          headers: streamHeaders,
        });
      }

      const contentType = rawType || "image/jpeg";
      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Vary", "Accept");

      return new Response(upstreamRes.body, { status: 200, headers });
    } catch {
      // A redirect here would send the browser to the raw origin carrying our
      // own referer -- fatal for referer-locked CDNs and pointless for streams.
      if (refererLocked || isMediaStream) {
        return new Response(null, {
          status: 502,
          headers: { "X-Content-Type-Options": "nosniff" },
        });
      }
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

// Streamtape hides the MP4 behind a short-lived /get_video token. The edge can
// resolve the token from the embed HTML, but Streamtape blocks datacenter IPs
// when the token is consumed. Serve the token URL to the browser instead, so
// the actual media request comes from the viewer's IP. botlink/robotlink are
// valid; ideoolink is a deliberately corrupted decoy.
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
      "Referer": "https://supjav.com/",
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
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><meta name="referrer" content="no-referrer"><title>${safeTitle}</title><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative}video{width:100%;height:100%;max-height:100vh;object-fit:contain;background:#000}.control-overlay{position:absolute;top:12px;right:12px;z-index:50}.quality-select{background:rgba(15,23,42,.88);color:#f8fafc;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:5px 10px;font-size:13px;font-family:system-ui,-apple-system,sans-serif;cursor:pointer}.quality-select option{background:#0f172a;color:#fff}</style></head><body><div id="quality-wrap" class="control-overlay" style="display:none"><select id="quality-selector" class="quality-select" title="Select Video Quality"></select></div><video id="player" controls autoplay muted playsinline referrerpolicy="no-referrer" ${safePoster ? `poster="${safePoster}"` : ''}></video><script>(function(){var v=document.getElementById('player'),s=${JSON.stringify(list)},sel=document.getElementById('quality-selector'),w=document.getElementById('quality-wrap');if(!s.length)return;function _unmute(){try{v.muted=false}catch(e){}document.removeEventListener('pointerdown',_unmute);document.removeEventListener('keydown',_unmute);document.removeEventListener('touchstart',_unmute)}document.addEventListener('pointerdown',_unmute);document.addEventListener('keydown',_unmute);document.addEventListener('touchstart',_unmute);function label(x){var l=x.label||(x.quality?(x.quality+'p'):'Original');if(x.quality>=1080&&!/full\s*hd/i.test(l))l+=' Full HD';else if(x.quality>=720&&x.quality<1080&&!/\bhd\b/i.test(l))l+=' HD';return l}if(s.length>1){w.style.display='block';s.forEach(function(x,i){var o=document.createElement('option');o.value=String(i);o.textContent=label(x);sel.appendChild(o)})}function set(i,keep){i=Math.max(0,Math.min(s.length-1,i));var t=keep?(v.currentTime||0):0,p=v.paused;sel.value=String(i);var usedFallback=false;var onError=function(){v.removeEventListener('error',onError);var fb=s[i].fallbackUrl;if(fb&&!usedFallback){usedFallback=true;v.src=fb;v.addEventListener('error',onError);v.load()}else if(i<s.length-1){set(i+1,keep)}};v.addEventListener('error',onError);v.src=s[i].url;v.addEventListener('loadedmetadata',function m(){v.removeEventListener('loadedmetadata',m);try{if(t>0)v.currentTime=Math.min(t,Math.max(0,(v.duration||t)-.25))}catch(e){}if(!p){v.muted=true;v.play().catch(function(){})}});v.load()}sel.addEventListener('change',function(){set(parseInt(sel.value,10)||0,true)});set(0,false);v.play().catch(function(){v.muted=true;v.play().catch(function(){})})})();</script><script>(function(){function n(t,d){try{parent.postMessage({source:'chuglii-player',type:t,detail:d||{}},'*')}catch(e){}}var v=document.getElementById('player');v.addEventListener('playing',function(){n('player:playing')});v.addEventListener('ended',function(){n('player:ended')});v.addEventListener('error',function(){n('player:error',{code:'media_error',message:(v.error&&v.error.message)||'This stream failed to play.'})})})();</script></body></html>`;
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
  <video id="player" controls autoplay muted playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      function notify(type, detail) {
        try { parent.postMessage({ source: 'chuglii-player', type: type, detail: detail || {} }, '*'); } catch (err) {}
      }
      var hlsRetries = 0;
      var video = document.getElementById('player');
      // Autoplay is only permitted while MUTED, so playback starts silent and
      // the first click/keypress restores audio. Without this the browser
      // blocked autoplay outright and the player sat black -- which reads as
      // "the video doesn't play".
      function unmuteOnFirstGesture() {
        try { video.muted = false; } catch (err) {}
        document.removeEventListener('pointerdown', unmuteOnFirstGesture);
        document.removeEventListener('keydown', unmuteOnFirstGesture);
        document.removeEventListener('touchstart', unmuteOnFirstGesture);
      }
      document.addEventListener('pointerdown', unmuteOnFirstGesture);
      document.addEventListener('keydown', unmuteOnFirstGesture);
      document.addEventListener('touchstart', unmuteOnFirstGesture);
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
  <video id="player" controls autoplay muted playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      function notify(type, detail) {
        try { parent.postMessage({ source: 'chuglii-player', type: type, detail: detail || {} }, '*'); } catch (err) {}
      }
      var video = document.getElementById('player');
      var badge = document.getElementById('failover-badge');
      // Autoplay is only permitted while MUTED, so playback starts silent and
      // the first click/keypress restores audio. Without this the browser
      // blocked autoplay and the player sat black ("it does not play").
      function unmuteOnFirstGesture() {
        try { video.muted = false; } catch (err) {}
        document.removeEventListener('pointerdown', unmuteOnFirstGesture);
        document.removeEventListener('keydown', unmuteOnFirstGesture);
        document.removeEventListener('touchstart', unmuteOnFirstGesture);
      }
      document.addEventListener('pointerdown', unmuteOnFirstGesture);
      document.addEventListener('keydown', unmuteOnFirstGesture);
      document.addEventListener('touchstart', unmuteOnFirstGesture);
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
  // An already-proxied URL (`/api/media?url=...`) must NOT be wrapped again:
  // that double hop put our own origin through the /api/player/stream host
  // allowlist, which does not list itself, so every btb stream 403'd. The
  // media proxy already handles the referer and rewrites playlist URIs.
  const isOwnMediaProxy = parsed.pathname === "/api/media";
  const proxyUrl = `/api/player/stream?url=${encodeURIComponent(abs)}`;
  const playDirect = useDirectAvs || isOwnMediaProxy;
  return {
    url: playDirect ? abs : proxyUrl,
    fallbackUrl: playDirect ? (isOwnMediaProxy ? "" : proxyUrl) : "",
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

const AVS_CHAIN_HOST_RE = /(^|\.)(hotscopes\.(io|net|com|org)|reallifecam\.to|reallifecams\.net|voyeur-house\.org|clicknplay\.to|vidello\.net|nowplay\.to)$/i;
const AVS_DIRECT_HOST_RE = /(^|\.)clicknplay\.to$/i;

// Stampede guard: many users hitting the same cold segment in the same colo
// share one origin fetch per isolate instead of fanning out N identical
// upstream requests. Entries self-expire; bounded map size.
const streamInflight = new Map();
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

  // ─── Studios play-time resolver (/api/studios/resolve) ───────────────
  // dasj91 stream URLs carry ~1h auth_key tokens, so nothing is stored at
  // ingest. At play time this route fetches the archive page, extracts the
  // fresh part m3u8 URLs from the data-config blocks, merges them into one
  // media playlist (multi-part posts get #EXT-X-DISCONTINUITY between
  // parts), and rewrites every segment/key through /api/player/stream.
  // Edge-cached ~25 min — safely inside the 1h token TTL.
  if (path === "/api/studios/resolve") {
    const pageUrl = url.searchParams.get("url") || "";
    if (!/^https:\/\/([^/]*\.)?91dasj\.com\/archives\/\d+\/?($|\?)/.test(pageUrl)) {
      return errorResponse("Missing or invalid dasj91 archive url", 400);
    }

    const resolveCache = caches.default;
    // rv= bumps the cached-playlist format version (cache key only, not sent upstream).
    const resolveKey = new Request(url.toString() + "&rv=3", { method: "GET" });
    try {
      const cachedResolve = await resolveCache.match(resolveKey);
      if (cachedResolve) return cachedResolve;
    } catch (e) {}

    const dasjUa = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    const pageResp = await fetch(pageUrl, { headers: { "User-Agent": dasjUa } });
    if (!pageResp.ok) return errorResponse("Archive fetch failed", 502);
    const pageHtml = await pageResp.text();

    const partUrls = [];
    // Attribute quoting varies per post: data-config="..." or data-config='...'.
    const configMatches = pageHtml.match(/data-config=(["'])([\s\S]+?)\1/g) || [];
    for (const cm of configMatches) {
      try {
        const raw = cm.slice(13, -1)
          .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&amp;/g, "&");
        const cfg = JSON.parse(raw);
        const vurl = cfg.video && cfg.video.url;
        if (typeof vurl === "string" && vurl.startsWith("http")) partUrls.push(vurl);
      } catch (e) {}
    }
    if (!partUrls.length) return errorResponse("No playable parts found", 404);

    const partGroups = [];
    let maxTargetDuration = 0;
    for (const partUrl of partUrls) {
      try {
        const partResp = await fetch(partUrl, { headers: { "User-Agent": dasjUa } });
        if (!partResp.ok) continue;
        const partText = await partResp.text();
        const parsed = new URL(partUrl);
        const partOrigin = parsed.origin;
        const partBase = parsed.pathname.substring(0, parsed.pathname.lastIndexOf("/") + 1);
        const group = [];
        for (const line of partText.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("#EXT-X-KEY:")) {
            group.push(trimmed.replace(/URI=["']([^"']+)["']/, (mm, uri) => {
              const abs = uri.startsWith("http") ? uri : (uri.startsWith("/") ? partOrigin + uri : partOrigin + partBase + uri);
              return `URI="/api/player/stream?url=${encodeURIComponent(abs)}"`;
            }));
            continue;
          }
          if (trimmed.startsWith("#")) {
            // Track the largest part TARGETDURATION, then strip part-level
            // playlist headers; the merged playlist emits its own.
            const tdm = trimmed.match(/^#EXT-X-TARGETDURATION:(\d+)/);
            if (tdm) maxTargetDuration = Math.max(maxTargetDuration, parseInt(tdm[1], 10));
            if (/^#(EXTM3U|EXT-X-VERSION|EXT-X-MEDIA-SEQUENCE|EXT-X-PLAYLIST-TYPE|EXT-X-TARGETDURATION)/.test(trimmed)) continue;
            group.push(trimmed); continue;
          }
          const abs = trimmed.startsWith("http") ? trimmed : (trimmed.startsWith("/") ? partOrigin + trimmed : partOrigin + partBase + trimmed);
          group.push(`/api/player/stream?url=${encodeURIComponent(abs)}`);
        }
        if (group.length) partGroups.push(group);
      } catch (e) {}
    }
    if (!partGroups.length) return errorResponse("No playable parts found", 502);

    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${maxTargetDuration || 10}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
    ];
    partGroups.forEach((group, i) => {
      if (i > 0) lines.push("#EXT-X-DISCONTINUITY");
      lines.push(...group);
    });
    lines.push("#EXT-X-ENDLIST");

    const resolveResp = new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Cache-Control": "public, max-age=1500",
      },
    });
    try { await resolveCache.put(resolveKey, resolveResp.clone()); } catch (e) {}
    return resolveResp;
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

    // Scale guard: this route is a public proxy endpoint. Without a host
    // allowlist it is an open anonymizing proxy that bots will abuse at
    // scale (origin bandwidth, Cloudflare ToS risk, origin-CDN IP bans).
    // Only hosts that actually appear in stored media URLs are proxied.
    const STREAM_HOST_SUFFIXES = [
      "taobao-cdn.com", "supjav.com", "supremejav.com", "clicknplay.to",
      "sheeshfans.com", "influencersgonewild.com",
      "influencersgonewild.net", "mmsvibex.fit", "voyeur-house.org",
      "spicymms.com", "indianbfclips.com", "desibp.cam", "mydesi.sbs", "mydesi.rest", "mastiraja.tv", "viralmms.net", "samusar.com",
      "reallifecam.to", "reallifecams.net", "hotscopes.net", "nowplay.to",
      // onlyfans sources added 2026-11-27 (referer-locked / public mp4)
      "content.zavastream.com", "media.uncut-x.com",
      "lulustream.com", "vidara.so", "vidara.to", "whitetrafsa.com",
      "tiktokcdn.com", "838238.xyz", "xianshipian.com", "aomcyou.site",
      "apianmeng.com", "atukjhesk.com",
      // studios category (madouer Phase A; dasj91/madouhd hosts pre-added for
      // Phase B/C): all verified 200 + CORS * with no Referer.
      "cdn2020.com", "97img.com", "thm3u8.co", "sxtmo.com", "micgqv.cn", "mkimfs.cn", "ucjosl.cn",
      // madouhd (Phase C): playlists live on sxtmo but segments rotate across
      // CloudFront distributions (e.g. d194uwh9agusk5.cloudfront.net).
      "cloudfront.net",
    ];
    const hostMatch = streamUpstreamUrl.match(/^https?:\/\/([^/?#]+)/i);
    const reqHost = hostMatch ? hostMatch[1].toLowerCase() : "";
    if (!STREAM_HOST_SUFFIXES.some((s) => reqHost === s || reqHost.endsWith("." + s))) {
      return errorResponse("Stream host not allowed", 403);
    }

    try {
      // Edge cache: segments and playlists are immutable, so serve repeat
      // fetches straight from the Cloudflare colo (~30ms) instead of paying
      // the slow origin-CDN round trip (~2-3s) every time.
      const streamCache = caches.default;
      try {
        const cachedStream = await streamCache.match(new Request(url.toString(), { method: "GET" }));
        if (cachedStream) {
          // Range request against a cached full object: slice locally and
          // answer 206 (~30ms) - this is the MP4 scrubbing fast path.
          const rangeHdr = request.headers.get("Range");
          const rm = rangeHdr ? rangeHdr.match(/^bytes=(\d+)-(\d*)$/) : null;
          if (rm) {
            const start = parseInt(rm[1], 10);
            const total = parseInt(cachedStream.headers.get("Content-Length") || "0", 10);
            if (total && start < total) {
              const end = Math.min(rm[2] ? parseInt(rm[2], 10) : total - 1, total - 1);
              if (start <= end) {
                // Stream the slice instead of materializing the whole cached
                // object: per-request memory stays at one chunk no matter how
                // many concurrent scrubs hit this colo. The cached body is
                // colo-local, so skipping over bytes is cheap.
                const sliceHeaders = new Headers();
                sliceHeaders.set("Content-Type", cachedStream.headers.get("Content-Type") || "video/mp4");
                sliceHeaders.set("Access-Control-Allow-Origin", "*");
                sliceHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                sliceHeaders.set("Access-Control-Allow-Headers", "*");
                sliceHeaders.set("Accept-Ranges", "bytes");
                sliceHeaders.set("Content-Range", `bytes ${start}-${end}/${total}`);
                sliceHeaders.set("Content-Length", String(end - start + 1));
                sliceHeaders.set("Cache-Control", "public, max-age=604800");
                sliceHeaders.set("X-Edge-Cache", "range-hit");
                try {
                  const reader = cachedStream.body.getReader();
                  const ts = new TransformStream();
                  const writer = ts.writable.getWriter();
                  const pump = async () => {
                    let skipped = 0;
                    let toEmit = end - start + 1;
                    try {
                      while (toEmit > 0) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        let chunk = value;
                        if (skipped < start) {
                          if (skipped + chunk.length <= start) { skipped += chunk.length; continue; }
                          chunk = chunk.subarray(start - skipped);
                          skipped = start;
                        }
                        if (chunk.length > toEmit) chunk = chunk.subarray(0, toEmit);
                        toEmit -= chunk.length;
                        await writer.write(chunk);
                      }
                    } catch { /* client aborted */ }
                    finally {
                      try { await writer.close(); } catch { /* already closed */ }
                      try { reader.cancel(); } catch { /* already done */ }
                    }
                  };
                  if (ctx) ctx.waitUntil(pump()); else pump();
                  return new Response(ts.readable, { status: 206, headers: sliceHeaders });
                } catch { /* fall back below */ }
              }
            }
            // Unknown total or streaming failed: fall through to origin.
          } else {
            const hitHeaders = new Headers(cachedStream.headers);
            hitHeaders.set("X-Edge-Cache", "hit");
            return new Response(cachedStream.body, { status: cachedStream.status, headers: hitHeaders });
          }
        }
      } catch { /* cache lookup best-effort */ }

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
      } else if (targetObj.hostname.includes("spicymms")) {
        referer = "https://www.spicymms.com/";
      } else if (targetObj.hostname.includes("indianbfclips")) {
        referer = "https://www.indianbfclips.com/";
      } else if (targetObj.hostname.includes("mydesi")) {
        referer = "https://mydesi.sbs/";
      } else if (targetObj.hostname.includes("samusar")) {
        referer = "https://www.samusar.com/";
      } else if (targetObj.hostname.includes("nowplay")) {
        referer = "https://nowplay.to/";
      } else if (targetObj.hostname.includes("xianshipian") || targetObj.hostname.includes("aomcyou") || targetObj.hostname.includes("apianmeng") || targetObj.hostname.includes("atukjhesk") || targetObj.hostname.includes("cdn2020") || targetObj.hostname.includes("97img") || targetObj.hostname.includes("thm3u8") || targetObj.hostname.includes("sxtmo") || targetObj.hostname.includes("micgqv") || targetObj.hostname.includes("mkimfs") || targetObj.hostname.includes("ucjosl") || targetObj.hostname.includes("cloudfront")) {
        // fangsung CDNs: bbcdn 403s any FOREIGN referer but allows none at all
        // (it also 403s Cloudflare-worker egress even with the site referer,
        // so send no Referer header at all for these hosts). The apianmeng
        // subdomain CDNs (kk55, cdnYYYYMMDD, ...) and atukjhesk also send
        // CORS * and ignore Referer, so empty is safe for all of them.
        referer = "";
      }

      const reqHeaders = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      };
      if (referer) {
        reqHeaders["Referer"] = referer;
      }

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

      // Stampede dedup (plain media only - m3u8 needs per-request rewriting).
      const inflightKey = !streamUpstreamUrl.includes(".m3u8")
        ? streamUpstreamUrl + "|" + effectiveRange
        : "";
      if (inflightKey && streamInflight.has(inflightKey)) {
        const shared = await streamInflight.get(inflightKey).catch(() => null);
        if (shared) {
          const h = new Headers(shared.headers);
          h.set("Access-Control-Allow-Origin", "*");
          h.set("Cache-Control", shared.status === 206 ? "no-store" : "public, max-age=604800, immutable");
          h.set("X-Edge-Cache", "inflight");
          return new Response(shared.clone().body, { status: shared.status, headers: h });
        }
      }

      const upstreamP = fetch(streamUpstreamUrl, {
        headers: reqHeaders,
      });
      if (inflightKey) {
        streamInflight.set(inflightKey, upstreamP.then((r) => r.clone()).catch((e) => { streamInflight.delete(inflightKey); throw e; }));
        if (streamInflight.size > 500) streamInflight.clear();
        setTimeout(() => streamInflight.delete(inflightKey), 20000);
      }
      const upstreamRes = await upstreamP;

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

        // ─── Range (206) edge caching ────────────────────────────────
        // Video elements ALWAYS send Range, so without caching 206s every
        // scrub position is an origin round trip. Two mechanisms:
        //   • Files ≤32MB: one-time background full-object warm - the
        //     cache-first fast path at the top of this handler then slices
        //     any range locally (X-Edge-Cache: range-hit).
        //   • Larger/unknown files: 2MB grid-aligned chunk cache - ranges
        //     are aligned down to a fixed grid, fetched once, cached under
        //     `url|chunk=<start>`, and sliced; repeat and overlapping
        //     scrubs (from any visitor) hit the colo (chunk-hit).
        if (effectiveRange && !isAvsDirect && (upstreamRes.status === 206 || upstreamRes.status === 200)) {
          const rm = effectiveRange.match(/^bytes=(\d+)-(\d*)$/);
          const crHeader = upstreamRes.headers.get("Content-Range") || "";
          let totalFromCR = parseInt(crHeader.split("/")[1] || "0", 10);
          if (!totalFromCR && upstreamRes.status === 200) {
            // Origin ignored our Range and returned the full object; its
            // Content-Length is then the total size.
            totalFromCR = parseInt(upstreamRes.headers.get("Content-Length") || "0", 10);
          }
          if (rm) {
            const reqStart = parseInt(rm[1], 10);
            const upstreamHeadersNoRange = { "User-Agent": reqHeaders["User-Agent"] };
            if (reqHeaders["Referer"]) upstreamHeadersNoRange["Referer"] = reqHeaders["Referer"];

            if (upstreamRes.status === 206 && totalFromCR > 0 && totalFromCR <= 32 * 1024 * 1024) {
              // Small/medium file: warm the full object once in the
              // background so the fast path above takes over all future
              // ranges. (This block previously sat AFTER the unconditional
              // return below and never ran.)
              const warmFull = (async () => {
                try {
                  const key = new Request(url.toString(), { method: "GET" });
                  if (await streamCache.match(key)) return;
                  const full = await fetch(streamUpstreamUrl, { headers: upstreamHeadersNoRange });
                  if (full.status === 200 && full.body) {
                    const warmHeaders = new Headers();
                    warmHeaders.set("Content-Type", full.headers.get("content-type") || "video/mp4");
                    warmHeaders.set("Cache-Control", "public, max-age=604800, immutable");
                    await streamCache.put(key, new Response(full.body, { status: 200, headers: warmHeaders }));
                  }
                } catch { /* full-warm best-effort */ }
              })();
              if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(warmFull);
            } else if (totalFromCR > 32 * 1024 * 1024) {
              // Large file: 2MB grid-aligned chunk cache. Also engages when
              // the origin ignored our Range (200-full) - in that case the
              // in-flight full body is canceled once a chunk response is
              // ready, so a 100-byte scrub request never streams 90MB
              // through the worker.
              const cancelUpstream = () => { try { upstreamRes.body?.cancel(); } catch { /* already closed */ } };
              // Large/unknown file: 2MB grid-aligned chunk cache.
              const CHUNK = 2 * 1024 * 1024;
              const chunkStart = Math.floor(reqStart / CHUNK) * CHUNK;
              const chunkEnd = totalFromCR > 0
                ? Math.min(chunkStart + CHUNK - 1, totalFromCR - 1)
                : chunkStart + CHUNK - 1;
              if (reqStart >= chunkStart && reqStart <= chunkEnd) {
                const serveChunkSlice = (buf, fromCache) => {
                  const reqEndRaw = rm[2] ? parseInt(rm[2], 10) : chunkStart + buf.byteLength - 1;
                  const reqEnd = Math.min(reqEndRaw, chunkStart + buf.byteLength - 1);
                  if (reqStart > reqEnd) return null;
                  const h = new Headers();
                  h.set("Content-Type", contentType || (streamUpstreamUrl.includes(".mp4") ? "video/mp4" : "application/octet-stream"));
                  h.set("Access-Control-Allow-Origin", "*");
                  h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
                  h.set("Access-Control-Allow-Headers", "*");
                  h.set("Accept-Ranges", "bytes");
                  h.set("Content-Range", `bytes ${reqStart}-${reqEnd}/${totalFromCR > 0 ? String(totalFromCR) : "*"}`);
                  h.set("Content-Length", String(reqEnd - reqStart + 1));
                  h.set("Cache-Control", "public, max-age=604800, immutable");
                  h.set("X-Edge-Cache", fromCache ? "chunk-hit" : "chunk-miss");
                  return new Response(buf.slice(reqStart - chunkStart, reqEnd - chunkStart + 1), { status: 206, headers: h });
                };
                const chunkKey = new Request(url.toString() + "|chunk=" + chunkStart, { method: "GET" });
                const cachedChunk = await streamCache.match(chunkKey).catch(() => null);
                if (cachedChunk) {
                  const buf = await cachedChunk.arrayBuffer();
                  const sliced = serveChunkSlice(buf, true);
                  if (sliced) { cancelUpstream(); return sliced; }
                } else {
                  try {
                    const chunkRes = await fetch(streamUpstreamUrl, {
                      headers: Object.assign({}, upstreamHeadersNoRange, { Range: `bytes=${chunkStart}-${chunkEnd}` }),
                    });
                    // Only consume the body when it is actually the aligned
                    // chunk (206). A 200 here means the origin ignored Range
                    // again - reading it would pull the whole (possibly huge)
                    // file into the isolate; cancel and fall through instead.
                    if (chunkRes.status === 206) {
                      const buf = await chunkRes.arrayBuffer(); // bounded: ≤2MB
                      if (buf.byteLength > 0) {
                        const cacheHeaders = new Headers();
                        cacheHeaders.set("Content-Type", contentType || (streamUpstreamUrl.includes(".mp4") ? "video/mp4" : "application/octet-stream"));
                        cacheHeaders.set("Cache-Control", "public, max-age=604800, immutable");
                        const putP = streamCache.put(
                          chunkKey,
                          new Response(buf.slice(0), { status: 200, headers: cacheHeaders })
                        ).catch(() => { /* best-effort */ });
                        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(putP);
                        const sliced = serveChunkSlice(buf, false);
                        if (sliced) { cancelUpstream(); return sliced; }
                      }
                    } else {
                      try { await chunkRes.body?.cancel(); } catch { /* already closed */ }
                    }
                  } catch { /* chunk fetch failed: fall through to plain forward */ }
                }
              }
            }
          }
        }

        if (upstreamRes.headers.get("Content-Range")) {
          resHeaders.set("Content-Range", upstreamRes.headers.get("Content-Range"));
        }
        if (upstreamRes.headers.get("Content-Length")) {
          resHeaders.set("Content-Length", upstreamRes.headers.get("Content-Length"));
        }
          // Segments/keys/MP4s are immutable content-addressed media: a long
          // browser-cache lifetime lets the timeline prefetcher warm regions
          // once and keeps every later hover/seek on them instant (even
          // across reloads).
          resHeaders.set(
            "Cache-Control",
            upstreamRes.status === 206 ? "no-store" : "public, max-age=604800, immutable"
          );

        // Populate the edge cache with full (non-Range) segment responses so
        // every later fetch - this visitor or anyone else's - is served from
        // the colo instead of the slow origin CDN. Bounded to small media
        // (segments/keys); huge full-file MP4 downloads are skipped.
        const contentLength = parseInt(upstreamRes.headers.get("Content-Length") || "0", 10);
        if (upstreamRes.status === 200 && !effectiveRange && upstreamRes.body && (!contentLength || contentLength <= 32 * 1024 * 1024)) {
          try {
            const [clientBody, cacheBody] = upstreamRes.body.tee();
            const cachePromise = streamCache.put(
              new Request(url.toString(), { method: "GET" }),
              new Response(cacheBody, { status: 200, headers: resHeaders })
            ).catch(() => { /* best-effort */ });
            if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(cachePromise);
            return new Response(clientBody, { status: upstreamRes.status, headers: resHeaders });
          } catch { /* fall through to plain streaming */ }
        }

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

      const playlistResponse = new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
      // Rewritten playlists are deterministic: edge-cache them too.
      try {
        const putPlaylist = streamCache.put(
          new Request(url.toString(), { method: "GET" }),
          playlistResponse.clone()
        ).catch(() => { /* best-effort */ });
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(putPlaylist);
      } catch { /* best-effort */ }
      return playlistResponse;
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
    // Our own media proxy path is RELATIVE by design (`/api/media?url=...`,
    // same origin), because the SPA builds it without knowing the API host.
    // Rejecting it made every referer-locked stream 400 before it played.
    const isOwnProxyPath = !!targetUrl && targetUrl.startsWith("/api/media?");
    if (
      !targetUrl ||
      (!isOwnProxyPath &&
        !targetUrl.startsWith("http://") &&
        !targetUrl.startsWith("https://"))
    ) {
      return errorResponse("Missing or invalid url parameter", 400);
    }
    if (isOwnProxyPath) {
      // Normalise to an absolute same-origin URL so every downstream check
      // (hostname sniffing, hls.js source) keeps working unchanged.
      targetUrl = new URL(targetUrl, url.origin).toString();
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
        // Our OWN /api/media output is already referer-corrected and has its
        // playlist URIs rewritten, so wrapping it again in /api/player/stream
        // is both redundant and fatal: that route only proxies allowlisted
        // hosts, so our own origin 403'd and nothing played.
        const proxied =
          destObj.pathname === "/api/media"
            ? [targetUrl]
            : candidates.map((c) => `/api/player/stream?url=${encodeURIComponent(c)}`);
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

      // Samusar (Myanmar) Resolver (samusar.com) - extracts highest-quality KVS stream
      if (destObj.hostname.includes("samusar.com")) {
        try {
          const samRes = await fetch(targetUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://www.samusar.com/",
            },
          });
          if (samRes.ok) {
            const samHtml = await samRes.text();
            const pickBest = (htmlStr) => {
              const keys = ["video_alt_url3", "video_alt_url2", "video_alt_url", "video_url"];
              const found = [];
              for (const k of keys) {
                const re = new RegExp(`${k}\\s*:\\s*'([^']*)'`);
                const m = htmlStr.match(re);
                if (m && m[1] && m[1].includes("/get_file/")) found.push(m[1]);
              }
              return found[0] || null;
            };
            const freshStreamUrl = pickBest(samHtml);
            const titleMatch = samHtml.match(/<title>([^<]+)<\/title>/i);
            const posterMatch = samHtml.match(/preview_url\s*:\s*'([^']+)'/i);
            if (freshStreamUrl) {
              const wantJson = url.searchParams.get("format") === "json" || request.headers.get("accept")?.includes("application/json");
              if (wantJson) {
                return new Response(JSON.stringify({
                  streamUrl: freshStreamUrl,
                  title: titleMatch ? titleMatch[1].trim() : "Myanmar Video",
                  poster: posterMatch ? posterMatch[1] : "",
                }), {
                  status: 200,
                  headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                  },
                });
              }
              return new Response(
                renderCleanHlsPlayer(`/api/player/stream?url=${encodeURIComponent(freshStreamUrl)}`, titleMatch ? titleMatch[1].trim() : "Samusar Video", posterMatch ? posterMatch[1] : ""),
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
          }
        } catch (e) {
          console.error("Samusar resolve error:", e);
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

      // 6. LuluStream + Third-Party Anti-Proxy Lockers (HQQ/Netu, DoodStream family, Vidello/NowPlay)
      // These hosts block Cloudflare Worker egress or bind tokens/requests to
      // the client IP and embed origin. Redirect directly so the browser loads
      // the embed natively instead of receiving an empty or blocked response.
      if (
        destObj.hostname.includes("luminscdn") ||
        destObj.hostname.includes("lulustream") ||
        destObj.hostname.includes("luluvdo") ||
        /(^|\.)(hqq\.(to|tv)|netu\.tv|waaw\.(to|tv)|doodstream\.com|dood\.(la|wf|so|pm|ws|to|sh|cx|yt|re|li)|d0000?d\.com|myvidplay\.com|ds2play\.com|playmogo\.com|vidello\.net|nowplay\.to)$/i.test(destObj.hostname)
      ) {
        return Response.redirect(targetUrl, 302);
      }

      // 7. Streamtape Resolver: extract the short-lived /get_video URL and let
      // the browser fetch it directly. Streaming it through the edge fails
      // because Streamtape rejects Cloudflare's datacenter IP on consumption.
      // Fall back to the upstream HTML only if the gate format changes.
      if (destObj.hostname.includes("streamtape.com")) {
        try {
          const gate = await resolveStreamtapeGate(targetUrl);
          if (gate) {
            const title = url.searchParams.get("title") || "Video";
            const poster = url.searchParams.get("poster") || "";
            return new Response(
              renderCleanMp4Player(
                [{ url: gate, rawUrl: targetUrl, type: "direct_mp4", quality: 720, label: "Streamtape" }],
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

      // 5b. Direct media file (mp4 / webm) requested through the player.
      // Without this the raw file was returned AS the iframe document: Chrome
      // then rendered its own bare player, so uncut-x lost our controls,
      // branding, quality menu and the next-source failover entirely.
      if (/\.(mp4|webm|m4v)(?:[?#]|$)/i.test(destObj.pathname)) {
        const entry = buildStreamEntry(targetUrl, "", "", "direct_mp4");
        if (entry) {
          const poster = url.searchParams.get("poster") || "";
          return new Response(
            renderCleanMp4Player([entry], url.searchParams.get("title") || "Video", poster),
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
      }

      // 6. Generic Fallback Proxy (EarnVids / evsishere / legacy):
      // Edge worker proxies HTML with a spoofed Referer and injects <base>.
      let referer = "https://supjav.com/";
      if (targetUrl.includes("mmsvibex")) referer = "https://mmsvibex.life/";
      if (destObj.hostname.includes("sheeshfans")) referer = "https://sheeshfans.com/";

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

  // GET /api/search?q=... — bounded suggestion index for the global search UI.
  // The Express server has a Redis-backed equivalent, but Cloudflare Pages only
  // runs this worker, so the edge route must exist here too.
  if (path === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) {
      return jsonResponse({ suggestions: [], query: q }, 200, {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      });
    }

    const normalized = normalizeSearchText(q);
    const like = `*${escapeIlike(q)}*`;
    const tagLiteral = searchArrayLiteral(q.toLocaleLowerCase());
    const performerParams = new URLSearchParams({
      select: "username,thumbnail_url,sprite_url,preview_url",
      username: `ilike.${like}`,
      order: "timestamp.desc.nullslast,id.desc",
      limit: "20",
    });
    const recordingParams = new URLSearchParams({
      select: "id,username,room_title,filename,thumbnail_url",
      or: `(username.ilike.${like},room_title.ilike.${like},filename.ilike.${like},tags.cs.{${tagLiteral}})`,
      order: "timestamp.desc.nullslast,id.desc",
      limit: "12",
    });

    const [performerRes, recordingRes, tagRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/linked_recordings?${performerParams}`, { headers: postgrestHeaders }),
      fetch(`${supabaseUrl}/rest/v1/linked_recordings?${recordingParams}`, { headers: postgrestHeaders }),
      fetch(`${supabaseUrl}/rest/v1/rpc/get_tag_counts`, {
        method: "POST",
        headers: postgrestHeaders,
        body: "{}",
      }),
    ]);

    const suggestions = [];
    const seenPerformers = new Set();

    if (performerRes.ok) {
      const rows = await performerRes.json();
      const performers = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          label: String(row?.username || "").trim(),
          image_url: row?.thumbnail_url || row?.sprite_url || row?.preview_url || null,
        }))
        .filter((row) => row.label && !seenPerformers.has(row.label.toLocaleLowerCase()))
        .sort((a, b) => suggestionScore(a.label, normalized) - suggestionScore(b.label, normalized))
        .slice(0, 4);
      for (const performer of performers) {
        seenPerformers.add(performer.label.toLocaleLowerCase());
        suggestions.push({
          type: "performer",
          label: performer.label,
          subtitle: "Performer",
          image_url: performer.image_url,
          href: `/performers/${encodeURIComponent(performer.label)}`,
        });
      }
    }

    if (recordingRes.ok) {
      const rows = await recordingRes.json();
      const recordings = (Array.isArray(rows) ? rows : [])
        .map((row) => {
          const rawTitle = String(row?.room_title || row?.filename || "").trim();
          const label = rawTitle
            ? rawTitle.length > 60 ? rawTitle.slice(0, 57) + "…" : rawTitle
            : "Untitled";
          return {
            label,
            username: String(row?.username || "").trim(),
            image_url: row?.thumbnail_url || null,
            id: String(row?.id || ""),
            score: suggestionScore(`${row?.username || ""} ${rawTitle}`, normalized),
          };
        })
        .filter((row) => row.id)
        .sort((a, b) => a.score - b.score)
        .slice(0, 4);
      for (const recording of recordings) {
        suggestions.push({
          type: "recording",
          label: recording.label,
          subtitle: recording.username || undefined,
          image_url: recording.image_url,
          href: `/video/${encodeURIComponent(recording.id)}`,
        });
      }
    }

    if (tagRes.ok) {
      const rows = await tagRes.json();
      const tags = (Array.isArray(rows) ? rows : [])
        .map((row) => ({
          tag: String(row?.tag ?? row?.name ?? "").trim(),
          count: Number(row?.count ?? 0) || 0,
        }))
        .filter((row) => row.tag && normalizeSearchText(row.tag).includes(normalized))
        .sort((a, b) =>
          suggestionScore(a.tag, normalized) - suggestionScore(b.tag, normalized) ||
          b.count - a.count ||
          a.tag.localeCompare(b.tag),
        )
        .slice(0, 4);
      for (const tag of tags) {
        suggestions.push({
          type: "tag",
          label: tag.tag,
          subtitle: "Tag",
          href: `/browse?tags=${encodeURIComponent(tag.tag)}`,
        });
      }
    }

    return jsonResponse({ suggestions, query: q, source: "edge" }, 200, {
      "Cache-Control": "public, s-maxage=45, stale-while-revalidate=120",
    });
  }

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
    const settings = await readPremiumSettings(supabaseUrl, postgrestHeaders);
    return jsonResponse({ ...settings, checkout_configured: false });
  }

  // ─── Account / user-data API ────────────────────────────────────────────
  // Public username login plus bearer-authenticated profile, role, saved,
  // history, watch-later, collections, follows, notifications and preferences.
  if (path === "/api/user" || path.startsWith("/api/user/")) {
    return handleUserApi(request, {
      path,
      url,
      supabaseUrl,
      anonKey: env.SUPABASE_ANON_KEY || supabaseKey,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey,
      postgrestHeaders,
    });
  }

  const PLAYLIST_CACHE = {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
  };

  // GET /api/playlists — public, community-created playlists with card media.
  if (path === "/api/playlists") {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_collections?select=${PLAYLIST_COLUMNS}&order=created_at.desc&limit=100`,
      { headers: postgrestHeaders },
    );
    if (!res.ok) return errorResponse("Failed to fetch playlists", res.status);
    const cols = await res.json();
    if (!cols || cols.length === 0) return jsonResponse([], 200, PLAYLIST_CACHE);

    const profileMap = await fetchPlaylistProfiles(
      supabaseUrl, postgrestHeaders, cols.map(col => col.user_id),
    );
    const colsWithItems = await Promise.all(cols.map(async col => {
      const itemRes = await fetch(
        `${supabaseUrl}/rest/v1/user_collection_items?select=recording_id,metadata,added_at,position&collection_id=eq.${encodeURIComponent(col.id)}&order=position.asc.nullslast,added_at.desc&limit=4`,
        { headers: { ...postgrestHeaders, "Prefer": "count=exact" } },
      );
      const items = itemRes.ok ? await itemRes.json() : [];
      return { col, items, count: postgrestCount(itemRes, items.length) };
    }));
    const recMap = await fetchPlaylistRecMap(
      supabaseUrl,
      postgrestHeaders,
      colsWithItems.flatMap(entry => entry.items.map(item => item.recording_id)),
    );

    const enriched = colsWithItems.map(({ col, items, count }) => ({
      ...col,
      item_count: count,
      items: enrichPlaylistItems(items, recMap),
      author: playlistAuthor(profileMap, col.user_id),
    }));
    return jsonResponse(enriched, 200, PLAYLIST_CACHE);
  }

  // GET /api/playlists/:id/items — full item list for a playlist detail page.
  const playlistItemsMatch = path.match(/^\/api\/playlists\/([^/]+)\/items$/);
  if (playlistItemsMatch) {
    const id = encodeURIComponent(playlistItemsMatch[1]);
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_collection_items?select=recording_id,metadata,added_at,position&collection_id=eq.${id}&order=position.asc.nullslast,added_at.desc`,
      { headers: postgrestHeaders },
    );
    if (!res.ok) return errorResponse("Failed to fetch playlist items", res.status);
    const items = await res.json();
    const recMap = await fetchPlaylistRecMap(
      supabaseUrl, postgrestHeaders, items.map(item => item.recording_id),
    );
    return jsonResponse(enrichPlaylistItems(items, recMap), 200, PLAYLIST_CACHE);
  }

  // GET /api/playlists/:id — single public playlist and its author/count.
  const playlistMatch = path.match(/^\/api\/playlists\/([^/]+)$/);
  if (playlistMatch) {
    const id = encodeURIComponent(playlistMatch[1]);
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_collections?select=${PLAYLIST_COLUMNS}&id=eq.${id}&limit=1`,
      { headers: postgrestHeaders },
    );
    if (!res.ok) return errorResponse("Failed to fetch playlist", res.status);
    const cols = await res.json();
    const col = cols && cols[0];
    if (!col) return errorResponse("Playlist not found", 404);

    const [profileMap, countRes] = await Promise.all([
      fetchPlaylistProfiles(supabaseUrl, postgrestHeaders, [col.user_id]),
      fetch(`${supabaseUrl}/rest/v1/user_collection_items?select=recording_id&collection_id=eq.${id}`, {
        method: "HEAD",
        headers: { ...postgrestHeaders, "Prefer": "count=exact" },
      }),
    ]);
    return jsonResponse({
      ...col,
      item_count: postgrestCount(countRes, 0),
      author: playlistAuthor(profileMap, col.user_id),
    }, 200, PLAYLIST_CACHE);
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
    const [res, siteMap] = await Promise.all([
      fetch(restUrl, { headers: postgrestHeaders }),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);
    const data = await res.json();
    const enriched = (data || []).map(item => withResolvedSite(item, siteMap));
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
      applyAdvancedSearch(params, search);
    }

    const restUrl = `${supabaseUrl}/rest/v1/linked_recordings?${params.toString()}`;
    const [res, siteMap] = await Promise.all([
      fetch(restUrl, {
        method: "GET",
        headers: {
          ...postgrestHeaders,
          "Prefer": "count=exact",
        },
      }),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);

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

    const enriched = data.map(item => withResolvedSite(item, siteMap));

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

  // GET /api/recordings/related
  if (path === "/api/recordings/related") {
    const limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get("limit") || "8", 10)));
    const username = url.searchParams.get("username");
    let restUrl = `${supabaseUrl}/rest/v1/linked_recordings?select=id,username,timestamp,room_title,tags,viewers,resolution,framerate,filesize,duration,gender,thumbnail_url,sprite_url,preview_url&limit=${limit}&order=timestamp.desc`;
    if (username) {
      restUrl += `&username=eq.${encodeURIComponent(username)}`;
    }
    const [res, siteMap] = await Promise.all([
      fetch(restUrl, { headers: postgrestHeaders }),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);
    const data = await res.json();
    return jsonResponse((data || []).map(item => withResolvedSite(item, siteMap)));
  }

  // GET /api/recordings/:id
  const recordingMatch = path.match(/^\/api\/recordings\/([a-zA-Z0-9_-]+)$/);
  if (recordingMatch) {
    const id = recordingMatch[1];
    const [res, siteMap] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/linked_recordings?id=eq.${encodeURIComponent(id)}&select=*`, {
        headers: postgrestHeaders,
      }),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);
    if (!res.ok) return errorResponse("Recording not found", 404);
    const rows = await res.json();
    if (!rows || rows.length === 0) return errorResponse("Recording not found", 404);
    const item = rows[0];
    return jsonResponse(withResolvedSite(item, siteMap), 200, {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    });
  }

  // GET /api/performers
  if (path === "/api/performers") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const gender = (url.searchParams.get("gender") || "").trim();
    const sort = url.searchParams.get("sort") || "count";

    const [stats, siteMap] = await Promise.all([
      getPerformerStats(supabaseUrl, postgrestHeaders),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);

    let performers = stats.slice();
    if (gender) performers = performers.filter(row => genderMatches(row.gender, gender));
    if (search) performers = performers.filter(row => row.username.toLowerCase().includes(search));

    performers.sort(sort === "name"
      ? (a, b) => a.username.localeCompare(b.username)
      : (a, b) => b.recording_count - a.recording_count || a.username.localeCompare(b.username));

    const total = performers.length;
    const pageRows = performers.slice(offset, offset + limit).map(row => ({
      username: row.username,
      recording_count: row.recording_count,
      gender: row.gender,
      latest_timestamp: row.latest_timestamp,
      latest_thumbnail: row.latest_thumbnail || row.sprite_url || null,
      sprite_url: row.sprite_url,
      site: resolveSite(row, siteMap),
    }));

    return jsonResponse({
      // `performers` is the SPA contract; `data` is kept for older consumers.
      performers: pageRows,
      data: pageRows,
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
    const [chanRes, recRes, siteMap] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/channels?username=eq.${encodeURIComponent(username)}&select=*`, { headers: postgrestHeaders }),
      fetch(`${supabaseUrl}/rest/v1/linked_recordings?username=eq.${encodeURIComponent(username)}&select=*&order=timestamp.desc&limit=50`, { headers: postgrestHeaders }),
      getSiteMap(supabaseUrl, postgrestHeaders),
    ]);
    const chan = await chanRes.json();
    const recs = await recRes.json();
    const performer = chan[0] || { username, display_name: username };
    return jsonResponse({
      performer: withResolvedSite(performer, siteMap),
      recordings: (recs || []).map(item => withResolvedSite(item, siteMap)),
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

// ═══════════════════════════════════════════════════════════════════════════
// Watch Live (/api/live/*) — catalogue from Supabase, playback from the
// object-storage remux when available, upstream feed otherwise.
// The catalogue rows are written by the live worker (GitHub Actions, runs
// alongside the scraper fleet): scrape → ffmpeg remux → storage upload.
// ═══════════════════════════════════════════════════════════════════════════

const LIVE_REMUX_BASE = env0 => (env0.LIVE_REMUX_BASE || "");

async function liveQuery(env, select) {
  const supabaseUrl = env.SUPABASE_URL || "https://supabase.chuglii.in";
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  const res = await fetch(
    `${supabaseUrl}/rest/v1/live_streams?select=${encodeURIComponent(select)}&active=eq.true&order=last_seen_at.desc&limit=200`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
  );
  if (!res.ok) throw new Error(`live_streams query ${res.status}`);
  return res.json();
}

// GET /api/live/streams — same shape the frontend already consumes.
async function handleLiveStreams(env, url) {
  try {
    const rows = await liveQuery(
      env,
      "id,title,title_en,thumbnail_url,quality_label,storage_path,cover_path,frame_count",
    );
    const streams = rows.map((r) => ({
      id: String(r.id),
      title: r.title || "",
      title_en: r.title_en || null,
      thumbnail_url: r.thumbnail_url || null,
      quality_label: r.quality_label || null,
      remux_ready: !!r.storage_path,
    }));
    return jsonResponse(
      { streams, cached: false },
      200,
      { "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60" },
    );
  } catch (err) {
    return errorResponse(err.message || "live streams failed", 502);
  }
}

// GET /api/live/resolve?id= — mint the playback source for one video.
async function handleLiveResolve(request, env, url) {
  const id = url.searchParams.get("id") || "";
  if (!/^\d{1,7}$/.test(id)) return errorResponse("Invalid id", 400);
  const fresh = url.searchParams.get("fresh") === "1";
  try {
    const rows = await liveQuery(env, "id,storage_path,duration_secs");
    const row = rows.find((r) => String(r.id) === id);
    const base = LIVE_REMUX_BASE(env);
    if (row && row.storage_path && base) {
      const m3u8 = `${base}/${row.storage_path}/index.m3u8`;
      return jsonResponse({
        stream: {
          id,
          m3u8_url: m3u8,
          poster_url: null,
          live: true,
          title_en: null,
        },
        cached: false,
        remux: { status: "ready", url: `/api/media?url=${encodeURIComponent(m3u8)}` },
      });
    }
    // No remux yet — resolve the upstream feed (same extraction the site's
    // own player uses) and let the edge media proxy handle it.
    const page = await fetch(
      `https://h4gaz3.jpzydpzm.cc/video/${id}/`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", Referer: "https://www.google.com/" }, redirect: "follow" },
    );
    if (!page.ok) throw new Error(`upstream ${page.status}`);
    const html = await page.text();
    const cfgMatch = html.match(/data-config='([^']+)'/);
    if (!cfgMatch) throw new Error("no player config");
    const cfg = JSON.parse(cfgMatch[1]);
    const m3u8 = cfg.video?.url;
    if (!m3u8 || !/^https?:\/\//.test(m3u8)) throw new Error("no m3u8");
    return jsonResponse({
      stream: { id, m3u8_url: m3u8, poster_url: cfg.video?.pic || null, live: cfg.live === true },
      cached: false,
      remux: { status: row ? "queued" : "unknown" },
    });
  } catch (err) {
    return errorResponse(err.message || "resolve failed", 502);
  }
}

// Covers from pic.biacea.cn are AES-128-CBC encrypted (key/IV ship in the
// site's own image loader). Decrypt with WebCrypto and serve plain JPEG.
// Covers from pic.biacea.cn are AES-128-CBC encrypted (key/IV ship in the
// site's own image loader as ASCII strings). Decrypt with WebCrypto.
function asciiBytes(s) {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
const LIVE_COVER_KEY = asciiBytes("f5d965df75336270");
const LIVE_COVER_IV = asciiBytes("97b60394abc2fbe1");

async function handleLiveThumb(env, url) {
  const raw = url.searchParams.get("url") || "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (parsed.hostname !== "pic.biacea.cn") return new Response("Bad host", { status: 400 });
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0" },
    });
    if (!res.ok) return new Response("Upstream error", { status: 404 });
    const enc = new Uint8Array(await res.arrayBuffer());
    const key = await crypto.subtle.importKey("raw", LIVE_COVER_KEY, "AES-CBC", false, ["decrypt"]);
    const dec = await crypto.subtle.decrypt({ name: "AES-CBC", iv: LIVE_COVER_IV }, key, enc);
    return new Response(dec, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    });
  } catch {
    return new Response("Decrypt failed", { status: 404 });
  }
}
