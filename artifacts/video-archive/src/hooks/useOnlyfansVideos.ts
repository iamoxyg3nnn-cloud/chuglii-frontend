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
    headers?: Record<string, string>;
    [key: string]: any;
  };
}

export type OnlyfansSortOption = "newest" | "views" | "rating" | "quality" | "oldest";

export interface UseOnlyfansVideosOptions {
  tag?: string;
  category?: string;
  search?: string;
  sort?: OnlyfansSortOption;
  limit?: number;
  page?: number;
}

export function useOnlyfansVideos(options: UseOnlyfansVideosOptions = {}) {
  const { tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);

  const queryKey = ["onlyfans-videos", { tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim().toLowerCase() : null;
      const p_category = category && !["all", "onlyfans"].includes(category.toLowerCase()) ? category.trim().toLowerCase() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc("scraper_get_onlyfans_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
          p_sort: sort,
          p_limit: limit,
          p_offset: offset,
        }),
        sb.rpc("scraper_count_onlyfans_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
        }),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as OnlyfansVideo[]) || [];
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
    staleTime: 1000 * 60 * 3,
  });
}

export function useOnlyfansVideoById(id: string | undefined) {
  return useQuery({
    queryKey: ["onlyfans-video-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<OnlyfansVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_onlyfans_video_by_id", { p_id: id });
      if (error) throw error;
      const list = (data as OnlyfansVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useOnlyfansRelatedVideos(id: string | undefined, limit: number = 8) {
  return useQuery({
    queryKey: ["onlyfans-related-videos", id, limit],
    enabled: Boolean(id),
    queryFn: async (): Promise<OnlyfansVideo[]> => {
      if (!id) return [];
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_onlyfans_videos", {
        p_source_site: null,
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
