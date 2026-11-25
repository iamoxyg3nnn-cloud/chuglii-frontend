import { describe, it, expect } from "vitest";
import { rankRelatedVideos, type RecommendationCandidate } from "../recommendations";

type Video = RecommendationCandidate & { title: string };

const video = (over: Partial<Video> & { id: string }): Video => ({
  title: over.id,
  tags: [],
  categories: [],
  actors: [],
  ...over,
});

describe("rankRelatedVideos", () => {
  it("prioritises shared specific tags over generic ones", () => {
    const current = video({ id: "current", tags: ["desi", "rare-model"], scraped_at: "2026-01-01T00:00:00Z" });
    const candidates = [
      video({ id: "generic", tags: ["desi"], scraped_at: "2026-01-01T00:00:00Z" }),
      video({ id: "specific", tags: ["rare-model"], scraped_at: "2026-01-02T00:00:00Z" }),
      video({ id: "both", tags: ["desi", "rare-model"], scraped_at: "2026-01-03T00:00:00Z" }),
    ];
    expect(rankRelatedVideos(current, candidates, 3).map((v) => v.id)).toEqual([
      "both",
      "specific",
      "generic",
    ]);
  });

  it("excludes the current clip and mirrored duplicates of it", () => {
    const current = video({ id: "current", title: "Star Clip Part 1", tags: ["desi"] });
    const candidates = [
      video({ id: "current" }),
      video({ id: "mirror", title: "star  clip  part 1", tags: ["desi"] }),
      video({ id: "other", title: "Different Clip", tags: ["desi"] }),
    ];
    const result = rankRelatedVideos(current, candidates, 8);
    expect(result.map((v) => v.id)).toEqual(["other"]);
  });

  it("collapses duplicate titles and keeps the most relevant copy", () => {
    const current = video({ id: "current", tags: ["desi", "rare"] });
    const candidates = [
      video({ id: "dup-low", title: "Same Title", tags: ["desi"], scraped_at: "2026-01-01T00:00:00Z" }),
      video({ id: "dup-high", title: "same title", tags: ["rare"], scraped_at: "2026-02-01T00:00:00Z" }),
      video({ id: "other", title: "Other", tags: ["unrelated"] }),
    ];
    const result = rankRelatedVideos(current, candidates, 8);
    expect(result.map((v) => v.id)).toEqual(["dup-high", "other"]);
  });

  it("keeps non-Latin titles distinct instead of collapsing them", () => {
    const current = video({ id: "current", title: "မြန်မာ ဗီဒီယို", tags: ["myanmar"] });
    const candidates = [
      video({ id: "mirror", title: "မြန်မာ ဗီဒီယို", tags: ["myanmar"] }),
      video({
        id: "same-title",
        title: "တူညီသော ခေါင်းစဉ်",
        tags: ["myanmar"],
        scraped_at: "2026-02-01T00:00:00Z",
      }),
      video({
        id: "same-title-copy",
        title: "တူညီသော ခေါင်းစဉ်",
        tags: ["myanmar"],
        scraped_at: "2026-01-01T00:00:00Z",
      }),
      video({ id: "different", title: "အခြား ဗီဒီယို", tags: ["myanmar"] }),
    ];
    expect(rankRelatedVideos(current, candidates, 8).map((v) => v.id)).toEqual([
      "same-title",
      "different",
    ]);
  });

  it("does not drop recommendations when the current title has no letters or numbers", () => {
    const current = video({ id: "current", title: "!!!", tags: ["desi"] });
    const candidates = [
      video({ id: "empty-a", title: "", tags: ["desi"], scraped_at: "2026-02-01T00:00:00Z" }),
      video({ id: "empty-b", title: "???", tags: ["desi"], scraped_at: "2026-01-01T00:00:00Z" }),
    ];
    expect(rankRelatedVideos(current, candidates, 8).map((v) => v.id)).toEqual([
      "empty-a",
      "empty-b",
    ]);
  });

  it("uses scrape time for ties and honours the requested limit", () => {
    const current = video({ id: "current" });
    const candidates = [
      video({ id: "old", scraped_at: "2026-01-01T00:00:00Z" }),
      video({ id: "fresh", scraped_at: "2026-02-01T00:00:00Z" }),
      video({ id: "middle", scraped_at: "2026-01-15T00:00:00Z" }),
    ];
    expect(rankRelatedVideos(current, candidates, 2).map((v) => v.id)).toEqual([
      "fresh",
      "middle",
    ]);
  });
});
