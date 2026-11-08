import { describe, it, expect } from "vitest";
import {
  MissingPerformerError,
  normalizePerformerUsername,
  resolvePoolTarget,
  usernameFromStreamLink,
} from "../request-pool.js";

describe("normalizePerformerUsername", () => {
  it("lowercases and strips characters the backend sanitizer drops", () => {
    expect(normalizePerformerUsername("  Alice.Wonder! ")).toBe("alicewonder");
    expect(normalizePerformerUsername("Jane_Doe-2")).toBe("jane_doe-2");
    expect(normalizePerformerUsername(null)).toBe("");
  });
});

describe("usernameFromStreamLink", () => {
  it.each([
    ["https://chaturbate.com/alice/", "alice"],
    ["https://www.chaturbate.com/Alice/?tour=abc", "alice"],
    ["chaturbate.com/alice", "alice"],
    ["https://stripchat.com/cam/bob", "bob"],
    ["https://stripchat.com/bob?utm_source=x", "bob"],
    ["stripchat.com/#/carol", "carol"],
  ])("%s → %s", (link, expected) => {
    expect(usernameFromStreamLink(link)).toBe(expected);
  });

  it("returns empty when the URL has no performer segment", () => {
    expect(usernameFromStreamLink("https://chaturbate.com/")).toBe("");
    expect(usernameFromStreamLink("")).toBe("");
    expect(usernameFromStreamLink(null)).toBe("");
  });
});

describe("resolvePoolTarget", () => {
  it("uses performer_username when present", () => {
    expect(
      resolvePoolTarget({
        id: 1,
        platform: "stripchat",
        performer_username: "Alice",
        stream_link: "https://stripchat.com/someone-else",
      }),
    ).toEqual({ username: "alice", site: "stripchat" });
  });

  it("falls back to the stream link", () => {
    expect(
      resolvePoolTarget({
        id: 2,
        platform: "chaturbate",
        performer_username: null,
        stream_link: "https://chaturbate.com/bob/",
      }),
    ).toEqual({ username: "bob", site: "chaturbate" });
  });

  it("rejects unsupported platforms", () => {
    expect(() =>
      resolvePoolTarget({
        id: 3,
        platform: "onlyfans",
        performer_username: "alice",
        stream_link: null,
      }),
    ).toThrow(MissingPerformerError);
  });

  it("rejects requests with no derivable username", () => {
    expect(() =>
      resolvePoolTarget({
        id: 4,
        platform: "chaturbate",
        performer_username: null,
        stream_link: "https://chaturbate.com/",
      }),
    ).toThrow(/no performer username/);
  });
});
