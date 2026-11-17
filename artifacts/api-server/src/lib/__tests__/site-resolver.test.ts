import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  enrichWithSite,
  enrichSingleWithSite,
  _resetSiteMapCache,
} from "../site-resolver.js";
import { supabase } from "../supabase.js";

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe("site-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSiteMapCache();
  });

  it("enriches recordings with correct sites from channel_assignments", async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          { username: "SaraKaAsar", site: "stripchat" },
          { username: "Desi_Fox1", site: "stripchat" },
          { username: "john_doe", site: "chaturbate" },
        ],
        error: null,
      }),
    });

    const recs: { username: string; site?: string }[] = [
      { username: "sarakaasar" },
      { username: "DESI_FOX1" },
      { username: "john_doe" },
      { username: "unknown_model" },
    ];

    const result = await enrichWithSite(recs);
    expect(result[0].site).toBe("stripchat");
    expect(result[1].site).toBe("stripchat");
    expect(result[2].site).toBe("chaturbate");
    expect(result[3].site).toBe("chaturbate");
  });

  it("preserves already defined site property", async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ username: "alice", site: "chaturbate" }],
        error: null,
      }),
    });

    const recs: { username: string; site?: string }[] = [{ username: "alice", site: "stripchat" }];
    const result = await enrichWithSite(recs);
    expect(result[0].site).toBe("stripchat");
  });

  it("handles single recording enrichment", async () => {
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ username: "sarakaasar", site: "stripchat" }],
        error: null,
      }),
    });

    const single: { username: string; site?: string } = { username: "sarakaasar" };
    const result = await enrichSingleWithSite(single);
    expect(result.site).toBe("stripchat");
  });
});
