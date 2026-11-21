import { Link } from "wouter";
import { useCallback, memo, useState, useRef } from "react";
import { PaperPlaneTilt, Flame, CaretDown } from "@phosphor-icons/react";
import { prefetchRoute } from "@/lib/route-chunks";
import { isActiveNavigationRoute } from "@/lib/navigation";

export const NAV_LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/performers", label: "Performers" },
  { href: "/tags", label: "Tags" },
  { href: "/playlists", label: "Playlists" },
] as const;

// Top-level categories correspond to scraper modules / site archives
export const SCRAPER_CATEGORIES = [
  {
    id: "viral-mms",
    name: "Viral MMS",
    href: "/leak?category=viral-mms",
    description: "All leaked videos & viral clips from MMSVibeX archive",
    count: "9,300+ videos",
    badge: "MMSVibeX",
  },
] as const;

interface DesktopNavProps {
  location: string;
  onRequestOpen?: () => void;
}

export const DesktopNav = memo(function DesktopNav({ location, onRequestOpen }: DesktopNavProps) {
  const isLeakActive = isActiveNavigationRoute("/leak", location);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    prefetchRoute("/leak");
    setDropdownOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setDropdownOpen(false);
    }, 180);
  };

  return (
    <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1 text-sm">
      {NAV_LINKS.map(({ href, label }) => (
        <NavLink key={href} href={href} label={label} isActive={isActiveNavigationRoute(href, location)} />
      ))}

      {/* Leaks Item with Scraper Category Hover Dropdown */}
      <div
        className="relative inline-block"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Link href="/leak?category=viral-mms" aria-current={isLeakActive ? "page" : undefined}>
          <span
            onFocus={handleMouseEnter}
            className={`px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all duration-150 cursor-pointer font-medium text-xs ${
              isLeakActive
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/35 shadow-sm shadow-rose-500/10"
                : "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent"
            }`}
            title="Leaks Archive by Scraper Category"
          >
            <Flame size={15} weight="fill" className="text-rose-500 animate-pulse" />
            <span>Leaks</span>
            <CaretDown
              size={11}
              className={`transition-transform duration-200 text-rose-400/80 ${
                dropdownOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </Link>

        {/* Dropdown showing Scraper Categories */}
        {dropdownOpen && (
          <div
            className="absolute top-full left-0 mt-2 w-72 rounded-2xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl shadow-rose-950/20 z-50 p-2.5 animate-in fade-in zoom-in-95 duration-150"
            role="menu"
            aria-label="Scraper Categories"
          >
            <div className="px-3 py-1.5 mb-1.5 border-b border-border/40 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
                Categories
              </span>
              <span className="text-[10px] text-muted-foreground/60 font-medium">By Scraper</span>
            </div>

            <div className="space-y-1">
              {SCRAPER_CATEGORIES.map((cat) => {
                const isSelected = location.includes(`category=${cat.id}`) || location === "/leak";
                return (
                  <Link key={cat.id} href={cat.href}>
                    <div
                      onClick={() => setDropdownOpen(false)}
                      className={`w-full p-2.5 rounded-xl flex items-start gap-2.5 transition-all cursor-pointer ${
                        isSelected
                          ? "bg-rose-500/15 border border-rose-500/30 text-rose-400"
                          : "hover:bg-secondary/70 text-foreground border border-transparent"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
                        <Flame size={18} weight="fill" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-sm">{cat.name}</span>
                          {cat.badge && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400">
                              {cat.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {cat.description}
                        </p>
                        <span className="text-[10px] text-muted-foreground/70 mt-1 inline-block">
                          {cat.count}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
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
