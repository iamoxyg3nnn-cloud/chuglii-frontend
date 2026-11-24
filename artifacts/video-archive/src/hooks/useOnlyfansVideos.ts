import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

export interface OnlyfansVideo {
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
  quality_label: string | null;
  quality_score: number | null;
  tags: string[];
  categories: string[];
  actors: string[];
  published_at: string | null;
  scraped_at: string;
  raw_payload?: {
    source_site?: string;
    source?: string;
    model?: string;
    models?: string[];
    servers?: Array<{
      name?: string;
      server?: string;
      embed_url?: string;
      url?: string;
      type?: string;
      quality_score?: number;
      quality_label?: string;
      headers?: Record<string, string>;
    }>;
    mirrors?: Array<{
      server?: string;
      name?: string;
      url?: string;
      embed_url?: string;
      quality_score?: number;
      quality_label?: string;
    }>;
    screenshots?: string[];
    gallery?: string[];
    headers?: Record<string, string>;
    [key: string]: any;
  };
}

export type OnlyfansSortOption = "newest" | "views" | "rating" | "quality" | "oldest";
export const ONLYFANS_SITES = ["internetchicks", "influencersgonewild", "sheeshfans"] as const;
export type OnlyfansSite = (typeof ONLYFANS_SITES)[number];

export const ONLYFANS_SITE_LABELS: Record<OnlyfansSite, string> = {
  internetchicks: "Internet Chicks",
  influencersgonewild: "Influencers Gone Wild",
  sheeshfans: "SheeshFans",
};

export function isOnlyfansSite(site: string | undefined): site is OnlyfansSite {
  return Boolean(site && (ONLYFANS_SITES as readonly string[]).includes(site));
}

export interface UseOnlyfansVideosOptions {
  site?: OnlyfansSite;
  tag?: string;
  category?: string;
  search?: string;
  sort?: OnlyfansSortOption;
  limit?: number;
  page?: number;
}

export function useOnlyfansVideos(options: UseOnlyfansVideosOptions = {}) {
  const { site, tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);

  const queryKey = ["onlyfans-videos", { site, tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    enabled: Boolean(site),
    queryFn: async () => {
      if (!site) return { items: [], total: 0, page, totalPages: 0, limit };
      const sb = await getSupabase();
      
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim().toLowerCase() : null;
      const p_category = category && !["all", "onlyfans"].includes(category.toLowerCase()) ? category.trim().toLowerCase() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      // Use canonical OnlyFans RPCs with per-site isolation.
      const [itemsResp, countResp] = await Promise.all([
        sb.rpc(`scraper_get_onlyfans_videos`, {
          p_source_site: site,
          p_tag,
          p_category,
          p_search,
          p_sort: sort,
          p_limit: limit,
          p_offset: offset,
        }),
        sb.rpc(`scraper_count_onlyfans_videos`, {
          p_source_site: site,
          p_tag,
          p_category,
          p_search,
        }),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as OnlyfansVideo[]) || [];
      const total = Number(countResp.data || 0);
      const totalPages = Math.ceil(total / limit);

      return {
        items: rawItems,
        total,
        page,
        totalPages,
        limit,
      };
    },
    staleTime: 1000 * 60 * 3,
  });
}

export function useOnlyfansVideoById(site: OnlyfansSite | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ["onlyfans-video-detail", site, id],
    enabled: Boolean(site && id),
    queryFn: async (): Promise<OnlyfansVideo | null> => {
      if (!site || !id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc(`scraper_get_onlyfans_video_by_id`, { p_id: id });
      if (error) throw error;
      const list = (data as OnlyfansVideo[]) || [];
      const match = list.find((v) => !site || v.source_site === site) || list[0] || null;
      return match;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useOnlyfansRelatedVideos(site: OnlyfansSite | undefined, id: string | undefined, limit: number = 8) {
  return useQuery({
    queryKey: ["onlyfans-related-videos", site, id, limit],
    enabled: Boolean(site && id),
    queryFn: async (): Promise<OnlyfansVideo[]> => {
      if (!site || !id) return [];
      const sb = await getSupabase();
      const { data, error } = await sb.rpc(`scraper_get_onlyfans_videos`, {
        p_source_site: site,
        p_tag: null,
        p_category: null,
        p_search: null,
        p_sort: "newest",
        p_limit: limit,
        p_offset: 0,
      });
      if (error) throw error;
      return ((data as OnlyfansVideo[]) || []).filter((v) => v.id !== id);
    },
    staleTime: 1000 * 60 * 10,
  });
}
