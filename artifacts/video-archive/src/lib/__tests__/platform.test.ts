import { describe, it, expect } from "vitest";
import { getRecordingPlatform, KNOWN_STRIPCHAT_USERNAMES } from "../platform";

describe("platform resolution", () => {
  it("resolves stripchat when explicit site is stripchat", () => {
    expect(getRecordingPlatform({ site: "stripchat", username: "anyone" })).toBe("stripchat");
    expect(getRecordingPlatform({ site: "STRIPCHAT", username: "anyone" })).toBe("stripchat");
  });

  it("resolves chaturbate when explicit site is chaturbate", () => {
    expect(getRecordingPlatform({ site: "chaturbate", username: "anyone" })).toBe("chaturbate");
    expect(getRecordingPlatform({ site: "CHATURBATE", username: "anyone" })).toBe("chaturbate");
  });

  it("falls back to known stripchat seed list when site is absent", () => {
    expect(getRecordingPlatform({ username: "sarakaasar" })).toBe("stripchat");
    expect(getRecordingPlatform({ username: "SaraKaAsar" })).toBe("stripchat");
    expect(getRecordingPlatform({ username: "Desi_Fox1" })).toBe("stripchat");
    expect(getRecordingPlatform({ username: "xiaomaomi0123" })).toBe("stripchat");
  });

  it("defaults to chaturbate for other performers when site is absent", () => {
    expect(getRecordingPlatform({ username: "some_other_model" })).toBe("chaturbate");
    expect(getRecordingPlatform(null)).toBe("chaturbate");
    expect(getRecordingPlatform({})).toBe("chaturbate");
  });

  it("contains critical models in seed set", () => {
    expect(KNOWN_STRIPCHAT_USERNAMES.has("sarakaasar")).toBe(true);
    expect(KNOWN_STRIPCHAT_USERNAMES.has("desi_fox1")).toBe(true);
    expect(KNOWN_STRIPCHAT_USERNAMES.has("virgin_aisha")).toBe(true);
  });
});
