import { safeExternalUrl } from "./safe-url";

export interface VideoServer {
  label: string;
  src: string;
  type: "iframe" | "link";
}

export function detectHostLabel(url: string): string {
  try {
    const { hostname } = new URL(url);
    if (hostname.includes("streamtape")) return "Streamtape";
    if (hostname.includes("voe")) return "VOE";
    if (hostname.includes("mixdrop")) return "Mixdrop";
    if (hostname.includes("dood")) return "DoodStream";
    if (hostname.includes("lulu")) return "LuluStream";
    if (hostname.includes("upload18")) return "Upload18";
    if (hostname.includes("dropload") || hostname.includes("dr0pstream")) return "Dropload";
    if (hostname.includes("videro")) return "Videro";
    if (hostname.includes("filehost")) return "FileHost";
    if (hostname.includes("filemoon")) return "Filemoon";
    if (hostname.includes("upstream")) return "Upstream";
    if (hostname.includes("vidoza")) return "Vidoza";
    if (hostname.includes("mp4upload")) return "MP4Upload";
    if (hostname.includes("pixeldrain")) return "Pixeldrain";
    if (hostname.includes("gofile")) return "Gofile";
    if (hostname.includes("streamwish")) return "Streamwish";
    if (hostname.includes("earnvids")) return "EarnVids";
    if (hostname.includes("seek") || hostname.includes("embedseek") || hostname.includes("seeks.cloud")) return "SeekStreaming";
    if (hostname.includes("upns")) return "UPNshare";
    if (hostname.includes("anonmp4")) return "AnonMP4";
    if (hostname.includes("udrop")) return "UDrop";
    if (hostname.includes("vidmoly")) return "VidMoly";
    if (hostname.includes("sheeshfans")) return "SheeshFans";
    if (hostname.includes("influencersgonewild")) return "InfluencersGoneWild";
    return hostname.replace(/^www\./, "");
  } catch {
    return "Server";
  }
}

/**
 * LuluStream (now LuluVDO) frame-busts out of iframes on its "/e/" watch page:
 * the page detects window.top !== self and replaces the embedding site with its
 * own homepage. "/embed/{code}" is the real iframe player, so rewrite every
 * LuluStream link (old "/e/" rows, "<code>.html" view links, LuluVDO mirrors)
 * to it before deciding how to render the server.
 */
export function normalizeLuluStreamUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(lulustream|luluvdo)\.com$/i.test(parsed.hostname)) return url;
    const segment = parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    const code = segment.replace(/\.html$/i, "");
    if (!/^[A-Za-z0-9_-]{4,}$/.test(code)) return url;
    return `https://lulustream.com/embed/${code}`;
  } catch {
    return url;
  }
}

/**
 * Dropload / Dr0pstream provides responsive embed players via /e/{code}.
 * Watch/download URLs often arrive as /d/{code}, /v/{code}, /embed-{code}.html, or /{code}.
 * Normalize all variations to {origin}/e/{code} so they embed cleanly.
 */
export function normalizeDroploadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)(dropload|dr0pstream)\.[a-z]{2,}$/i.test(parsed.hostname)) return url;
    const segment = parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    const code = segment.replace(/^embed-/i, "").replace(/\.html$/i, "");
    if (!/^[A-Za-z0-9_-]{4,}$/.test(code)) return url;
    return `${parsed.origin}/e/${code}`;
  } catch {
    return url;
  }
}

/**
 * AnonMP4 provides responsive embed players via /embed/{code}.
 * Normalize /v/{code}, /e/{code}, /{code} to {origin}/embed/{code}.
 */
export function normalizeAnonMP4Url(url: string): string {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)anonmp4\.[a-z]{2,}$/i.test(parsed.hostname)) return url;
    const segment = parsed.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    const code = segment.replace(/^embed-/i, "").replace(/\.html$/i, "");
    if (!/^[A-Za-z0-9_-]{4,}$/.test(code)) return url;
    return `${parsed.origin}/embed/${code}`;
  } catch {
    return url;
  }
}

export function isEmbedUrl(url: string): boolean {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) return false;
  try {
    const { pathname, hostname } = new URL(safeUrl);
    // AnonMP4 binds playback tokens to a PHP session cookie that lacks SameSite=None / Partitioned.
    // In cross-site iframes, modern browsers drop the session cookie, causing AnonMP4's backend to respond
    // with "Forbidden: Playback ticket already used or invalid session."
    // It must be launched top-level (popup window or new tab) where cookies are first-party.
    if (hostname.includes("anonmp4")) {
      return false;
    }
    // Path-based detection for common embed patterns
    if (pathname.includes("/e/") || pathname.includes("/embed/") || pathname.includes("/player/") || pathname.includes("/v/")) {
      return true;
    }
    // Host-based detection for known embed-friendly providers
    // Some hosts embed via direct URL without a standard embed path
    if (
      hostname.includes("seek") ||
      hostname.includes("embedseek") ||
      hostname.includes("seeks.cloud") ||
      hostname.includes("upns") ||
      hostname.includes("vidara") ||
      hostname.includes("dropload") ||
      hostname.includes("dr0pstream")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Returns the correct iframe referrerpolicy for a given embed URL.
 *
 * Some hosts (AnonMP4, SeekStreaming, UPNshare, Vidara) validate the HTTP
 * Referer header as part of a one-time playback ticket or session-token
 * handshake. Using "no-referrer" on those iframes strips the header and
 * causes "Forbidden: Playback ticket already used or invalid session".
 *
 * We send only the origin (no path) for those hosts so the domain check
 * passes while the full page URL remains private. All other hosts keep
 * "no-referrer" for user-privacy hardening.
 */
export function iframeReferrerPolicy(
  url: string,
): "no-referrer" | "origin" | "strict-origin-when-cross-origin" {
  try {
    const { hostname } = new URL(url);
    // Hosts that validate Referer for playback-ticket or session auth
    if (
      hostname.includes("anonmp4") ||
      hostname.includes("seek") ||
      hostname.includes("embedseek") ||
      hostname.includes("seeks.cloud") ||
      hostname.includes("upns") ||
      hostname.includes("vidara") ||
      // These CDNs require the origin Referer header to authorize playback
      hostname.includes("internetchicks") ||
      hostname.includes("sheeshfans") ||
      hostname.includes("influencersgonewild")
    ) {
      // "origin" sends only "https://chuglii.in" — domain validated, path hidden
      return "origin";
    }
  } catch { /* ignore */ }
  // Privacy-first default: strip referrer for all other hosts
  return "no-referrer";
}

export function normalizeVideoServerUrl(rawUrl: string): string {
  let url = rawUrl;
  try {
    let parsed = new URL(url);

    // Repair malformed values where an absolute URL was embedded inside
    // the path, e.g. "https://vidara.so/v/https://vidara.to/e/XXXX"
    if (/https?:\/\//i.test(parsed.pathname)) {
      const inner = parsed.pathname.match(/\/(e|v|embed|player)\/([A-Za-z0-9_-]+)\/?$/i);
      if (inner) {
        url = `${parsed.origin}/${inner[1]}/${inner[2]}`;
        parsed = new URL(url);
      }
    }

    if (parsed.hostname.includes("voe") && !parsed.pathname.startsWith("/e/")) {
      url = parsed.origin + "/e" + parsed.pathname;
    }
    // Convert pixeldrain API URLs to user-facing page URLs
    const pdMatch = parsed.pathname.match(/^\/api\/file\/(.+)/);
    if (parsed.hostname.includes("pixeldrain") && pdMatch) {
      url = `https://pixeldrain.com/u/${pdMatch[1]}`;
    }
    // Vidara: /v/XXX is the download page, /e/XXX is the embed player
    if (parsed.hostname.includes("vidara") && parsed.pathname.startsWith("/v/")) {
      url = parsed.origin + "/e" + parsed.pathname.slice(2);
    }
    url = normalizeLuluStreamUrl(url);
    url = normalizeDroploadUrl(url);
    url = normalizeAnonMP4Url(url);
  } catch {}
  return url;
}

export function deriveServers(
  embedUrl?: string | null,
  links?: Record<string, string> | null,
): VideoServer[] {
  const servers: VideoServer[] = [];
  const seen = new Set<string>();
  const seenHosts = new Set<string>();

  if (links) {
    for (const [label, src] of Object.entries(links)) {
      const safeSrc = safeExternalUrl(src);
      if (safeSrc) {
        const url = normalizeVideoServerUrl(safeSrc);
        if (isEmbedUrl(url)) {
          servers.push({ label, src: url, type: "iframe" });
        } else {
          servers.push({ label, src: url, type: "link" });
        }
        seen.add(url);
        try { seenHosts.add(new URL(url).hostname); } catch {}
      }
    }
  }

  const safeEmbedUrlRaw = safeExternalUrl(embedUrl);
  const safeEmbedUrl = safeEmbedUrlRaw ? normalizeVideoServerUrl(safeEmbedUrlRaw) : null;
  if (safeEmbedUrl && !seen.has(safeEmbedUrl)) {
    let hostDuplicate = false;
    try { hostDuplicate = seenHosts.has(new URL(safeEmbedUrl).hostname); } catch {}
    if (!hostDuplicate) {
      servers.push({
        label: detectHostLabel(safeEmbedUrl),
        src: safeEmbedUrl,
        type: isEmbedUrl(safeEmbedUrl) ? "iframe" : "link",
      });
      seen.add(safeEmbedUrl);
    }
  }

  // Stable sort: prioritize in-page embeddable ("iframe") servers over external ("link") servers
  // so users immediately get interactive in-page playback when multiple mirrors are available.
  servers.sort((a, b) => {
    if (a.type === b.type) return 0;
    return a.type === "iframe" ? -1 : 1;
  });

  return servers;
}
