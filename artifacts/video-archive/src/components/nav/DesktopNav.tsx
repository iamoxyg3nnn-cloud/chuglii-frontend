import { Link } from "wouter";
import { useCallback, memo } from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { prefetchRoute } from "@/lib/route-chunks";
import { isActiveNavigationRoute } from "@/lib/navigation";

export const NAV_LINKS = [
  { href: "/browse", label: "Browse" },
  { href: "/performers", label: "Performers" },
  { href: "/tags", label: "Tags" },
  { href: "/playlists", label: "Playlists" },
] as const;

interface DesktopNavProps {
  location: string;
  onRequestOpen?: () => void;
}

export const DesktopNav = memo(function DesktopNav({ location, onRequestOpen }: DesktopNavProps) {
  return (
    <nav aria-label="Primary navigation" className="hidden md:flex items-center gap-1 text-sm">
      {NAV_LINKS.map(({ href, label }) => (
        <NavLink key={href} href={href} label={label} isActive={isActiveNavigationRoute(href, location)} />
      ))}
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
