import { Link } from "wouter";
import { useCallback, memo, useState, useRef } from "react";
import { PaperPlaneTilt, Flame, GlobeHemisphereWest, FilmStrip, CaretDown } from "@phosphor-icons/react";
import { prefetchRoute } from "@/lib/route-chunks";
import { isActiveNavigationRoute } from "@/lib/navigation";

export const NAV_LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/performers", label: "Performers" },
  { href: "/tags", label: "Tags" },
  { href: "/playlists", label: "Playlists" },
] as const;

// Scraper categories
export const SCRAPER_CATEGORIES = [
  {
    id: "viral-mms",
    name: "Viral MMS",
    href: "/leak?category=viral-mms",
    count: "9.2k",
    icon: Flame,
  },
  {
    id: "japanese",
    name: "Japanese (JAV)",
    href: "/japanese",
    count: "Hot",
    icon: GlobeHemisphereWest,
  },
  {
    id: "myanmar",
    name: "Myanmar",
    href: "/myanmar",
    count: "New",
    icon: FilmStrip,
  },
] as const;

interface DesktopNavProps {
  location: string;
  onRequestOpen?: () => void;
}

export const DesktopNav = memo(function DesktopNav({ location, onRequestOpen }: DesktopNavProps) {
  const isLeakActive =
    isActiveNavigationRoute("/leak", location) ||
    isActiveNavigationRoute("/japanese", location) ||
    isActiveNavigationRoute("/myanmar", location);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    prefetchRoute("/leak");
    prefetchRoute("/japanese");
    prefetchRoute("/myanmar");
    setDropdownOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setDropdownOpen(false);
    }, 150);
  };

  return (
    <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1 text-sm">
      {NAV_LINKS.map(({ href, label }) => (
        <NavLink key={href} href={href} label={label} isActive={isActiveNavigationRoute(href, location)} />
      ))}

      {/* Leaks Menu Item with Clean Popover */}
      <div
        className="relative inline-flex items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Link href="/leak?category=viral-mms" aria-current={isLeakActive ? "page" : undefined}>
          <span
            onFocus={handleMouseEnter}
            className={`px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              isLeakActive
                ? "text-rose-400 bg-rose-500/10 font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <Flame size={14} weight={isLeakActive ? "fill" : "regular"} className={isLeakActive ? "text-rose-500" : "text-muted-foreground/70"} />
            <span>Leaks</span>
            <CaretDown size={10} className={`transition-transform duration-150 opacity-60 ${dropdownOpen ? "rotate-180" : ""}`} />
          </span>
        </Link>

        {/* Clean, Simple Dropdown */}
        {dropdownOpen && (
          <div
            className="absolute top-full left-0 mt-1 w-48 rounded-lg bg-popover/95 backdrop-blur-sm border border-border/60 shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-100"
            role="menu"
          >
            {SCRAPER_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active =
                (cat.id === "japanese" && isActiveNavigationRoute("/japanese", location)) ||
                (cat.id === "myanmar" && (isActiveNavigationRoute("/myanmar", location) || location.includes("category=myanmar"))) ||
                (cat.id === "viral-mms" && (isActiveNavigationRoute("/leak", location) || location.includes("category=viral-mms")));
              return (
                <Link key={cat.id} href={cat.href}>
                  <span
                    onClick={() => setDropdownOpen(false)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors cursor-pointer ${
                      active
                        ? "text-rose-400 font-medium bg-rose-500/10"
                        : "text-foreground/80 hover:text-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Icon size={14} weight={active ? "fill" : "regular"} className={active ? "text-rose-500" : "text-muted-foreground/80"} />
                      <span>{cat.name}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground/70 tabular-nums">{cat.count}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <span className="w-px h-4 bg-border/20 mx-1" />
      <button
        onClick={onRequestOpen}
        type="button"
        className="nav-underline px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-colors duration-150 text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <PaperPlaneTilt size={14} weight="regular" className="text-muted-foreground/70" />
        Request
      </button>
    </nav>
  );
});

interface NavLinkProps {
  href: string;
  label: string;
  isActive: boolean;
}

const NavLink = memo(function NavLink({ href, label, isActive: active }: NavLinkProps) {
  const prefetch = useCallback(() => {
    prefetchRoute(href);
  }, [href]);

  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      <span
        onMouseEnter={prefetch}
        onFocus={prefetch}
        className={`nav-underline px-3 py-1.5 rounded-lg inline-flex items-center transition-colors duration-150 cursor-pointer ${
          active
            ? "text-foreground font-medium active"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
      </span>
    </Link>
  );
});
