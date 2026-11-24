import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { rankRelatedVideos } from "@/lib/recommendations";

export interface MyanmarVideo {
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
  raw_payload?: {
    source?: string;
    relative_time?: string;
    original_title?: string;
    detail_url?: string;
    stream_url?: string;
    servers?: Array<{ name: string; embed_url: string }>;
  };
}

export type MyanmarSortOption = "newest" | "views" | "rating" | "longest" | "oldest";

export interface UseMyanmarVideosOptions {
  tag?: string;
  category?: string;
  search?: string;
  sort?: MyanmarSortOption;
  limit?: number;
  page?: number;
}

export function useMyanmarVideos(options: UseMyanmarVideosOptions = {}) {
  const { tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);

  const queryKey = ["myanmar-videos", { tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim().toLowerCase() : null;
      const p_category = category && !["all", "myanmar"].includes(category.toLowerCase()) ? category.trim().toLowerCase() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc("scraper_get_myanmar_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
          p_sort: sort,
          p_limit: limit,
          p_offset: offset,
        }),
        sb.rpc("scraper_count_myanmar_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
        }),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as MyanmarVideo[]) || [];
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

export function useMyanmarVideoById(id: string | undefined) {
  return useQuery({
    queryKey: ["myanmar-video-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<MyanmarVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_myanmar_video_by_id", { p_id: id });
      if (error) throw error;
      const list = (data as MyanmarVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useMyanmarRelatedVideos(
  id: string | undefined,
  current: MyanmarVideo | null | undefined,
  limit: number = 8,
) {
  return useQuery({
    queryKey: ["myanmar-related-videos", id, current?.id, limit],
    enabled: Boolean(id && current),
    queryFn: async (): Promise<MyanmarVideo[]> => {
      if (!id) return [];
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_myanmar_related_videos", {
        p_video_id: id,
        p_limit: Math.max(limit * 3, 24),
      });
      if (error) throw error;
      const pool = (data as MyanmarVideo[]) || [];
      return current ? rankRelatedVideos(current, pool, limit) : pool.slice(0, limit);
    },
    staleTime: 1000 * 60 * 10,
  });
}
