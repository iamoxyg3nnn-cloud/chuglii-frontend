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

function describeRoute(path: string): { title: string; description: string; index: boolean } {
  if (path === "/") {
    return {
      title: "Adult Cam Recording Archive & Performer Directory",
      description: "Explore cam recordings and performer profiles on VAULT. Create an account to save your favorite recordings in your own private archive. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/browse" || path.startsWith("/browse/")) {
    return {
      title: "Browse Cam Recordings",
      description: "Search the public VAULT cam recording catalogue by title, performer and tags. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/performers") {
    return {
      title: "Performer Directory",
      description: "Discover performer profiles and related recordings in the VAULT directory. Adults only (18+).",
      index: true,
    };
  }
  if (path === "/tags") {
    return {
      title: "Browse Archive Tags",
      description: "Find public cam recordings by topic and tag in the VAULT directory. Adults only (18+).",
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

    document.title = title;
    upsertMeta('meta[name="description"]', "name", "description", route.description);
    upsertMeta('meta[name="robots"]', "name", "robots", route.index
      ? "index, follow, max-image-preview:large"
      : "noindex, nofollow");
    upsertMeta('meta[name="rating"]', "name", "rating", "adult");
    upsertMeta('meta[property="og:title"]', "property", "og:title", title);
    upsertMeta('meta[property="og:description"]', "property", "og:description", route.description);
    upsertMeta('meta[property="og:type"]', "property", "og:type", "website");
    upsertMeta('meta[property="og:url"]', "property", "og:url", canonical);
    upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary");
    upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
    upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", route.description);
    upsertCanonical(canonical);
  }, [location]);

  return null;
}
