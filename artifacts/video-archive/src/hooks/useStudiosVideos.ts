import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

export interface StudiosVideo {
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
export function studiosDisplayTitle(video: Pick<StudiosVideo, "title" | "title_en">): string {
  const en = (video.title_en || "").trim();
  return en || video.title;
}

/** Source sites in the studios family. Each site has its OWN isolated table
 *  and RPC family (scraper_*_madouer_videos / scraper_*_dasj91_videos) and is
 *  listed in the Chinese category site picker (fangsung pattern). Mirrors
 *  scraper/categories/studios/categories.py SITES. */
export const STUDIO_SITES = [
  { site: "madouer", label: "Madou", enabled: true },
  { site: "dasj91", label: "91 Dasj", enabled: true },
  { site: "madouhd", label: "Madou HD", enabled: false },
] as const;

/** Site sections crawled from madouer.cc (whitelisted MacCMS type ids).
 *  Mirrors scraper/categories/studios/categories.py MADOUER_TYPES. JAV
 *  sections (23–27) and type 20 (萝莉社) are excluded at the source. */
export const MADOUER_SECTIONS = [
  { id: "1", cn: "麻豆视频", en: "Madou Videos" },
  { id: "2", cn: "日本视频", en: "Japanese Videos" },
  { id: "3", cn: "欧美视频", en: "Western Videos" },
  { id: "4", cn: "动漫视频", en: "Anime Videos" },
  { id: "5", cn: "国产视频", en: "Chinese Amateur" },
  { id: "6", cn: "麻豆原创", en: "Madou Original" },
  { id: "7", cn: "91制片厂", en: "91 Studio" },
  { id: "8", cn: "天美传媒", en: "Tianmei Media" },
  { id: "9", cn: "蜜桃影像", en: "Peach Images" },
  { id: "10", cn: "星空传媒", en: "Starlight Media" },
  { id: "11", cn: "皇家华人", en: "Royal Chinese" },
  { id: "12", cn: "精东影业", en: "Jingdong Studio" },
  { id: "13", cn: "乐播传媒", en: "Lebo Media" },
  { id: "14", cn: "成人头条", en: "Adult Headlines" },
  { id: "15", cn: "兔子先生", en: "Mr. Rabbit" },
  { id: "16", cn: "杏吧原创", en: "Xingba Original" },
  { id: "17", cn: "玩偶姐姐", en: "HongKongDoll" },
  { id: "18", cn: "糖心Vlog", en: "Tangxin Vlog" },
  { id: "22", cn: "华语原创", en: "Chinese Original" },
  { id: "31", cn: "推特女神", en: "Twitter Girls" },
  { id: "32", cn: "国产系列", en: "Chinese Series" },
] as const;

/** 91dasj.com zones crawled (whitelisted slugs). Mirrors
 *  scraper/categories/studios/categories.py DASJ91_CATEGORIES. All 吃瓜
 *  (real-person leak) zones, 学生校园 and 每日大赛 are excluded at the source. */
export const DASJ91_SECTIONS = [
  { id: "aifl", cn: "AI短剧", en: "AI Dramas" },
  { id: "rmbg", cn: "反差女神", en: "Contrast Goddess" },
  { id: "jxth", cn: "探花大神", en: "Tanhua Masters" },
  { id: "ldcz", cn: "绿帽磁场", en: "Cuckold Stories" },
  { id: "qwys", cn: "伦理猎奇", en: "Taboo Drama" },
] as const;

export type StudiosSortOption = "newest" | "oldest" | "quality";

export interface UseStudiosVideosOptions {
  site?: string;
  category?: string;
  tag?: string;
  search?: string;
  sort?: StudiosSortOption;
  limit?: number;
  page?: number;
}

/**
 * Isolated studios category adapter — queries ONLY scraper.studios_videos
 * via its own RPC family. No union/cross-category reads.
 */
export function useStudiosVideos(options: UseStudiosVideosOptions = {}) {
  const {
    site,
    category,
    tag,
    search,
    sort = "newest",
    limit = 24,
    page = 1,
  } = options;
  const offset = Math.max(0, (page - 1) * limit);
  const queryKey = ["studios-videos", { site, category, tag, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      const p_category =
        category && category.toLowerCase() !== "all" ? category.trim() : null;
      const p_tag = tag && tag.toLowerCase() !== "all" ? tag.trim() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const rpcParams = {
        p_category,
        p_tag,
        p_search,
      };

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc(`scraper_get_${site}_videos`, { ...rpcParams, p_sort: sort, p_limit: limit, p_offset: offset }),
        sb.rpc(`scraper_count_${site}_videos`, rpcParams),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as StudiosVideo[]) || [];
      const items = Array.from(new Map(rawItems.map((v) => [v.id, v])).values());
      const total = Number(countResp.data || 0);
      return { items, total, page, totalPages: Math.ceil(total / limit), limit };
    },
    staleTime: 1000 * 60 * 3,
  });
}

export function useStudiosVideoById(id: string | undefined, site: string = "madouer") {
  return useQuery({
    queryKey: ["studios-video-detail", site, id],
    enabled: Boolean(id),
    queryFn: async (): Promise<StudiosVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc(`scraper_get_${site}_video_by_id`, { p_id: id });
      if (error) throw error;
      const list = (data as StudiosVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}
