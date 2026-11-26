/**
 * Contract tests for Voyeur House watch page player routing and Worker handling.
 *
 * HQQ/Netu (`hqq.to`) and DoodStream-family embeds (`myvidplay.com`,
 * `d000d.com`, `ds2play.com`, `playmogo.com`) return empty or blocked bodies to
 * Cloudflare Worker egress and bind session tokens to the browser's IP/origin.
 * Wrapping them in `/api/player?url=...` caused blank screens across the
 * Voyeur House category.
 *
 * These tests pin the routing rules across `VoyeurhouseWatch.tsx` and
 * `public/_worker.js`:
 *   - Third-party embed lockers render directly in `<PlayerFrame>`, never via `/api/player`
 *   - AVS/ClicknPlay/RealLifeCams/NowPlay resolved streams accept relative `/api/player/stream`
 *     paths as well as `https://` URLs, and `.m3u8` streams play in `<HlsVideoPlayer>`
 *   - Worker `/api/player` redirects HQQ/DoodStream/Vidello/NowPlay instead of proxying them
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib/__tests__ -> repo root
const REPO_ROOT = join(HERE, "../../../../../");
const WATCH_PAGE = join(REPO_ROOT, "artifacts/video-archive/src/pages/VoyeurhouseWatch.tsx");
const WORKER = join(REPO_ROOT, "artifacts/video-archive/public/_worker.js");

const page = readFileSync(WATCH_PAGE, "utf8");
const worker = readFileSync(WORKER, "utf8");

describe("Voyeur House watch page player routing", () => {
  it("routes HQQ, DoodStream mirrors, and embed/iframe lockers straight to direct iframe", () => {
    expect(page).toContain("isThirdPartyEmbedOnly");
    expect(page).toContain("isDirectThirdPartyEmbedUrl");
    for (const host of ["hqq", "d0000?d", "myvidplay", "ds2play", "playmogo", "vidello", "nowplay"]) {
      expect(page).toContain(host);
    }
    expect(page).toContain("iframeSrc.startsWith(\"/api/player?\") || isDirectThirdPartyEmbedUrl(iframeSrc)");
  });

  it("accepts relative /api/player/stream URLs from /api/player/resolve", () => {
    expect(page).toContain("/^(?:https?:\\/\\/|\\/)/i.test(stream.url)");
  });

  it("plays HLS streams with HlsVideoPlayer instead of feeding .m3u8 to VideoPlayer", () => {
    expect(page).toContain('import { HlsVideoPlayer } from "@/components/HlsVideoPlayer"');
    expect(page).toContain("isHlsStreamUrl");
    expect(page).toContain("<HlsVideoPlayer");
  });

  it("only enables Download MP4 for direct video files, not HLS playlists", () => {
    expect(page).toMatch(/isDirect\s*=[\s\S]*isDirectVideoUrl\(video\.full_video_url\)/);
  });
});

describe("deployed worker: Voyeur House & locker routing", () => {
  it("redirects HQQ and DoodStream-family embeds in /api/player instead of proxying", () => {
    const playerStart = worker.indexOf('if (path === "/api/player")');
    const playerBlock = worker.slice(playerStart, worker.indexOf('if (path === "/api/scraper/sync")', playerStart));
    expect(playerBlock).toContain("hqq\\.(to|tv)");
    expect(playerBlock).toContain("d0000?d\\.com");
    expect(playerBlock).toContain("myvidplay\\.com");
    expect(playerBlock).toContain("Response.redirect(targetUrl, 302)");
  });

  it("supports vidello.net -> nowplay.to resolution and HLS proxying", () => {
    expect(worker).toContain("vidello\\.net|nowplay\\.to");
    expect(worker).toContain('"nowplay.to"');
  });
});
