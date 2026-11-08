import { useEffect } from "react";

/**
 * Central SEO helpers for the public VAULT frontend.
 *
 * Every route is intentionally indexable: the archive is a public catalogue
 * and search traffic is the primary way new visitors discover it. RouteSeoMeta
 * applies sensible defaults per path, and detail pages upgrade those defaults
 * with entity-specific titles, descriptions, images, canonical URLs and
 * structured data once their data arrives.
 */

export const SITE_URL = "https://chuglii.in";
export const BRAND = "VAULT";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph.jpg`;
export const OG_IMAGE_WIDTH = "1280";
export const OG_IMAGE_HEIGHT = "720";

const ROBOTS_CONTENT =
  "index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1";

export type SeoType = "website" | "article" | "video.other" | "profile";

export interface SeoConfig {
  /** Page title (brand suffix is appended automatically when missing). */
  title: string;
  /** Meta description, also reused for Open Graph / Twitter. */
  description: string;
  /** Path (and optional query) used to derive the canonical URL. */
  path?: string;
  /** Explicit canonical URL; overrides `path` when provided. */
  canonical?: string;
  /** Social preview image; relative URLs are resolved against SITE_URL. */
  image?: string | null;
  imageAlt?: string;
  type?: SeoType;
  /** Explicit route-level override for search indexing. */
  indexable?: boolean;
  /** Structured data injected as a single JSON-LD script tag. */
  jsonLd?: Record<string, unknown>;
}

function upsertMeta(
  attribute: "name" | "property",
  key: string,
  content: string,
) {
  let element = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

function upsertStructuredData(data: Record<string, unknown> | null) {
  const id = "vault-route-structured-data";
  let element = document.getElementById(id) as HTMLScriptElement | null;
  if (!data) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("script");
    element.id = id;
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(data);
}

/** Resolve any absolute/relative URL into an absolute URL for social meta. */
export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${SITE_URL}${trimmed}`;
  return `${SITE_URL}/${trimmed}`;
}

/** Build an absolute canonical URL from a path + optional query string. */
export function canonicalUrl(path: string, search = ""): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedPath =
    cleanPath === "/" ? "/" : cleanPath.replace(/\/+$/, "");
  return `${SITE_URL}${normalizedPath}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
}

/** Keep generated titles and descriptions inside search-result limits. */
export function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Convert a duration in seconds into ISO-8601 for schema.org VideoObject. */
export function isoDuration(totalSeconds: number | null | undefined): string | undefined {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return undefined;
  }
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [
    hours > 0 ? `${hours}H` : "",
    minutes > 0 ? `${minutes}M` : "",
    secs > 0 || (hours === 0 && minutes === 0) ? `${secs}S` : "",
  ];
  return `PT${parts.join("")}`;
}

/**
 * Apply a complete metadata set to the document head. Safe to call on every
 * navigation and whenever a detail page's data changes.
 */
export function applySeo(config: SeoConfig) {
  if (typeof document === "undefined") return;

  const title = config.title.includes(BRAND)
    ? config.title
    : `${config.title} | ${BRAND}`;
  const description = truncate(config.description, 320);
  const canonical =
    config.canonical ??
    canonicalUrl(config.path ?? "/");
  const canonicalPath = new URL(canonical, SITE_URL).pathname;
  const detailPath = /^\/video\/[^/]+\/?$/.test(canonicalPath) || /^\/performers\/[^/]+\/?$/.test(canonicalPath);
  const privatePath = /^\/(login|signup|forgot-password|auth|bookmarks|watch-later|history|analytics|collections|following|notifications|my-requests|profile|user|settings|admin|request|content-removal)(\/|$)/.test(canonicalPath);
  const detailIndexingEnabled = import.meta.env.VITE_SEO_INDEX_DETAIL_PAGES === "true";
  const indexable = config.indexable ?? (!privatePath && (!detailPath || detailIndexingEnabled));
  const robotsContent = indexable ? ROBOTS_CONTENT : "noindex, follow";
  const image = absoluteUrl(config.image) ?? DEFAULT_OG_IMAGE;
  const imageAlt = config.imageAlt ?? `${BRAND} — adult cam recording archive`;

  document.title = title;

  upsertMeta("name", "description", description);
  upsertMeta("name", "robots", robotsContent);
  upsertMeta("name", "googlebot", robotsContent);
  upsertMeta("name", "rating", "adult");

  upsertMeta("property", "og:title", title);
  upsertMeta("property", "og:description", description);
  upsertMeta("property", "og:type", config.type ?? "website");
  upsertMeta("property", "og:site_name", BRAND);
  upsertMeta("property", "og:locale", "en_US");
  upsertMeta("property", "og:url", canonical);
  upsertMeta("property", "og:image", image);
  upsertMeta("property", "og:image:secure_url", image);
  upsertMeta("property", "og:image:width", OG_IMAGE_WIDTH);
  upsertMeta("property", "og:image:height", OG_IMAGE_HEIGHT);
  upsertMeta("property", "og:image:alt", imageAlt);

  upsertMeta("name", "twitter:card", "summary_large_image");
  upsertMeta("name", "twitter:title", title);
  upsertMeta("name", "twitter:description", description);
  upsertMeta("name", "twitter:image", image);
  upsertMeta("name", "twitter:image:alt", imageAlt);

  upsertCanonical(canonical);
  upsertStructuredData(config.jsonLd ?? null);
}

/**
 * Page-level SEO override. Detail pages call this once their API data has
 * loaded so search engines and social crawlers get real titles/descriptions/
 * images instead of generic placeholders.
 */
export function usePageSeo(config: SeoConfig | null) {
  useEffect(() => {
    if (config) applySeo(config);
  }, [config]);
}

/** Standard site-wide organisation node reused in structured data graphs. */
export function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: BRAND,
    description:
      "Adults-only searchable archive of publicly listed cam recordings, performer profiles and topic tags.",
    inLanguage: "en",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/browse?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationNode() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/favicon-32x32.png`,
  };
}
