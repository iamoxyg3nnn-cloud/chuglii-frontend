import { useState, useEffect, useRef, lazy, Suspense } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link, useLocation } from "wouter";
import { FilmStrip, SunDim, MoonStars, Crown, Check, List, X } from "@phosphor-icons/react";
import { UserMenu } from "@/components/UserMenu";
import { usePremium } from "@/contexts/PremiumContext";
import { useAds } from "@/contexts/AdsContext";
import { DesktopNav } from "@/components/nav/DesktopNav";
import { SearchDropdown } from "@/components/nav/SearchDropdown";
import { markAgeGatePassed } from "@/lib/gating";
import { PremiumUpsellPopup } from "@/components/ads/PremiumUpsellPopup";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { useTheme } from "@/contexts/ThemeContext";
import { getGetStatsQueryKey, useGetStats } from "@workspace/api-client-react";

// Lazy-load components that are heavy or only needed on interaction:
// - NotificationBell: pulls in notification hooks, only visible for auth users
// - MobileMenu: only visible on mobile toggle
// - RequestDialog: pulls in framer-motion, only opens on click
const NotificationBell = lazy(() => import("@/components/NotificationBell").then(m => ({ default: m.NotificationBell })));
const MobileMenu = lazy(() => import("@/components/nav/MobileMenu").then(m => ({ default: m.MobileMenu })));
const RequestDialog = lazy(() => import("@/components/RequestDialog"));

import { prefetchRoute } from "@/lib/route-chunks";

// Route chunk + data prefetching is centralized in lib/route-chunks.ts; the
// footer just points at it (connection-constrained guard lives there).
function prefetchFooter(href: string) {
  prefetchRoute(href);
}

function Logo() {
  return (
    <Link href="/" className="shrink-0 flex items-center gap-2.5 group">
      <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 group-hover:border-primary/40 transition-colors duration-200">
        <FilmStrip size={17} weight="duotone" className="text-primary" />
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-bold text-lg tracking-tight text-foreground group-hover:text-primary transition-colors duration-200">
          VAULT
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
      </div>
    </Link>
  );
}

export function AgeGate() {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // Read actual archive totals from the stats endpoint
  const statsQuery = useGetStats({
    query: {
      queryKey: getGetStatsQueryKey(),
      enabled: isOpen,
      staleTime: 30_000,
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
    },
  });

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem("age-gate-passed") !== "true") setIsOpen(true);
    } catch {
      // If storage is unavailable, require confirmation for this visit.
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      document.body.classList.remove("overflow-hidden");
      return;
    }
    document.body.classList.add("overflow-hidden");
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  const stats = statsQuery.data;
  const recordingsCount =
    typeof stats?.total_recordings === "number"
      ? new Intl.NumberFormat().format(stats.total_recordings)
      : "6,300+";
  const performersCount =
    typeof stats?.total_performers === "number"
      ? new Intl.NumberFormat().format(stats.total_performers)
      : "440+";

  const handleConfirm = () => {
    try {
      localStorage.setItem("age-gate-passed", "true");
      document.cookie = "Confirmed18=true; path=/; max-age=31536000; SameSite=Lax";
    } catch {}
    markAgeGatePassed();
    setIsOpen(false);
  };

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        // Consent is explicit: Escape or an outside click must not bypass the age gate.
        if (open) setIsOpen(true);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100001] bg-black data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="splash-18 fixed inset-0 z-[100002] w-screen h-screen min-h-screen bg-black overflow-y-auto outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          {showTerms ? (
            <div className="w-full max-w-lg my-auto px-6 py-10 text-center font-sans">
              <DialogPrimitive.Title
                className="text-base uppercase tracking-[0.25em] text-[#cccccc] mb-6 font-semibold"
                style={{ fontFamily: '"Montserrat Alternates", sans-serif' }}
              >
                Terms of Use
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Terms and conditions for using the Chuglii recording archive.
              </DialogPrimitive.Description>
              <div className="text-sm text-[#888888] leading-relaxed space-y-4 max-h-[60vh] overflow-y-auto pr-2 text-left bg-[#111111] p-5 rounded-lg border border-[#222222]">
                <p>
                  By accessing this site, you agree to the following terms and conditions. If you do not
                  agree with any part of these terms, you must not use this site.
                </p>
                <p>
                  <strong className="text-white">Age Restriction.</strong> This site contains adult material intended only for
                  people who are at least 18 years old or the age of majority in their location, whichever
                  is higher. By entering, you confirm that you meet the applicable age requirement.
                </p>
                <p>
                  <strong className="text-white">Personal Use.</strong> Content on this site is provided for personal,
                  non-commercial viewing only. You may not download, redistribute, or reproduce any
                  content without explicit permission.
                </p>
                <p>
                  <strong className="text-white">User Conduct.</strong> You agree not to use the site for any unlawful purpose
                  or to violate any applicable laws. Harassment, abuse, or harmful behavior toward other
                  users will result in account termination.
                </p>
                <p>
                  <strong className="text-white">Privacy.</strong> Your privacy is important to us. Please review our Privacy
                  Policy to understand how we collect and handle your data.
                </p>
                <p>
                  <strong className="text-white">Disclaimer.</strong> All content is provided "as is" without warranty of any
                  kind. The site operators are not responsible for user-submitted content or external links.
                </p>
                <p>
                  <strong className="text-white">Changes.</strong> These terms may be updated at any time. Continued use of the
                  site after changes constitutes acceptance of the new terms.
                </p>
              </div>
              <div className="mt-6 text-center">
                <button
                  type="button"
                  className="h-9 px-6 rounded text-sm text-[#aaaaaa] border border-[#444444] hover:text-white hover:border-[#666666] transition-colors"
                  onClick={() => setShowTerms(false)}
                >
                  Back
                </button>
              </div>
            </div>
          ) : (
            <>
              <DialogPrimitive.Title className="sr-only">
                Chuglii — 18+ Age Verification Warning
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Adult content warning. You must confirm that you are at least 18 years old to access this archive.
              </DialogPrimitive.Description>

              <a href="/" className="splash-18__logo" onClick={(e) => e.preventDefault()}>
                Chuglii
              </a>

              <div className="site-promo-title" data-testid="star-header">
                <i className="star" aria-hidden="true">★</i>
                <span>The Ultimate Chaturbate Archive</span>
                <i className="star" aria-hidden="true">★</i>
              </div>

              <h2>
                More than <b>{recordingsCount}</b> hours of video of <b>{performersCount}</b> performers
              </h2>

              <p>To continue, you must confirm that you are an adult person</p>

              <button
                id="btn-confirm-age"
                type="button"
                className="btn btn-secondary btn-base-outline btn-confirm-age"
                onClick={handleConfirm}
              >
                Yes, I'm over 18
              </button>

              <div className="mt-8 flex items-center justify-center gap-3 text-xs text-[#555555]">
                <button
                  type="button"
                  className="hover:text-[#888888] transition-colors"
                  onClick={() => window.location.replace("https://www.google.com/")}
                >
                  Exit
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className="hover:text-[#888888] transition-colors"
                  onClick={() => setShowTerms(true)}
                >
                  Terms of Use
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Navbar() {
  const [location, setLocation] = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      mobileMenuButtonRef.current?.focus();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);
  const { isDark: dark, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const { isPremium, loading, adsEnabled, config } = usePremium();
  // Premium only removes ads. When advertising is paused there is nothing to
  // sell, so every premium CTA is hidden until it is switched back on.
  const premiumOffered = adsEnabled && config !== undefined && config.ads_enabled !== false;

  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const isScrolled = window.scrollY > 15;
          setScrolled((prev) => (prev !== isScrolled ? isScrolled : prev));
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-[60] w-full ${
        scrolled ? "glass-panel scrolled" : "glass-panel"
      }`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/12 to-transparent pointer-events-none" />

      <div className="nav-inner container mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center gap-4 relative">
        <Logo />

        <div className="hidden md:block w-px h-5 bg-border/30" />

        <DesktopNav location={location} onRequestOpen={() => setRequestOpen(true)} />

        <div className="flex-1" />

        <div className="flex items-center gap-0.5">
          <SearchDropdown open={searchOpen} onOpenChange={setSearchOpen} />

          {!searchOpen && (
            <button
              onClick={toggleTheme}
              className="nav-btn hidden sm:flex cursor-pointer"
              aria-label="Dark mode"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={dark}
              type="button"
            >
              <div className="relative z-10 transition-transform duration-200 hover:scale-105">
                {dark ? <SunDim size={17} weight="regular" /> : <MoonStars size={17} weight="regular" />}
              </div>
            </button>
          )}

          {premiumOffered && (
            <Link
              href="/premium"
              className={`nav-btn ${searchOpen ? "hidden sm:flex" : ""}`}
              aria-label={isPremium ? "Premium member — see benefits" : "Go Premium — see details & upgrade"}
              title={isPremium ? "You're Premium — see benefits" : "Go Premium — see details & upgrade"}
            >
              <Crown
                size={17}
                weight={isPremium ? "fill" : "regular"}
                className={`transition-colors ${isPremium ? "text-primary" : ""}`}
              />
              {isPremium ? (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-primary text-background flex items-center justify-center border border-background">
                  <Check size={9} weight="bold" />
                </span>
              ) : (
                !loading && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" />
                )
              )}
            </Link>
          )}

          <div className={searchOpen ? "hidden sm:block" : ""}>
            <Suspense fallback={null}><NotificationBell /></Suspense>
          </div>
          <UserMenu />

          <button
            ref={mobileMenuButtonRef}
            type="button"
            className="flex md:hidden items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-white/5 rounded-full transition-all relative cursor-pointer"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-controls="mobile-navigation"
            aria-expanded={mobileOpen}
          >
            <div className="relative transition-transform duration-200" style={{ transform: mobileOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              {mobileOpen ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
            </div>
          </button>
        </div>
      </div>

      <Suspense fallback={null}>
        <MobileMenu
          open={mobileOpen}
          location={location}
          dark={dark}
          onDarkToggle={toggleTheme}
          onClose={() => setMobileOpen(false)}
          onRequestOpen={() => setRequestOpen(true)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <RequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
      </Suspense>
    </header>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { showAds, adsEnabled, config } = usePremium();
  const premiumOffered = adsEnabled && config !== undefined && config.ads_enabled !== false;
  const { creativesFor } = useAds();
  // Site-wide strips only take space once a creative exists for one of their
  // tiers — an empty strip would otherwise leave a bordered bar / gap.
  const hasCreative = (files: string[]) =>
    files.some((file) => creativesFor(file).length > 0);
  const topStripAds =
    showAds && hasCreative(["billboard-970x250", "leaderboard-728x90", "mobile-banner-320x50"]);
  const footerAds =
    showAds && hasCreative(["leaderboard-728x90", "banner-468x60", "rect-300x100"]);

  return (
    <div className="min-h-screen text-foreground flex flex-col font-sans relative">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-md focus:shadow-lg focus:text-xs focus:font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <AgeGate />
      <Navbar />

      {/* ── Site-wide top ad strip (every page) ──────────────────────────
          970×250 billboard on large screens, 728×90 on medium, 320×50 on
          phones — codes live in ads/*.txt; hidden until a tier has one. */}
      {topStripAds && (
        <div className="border-b border-border/40 bg-secondary/10">
          <div className="container mx-auto px-4 sm:px-6 py-4">
            <AdLeaderboard
              lg="billboard-970x250"
              md="leaderboard-728x90"
              mobile="mobile-banner-320x50"
            />
          </div>
        </div>
      )}

      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col focus:outline-none">
        {children}
      </main>

      <PremiumUpsellPopup />

      <footer className="border-t border-border/40 mt-20 bg-card/40 backdrop-blur-md">
        <div className="container mx-auto px-4 sm:px-6 py-12 lg:py-16">
          {/* ── Site-wide footer ad (every page) ────────────────────────
              728×90 desktop / 468×60 tablet / 300×100 phones (rectangle). */}
          {footerAds && (
            <div className="mb-12 flex justify-center">
              <AdLeaderboard
                lg="leaderboard-728x90"
                md="banner-468x60"
                mobile="rect-300x100"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12 pb-12 border-b border-border/40">
            {/* Brand column */}
            <div className="lg:col-span-2 space-y-4">
              <Link href="/" className="flex items-center gap-2 group w-fit">
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 border border-primary/20 group-hover:border-primary/40 transition-colors">
                  <FilmStrip size={15} weight="duotone" className="text-primary" />
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-bold text-base tracking-tight text-foreground group-hover:text-primary transition-colors">
                    VAULT
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                </div>
              </Link>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                A public recording index and performer archive. Explore listed streams, discover performer profiles, and curate your personal collection.
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500/80" />
                <span>Archive index operational</span>
                <span className="text-border/60">·</span>
                <span className="font-semibold text-foreground/80">18+ Adults only</span>
              </div>
            </div>

            {/* Discover */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-foreground tracking-wide">Discover</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>
                  <Link href="/browse" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/browse")} onFocus={() => prefetchFooter("/browse")}>
                    Browse recordings
                  </Link>
                </li>
                <li>
                  <Link href="/performers" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/performers")} onFocus={() => prefetchFooter("/performers")}>
                    Performer directory
                  </Link>
                </li>
                <li>
                  <Link href="/tags" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/tags")} onFocus={() => prefetchFooter("/tags")}>
                    Topic tags
                  </Link>
                </li>
                <li>
                  <Link href="/playlists" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/playlists")} onFocus={() => prefetchFooter("/playlists")}>
                    Curated playlists
                  </Link>
                </li>
                <li>
                  <Link href="/collections" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/collections")} onFocus={() => prefetchFooter("/collections")}>
                    Public collections
                  </Link>
                </li>
              </ul>
            </div>

            {/* Library */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-foreground tracking-wide">Library</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>
                  <Link href="/bookmarks" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/bookmarks")} onFocus={() => prefetchFooter("/bookmarks")}>
                    Saved bookmarks
                  </Link>
                </li>
                <li>
                  <Link href="/watch-later" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/watch-later")} onFocus={() => prefetchFooter("/watch-later")}>
                    Watch later
                  </Link>
                </li>
                <li>
                  <Link href="/history" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/history")} onFocus={() => prefetchFooter("/history")}>
                    Watch history
                  </Link>
                </li>
                <li>
                  <Link href="/my-requests" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/my-requests")} onFocus={() => prefetchFooter("/my-requests")}>
                    My requests
                  </Link>
                </li>
                {premiumOffered && (
                  <li>
                    <Link href="/premium" className="text-primary hover:text-primary/90 transition-colors font-medium" onMouseEnter={() => prefetchFooter("/premium")} onFocus={() => prefetchFooter("/premium")}>
                      Premium membership
                    </Link>
                  </li>
                )}
              </ul>
            </div>

            {/* Support & Legal */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-foreground tracking-wide">Support & Legal</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                <li>
                  <Link href="/request" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/request")} onFocus={() => prefetchFooter("/request")}>
                    Request recording
                  </Link>
                </li>
                <li>
                  <Link href="/content-removal" className="hover:text-foreground transition-colors">
                    Content removal / DMCA
                  </Link>
                </li>
                <li>
                  <Link href="/analytics" className="hover:text-foreground transition-colors" onMouseEnter={() => prefetchFooter("/analytics")} onFocus={() => prefetchFooter("/analytics")}>
                    Viewing analytics
                  </Link>
                </li>
                <li className="pt-1 text-muted-foreground text-[11px]">
                  <span>Terms of Service</span>
                  <span className="mx-2">·</span>
                  <span>Privacy Policy</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-muted-foreground">
            <div>
              &copy; <span className="tabular-nums">{new Date().getFullYear()}</span> VAULT. Public Recording Archive &amp; Performer Directory.
            </div>
            <div className="text-muted-foreground text-[11px]">
              Adult content intended strictly for audiences 18 years or older.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}