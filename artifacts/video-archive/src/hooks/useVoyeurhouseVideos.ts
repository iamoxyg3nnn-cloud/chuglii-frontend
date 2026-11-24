import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

export interface VoyeurhouseVideo {
  id: string;
  source_site: string;
  source_post_id: string;
  title: string;
  slug: string | null;
  detail_url: string;
  full_video_url: string | null;
  video_mime_type: string;
  trailer_preview_url: string | null;
  thumbnail_url: string | null;
  clean_thumbnail_url: string | null;
  quality_label: string | null;
  quality_score: number | null;
  duration_formatted: string | null;
  duration_seconds: number | null;
  views_count: number;
  views_raw: string | null;
  rating_score: number | null;
  rating_raw: string | null;
  tags: string[];
  categories: string[];
  actors: string[];
  status: string;
  dead_reason: string | null;
  last_checked_at: string | null;
  published_at: string | null;
  scraped_at: string;
  raw_payload?: {
    source?: string;
    embed_url?: string;
    description?: string;
    dead_reason?: string;
    servers?: Array<{ name: string; server?: string; type?: string; embed_url?: string; url?: string }>;
  };
}

/**
 * One category, one adapter per isolated website (mirrors the OnlyFans layout).
 * Each website has its OWN table + RPC family. There is no union/cross-site read.
 */
export const VOYEURHOUSE_SITES = [
  "voyeurhouseorg",
  "hotscopesvoyeurhouse",
  "reallifecamto",
  "hotscopesspygasm",
  "hotscopesreallifecam",
] as const;
export type VoyeurhouseSite = (typeof VOYEURHOUSE_SITES)[number];

export const VOYEURHOUSE_SITE_LABELS: Record<VoyeurhouseSite, string> = {
  voyeurhouseorg: "Voyeur House",
  hotscopesvoyeurhouse: "HotScopes · Voyeur House",
  reallifecamto: "RealLifeCam.to",
  hotscopesspygasm: "HotScopes · SpyGasm",
  hotscopesreallifecam: "HotScopes · ReallifeCam",
};

export const VOYEURHOUSE_SITE_SOURCES: Record<VoyeurhouseSite, string> = {
  voyeurhouseorg: "voyeur-house.org",
  hotscopesvoyeurhouse: "hotscopes.net/videos/voyeur-house",
  reallifecamto: "reallifecam.to/videos",
  hotscopesspygasm: "hotscopes.net/videos/spygasm?o=mr",
  hotscopesreallifecam: "hotscopes.net/videos/reallifecam?o=mr",
};

/** Per-source RPC names. A source can ONLY ever query its own isolated table. */
const AVS_SITE_RPCS: Record<Exclude<VoyeurhouseSite, "voyeurhouseorg">, { list: string; count: string; byId: string }> = {
  hotscopesvoyeurhouse: {
    list: "scraper_get_hotscopesvoyeurhouse_videos",
    count: "scraper_count_hotscopesvoyeurhouse_videos",
    byId: "scraper_get_hotscopesvoyeurhouse_video_by_id",
  },
  reallifecamto: {
    list: "scraper_get_reallifecamto_videos",
    count: "scraper_count_reallifecamto_videos",
    byId: "scraper_get_reallifecamto_video_by_id",
  },
  hotscopesspygasm: {
    list: "scraper_get_hotscopesspygasm_videos",
    count: "scraper_count_hotscopesspygasm_videos",
    byId: "scraper_get_hotscopesspygasm_video_by_id",
  },
  hotscopesreallifecam: {
    list: "scraper_get_hotscopesreallifecam_videos",
    count: "scraper_count_hotscopesreallifecam_videos",
    byId: "scraper_get_hotscopesreallifecam_video_by_id",
  },
};

export function isVoyeurhouseSite(site: string | undefined): site is VoyeurhouseSite {
  return Boolean(site && (VOYEURHOUSE_SITES as readonly string[]).includes(site));
}

export type VoyeurhouseSortOption = "newest" | "views" | "rating" | "quality" | "oldest";

export interface UseVoyeurhouseVideosOptions {
  site?: VoyeurhouseSite;
  tag?: string;
  category?: string;
  search?: string;
  sort?: VoyeurhouseSortOption;
  limit?: number;
  page?: number;
}

export function useVoyeurhouseVideos(options: UseVoyeurhouseVideosOptions = {}) {
  const { site, tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);
  const queryKey = ["voyeurhouse-videos", { site, tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    enabled: Boolean(site),
    queryFn: async () => {
      if (!site) return { items: [] as VoyeurhouseVideo[], total: 0, page, totalPages: 0, limit };
      const sb = await getSupabase();
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim().toLowerCase() : null;
      const p_category =
        category && !["all", "voyeurhouse", site].includes(category.toLowerCase())
          ? category.trim().toLowerCase()
          : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const rpc =
        site === "voyeurhouseorg"
          ? {
              list: "scraper_get_voyeurhouse_videos",
              count: "scraper_count_voyeurhouse_videos",
            }
          : AVS_SITE_RPCS[site];
      const rpcParams = { p_source_site: site, p_tag, p_category, p_search };

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc(rpc.list, { ...rpcParams, p_sort: sort, p_limit: limit, p_offset: offset }),
        sb.rpc(rpc.count, rpcParams),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as VoyeurhouseVideo[]) || [];
      const items = Array.from(new Map(rawItems.map((v) => [v.id, v])).values());
      const total = Number(countResp.data || 0);
      return { items, total, page, totalPages: Math.ceil(total / limit), limit };
    },
    staleTime: 1000 * 60 * 3,
  });
}

export function useVoyeurhouseVideoById(site: VoyeurhouseSite | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["voyeurhouse-video-detail", site, id],
    enabled: Boolean(site && id),
    queryFn: async (): Promise<VoyeurhouseVideo | null> => {
      if (!site || !id) return null;
      const sb = await getSupabase();
      const rpc = site === "voyeurhouseorg" ? "scraper_get_voyeurhouse_video_by_id" : AVS_SITE_RPCS[site].byId;
      const { data, error } = await sb.rpc(rpc, { p_id: id });
      if (error) throw error;
      const list = (data as VoyeurhouseVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}
