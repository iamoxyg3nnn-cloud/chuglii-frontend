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
  { site: "madouhd", label: "Madou HD", enabled: true },
] as const;

/** Site sections crawled from madouer.cc (whitelisted MacCMS type ids).
 *  Mirrors scraper/categories/studios/categories.py MADOUER_TYPES. JAV
 *  sections (23–27) and type 20 (萝莉社) are excluded at the source. */
export const MADOUER_SECTIONS = [
  { id: "1", cn: "麻豆视频", en: "Madou Videos" },
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

/** Site sections crawled from madouhd.cc (full-site allowlist minus
 *  policy exclusions: real-person leaks/NCII, scat, gore, douyin
 *  reuploads, and the sitewide superset cate35). Mirrors
 *  scraper/categories/studios/categories.py MADOUHD_CATEGORIES. */
export const MADOUHD_SECTIONS = [
  { id: "cate3", cn: "真实乱伦", en: "Taboo Drama" },
  { id: "cate4", cn: "自慰喷水", en: "Solo & Squirting" },
  { id: "cate5", cn: "巨乳肥臀", en: "Busty & Curvy" },
  { id: "cate6", cn: "嫩穴白虎", en: "Smooth & Tight" },
  { id: "cate8", cn: "扫街探店", en: "Street Pickup" },
  { id: "cate11", cn: "制服诱惑", en: "Uniform Temptation" },
  { id: "cate12", cn: "媚黑淫女", en: "Interracial" },
  { id: "cate13", cn: "sm调教", en: "BDSM" },
  { id: "cate14", cn: "美女主播", en: "Cam Girls" },
  { id: "cate15", cn: "绿帽换妻", en: "Cuckold & Swinging" },
  { id: "cate17", cn: "明星淫梦", en: "Celebrity Dreams" },
  { id: "cate18", cn: "男同/女同", en: "LGBT" },
  { id: "cate19", cn: "成人综艺", en: "Adult Variety" },
  { id: "cate20", cn: "足交口交", en: "Footjob & Oral" },
  { id: "cate21", cn: "勾引搭讪", en: "Pickup & Seduction" },
  { id: "cate22", cn: "AV女优", en: "JAV Actresses" },
  { id: "cate23", cn: "户外野战", en: "Outdoor" },
  { id: "cate24", cn: "颅内高潮", en: "Mindgasm" },
  { id: "cate26", cn: "淫语歌曲", en: "Erotic Songs" },
  { id: "cate28", cn: "Cosplay", en: "Cosplay" },
  { id: "cate29", cn: "VR影片", en: "VR Films" },
  { id: "cate30", cn: "18禁三级", en: "Softcore III" },
  { id: "cate31", cn: "伪娘人妖", en: "Femboy & Ladyboy" },
  { id: "cate36", cn: "kittyxkum", en: "kittyxkum" },
  { id: "cate37", cn: "桥本香菜", en: "Hashimoto Kana" },
  { id: "cate38", cn: "玩偶姐姐", en: "Doll Sister" },
  { id: "cate39", cn: "懒懒睡不醒", en: "Lazy Sleepy" },
  { id: "cate40", cn: "Yui+Peachpie", en: "Yui & Peachpie" },
  { id: "cate41", cn: "网红-辛尤里", en: "Xin Yuli" },
  { id: "cate42", cn: "女神多乙", en: "Duo Yi" },
  { id: "cate43", cn: "网红司雨", en: "Si Yu" },
  { id: "cate44", cn: "台北娜娜", en: "Taipei Nana" },
  { id: "cate45", cn: "唐伯虎", en: "Tang Bohu" },
  { id: "cate46", cn: "Cola酱", en: "Cola Jiang" },
  { id: "cate47", cn: "荡女刘玥", en: "Liu Yue" },
  { id: "cate48", cn: "饼干姐姐", en: "Cookie Sister" },
  { id: "cate49", cn: "Daisybaby", en: "Daisybaby" },
  { id: "cate50", cn: "奶咪", en: "Naimi" },
  { id: "cate51", cn: "ChineseBunny", en: "ChineseBunny" },
  { id: "cate52", cn: "芋圆呀呀", en: "Yuyu Yaya" },
  { id: "cate53", cn: "高清JVID", en: "JVID HD" },
  { id: "cate55", cn: "精品AV", en: "Premium AV" },
  { id: "cate56", cn: "无码AV", en: "Uncensored AV" },
  { id: "cate57", cn: "无码流出", en: "Uncensored Leaks" },
  { id: "cate58", cn: "中文字幕", en: "Chinese Subtitles" },
  { id: "cate59", cn: "家庭乱伦", en: "Family Taboo" },
  { id: "cate60", cn: "少女嫩妹", en: "Young Girls" },
  { id: "cate61", cn: "职场制服", en: "Office Uniform" },
  { id: "cate62", cn: "巨乳诱惑", en: "Busty Temptation" },
  { id: "cate63", cn: "母乳孕妇", en: "Lactating & Pregnant" },
  { id: "cate64", cn: "强制寝取NTR", en: "NTR" },
  { id: "cate65", cn: "SM调教", en: "SM Training" },
  { id: "cate66", cn: "水果Π-电影解说", en: "Movie Commentary" },
  { id: "cate68", cn: "轻S-调教反差", en: "Light SM" },
  { id: "cate69", cn: "拳交-肛交", en: "Fisting & Anal" },
  { id: "cate70", cn: "同性-女调女", en: "Lesbian" },
  { id: "cate73", cn: "SM-虐肛", en: "SM Rough" },
  { id: "cate74", cn: "SM-虐阴", en: "SM Torment" },
  { id: "cate75", cn: "SM-虐待", en: "SM Abuse" },
  { id: "cate76", cn: "SM-捆绑", en: "SM Bondage" },
  { id: "cate77", cn: "福利大全", en: "Free-for-all" },
  { id: "cate79", cn: "国产精品", en: "Chinese Premium" },
  { id: "cate80", cn: "麻豆出品", en: "Madou Originals" },
  { id: "cate81", cn: "糖心Vlog", en: "Tangxin Vlog" },
  { id: "cate82", cn: "茄子视频", en: "Eggplant Video" },
  { id: "cate83", cn: "性视界", en: "Sex Vision" },
  { id: "cate84", cn: "香蕉视频", en: "Banana Video" },
  { id: "cate85", cn: "乌托邦", en: "Utopia" },
  { id: "cate86", cn: "星空无限传媒", en: "Starlight Media" },
  { id: "cate87", cn: "快播原创", en: "Kuaibo Original" },
  { id: "cate88", cn: "皇家华人", en: "Royal Chinese" },
  { id: "cate89", cn: "精东影业", en: "Jingdong Pictures" },
  { id: "cate90", cn: "蜜桃影像", en: "Peach Pictures" },
  { id: "cate91", cn: "果冻传媒", en: "Jelly Media" },
  { id: "cate92", cn: "91制片厂", en: "Studio 91" },
  { id: "cate93", cn: "天美传媒", en: "Tianmei Media" },
  { id: "cate94", cn: "爱豆传媒", en: "Aidou Media" },
  { id: "cate95", cn: "兔子先生", en: "Mr. Rabbit" },
  { id: "cate97", cn: "扣扣传媒", en: "Koukou Media" },
  { id: "cate98", cn: "杏吧原创", en: "Xingba Original" },
  { id: "cate99", cn: "SA国际传媒", en: "SA International" },
  { id: "cate101", cn: "兄妹相爱", en: "Siblings" },
  { id: "cate102", cn: "偷腥嫂子", en: "Cheating Sister-in-law" },
  { id: "cate103", cn: "偷欢小姨", en: "Naughty Aunt" },
  { id: "cate104", cn: "师生乱伦", en: "Teacher & Student" },
  { id: "cate105", cn: "全家乱P", en: "Family Swap" },
  { id: "cate106", cn: "母子通奸", en: "Mother & Son" },
  { id: "cate107", cn: "舅侄畸恋", en: "Uncle & Niece" },
  { id: "cate108", cn: "姐弟情深", en: "Sister & Brother" },
  { id: "cate109", cn: "父女忌恋", en: "Father & Daughter" },
  { id: "cate110", cn: "儿媳诱惑", en: "Daughter-in-law" },
  { id: "cate111", cn: "最爱岳母", en: "Mother-in-law" },
  { id: "cate113", cn: "Pinkloving", en: "Pinkloving" },
  { id: "cate114", cn: "Leah+Meow", en: "Leah & Meow" },
  { id: "cate115", cn: "MollyRedWolf", en: "MollyRedWolf" },
  { id: "cate116", cn: "Sia Siberia", en: "Sia Siberia" },
  { id: "cate117", cn: "Zirael+Rem", en: "Zirael & Rem" },
  { id: "cate118", cn: "Deluxe Bitch's", en: "Deluxe Bitch" },
  { id: "cate119", cn: "Candy Love", en: "Candy Love" },
  { id: "cate120", cn: "Purple Bitch", en: "Purple Bitch" },
  { id: "cate121", cn: "Rosie rider's", en: "Rosie Rider" },
  { id: "cate122", cn: "SweetieFox", en: "SweetieFox" },
  { id: "cate123", cn: "FantasyBabe's", en: "FantasyBabe" },
  { id: "cate124", cn: "MyAnny's", en: "MyAnny" },
  { id: "cate125", cn: "Eva Elfie", en: "Eva Elfie" },
  { id: "cate126", cn: "SkinLovers's", en: "SkinLovers" },
  { id: "cate127", cn: "Melody Marks", en: "Melody Marks" },
  { id: "cate128", cn: "Creamy Spot", en: "Creamy Spot" },
  { id: "cate129", cn: "Ada Kham", en: "Ada Kham" },
  { id: "cate131", cn: "精选推荐", en: "Featured Picks" },
  { id: "cate132", cn: "少女嫩妹", en: "Young Girls II" },
  { id: "cate133", cn: "法国剧情", en: "French Drama" },
  { id: "cate134", cn: "巨乳肥臀", en: "Busty & Curvy II" },
  { id: "cate135", cn: "啄木鸟", en: "Woodpecker" },
  { id: "cate136", cn: "黑人巨屌", en: "BBC" },
  { id: "cate137", cn: "全家乱伦", en: "Family Taboo II" },
  { id: "cate138", cn: "中文字幕", en: "Chinese Subtitles II" },
  { id: "cate139", cn: "成人电影", en: "Adult Movies" },
  { id: "cate141", cn: "中文字幕", en: "Chinese Subtitles III" },
  { id: "cate142", cn: "精品动漫", en: "Premium Anime" },
  { id: "cate143", cn: "毁童年", en: "Ruined Childhood" },
  { id: "cate144", cn: "最终幻想", en: "Final Fantasy" },
  { id: "cate145", cn: "剧情中文", en: "Chinese Plot" },
  { id: "cate146", cn: "完美世界", en: "Perfect World" },
  { id: "cate147", cn: "近亲乱伦", en: "Incest Anime" },
  { id: "cate148", cn: "电车痴汉", en: "Train Molester" },
  { id: "cate149", cn: "3D同人", en: "3D Doujin" },
  { id: "cate150", cn: "火影忍者", en: "Naruto" },
  { id: "cate153", cn: "薇凹的性趣", en: "Wei'ao" },
  { id: "cate154", cn: "王竹子教学", en: "Wang Zhuzi" },
  { id: "cate155", cn: "Carrie雨千", en: "Carrie Yuqian" },
  { id: "cate156", cn: "一三蜜桃说", en: "Yisan Mitao" },
  { id: "cate157", cn: "1G.老湿", en: "1G Laoshi" },
  { id: "cate158", cn: "许蓝方", en: "Xu Lanfang" },
  { id: "cate159", cn: "小哥哥艾里", en: "Ai Li" },
  { id: "cate160", cn: "misa 米砂", en: "Misa" },
  { id: "cate161", cn: "中指通一下", en: "Zhongzhi" },
  { id: "cate162", cn: "深夜保健室", en: "Late-night Clinic" },
  { id: "cate164", cn: "原创", en: "Original" },
  { id: "cate166", cn: "内射", en: "Creampie" },
  { id: "cate167", cn: "乱伦", en: "Incest" },
  { id: "cate168", cn: "母狗", en: "Submissive" },
  { id: "cate170", cn: "PMV", en: "PMV" },
  { id: "cate171", cn: "裸舞", en: "Nude Dance" },
  { id: "cate172", cn: "口交", en: "Blowjob" },
  { id: "cate174", cn: "混剪", en: "Compilations" },
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
