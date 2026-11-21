import { Link } from "wouter";
import { useCallback, memo, useState, useRef } from "react";
import { PaperPlaneTilt, Flame, CaretDown, Sparkle, BookmarkSimple } from "@phosphor-icons/react";
import { prefetchRoute } from "@/lib/route-chunks";
import { isActiveNavigationRoute } from "@/lib/navigation";

export const NAV_LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/performers", label: "Performers" },
  { href: "/tags", label: "Tags" },
  { href: "/playlists", label: "Playlists" },
] as const;

export const LEAK_DROPDOWN_CATEGORIES = [
  { label: "All Leaks", href: "/leak", tag: "All", badge: "Live" },
  { label: "Indian & Desi MMS", href: "/leak?tag=desi", tag: "desi", badge: "Hot" },
  { label: "Bhabhi & Aunty", href: "/leak?tag=bhabhi", tag: "bhabhi" },
  { label: "Viral Clips", href: "/leak?tag=viral", tag: "viral", badge: "Trending" },
  { label: "Pakistani Leaks", href: "/leak?tag=pakistani", tag: "pakistani" },
  { label: "Bangladeshi", href: "/leak?tag=bangladesi", tag: "bangladesi" },
  { label: "Web Series", href: "/leak?tag=web-series", tag: "web-series" },
  { label: "Amateur & College", href: "/leak?tag=amateur", tag: "amateur" },
  { label: "Village / Dehati", href: "/leak?tag=village", tag: "village" },
  { label: "Saved Favorites", href: "/leak?tag=Saved", tag: "Saved", isSaved: true },
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

      {/* Leaks Item with Hover Category Dropdown */}
      <div
        className="relative inline-block"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Link href="/leak" aria-current={isLeakActive ? "page" : undefined}>
          <span
            onFocus={handleMouseEnter}
            className={`px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-all duration-150 cursor-pointer font-medium text-xs ${
              isLeakActive
                ? "bg-rose-500/20 text-rose-400 border border-rose-500/35 shadow-sm shadow-rose-500/10"
                : "text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent"
            }`}
            title="Trending Leaks & Viral Clips"
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

        {/* Floating Category Dropdown */}
        {dropdownOpen && (
          <div
            className="absolute top-full left-0 mt-2 w-64 rounded-2xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl shadow-rose-950/20 z-50 p-2 animate-in fade-in zoom-in-95 duration-150"
            role="menu"
            aria-label="Leak Categories"
          >
            <div className="px-3 py-1.5 mb-1 border-b border-border/40 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                <Flame size={12} weight="fill" /> Desi Leaks Categories
              </span>
              <span className="text-[10px] text-muted-foreground/70">9,300+ clips</span>
            </div>

            <div className="grid grid-cols-1 gap-0.5 max-h-[70vh] overflow-y-auto no-scrollbar py-0.5">
              {LEAK_DROPDOWN_CATEGORIES.map((cat) => {
                const isSelected = location.includes(`tag=${cat.tag}`) || (cat.tag === "All" && location === "/leak");
                return (
                  <Link key={cat.href} href={cat.href}>
                    <span
                      onClick={() => setDropdownOpen(false)}
                      className={`w-full px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                        isSelected
                          ? "bg-rose-500/15 text-rose-400 font-semibold"
                          : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {cat.isSaved ? (
                          <BookmarkSimple size={13} weight="fill" className="text-amber-400" />
                        ) : cat.tag === "All" ? (
                          <Sparkle size={13} weight="fill" className="text-rose-400" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500/70" />
                        )}
                        <span>{cat.label}</span>
                      </span>

                      {cat.badge && (
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/20">
                          {cat.badge}
                        </span>
                      )}
                    </span>
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
