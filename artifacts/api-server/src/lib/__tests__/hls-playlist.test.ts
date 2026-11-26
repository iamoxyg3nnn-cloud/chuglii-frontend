import { describe, expect, it } from "vitest";
import {
  PROXY_MEDIA_PATH,
  proxiedMediaUrl,
  rewritePlaylistUris,
} from "../hls-playlist.js";

const MASTER = `#EXTM3U
#EXT-X-VERSION:3

#EXT-X-STREAM-INF:BANDWIDTH=1350000,RESOLUTION=1280x720,NAME="720p"
720p/video.m3u8

#EXT-X-STREAM-INF:BANDWIDTH=825000,RESOLUTION=854x480,NAME="480p"
480p/video.m3u8
`;

describe("rewritePlaylistUris", () => {
  it("wraps relative variant URIs through the proxy, resolved against the playlist URL", () => {
    const base =
      "https://content.zavastream.com/621742/abc/index.m3u8";
    const out = rewritePlaylistUris(MASTER, base);
    const lines = out.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.startsWith(`${PROXY_MEDIA_PATH}?url=`)).toBe(true);
    }

    const first = new URL(
      decodeURIComponent(lines[0].slice(`${PROXY_MEDIA_PATH}?url=`.length)),
    );
    expect(first.toString()).toBe(
      "https://content.zavastream.com/621742/abc/720p/video.m3u8",
    );
  });

  it("preserves comments and blank lines", () => {
    const out = rewritePlaylistUris(MASTER, "https://cdn.test/x/index.m3u8");
    expect(out).toContain("#EXTM3U");
    expect(out).toContain("#EXT-X-STREAM-INF:BANDWIDTH=1350000");
    expect(out.split("\n")[2]).toBe("");
  });

  it("rewrites absolute URIs unchanged in meaning", () => {
    const playlist =
      "#EXTM3U\nhttps://other.test/seg_00001.ts\n";
    const out = rewritePlaylistUris(playlist, "https://cdn.test/index.m3u8");
    const line = out.split("\n")[1];
    const decoded = decodeURIComponent(line.slice(`${PROXY_MEDIA_PATH}?url=`.length));
    expect(decoded).toBe("https://other.test/seg_00001.ts");
  });

  it("rewrites URI attributes on key and map tags (AES-128 sources)", () => {
    const playlist = [
      "#EXTM3U",
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-MAP:URI="init.mp4"',
      "seg_00000.ts",
    ].join("\n");
    const out = rewritePlaylistUris(playlist, "https://cdn.test/a/index.m3u8");

    expect(out).toContain("#EXT-X-KEY:METHOD=AES-128,URI=\"");
    const keyUri = /URI="([^"]+)"/.exec(out)?.[1] ?? "";
    expect(keyUri.startsWith(PROXY_MEDIA_PATH)).toBe(true);
    expect(decodeURIComponent(keyUri.split("url=")[1])).toBe(
      "https://cdn.test/a/key.bin",
    );
    expect(out).toContain("#EXT-X-MAP:URI=\"");
  });

  it("leaves an unparseable URI alone rather than throwing", () => {
    const out = rewritePlaylistUris("file.ts", "://broken");
    expect(out).toBe("file.ts");
  });

  it("proxiedMediaUrl encodes the target", () => {
    const url = "https://cdn.test/a/video.m3u8?token=1&x=2";
    expect(proxiedMediaUrl(url)).toBe(
      `${PROXY_MEDIA_PATH}?url=${encodeURIComponent(url)}`,
    );
  });
});
