/**
 * Contract tests for the DEPLOYED media proxy.
 *
 * Production is Cloudflare Pages, and `public/_worker.js` intercepts
 * `/api/media` BEFORE the Express function runs. So the Worker -- not
 * `routes/media-proxy.ts` -- is what actually serves every thumbnail and
 * stream in production.
 *
 * That gap is exactly how borntobefuck broke: the Express fix (referer
 * override + HLS rewrite) was correct but never executed, because the Worker
 * answered first, sent `Referer: https://chuglii.in/` to a referer-locked CDN,
 * then redirected the browser to the raw origin (which 403'd too).
 *
 * These tests pin the Worker's behaviour so the two implementations cannot
 * silently drift apart again.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib/__tests__ -> repo root
const REPO_ROOT = join(HERE, "../../../../../");
const WORKER_PATH = join(REPO_ROOT, "artifacts/video-archive/public/_worker.js");

const worker = readFileSync(WORKER_PATH, "utf8");

/** The `/api/media` handler body, isolated from the rest of the worker. */
function mediaLines(): string[] {
  const start = worker.indexOf('if (path === "/api/media")');
  expect(start, "worker must still handle /api/media").toBeGreaterThan(-1);
  const rest = worker.slice(start);
  const nextRoute = rest.indexOf('if (path === "/', 10);
  const block = nextRoute === -1 ? rest : rest.slice(0, nextRoute);
  return block.split("\n");
}

describe("deployed worker: media proxy", () => {
  it("sends the site referer borntobefuck's CDN requires", () => {
    expect(worker).toContain('"content.zavastream.com": "https://borntobefuck.com/"');
  });

  it("only redirects to the raw origin behind the referer-locked guard", () => {
    // A redirect hands the request to the browser, which re-sends it with OUR
    // referer; the CDN answers 403. That was the production failure, so every
    // redirect must be the `else` of a `refererLocked || isMediaStream` guard.
    const lines = mediaLines();
    const offenders: number[] = [];
    lines.forEach((line, i) => {
      if (!line.includes("Response.redirect(targetUrl")) return;
      const preceding = lines.slice(Math.max(0, i - 12), i).join("\n");
      if (!preceding.includes("refererLocked || isMediaStream")) offenders.push(i + 1);
    });
    expect(
      offenders,
      `unguarded origin redirects in the media handler at lines: ${offenders.join(", ")}`,
    ).toHaveLength(0);
  });

  it("rewrites HLS playlist URIs back through the proxy", () => {
    const block = mediaLines().join("\n");
    expect(block).toContain("application/vnd.apple.mpegurl");
    expect(block).toContain("/api/media?url=");
    // Relative variant/segment URIs must resolve against the playlist URL.
    expect(block).toContain("new URL(uri, playlistBase)");
    // URI="..." attributes (EXT-X-KEY / EXT-X-MAP) must be rewritten too.
    expect(block).toContain('URI="([^"]+)"');
  });

  it("forwards Range and preserves 206 for video bytes", () => {
    const block = mediaLines().join("\n");
    expect(block).toContain('request.headers.get("range")');
    expect(block).toContain('"Range": rangeHeader');
    expect(block).toContain("Content-Range");
    expect(block).toContain("status: upstreamRes.status === 206 ? 206 : 200");
  });

  it("accepts our own relative proxy path in /api/player", () => {
    // The SPA builds `/api/media?url=...` (relative, same origin). The player
    // rejected anything that did not start with http(s), so every btb stream
    // 400'd before it could play.
    expect(worker).toContain("isOwnProxyPath");
    expect(worker).toContain('targetUrl.startsWith("/api/media?")');
    expect(worker).toContain("new URL(targetUrl, url.origin).toString()");
  });

  it("never re-wraps our own media proxy in /api/player/stream", () => {
    // /api/player/stream only proxies allowlisted hosts and does not list
    // itself, so wrapping our own /api/media URL there 403'd the stream.
    expect(worker).toContain('destObj.pathname === "/api/media"');
    expect(worker).toContain("const isOwnMediaProxy = parsed.pathname === \"/api/media\"");
  });

  it("allowlists the onlyfans CDNs for direct streams", () => {
    expect(worker).toContain('"content.zavastream.com", "media.uncut-x.com"');
  });

  it("does not long-cache streams and never caches under a poisoned key", () => {
    const block = mediaLines().join("\n");
    // Streams/playlists bypass the edge cache entirely.
    expect(block).toContain("cacheTtl: 0, cacheEverything: false");
    expect(block).toContain('"Cache-Control": "public, max-age=30"');
    // Images are fetched under a cache-busted URL: `cacheEverything: true` had
    // cached the 403 from when this Worker sent the wrong referer, and the edge
    // kept replaying it (`cf-cache-status: HIT`) long after the fix.
    expect(block).toContain('_cf=2');
    // No image fetch may re-enable blanket caching (the comment explaining why
    // mentions the old option, so match the actual option syntax).
    expect(block).not.toMatch(/cacheEverything:\s*true\s*[,}]/);
  });
});
