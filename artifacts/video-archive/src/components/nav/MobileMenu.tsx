import { Link } from "wouter";
import {
  Compass,
  UsersThree,
  Tag,
  Playlist,
  PaperPlaneTilt,
  BookmarkSimple,
  FolderSimplePlus,
  Clock,
  ClockCounterClockwise,
  Heart,
  UserCircle,
  Bell,
  Gear,
  SunDim,
  MoonStars,
} from "@phosphor-icons/react";
import { NAV_LINKS } from "./DesktopNav";
import { prefetchRoute } from "@/lib/route-chunks";
import { isActiveNavigationRoute } from "@/lib/navigation";

const NAV_ICON_MAP: Record<string, React.ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" | "duotone"; className?: string }>> = {
  "/browse": Compass,
  "/performers": UsersThree,
  "/tags": Tag,
  "/playlists": Playlist,
};

const LIBRARY_LINKS = [
  { href: "/bookmarks", label: "Bookmarks", icon: BookmarkSimple },
  { href: "/collections", label: "Collections", icon: FolderSimplePlus },
  { href: "/watch-later", label: "Watch Later", icon: Clock },
  { href: "/history", label: "History", icon: ClockCounterClockwise },
  { href: "/my-requests", label: "My Requests", icon: PaperPlaneTilt },
  { href: "/following", label: "Following", icon: Heart },
] as const;

const SETTINGS_LINKS = [
  { href: "/profile", label: "Profile & Activity", icon: UserCircle },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings", label: "Settings", icon: Gear },
] as const;

interface MobileMenuProps {
  open: boolean;
  location: string;
  dark: boolean;
  onDarkToggle: () => void;
  onClose: () => void;
  onRequestOpen?: () => void;
}

export function MobileMenu({
  open,
  location,
  dark,
  onDarkToggle,
  onClose,
  onRequestOpen,
}: MobileMenuProps) {
  return (
    <nav
      id="mobile-navigation"
      aria-label="Mobile navigation"
      className={`md:hidden glass-dropdown border-t-0 rounded-b-xl mx-2 mb-2 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain shadow-2xl ${
        open
          ? "animate-in fade-in slide-in-from-top-1 zoom-in-95 duration-200"
          : "hidden"
      }`}
      style={{ transformOrigin: "top" }}
    >
          {/* Main navigation */}
          <div className="px-3 py-3 space-y-0.5">
            {NAV_LINKS.map(({ href, label }) => {
              const Icon = NAV_ICON_MAP[href] ?? Compass;
              const active = isActiveNavigationRoute(href, location);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined}>
                  <span
                    className={`block px-3 py-2.5 text-sm rounded-lg transition-all duration-150 inline-flex items-center gap-2.5 ${
                      active
                        ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                    }`}
                    onClick={onClose}
                    onMouseEnter={() => prefetchRoute(href)}
                    onFocus={() => prefetchRoute(href)}
                  >
                    <Icon size={17} weight={active ? "bold" : "regular"} className={active ? "text-primary" : "text-muted-foreground/70"} />
                    {label}
                  </span>
                </Link>
              );
            })}
            <button
              onClick={() => { onClose?.(); onRequestOpen?.(); }}
              onMouseEnter={() => prefetchRoute("/request")}
              onFocus={() => prefetchRoute("/request")}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg transition-colors duration-150 text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5 cursor-pointer"
            >
              <PaperPlaneTilt size={17} weight="regular" className="text-muted-foreground/70" />
              Request
            </button>
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Library section */}
          <div className="px-3 py-2 space-y-0.5">
            <p className="px-3 py-1 text-xs text-muted-foreground/70 font-medium">
              Library
            </p>
            {LIBRARY_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActiveNavigationRoute(href, location);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined}>
                  <span
                    className={`block px-3 py-2 text-sm rounded-lg transition-colors duration-150 inline-flex items-center gap-2.5 ${
                      active
                        ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                    }`}
                    onClick={onClose}
                    onMouseEnter={() => prefetchRoute(href)}
                    onFocus={() => prefetchRoute(href)}
                  >
                    <Icon size={16} weight={active ? "bold" : "regular"} className={active ? "text-primary" : "text-muted-foreground/70"} />
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Settings + Random */}
          <div className="px-3 py-2 space-y-0.5">
            {SETTINGS_LINKS.map(({ href, label, icon: Icon }) => {
              const active = isActiveNavigationRoute(href, location);
              return (
                <Link key={href} href={href} aria-current={active ? "page" : undefined}>
                  <span
                    className={`block px-3 py-2 text-sm rounded-lg transition-colors duration-150 inline-flex items-center gap-2.5 ${
                      active
                        ? "text-foreground font-medium bg-secondary/50 dark:bg-white/8"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/30 dark:hover:bg-white/5"
                    }`}
                    onClick={onClose}
                    onMouseEnter={() => prefetchRoute(href)}
                    onFocus={() => prefetchRoute(href)}
                  >
                    <Icon size={16} weight={active ? "bold" : "regular"} className={active ? "text-primary" : "text-muted-foreground/70"} />
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="border-t border-border/30 mx-3" />

          {/* Dark mode toggle */}
          <div className="px-3 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${dark ? "bg-primary/10" : "bg-amber-500/10"}`}>
                {dark ? (
                  <SunDim size={16} weight="regular" className="text-primary" />
                ) : (
                  <MoonStars size={16} weight="regular" className="text-amber-500" />
                )}
              </div>
              <span className="text-xs text-muted-foreground font-medium">{dark ? "Dark" : "Light"} mode</span>
            </div>
            <button
              type="button"
              onClick={onDarkToggle}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-200 cursor-pointer ${
                dark ? "border border-primary/60" : "border border-border/40"
              }`}
              role="switch"
              aria-checked={dark}
              aria-label="Dark mode"
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-all duration-200 ${
                  dark ? "translate-x-[18px]" : "translate-x-1"
                }`}
              />
            </button>
          </div>
    </nav>
  );
}
