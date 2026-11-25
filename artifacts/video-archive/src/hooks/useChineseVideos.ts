import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";

export interface ChineseVideo {
  id: string;
  source_site: string;
  source_post_id: string;
  content_type: "video" | "torrent";
  title: string;
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
  category_id: string | null;
  category_name_cn: string | null;
  category_name_en: string | null;
  category_group: string | null;
  magnet_uri: string | null;
  magnet_hash: string | null;
  torrent_file_url: string | null;
  size_label: string | null;
  resolution: string | null;
  cdn_endpoints: Array<{ name?: string; url: string }>;
  screenshots: string[];
  tags: string[];
  categories: string[];
  status: string;
  published_at: string | null;
  scraped_at: string;
  raw_payload?: Record<string, unknown>;
}

/** Coarse website-browse groups inside the isolated chinese table.
 *  JAV and livestream zones are excluded from the scraper and the UI. */
export const CHINESE_GROUPS = ["chinese", "western"] as const;
export type ChineseGroup = (typeof CHINESE_GROUPS)[number];

/** Source-site zones (subcategories). Mirrors scraper categories.py — each zone
 *  is isolated by its own category_id in scraper.chinese_videos. */
export const CHINESE_ZONES = [
  { id: "20110496", en: "Chinese Premium", cn: "国产精品", group: "chinese", contentType: "video" },
  { id: "20030496", en: "Chinese Studios", cn: "国产传媒", group: "chinese", contentType: "video" },
  { id: "20040496", en: "Tanhua Escorts", cn: "外围探花", group: "chinese", contentType: "video" },
  { id: "20050496", en: "Master Works", cn: "大神作品", group: "chinese", contentType: "video" },
  { id: "20090496", en: "Web Goddesses", cn: "网黄女神", group: "chinese", contentType: "video" },
  { id: "20100496", en: "Housewives", cn: "良家人妻", group: "chinese", contentType: "video" },
  { id: "20060496", en: "Wife Swapping", cn: "夫妻交换", group: "chinese", contentType: "video" },
  { id: "20080496", en: "Cuckold", cn: "绿帽淫妻", group: "chinese", contentType: "video" },
  { id: "20120496", en: "Incest", cn: "近亲乱伦", group: "chinese", contentType: "video" },
  { id: "20010496", en: "Rape", cn: "强奸迷奸", group: "chinese", contentType: "video" },
  { id: "20020496", en: "Asian BBC", cn: "亚洲媚黑", group: "chinese", contentType: "video" },
  { id: "20140496", en: "HK-TW Classic", cn: "港台三级", group: "chinese", contentType: "video" },
  { id: "20150496", en: "Couple Leaks", cn: "情侣泄密", group: "chinese", contentType: "video" },
  { id: "20160496", en: "Bathroom Spy", cn: "浴室偷拍", group: "chinese", contentType: "video" },
  { id: "20170496", en: "Hotel Spy", cn: "酒店偷拍", group: "chinese", contentType: "video" },
  { id: "20180496", en: "Massage", cn: "女性按摩", group: "chinese", contentType: "video" },
  { id: "20190496", en: "Street Snap", cn: "街拍抄底", group: "chinese", contentType: "video" },
  { id: "20200496", en: "Home Cam", cn: "家庭监控", group: "chinese", contentType: "video" },
  { id: "20210496", en: "Erotic Dance", cn: "激情艳舞", group: "chinese", contentType: "video" },
  { id: "20220496", en: "Model Shoots", cn: "模特私拍", group: "chinese", contentType: "video" },
  { id: "20230496", en: "Nude Loans", cn: "裸贷裸条", group: "chinese", contentType: "video" },
  { id: "20240496", en: "BDSM", cn: "字母调教", group: "chinese", contentType: "video" },
  { id: "20250496", en: "Bondage", cn: "捆绑绳艺", group: "chinese", contentType: "video" },
  { id: "20260496", en: "Extreme", cn: "变态重口", group: "chinese", contentType: "video" },
  { id: "20270496", en: "Exhibition", cn: "户外露出", group: "chinese", contentType: "video" },
  { id: "20380496", en: "Influencer Leaks", cn: "网红流出", group: "chinese", contentType: "video" },
  { id: "20400496", en: "Fuliji", cn: "ｘ福利姬", group: "chinese", contentType: "video" },
  { id: "20390496", en: "Sugar Daddy", cn: "金主定制", group: "chinese", contentType: "video" },
  { id: "20350496", en: "Stockings Feet", cn: "丝足诱惑", group: "chinese", contentType: "video" },
  { id: "20370496", en: "Hentai", cn: "成人动漫", group: "chinese", contentType: "video" },
  { id: "20340496", en: "Trans", cn: "TSCD变性", group: "chinese", contentType: "video" },
  { id: "20360496", en: "Toilet Spy", cn: "厕拍偷拍", group: "chinese", contentType: "video" },
  { id: "19920497", en: "Chinese Magnet", cn: "国产专区", group: "chinese", contentType: "torrent" },
  { id: "19960497", en: "Studio Magnet", cn: "传媒作品", group: "chinese", contentType: "torrent" },
  { id: "19980497", en: "Web Goddesses Magnet", cn: "网黄女神", group: "chinese", contentType: "torrent" },
  { id: "19990497", en: "Cuckold Magnet", cn: "绿帽淫妻", group: "chinese", contentType: "torrent" },
  { id: "19950497", en: "Western Magnet", cn: "欧美色情", group: "western", contentType: "torrent" },
] as const;

export const CHINESE_GROUP_LABELS: Record<ChineseGroup, string> = {
  chinese: "Chinese",
  western: "Western",
};

export function isChineseGroup(group: string | undefined): group is ChineseGroup {
  return Boolean(group && (CHINESE_GROUPS as readonly string[]).includes(group));
}

export type ChineseSortOption = "newest" | "oldest" | "quality";

export interface UseChineseVideosOptions {
  group?: ChineseGroup;
  contentType?: "video" | "torrent";
  category?: string;
  search?: string;
  sort?: ChineseSortOption;
  limit?: number;
  page?: number;
}

/**
 * Isolated Chinese category adapter — queries ONLY scraper.chinese_videos via
 * its own RPC family. No union/cross-category reads, mirroring the OnlyFans /
 * Voyeur House layout.
 */
export function useChineseVideos(options: UseChineseVideosOptions = {}) {
  const {
    group,
    contentType,
    category,
    search,
    sort = "newest",
    limit = 24,
    page = 1,
  } = options;
  const offset = Math.max(0, (page - 1) * limit);
  const queryKey = ["chinese-videos", { group, contentType, category, search, sort, limit, page }];

  return useQuery({
    queryKey,
    queryFn: async () => {
      const sb = await getSupabase();
      const p_group = group && group.toLowerCase() !== "all" ? group.trim().toLowerCase() : null;
      const p_content_type =
        contentType && contentType.toLowerCase() !== "all" ? contentType.trim().toLowerCase() : null;
      const p_category =
        category && category.toLowerCase() !== "all" ? category.trim() : null;
      const p_search = search && search.trim().length > 0 ? search.trim() : null;

      const rpcParams = {
        p_source_site: null,
        p_content_type,
        p_category,
        p_tag: null,
        p_search,
        p_group,
      };

      const [itemsResp, countResp] = await Promise.all([
        sb.rpc("scraper_get_chinese_videos", { ...rpcParams, p_sort: sort, p_limit: limit, p_offset: offset }),
        sb.rpc("scraper_count_chinese_videos", rpcParams),
      ]);

      if (itemsResp.error) throw itemsResp.error;
      if (countResp.error) throw countResp.error;

      const rawItems = (itemsResp.data as ChineseVideo[]) || [];
      const items = Array.from(new Map(rawItems.map((v) => [v.id, v])).values());
      const total = Number(countResp.data || 0);
      return { items, total, page, totalPages: Math.ceil(total / limit), limit };
    },
    staleTime: 1000 * 60 * 3,
  });
}

export function useChineseVideoById(id: string | undefined) {
  return useQuery({
    queryKey: ["chinese-video-detail", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ChineseVideo | null> => {
      if (!id) return null;
      const sb = await getSupabase();
      const { data, error } = await sb.rpc("scraper_get_chinese_video_by_id", { p_id: id });
      if (error) throw error;
      const list = (data as ChineseVideo[]) || [];
      return list.length > 0 ? list[0] : null;
    },
    staleTime: 1000 * 60 * 10,
  });
}
