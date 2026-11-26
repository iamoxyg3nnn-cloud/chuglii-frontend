import { Router, type IRouter } from "express";

const router: IRouter = Router();

function renderCleanPlayerHtml(streamingUrl: string, title = "", poster = ""): string {
  const safeTitle = (title || "Chuglii Player").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const isHls = streamingUrl.includes(".m3u8") || streamingUrl.includes("/hls/");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${safeTitle}</title>
  ${isHls ? '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js"></script>' : ''}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    video { width: 100%; height: 100%; max-height: 100vh; object-fit: contain; background: #000; outline: none; }
  </style>
</head>
<body>
  <video id="player" controls autoplay playsinline ${poster ? `poster="${poster}"` : ""}></video>
  <script>
    (function() {
      var video = document.getElementById('player');
      var streamUrl = ${JSON.stringify(streamingUrl)};
      ${isHls ? `
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function() {}); });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', function() { video.play().catch(function() {}); });
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

router.get("/player", async (req, res) => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url : null;
  if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
    res.status(400).json({ error: "Missing or invalid url parameter" });
    return;
  }

  try {
    const destObj = new URL(targetUrl);

    // Buu Mal (Myanmar) Resolver
    if (destObj.hostname.includes("buumal.com")) {
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
          const freshStreamUrl = sourceMatch[1].replace(/&amp;/g, "&");
          let title = titleMatch ? titleMatch[1].replace(/Buu Mal\s*\(.*?\)/gi, "").trim() : "Myanmar Video";
          const poster = posterMatch ? posterMatch[1].replace(/&amp;/g, "&") : "";

          const wantJson = req.query.format === "json" || req.headers.accept?.includes("application/json");
          if (wantJson) {
            res.setHeader("Cache-Control", "no-store");
            res.json({ streamUrl: freshStreamUrl, title, poster });
            return;
          }

          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.send(renderCleanPlayerHtml(freshStreamUrl, title, poster));
          return;
        }
      }
    }

    // SupJav and Partner Lockers (FC2Stream, LuluStream, EarnVids, Streamtape)
    // Proxy with spoofed Referer: https://supjav.com/ to bypass domain restrictions
    if (
      destObj.hostname.includes("fc2stream") ||
      destObj.hostname.includes("luminscdn") ||
      destObj.hostname.includes("evsishere") ||
      destObj.hostname.includes("earnvids") ||
      destObj.hostname.includes("vidhide") ||
      destObj.hostname.includes("streamtape")
    ) {
      const upstreamRes = await fetch(targetUrl, {
        headers: {
          "User-Agent": (req.headers["user-agent"] as string) || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Referer: "https://supjav.com/",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (upstreamRes.ok) {
        let body = await upstreamRes.text();
        body = body.replace(/top\.location[^;]+;/g, "/* neutral */");
        body = body.replace(/window\.location\.ancestorOrigins/g, '["https://supjav.com"]');
        body = body.replace(/window\["CWmUGiWrLe"\]\(\)/g, "");
        body = body.replace(/window\.open\([^)]*\)/g, "null");

        const baseTag = `<base href="${destObj.origin}/">`;
        if (body.includes("<head>")) {
          body = body.replace("<head>", `<head>${baseTag}`);
        } else {
          body = baseTag + body;
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=1800");
        res.send(body);
        return;
      }
    }

    // Default redirect to targetUrl if no custom resolver
    res.redirect(targetUrl);
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve stream" });
  }
});

/**
 * Stream proxy for direct MP4/WebM files that require a spoofed Referer and
 * Range-capable passthrough (sheeshfans, influencersgonewild).
 * The browser's native <video> element cannot inject a custom Referer header,
 * so we proxy the bytes server-side and add the right origin header.
 *
 * Usage: GET /api/player/stream?url=<encoded-cdn-url>
 */
router.get("/player/stream", async (req, res) => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url : null;
  if (!targetUrl || (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://"))) {
    res.status(400).json({ error: "Missing or invalid url parameter" });
    return;
  }

  try {
    const destObj = new URL(targetUrl);

    // Determine the correct spoofed Referer based on the CDN origin.
    let referer = `${destObj.protocol}//${destObj.hostname}/`;
    if (destObj.hostname.includes("sheeshfans")) {
      referer = "https://sheeshfans.com/";
    } else if (destObj.hostname.includes("influencersgonewild")) {
      referer = "https://influencersgonewild.com/";
    }

    const upstreamHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Referer: referer,
      Origin: referer.replace(/\/$/, ""),
      Accept: "video/webm,video/mp4,video/*;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    // Forward Range header so seek/partial-content works in the browser player.
    const rangeHeader = req.headers["range"];
    if (rangeHeader) {
      upstreamHeaders["Range"] = rangeHeader;
    }

    const upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });
      return;
    }

    // Relay status (200 or 206 Partial Content), content headers, and body.
    res.status(upstream.status);

    const relayHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
      "last-modified",
      "etag",
    ];
    for (const h of relayHeaders) {
      const val = upstream.headers.get(h);
      if (val) res.setHeader(h, val);
    }
    // Allow browser to cache stream segments.
    if (!res.getHeader("cache-control")) {
      res.setHeader("Cache-Control", "public, max-age=3600");
    }
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (!upstream.body) {
      res.end();
      return;
    }

    // Pipe the response body to the client.
    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          const shouldContinue = res.write(value);
          if (!shouldContinue) {
            // Back-pressure: wait for drain before reading more.
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
      } catch {
        res.end();
      }
    };
    await pump();
  } catch (err) {
    res.status(500).json({ error: "Failed to proxy stream" });
  }
});

export default router;
