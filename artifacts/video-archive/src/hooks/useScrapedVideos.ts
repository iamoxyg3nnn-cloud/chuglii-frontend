import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

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

export type ScrapedSortOption = "newest" | "views" | "rating" | "longest" | "oldest";

export interface UseScrapedVideosOptions {
  tag?: string;
  category?: string;
  search?: string;
  sort?: ScrapedSortOption;
  limit?: number;
  page?: number;
}

export function useScrapedVideos(options: UseScrapedVideosOptions = {}) {
  const { tag, category, search, sort = "newest", limit = 24, page = 1 } = options;
  const offset = Math.max(0, (page - 1) * limit);

  const queryKey = ["scraped-videos", { tag, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      
      const p_tag = tag && tag !== "All" ? tag : null;
      const p_category = category && category !== "All" ? category : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      // Parallel fetch items and total count
      const [itemsResp, countResp] = await Promise.all([
        sb.rpc("scraper_get_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
          p_sort: sort,
          p_limit: limit,
          p_offset: offset,
        }),
        sb.rpc("scraper_count_videos", {
          p_source_site: null,
          p_tag,
          p_category,
          p_search,
        }),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const items = (itemsResp.data as ScrapedVideo[]) || [];
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

export function useScrapedVideoById(id: string | undefined) {
  return useQuery({
    queryKey: ["scraped-video-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ScrapedVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_video_by_id", { p_id: id });
      if (error) throw error;
      const list = (data as ScrapedVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}

export function useScrapedRelatedVideos(id: string | undefined, limit: number = 12) {
  return useQuery({
    queryKey: ["scraped-related-videos", id, limit],
    enabled: Boolean(id),
    queryFn: async (): Promise<ScrapedVideo[]> => {
      if (!id) return [];
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_related_videos", {
        p_video_id: id,
        p_limit: limit,
      });
      if (error) throw error;
      return (data as ScrapedVideo[]) || [];
    },
    staleTime: 1000 * 60 * 10,
  });
}
