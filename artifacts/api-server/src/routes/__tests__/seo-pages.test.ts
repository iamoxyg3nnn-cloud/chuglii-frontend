import { describe, expect, it } from "vitest";
import { renderSeoDocument } from "../seo-pages.js";

const template = '<!doctype html><html><head><title>Default</title><meta name="description" content="default"><meta name="robots" content="index, follow"><meta name="googlebot" content="index, follow"><link rel="canonical" href="https://chuglii.in/"><script type="application/ld+json">{"@type":"WebSite"}</script></head><body><div id="root"></div></body></html>';

describe("server-side SEO document rendering", () => {
  it("renders route-specific metadata and crawlable fallback content", () => {
    const html = renderSeoDocument(template, {
      title: "Browse Adult Cam Recordings",
      description: "Route-specific page description.",
      canonical: "https://chuglii.in/browse",
      heading: "Browse Adult Cam Recordings",
      intro: "Search the catalogue.",
      indexable: true,
    });
    expect(html).toContain("<title>Browse Adult Cam Recordings | VAULT</title>");
    expect(html).toContain('content="https://chuglii.in/browse"');
    expect(html).toContain('content="index, follow, max-image-preview:large');
    expect(html).toContain("<h1>Browse Adult Cam Recordings</h1>");
    expect(html).toContain('id="vault-server-seo"');
  });

  it("marks unreviewed detail routes noindex, follow", () => {
    const html = renderSeoDocument(template, {
      title: "Archived Recording",
      description: "Unreviewed listing.",
      canonical: "https://chuglii.in/video/example",
      heading: "Archived Recording",
      intro: "Catalogue listing.",
      indexable: false,
    });
    expect(html).toContain('name="robots" content="noindex, follow"');
    expect(html).toContain('name="googlebot" content="noindex, follow"');
    expect(html).toContain('href="https://chuglii.in/video/example"');
  });
});
