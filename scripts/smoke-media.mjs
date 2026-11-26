#!/usr/bin/env node
/**
 * Post-deploy smoke test for the DEPLOYED media path.
 *
 * Why this exists: the site is served by Cloudflare Pages, where
 * `public/_worker.js` handles `/api/media` and `/api/player` itself. A build
 * that compiles, passes unit tests and deploys can still be completely broken
 * in production -- that is exactly what happened with borntobefuck, where four
 * separate faults in the Worker (wrong referer, redirect to the origin, cached
 * 403s, and double-proxying through /api/player/stream) left every thumbnail
 * and every stream dead while CI stayed green.
 *
 * This script speaks to the live origin the way a browser does and fails loudly
 * if the media path regresses. Run it after every deploy.
 *
 *   node scripts/smoke-media.mjs [--base https://chuglii.in]
 *
 * Environment (only needed to discover a live stream to test against):
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY - or - SUPABASE_URL / SUPABASE_ANON_KEY
 */

const args = process.argv.slice(2);
const baseArg = args.indexOf("--base");
const BASE = (baseArg >= 0 ? args[baseArg + 1] : "https://chuglii.in").replace(/\/+$/, "");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "manual" });
  return res;
}

/** A currently-live borntobefuck row (referer-locked HLS, the hardest case). */
async function pickReference() {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    // The public feed RPC the SPA itself uses (anon-callable). The service-role
    // revalidation RPC is deliberately not exposed to anon.
    const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/scraper_get_onlyfans_videos`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON,
        authorization: `Bearer ${SUPABASE_ANON}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_source_site: "borntobefuck",
        p_tag: null,
        p_category: null,
        p_search: null,
        p_sort: "newest",
        p_limit: 5,
        p_offset: 0,
      }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = (Array.isArray(rows) ? rows : []).find(
      (r) => r.full_video_url && r.thumbnail_url,
    );
    return row ? { stream: row.full_video_url, thumb: row.thumbnail_url, id: row.source_post_id } : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Smoke-testing ${BASE}\n`);
  const proxied = (u) => `${BASE}/api/media?url=${encodeURIComponent(u)}`;
  const ref = await pickReference();

  // 1. The proxy must answer for a plain static image (baseline reachability).
  {
    const target = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_92x30dp.png";
    const res = await get(proxied(target));
    record(
      "media proxy serves a plain image",
      res.ok && (res.headers.get("content-type") || "").startsWith("image/"),
      `${res.status} ${res.headers.get("content-type") || "-"}`,
    );
  }

  // 2. A referer-locked thumbnail must come back as bytes, NOT a redirect.
  //    The old Worker redirected to the raw CDN, which then 403'd the browser.
  if (ref) {
    const res = await get(proxied(ref.thumb), { Referer: `${BASE}/onlyfans/borntobefuck` });
    const ct = res.headers.get("content-type") || "";
    record(
      "referer-locked thumbnail (no redirect, real image)",
      res.status === 200 && ct.startsWith("image/"),
      `${res.status} ${ct}`,
    );
  } else {
    record("referer-locked thumbnail", false, "no reference row (Supabase env missing/unreachable)");
  }

  // 3. The playlist must be rewritten so relative segment URIs cannot leak to
  //    our own origin, and it must NOT be a redirect.
  let variantUrl = null;
  let segmentUrl = null;
  if (ref) {
    const res = await get(proxied(ref.stream));
    const body = res.status === 200 ? await res.text() : "";
    const ct = res.headers.get("content-type") || "";
    const lines = body.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    const relative = lines.filter((l) => !l.startsWith("/api/media?"));
    const ok = res.status === 200 && ct.includes("mpegurl") && lines.length > 0 && relative.length === 0;
    const isMaster = body.includes("#EXT-X-STREAM-INF");
    const first = lines.find((l) => l.startsWith("/api/media?")) || null;
    // A source may store the master playlist or a single rendition; only a
    // master needs one more hop before we reach actual segments.
    if (first && isMaster) variantUrl = first;
    if (first && !isMaster) segmentUrl = first;
    record(
      "HLS playlist proxied and fully rewritten",
      ok,
      `${res.status} ${ct} uris=${lines.length} relative=${relative.length} ${isMaster ? "master" : "media"}`,
    );
  }

  // 4. A segment must stream with a Range request (seeking + playback).
  {
    if (!segmentUrl && variantUrl) {
      const vres = await get(`${BASE}${variantUrl}`);
      const vbody = vres.status === 200 ? await vres.text() : "";
      segmentUrl = vbody.split(/\r?\n/).find((l) => l.trim().startsWith("/api/media?")) || null;
    }
    if (segmentUrl) {
      const sres = await get(`${BASE}${segmentUrl}`, { Range: "bytes=0-2047" });
      const ct = sres.headers.get("content-type") || "";
      record(
        "segment streams with Range (206)",
        sres.status === 206 && /video|octet-stream/.test(ct),
        `${sres.status} ${ct} range=${sres.headers.get("content-range") || "-"}`,
      );
    } else {
      record("segment streams with Range (206)", false, "no segment URI found");
    }
  }

  // 5. The player shell must accept our own relative proxy URL.
  if (ref) {
    const playerUrl = `${BASE}/api/player?url=${encodeURIComponent(`/api/media?url=${encodeURIComponent(ref.stream)}`)}`;
    const res = await get(playerUrl);
    const body = res.status === 200 ? await res.text() : "";
    const doubleProxied = body.includes("/api/player/stream?url=");
    record(
      "player accepts our proxy path and does not double-proxy",
      res.status === 200 && !doubleProxied,
      `${res.status} doubleProxied=${doubleProxied}`,
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\nFAILED: ${failed.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
