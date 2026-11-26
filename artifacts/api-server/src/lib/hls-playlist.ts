/**
 * HLS playlist URL rewriting for the media proxy.
 *
 * Why: referer-locked CDNs (content.zavastream.com for borntobefuck.com) serve
 * playlists whose variant and segment URIs are RELATIVE — `720p/video.m3u8`,
 * `seg_00000.ts`. If the proxy streamed the playlist verbatim, the browser
 * would resolve those against OUR origin and request `/720p/video.m3u8`, which
 * 404s. Every URI therefore has to be resolved against the playlist's own URL
 * and then wrapped back through the proxy.
 */

/** Path the media proxy is mounted on. */
export const PROXY_MEDIA_PATH = "/api/media";

/** Absolute upstream URL -> our own proxy URL. */
export function proxiedMediaUrl(absoluteUrl: string): string {
  return `${PROXY_MEDIA_PATH}?url=${encodeURIComponent(absoluteUrl)}`;
}

/**
 * Rewrite every variant, segment and key URI in a playlist so it points back at
 * this proxy. Blank lines and comments are preserved; `URI="..."` attributes in
 * tags (`#EXT-X-KEY`, `#EXT-X-MAP`) are rewritten too, which matters for AES-128
 * encrypted sources.
 */
export function rewritePlaylistUris(playlist: string, baseUrl: string): string {
  const toProxy = (uri: string): string => {
    try {
      return proxiedMediaUrl(new URL(uri, baseUrl).toString());
    } catch {
      return uri;
    }
  };

  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${toProxy(uri)}"`);
      }
      return toProxy(trimmed);
    })
    .join("\n");
}
