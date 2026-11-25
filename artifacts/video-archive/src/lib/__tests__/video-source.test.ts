import { describe, expect, it } from "vitest";
import { buildEdgePlayerUrl, buildEdgeResolveUrl, isDirectVideoUrl } from "../video-source";

describe("isDirectVideoUrl", () => {
  it("accepts native video paths with signed query tokens", () => {
    expect(isDirectVideoUrl("https://cdn.example.com/video.mp4?token=abc")).toBe(true);
    expect(isDirectVideoUrl("https://cdn.example.com/clip.webm#t=10")).toBe(true);
  });

  it("rejects pages and HLS manifests", () => {
    expect(isDirectVideoUrl("https://example.com/watch?id=1")).toBe(false);
    expect(isDirectVideoUrl("https://cdn.example.com/master.m3u8?token=abc")).toBe(false);
    expect(isDirectVideoUrl(null)).toBe(false);
  });
});

describe("buildEdgePlayerUrl", () => {
  it("passes player metadata through URLSearchParams", () => {
    const url = buildEdgePlayerUrl("https://host.example/embed?a=1&b=2", {
      title: "A & B",
      poster: "https://img.example/p.jpg",
      detail: "https://source.example/page",
    });

    const parsed = new URL(url, "https://chuglii.example");
    expect(parsed.pathname).toBe("/api/player");
    expect(parsed.searchParams.get("url")).toBe("https://host.example/embed?a=1&b=2");
    expect(parsed.searchParams.get("title")).toBe("A & B");
    expect(parsed.searchParams.get("poster")).toBe("https://img.example/p.jpg");
    expect(parsed.searchParams.get("detail")).toBe("https://source.example/page");
  });
});

describe("buildEdgeResolveUrl", () => {
  it("passes AVS resolver metadata through URLSearchParams", () => {
    const url = buildEdgeResolveUrl("https://playtwo.clicknplay.to/files/x/video.mp4", {
      title: "Clip & Co",
      embed: "https://clicknplay.to/embed-abc.html",
      detail: "https://hotscopes.net/video/1",
    });

    const parsed = new URL(url, "https://chuglii.example");
    expect(parsed.pathname).toBe("/api/player/resolve");
    expect(parsed.searchParams.get("url")).toBe("https://playtwo.clicknplay.to/files/x/video.mp4");
    expect(parsed.searchParams.get("embed")).toBe("https://clicknplay.to/embed-abc.html");
    expect(parsed.searchParams.get("detail")).toBe("https://hotscopes.net/video/1");
  });
});
