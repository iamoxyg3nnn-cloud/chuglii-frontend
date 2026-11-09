import { describe, expect, it } from "vitest";
import {
  deriveServers,
  detectHostLabel,
  iframeReferrerPolicy,
  isEmbedUrl,
  normalizeAnonMP4Url,
  normalizeDroploadUrl,
  normalizeLuluStreamUrl,
  normalizeVideoServerUrl,
} from "../video-hosts";

describe("detectHostLabel", () => {
  it.each([
    ["https://dropload.io/e/abc1234", "Dropload"],
    ["https://dropload.tv/abc1234", "Dropload"],
    ["https://dr0pstream.com/d/abc1234", "Dropload"],
    ["https://anonmp4.com/embed/abc1234", "AnonMP4"],
    ["https://anonmp4.to/v/abc1234", "AnonMP4"],
    ["https://lulustream.com/e/abc1234", "LuluStream"],
    ["https://streamtape.com/v/abc", "Streamtape"],
    ["https://unknown-mirror.xyz/play/abc", "unknown-mirror.xyz"],
  ])("%s -> %s", (url, expected) => {
    expect(detectHostLabel(url)).toBe(expected);
  });
});

describe("normalizeDroploadUrl", () => {
  it.each([
    ["https://dropload.io/d/3abcDEF_123", "https://dropload.io/e/3abcDEF_123"],
    ["https://dropload.tv/e/3abcDEF_123", "https://dropload.tv/e/3abcDEF_123"],
    ["https://dropload.io/3abcDEF_123", "https://dropload.io/e/3abcDEF_123"],
    ["https://dropload.io/3abcDEF_123.html", "https://dropload.io/e/3abcDEF_123"],
    ["https://dropload.io/embed-3abcDEF_123.html", "https://dropload.io/e/3abcDEF_123"],
    ["https://dr0pstream.com/d/xyz9876", "https://dr0pstream.com/e/xyz9876"],
  ])("normalizes %s to embed player %s", (input, expected) => {
    expect(normalizeDroploadUrl(input)).toBe(expected);
  });

  it("leaves non-dropload urls untouched", () => {
    expect(normalizeDroploadUrl("https://example.com/d/12345")).toBe("https://example.com/d/12345");
  });
});

describe("normalizeAnonMP4Url", () => {
  it.each([
    ["https://anonmp4.com/v/abcd1234", "https://anonmp4.com/embed/abcd1234"],
    ["https://anonmp4.com/embed/abcd1234", "https://anonmp4.com/embed/abcd1234"],
    ["https://anonmp4.to/abcd1234", "https://anonmp4.to/embed/abcd1234"],
    ["https://anonmp4.com/e/abcd1234", "https://anonmp4.com/embed/abcd1234"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeAnonMP4Url(input)).toBe(expected);
  });

  it("leaves non-anonmp4 urls untouched", () => {
    expect(normalizeAnonMP4Url("https://example.com/v/1234")).toBe("https://example.com/v/1234");
  });
});

describe("normalizeLuluStreamUrl", () => {
  it("converts LuluStream and LuluVDO links to /embed/{code}", () => {
    expect(normalizeLuluStreamUrl("https://lulustream.com/e/abcd123")).toBe("https://lulustream.com/embed/abcd123");
    expect(normalizeLuluStreamUrl("https://luluvdo.com/xyz9876.html")).toBe("https://lulustream.com/embed/xyz9876");
  });
});

describe("isEmbedUrl", () => {
  it("recognizes dropload and anonmp4 as embed-friendly", () => {
    expect(isEmbedUrl("https://dropload.io/e/12345678")).toBe(true);
    expect(isEmbedUrl("https://anonmp4.com/embed/12345678")).toBe(true);
    expect(isEmbedUrl("https://dr0pstream.com/e/12345678")).toBe(true);
  });

  it("recognizes path-based embed indicators", () => {
    expect(isEmbedUrl("https://streamtape.com/e/abc1234")).toBe(true);
    expect(isEmbedUrl("https://example.org/embed/abc1234")).toBe(true);
  });

  it("returns false for non-embed links", () => {
    expect(isEmbedUrl("https://example.com/download/file.zip")).toBe(false);
  });
});

describe("deriveServers", () => {
  it("derives embed iframe server for dropload links", () => {
    const servers = deriveServers(null, {
      "Dropload": "https://dropload.io/d/abc12345",
    });
    expect(servers).toEqual([
      {
        label: "Dropload",
        src: "https://dropload.io/e/abc12345",
        type: "iframe",
      },
    ]);
  });

  it("derives embed iframe server for anonmp4 links", () => {
    const servers = deriveServers(null, {
      "AnonMP4": "https://anonmp4.com/v/xyz98765",
    });
    expect(servers).toEqual([
      {
        label: "AnonMP4",
        src: "https://anonmp4.com/embed/xyz98765",
        type: "iframe",
      },
    ]);
  });

  it("derives both embedUrl and mirror links without duplicates", () => {
    const servers = deriveServers("https://dropload.io/abc12345", {
      "Mirror 1": "https://anonmp4.to/v/secret99",
      "Mirror 2": "https://dropload.io/e/abc12345",
    });
    expect(servers.length).toBe(2);
    expect(servers[0].src).toBe("https://anonmp4.to/embed/secret99");
    expect(servers[1].src).toBe("https://dropload.io/e/abc12345");
  });
});

describe("iframeReferrerPolicy", () => {
  it.each([
    ["https://anonmp4.com/embed/abc1234", "origin"],
    ["https://anonmp4.to/embed/xyz9876", "origin"],
    ["https://seeks.cloud/e/abc123", "origin"],
    ["https://embedseek.com/e/abc123", "origin"],
    ["https://upns.io/e/abc123", "origin"],
    ["https://vidara.so/e/abc123", "origin"],
  ])("%s -> origin (ticket-auth host)", (url, expected) => {
    expect(iframeReferrerPolicy(url)).toBe(expected);
  });

  it.each([
    ["https://dropload.io/e/abc1234", "no-referrer"],
    ["https://streamtape.com/v/abc", "no-referrer"],
    ["https://lulustream.com/embed/abc", "no-referrer"],
    ["https://dood.to/e/abc", "no-referrer"],
    ["https://mixdrop.ag/e/abc", "no-referrer"],
    ["https://example.com/player/abc", "no-referrer"],
  ])("%s -> no-referrer (privacy-first default)", (url, expected) => {
    expect(iframeReferrerPolicy(url)).toBe(expected);
  });

  it("returns no-referrer for invalid/empty url", () => {
    expect(iframeReferrerPolicy("not-a-url")).toBe("no-referrer");
    expect(iframeReferrerPolicy("")).toBe("no-referrer");
  });
});
