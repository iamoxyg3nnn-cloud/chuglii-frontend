import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { rankRelatedVideos } from "@/lib/recommendations";

export interface ScrapedVideo {
  id: string;
  source_site: string;
  source_post_id: string;
  title: string;
  slug: string;
  detail_url: string;
  full_video_url: string | null;
  video_mime_type: string;
  trailer_preview_url: string | null;
  thumbnail_url: string | null;
  clean_thumbnail_url: string | null;
  duration_formatted: string | null;
  duration_seconds: number | null;
  views_count: number;
  views_raw: string | null;
  rating_score: number | null;
  rating_raw: string | null;
  tags: string[];
  categories: string[];
  actors: string[];
  published_at: string | null;
  scraped_at: string;
  raw_payload?: Record<string, any> | null;
}

export const VIRAL_MMS_SITES = [
  "mmsvibex",
  "spicymms",
  "desi49",
  "mydesi",
  "indianbfclips",
] as const;
export type ViralMmsSite = (typeof VIRAL_MMS_SITES)[number];

export const VIRAL_MMS_SITE_LABELS: Record<ViralMmsSite, string> = {
  mmsvibex: "MMSVibeX",
  spicymms: "SpicyMMS",
  desi49: "Desi49",
  mydesi: "MyDesi",
  indianbfclips: "IndianBFClips",
};

export function isViralMmsSite(site: string | undefined): site is ViralMmsSite {
  return Boolean(site && (VIRAL_MMS_SITES as readonly string[]).includes(site));
}

type IsolatedViralSite = Exclude<ViralMmsSite, "mmsvibex">;

const VIRAL_SITE_RPCS: Record<
  IsolatedViralSite,
  { list: string; count: string; byId: string }
> = {
  spicymms: {
    list: "scraper_get_spicymms_videos",
    count: "scraper_count_spicymms_videos",
    byId: "scraper_get_spicymms_video_by_id",
  },
  desi49: {
    list: "scraper_get_desi49_videos",
    count: "scraper_count_desi49_videos",
    byId: "scraper_get_desi49_video_by_id",
  },
  mydesi: {
    list: "scraper_get_mydesi_videos",
    count: "scraper_count_mydesi_videos",
    byId: "scraper_get_mydesi_video_by_id",
  },
  indianbfclips: {
    list: "scraper_get_indianbfclips_videos",
    count: "scraper_count_indianbfclips_videos",
    byId: "scraper_get_indianbfclips_video_by_id",
  },
};

export type ScrapedSortOption = "newest" | "views" | "rating" | "longest" | "oldest";

export interface UseScrapedVideosOptions {
  site?: ViralMmsSite;
  tag?: string;
  category?: string;
  search?: string;
  sort?: ScrapedSortOption;
  limit?: number;
  page?: number;
}

export function useScrapedVideos(options: UseScrapedVideosOptions = {}) {
  const { site = "mmsvibex", tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);

  const queryKey = ["scraped-videos", { site, tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();

      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim().toLowerCase() : null;
      const p_category =
        category && !["all", "viral-mms"].includes(category.toLowerCase())
          ? category.trim().toLowerCase()
          : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const rpcs =
        site === "mmsvibex"
          ? { list: "scraper_get_videos", count: "scraper_count_videos" }
          : VIRAL_SITE_RPCS[site];
      const p_source_site = site === "mmsvibex" ? null : site;

      // Parallel fetch items and total count
      const [itemsResp, countResp] = await Promise.all([
        sb.rpc(rpcs.list, {
          p_source_site,
          p_tag,
          p_category,
          p_search,
          p_sort: sort,
          p_limit: limit,
          p_offset: offset,
        }),
        sb.rpc(rpcs.count, {
          p_source_site,
          p_tag,
          p_category,
          p_search,
        }),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as ScrapedVideo[]) || [];
      const items = Array.from(new Map(rawItems.map((v) => [v.id, v])).values());
      const total = Number(countResp.data || 0);
      const totalPages = Math.ceil(total / limit);

      return {
        items,
        total,
        page,
        totalPages,
        limit,
      };
    },
    staleTime: 1000 * 60 * 3, // 3 minutes cache
  });
}

export function useScrapedVideoById(id: string | undefined, site: ViralMmsSite = "mmsvibex") {
  return useQuery({
    queryKey: ["scraped-video-detail", site, id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ScrapedVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const rpcName = site === "mmsvibex" ? "scraper_get_video_by_id" : VIRAL_SITE_RPCS[site].byId;
      const { data, error } = await sb.rpc(rpcName, { p_id: id });
      if (error) throw error;
      const list = (data as ScrapedVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useScrapedRelatedVideos(
  id: string | undefined,
  current: ScrapedVideo | null | undefined,
  limit: number = 12,
  site: ViralMmsSite = "mmsvibex",
) {
  return useQuery({
    queryKey: ["scraped-related-videos", site, id, current?.id, limit],
    enabled: Boolean(id && current),
    queryFn: async (): Promise<ScrapedVideo[]> => {
      if (!id) return [];
      const sb = await getSupabase();
      if (site === "mmsvibex") {
        const { data, error } = await sb.rpc("scraper_get_related_videos", {
          p_video_id: id,
          p_limit: Math.max(limit * 3, 24),
        });
        if (error) throw error;
        const pool = (data as ScrapedVideo[]) || [];
        return current ? rankRelatedVideos(current, pool, limit) : pool.slice(0, limit);
      }

      const { data, error } = await sb.rpc(VIRAL_SITE_RPCS[site].list, {
        p_source_site: site,
        p_tag: null,
        p_category: null,
        p_search: null,
        p_sort: "newest",
        p_limit: Math.max(limit * 3, 32),
        p_offset: 0,
      });
      if (error) throw error;
      const pool = (data as ScrapedVideo[]) || [];
      return current ? rankRelatedVideos(current, pool, limit) : pool.slice(0, limit);
    },
    staleTime: 1000 * 60 * 10,
  });
}
