import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  applySeo,
  canonicalUrl,
  organizationNode,
  SITE_URL,
  truncate,
  websiteNode,
} from "@/lib/seo";

const BRAND = "VAULT";

interface RouteSeo {
  title: string;
  description: string;
  image?: string | null;
  type?: "website" | "article" | "video.other" | "profile";
  /** Query string (without "?") to keep on the canonical URL. */
  canonicalQuery?: string;
  indexable?: boolean;
  jsonLd?: Record<string, unknown>;
}

function webPageNode(canonical: string, title: string, description: string) {
  return {
    "@type": "WebPage",
    "@id": `${canonical}#webpage`,
    url: canonical,
    name: title,
    description,
    inLanguage: "en",
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
  };
}

function collectionNode(
  canonical: string,
  title: string,
  description: string,
  type: "CollectionPage" | "ProfilePage" = "CollectionPage",
) {
  return {
    ...webPageNode(canonical, title, description),
    "@type": type,
  };
}

function describeRoute(path: string, params: URLSearchParams): RouteSeo {
  if (path === "/") {
    const canonical = `${SITE_URL}/`;
    const title = "Adult Cam Recording Archive & Performer Directory";
    const description =
      "Search VAULT's public adult cam recording archive by performer, title and tag. Explore listings and performer profiles, or create a free account to save favorites. Adults only (18+).";
    return {
      title,
      description,
      type: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          websiteNode(),
          organizationNode(),
          webPageNode(canonical, title, description),
        ],
      },
    };
  }

  if (path === "/browse" || path.startsWith("/browse/")) {
    const search = (params.get("search") ?? "").trim();
    const tags = (params.get("tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const gender = (params.get("gender") ?? "").trim();
    const resolution = (params.get("resolution") ?? "").trim();
    const sort = (params.get("sort") ?? "").trim();
    const pageNumber = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

    const hasFilters = Boolean(
      search || tags.length || gender || resolution || sort || pageNumber > 1,
    );

    let title = "Browse Adult Cam Recordings";
    let description =
      "Search public VAULT recording listings by title, performer or tag. Filter the catalogue and sort recordings to find relevant entries. Adults only (18+).";

    if (tags.length > 0) {
      const tagLabel = tags.map((tag) => `#${tag}`).join(", ");
      title = `${tagLabel} Adult Cam Recordings`;
      description = `Browse adult cam recording listings tagged ${tagLabel} in the public VAULT archive. Refine results by performer, gender and resolution. Adults only (18+).`;
    } else if (search) {
      title = `“${truncate(search, 60)}” Adult Cam Recordings`;
      description = `Public adult cam recording listings matching “${truncate(search, 60)}” in the VAULT archive. Search by performer, title or tag to find more. Adults only (18+).`;
    } else if (gender && resolution) {
      title = `${resolution} ${gender} Adult Cam Recordings`;
      description = `Browse ${resolution} adult cam recordings featuring ${gender} performers in the public VAULT archive. Filter, sort and explore the catalogue. Adults only (18+).`;
    }

    if (pageNumber > 1) title = `${title} — Page ${pageNumber}`;

    // Keep meaningful browse filters in the canonical URL so each filtered /
    // paginated view is self-canonical rather than competing with /browse.
    const kept = new URLSearchParams();
    for (const key of ["search", "tags", "gender", "resolution", "sort", "page"]) {
      const value = params.get(key);
      if (value) kept.set(key, value);
    }
    const canonicalQuery = hasFilters ? kept.toString() : "";
    const indexable = !hasFilters || (tags.length === 1 && !search && !gender && !resolution && !sort && pageNumber === 1);

    return {
      title,
      description,
      type: "website",
      canonicalQuery,
      indexable,
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          websiteNode(),
          organizationNode(),
          collectionNode(
            canonicalUrl(path, canonicalQuery),
            `${title} | ${BRAND}`,
            description,
          ),
        ],
      },
    };
  }

  if (path === "/performers") {
    const title = "Adult Performer Directory";
    const description =
      "Browse the VAULT performer directory and discover public profile listings connected with the recording archive. Search performers and explore their recordings. Adults only (18+).";
    return {
      title,
      description,
      type: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          websiteNode(),
          organizationNode(),
          collectionNode(canonicalUrl(path), `${title} | ${BRAND}`, description),
        ],
      },
    };
  }

  if (path === "/tags") {
    const title = "Browse Recording Tags";
    const description =
      "Explore the VAULT archive by topic tags and use each tag to find matching public recording listings. Browse categories and refine by performer, gender and resolution. Adults only (18+).";
    return {
      title,
      description,
      type: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          websiteNode(),
          organizationNode(),
          collectionNode(canonicalUrl(path), `${title} | ${BRAND}`, description),
        ],
      },
    };
  }

  if (path === "/premium") {
    const title = "VAULT Premium — Ad-Free Archive Access";
    const description =
      "Support VAULT and unlock ad-free browsing across the recording archive. Premium follows your account on every device, stacks for 30 days, and can also be earned free by watching sponsored ads.";
    return {
      title,
      description,
      type: "website",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          websiteNode(),
          organizationNode(),
          webPageNode(canonicalUrl(path), `${title} | ${BRAND}`, description),
        ],
      },
    };
  }

  if (path === "/playlists") {
    const title = "Public Playlists";
    const description =
      "Explore public VAULT playlists and collections of adult cam recordings curated by the community. Play a list straight through or save the recordings you like. Adults only (18+).";
    return { title, description, type: "website" };
  }

  if (path === "/login") {
    return {
      title: "Sign In",
      description:
        "Sign in to your VAULT account to sync favorites, watch later, playlists, follows and your private recording archive across devices.",
      type: "website",
    };
  }

  if (path === "/signup") {
    return {
      title: "Create a Free Account",
      description:
        "Create a free VAULT account to save adult cam recordings, follow performers, build playlists and keep your private archive synced across devices. Adults only (18+).",
      type: "website",
    };
  }

  if (path === "/forgot-password") {
    return {
      title: "Reset Your Password",
      description:
        "Reset the password for your VAULT account and get back to your saved recordings, playlists and followed performers.",
      type: "website",
    };
  }

  if (path === "/auth/callback") {
    return {
      title: "Signing In",
      description: "Completing sign-in to your VAULT account.",
      type: "website",
    };
  }

  if (path === "/random") {
    return {
      title: "Random Recording",
      description:
        "Jump into a random public adult cam recording from the VAULT archive and discover performers you may not have found yet. Adults only (18+).",
      type: "website",
    };
  }

  if (path === "/content-removal") {
    return { title: "Report Content or Request Removal", description: "Report a listing that may violate privacy, consent, copyright or applicable law.", type: "website", indexable: false };
  }

  if (path === "/request") {
    return {
      title: "Request a Recording",
      description:
        "Request a missing performer or recording for the VAULT archive. Sign in to submit requests and follow their status.",
      type: "website",
    };
  }

  if (
    path === "/bookmarks" ||
    path === "/watch-later" ||
    path === "/history" ||
    path === "/analytics" ||
    path === "/collections" ||
    path.startsWith("/collections/") ||
    path === "/following" ||
    path === "/notifications" ||
    path === "/my-requests" ||
    path === "/profile" ||
    path === "/user" ||
    path === "/settings" ||
    path.startsWith("/admin")
  ) {
    return {
      title: "Your VAULT Account",
      description:
        "Manage your VAULT account, saved recordings, playlists, follows, watch history and preferences. Sign in to keep your archive synced across devices.",
      type: "website",
    };
  }

  // Detail pages override this placeholder from their own data once loaded.
  // Until then the page stays indexable with a sensible archive title.
  if (path.startsWith("/video/")) {
    return {
      title: "Archived Adult Cam Recording",
      description:
        "View an archived adult cam recording on VAULT, with performer details, tags and related public listings. Adults only (18+).",
      type: "video.other",
    };
  }
  if (path.startsWith("/performers/")) {
    return {
      title: "Adult Performer Profile",
      description:
        "Explore an adult performer profile on VAULT and browse their public archived cam recordings. Adults only (18+).",
      type: "profile",
    };
  }

  return {
    title: "VAULT — Adult Recording Archive",
    description:
      "VAULT is a public, adults-only archive for discovering cam recordings by performer, title and tag. Browse the catalogue or create a free account to save favorites. Adults only (18+).",
    type: "website",
  };
}

export function RouteSeoMeta() {
  const [location] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const path = location.split("?")[0].split("#")[0] || "/";
    const params = new URLSearchParams(search);
    const route = describeRoute(path, params);
    const canonical = canonicalUrl(path, route.canonicalQuery ?? "");

    applySeo({
      title: route.title,
      description: route.description,
      path,
      canonical,
      image: route.image,
      type: route.type,
      indexable: route.indexable,
      jsonLd:
        route.jsonLd ??
        (path === "/"
          ? undefined
          : {
              "@context": "https://schema.org",
              "@graph": [
                websiteNode(),
                organizationNode(),
                webPageNode(
                  canonical,
                  `${route.title} | ${BRAND}`,
                  route.description,
                ),
              ],
            }),
    });
  }, [location, search]);

  return null;
}
