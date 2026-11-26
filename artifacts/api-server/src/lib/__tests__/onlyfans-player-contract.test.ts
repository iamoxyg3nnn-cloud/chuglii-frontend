/**
 * Contract tests for the OnlyFans watch page's player selection.
 *
 * Every OnlyFans video used to render `<iframe src="/api/player">`, and the
 * Worker's player templates emit a bare `<video controls autoplay muted>`.
 * `controls` means the BROWSER's UI, so visitors never saw our branded player,
 * quality menu or mirror failover -- and fixing things *inside* the iframe
 * could not help, because the iframe was already the wrong place to play.
 *
 * These tests pin the routing rule:
 *
 *   .m3u8 / .mp4   -> our own player components (VideoPlayer / HlsVideoPlayer)
 *   anything else  -> iframe (third-party embed lockers we cannot replace)
 *
 * They read the page source, the same way worker-media-contract.test.ts reads
 * the deployed Worker, so the rule cannot quietly drift back.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/lib/__tests__ -> repo root
const REPO_ROOT = join(HERE, "../../../../../");
const WATCH_PAGE = join(REPO_ROOT, "artifacts/video-archive/src/pages/OnlyfansWatch.tsx");
const WORKER = join(REPO_ROOT, "artifacts/video-archive/public/_worker.js");

const page = readFileSync(WATCH_PAGE, "utf8");
const worker = readFileSync(WORKER, "utf8");

describe("OnlyFans watch page player routing", () => {
  it("plays direct video with our own VideoPlayer, autoplaying muted", () => {
    expect(page).toContain('import { VideoPlayer } from "@/components/VideoPlayer"');
    // autoPlay is what makes startMuted true; without it the browser blocks
    // playback and the visit starts on a paused black frame.
    const directBlock = page.slice(page.indexOf("<VideoPlayer"), page.indexOf("onReload", page.indexOf("<VideoPlayer")));
    expect(directBlock).toContain("autoPlay");
  });

  it("plays HLS with HlsVideoPlayer instead of handing it to an iframe", () => {
    expect(page).toContain('import { HlsVideoPlayer } from "@/components/HlsVideoPlayer"');
    expect(page).toContain("<HlsVideoPlayer");
    expect(page).toContain("candidates={hlsCandidates}");
  });

  it("no longer routes first-party media hosts to the edge-player iframe", () => {
    // The removed branch forced media.uncut-x.com / content.zavastream.com into
    // an iframe whose template renders native controls.
    expect(page).not.toContain("edgePlayerMediaHosts");
    expect(page).not.toContain("useEdgePlayerForMedia");
  });

  it("proxies uncut-x media so the in-page player can seek it", () => {
    expect(page).toContain("media.uncut-x.com");
    expect(page).toMatch(/function needsStreamProxy/);
  });

  it("keeps the iframe for third-party embed lockers only", () => {
    expect(page).toContain("streamKind");
    expect(page).toContain("classifyStream");
    // An embed still has to reach the iframe branch.
    expect(page).toMatch(/streamKind === "hls"[\s\S]*isDirectVideo[\s\S]*<PlayerFrame/);
  });

  it("Worker iframe templates are only a fallback, so they may keep native controls", () => {
    // Documents the constraint: `controls` in these templates is the reason
    // first-party streams must not be sent here.
    const mp4 = worker.slice(worker.indexOf("function renderCleanMp4Player"), worker.indexOf("function renderCleanHlsPlayer"));
    expect(mp4).toContain("controls");
  });
});
