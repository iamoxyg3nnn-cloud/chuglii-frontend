import { useEffect } from "react";
import { useLocation } from "wouter";

const SITE = "https://chuglii.in";
const BRAND = "VAULT";

function upsertMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function upsertCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

function upsertRouteStructuredData(canonical: string, title: string, description: string) {
  let element = document.getElementById("vault-route-structured-data") as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.id = "vault-route-structured-data";
    element.type = "application/ld+json";
    document.head.appendChild(element);
  }

  element.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${canonical}#webpage`,
    url: canonical,
    name: title,
    description,
    inLanguage: "en",
    isPartOf: {
      "@type": "WebSite",
      name: BRAND,
      url: `${SITE}/`,
    },
  });
}

function describeRoute(path: string): { title: string; description: string; index: boolean } {
  if (path === "/") {
    return {
      title: "Adult Cam Recording Archive & Performer Directory",
      description: "Search VAULT’s adult cam recording archive by performer, title and tag. Explore public listings and performer profiles, or save favorites to a private account. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/browse" || path.startsWith("/browse/")) {
    return {
      title: "Browse Adult Cam Recordings",
      description: "Search public VAULT recording listings by title, performer or tag. Filter the catalogue and sort recordings to find relevant entries. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/performers") {
    return {
      title: "Adult Performer Directory",
      description: "Browse the VAULT performer directory and discover public profile listings connected with the recording archive. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/tags") {
    return {
      title: "Browse Recording Tags",
      description: "Explore the VAULT archive by topic tags and use each tag to find matching public recording listings. Adults only (18+).",
      index: true,
    };
  }

  // Detail pages remain out of search until publisher authorization, performer
  // consent, and removal workflows have been verified for every indexed item.
  if (path.startsWith("/video/") || path.startsWith("/performers/")) {
    return {
      title: "Archive Details",
      description: "Adult-only archive details on VAULT.",
      index: false,
    };
  }
  return {
    title: "VAULT",
    description: "Adult-only recording archive.",
    index: false,
  };
}

export function RouteSeoMeta() {
  const [location] = useLocation();

  useEffect(() => {
    const path = location.split("?")[0].split("#")[0] || "/";
    const route = describeRoute(path);
    const title = `${route.title} | ${BRAND}`;
    const canonical = `${SITE}${path === "/" ? "/" : path.endsWith("/") ? path.slice(0, -1) : path}`;
    const robots = route.index
      ? "index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1"
      : "noindex, nofollow";

    document.title = title;
    upsertMeta('meta[name="description"]', "name", "description", route.description);
    upsertMeta('meta[name="robots"]', "name", "robots", robots);
    upsertMeta('meta[name="rating"]', "name", "rating", "adult");
    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", route.description);
    upsertMeta('meta[property="og:type"]', "property", "og:type", "website");
    upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", BRAND);
    upsertMeta('meta[property="og:locale"]', "property", "og:locale", "en_US");
    upsertMeta('meta[property="og:url"]', "property", "og:url", canonical);
    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", route.description);
    upsertCanonical(canonical);
    upsertRouteStructuredData(canonical, title, route.description);
  }, [location]);

  return null;
}
