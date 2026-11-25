import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

export interface FangsungVideo {
  id: string;
  source_site: string;
  source_post_id: string;
  content_type: "video";
  title: string;
  /** Google-translated English title (may be null for legacy rows). */
  title_en?: string | null;
  slug: string | null;
  detail_url: string;
  full_video_url: string | null;
  video_mime_type: string | null;
  thumbnail_url: string | null;
  clean_thumbnail_url: string | null;
  quality_label: string | null;
  quality_score: number | null;
  duration_formatted: string | null;
  duration_seconds: number | null;
  region: string | null;
  region_en: string | null;
  resolution: string | null;
  tags: string[];
  categories: string[];
  status: string;
  published_at: string | null;
  scraped_at: string;
  raw_payload?: Record<string, unknown>;
}

/** English-first display title: falls back to the original CJK title when a
 *  row has no translation yet. */
export function fangsungDisplayTitle(video: Pick<FangsungVideo, "title" | "title_en">): string {
  const en = (video.title_en || "").trim();
  return en || video.title;
}

/** Region terms crawled from www.fangsung.com (search-term categories).
 *  Mirrors scraper/categories/fangsung/categories.py. */
export const FANGSUNG_REGIONS = [
  { term: "日本AV", en: "Japanese AV" },
  { term: "台湾", en: "Taiwanese" },
  { term: "中国AV", en: "Chinese AV" },
  { term: "国产", en: "Chinese Domestic" },
  { term: "欧美", en: "Western" },
  { term: "韩国", en: "Korean" },
  { term: "香港", en: "Hong Kong" },
  { term: "泰国", en: "Thai" },
  { term: "越南", en: "Vietnamese" },
  { term: "大陆", en: "Mainland" },
] as const;

export type FangsungSortOption = "newest" | "oldest" | "quality";

export interface UseFangsungVideosOptions {
  category?: string;
  tag?: string;
  search?: string;
  sort?: FangsungSortOption;
  limit?: number;
  page?: number;
}

/**
 * Isolated fangsung category adapter — queries ONLY scraper.fangsung_videos
 * via its own RPC family. No union/cross-category reads.
 */
export function useFangsungVideos(options: UseFangsungVideosOptions = {}) {
  const {
    category,
    tag,
    search,
    sort = "newest",
    limit = 24,
    page = 1,
  } = options;
  const offset = Math.max(0, (page - 1) * limit);
  const queryKey = ["fangsung-videos", { category, tag, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      const p_category =
        category && category.toLowerCase() !== "all" ? category.trim() : null;
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const rpcParams = {
        p_source_site: null,
        p_content_type: null,
        p_category,
        p_tag,
        p_search,
      };

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc("scraper_get_fangsung_videos", { ...rpcParams, p_sort: sort, p_limit: limit, p_offset: offset }),
        sb.rpc("scraper_count_fangsung_videos", rpcParams),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as FangsungVideo[]) || [];
      const items = Array.from(new Map(rawItems.map((v) => [v.id, v])).values());
      const total = Number(countResp.data || 0);
      return { items, total, page, totalPages: Math.ceil(total / limit), limit };
    },
    staleTime: 1000 * 60 * 3,
  });
}

export function useFangsungVideoById(id: string | undefined) {
  return useQuery({
    queryKey: ["fangsung-video-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<FangsungVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_fangsung_video_by_id", { p_id: id });
      if (error) throw error;
      const list = (data as FangsungVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}
