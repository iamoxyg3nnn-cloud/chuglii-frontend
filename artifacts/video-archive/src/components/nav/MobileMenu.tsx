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
  Flame,
  GlobeHemisphereWest,
  FilmStrip,
  Broadcast,
  Eye,
  Magnet,
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
            {/* Leaks Categories in Mobile Menu */}
            <div className="space-y-1 pt-1">
              <p className="px-3 py-1 text-xs text-muted-foreground/70 font-medium flex items-center gap-1.5">
                <Flame size={13} weight="fill" className="text-rose-500" />
                <span>Leaks & Exclusives</span>
              </p>
              <Link href="/leak?category=viral-mms" aria-current={isActiveNavigationRoute("/leak", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/leak", location)
                      ? "text-rose-400 font-medium bg-rose-500/15 border border-rose-500/30"
                      : "text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/leak")}
                  onFocus={() => prefetchRoute("/leak")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Flame size={16} weight="fill" className="text-rose-500" />
                    Viral MMS
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 uppercase">
                    9.2k
                  </span>
                </span>
              </Link>
              <Link href="/onlyfans" aria-current={isActiveNavigationRoute("/onlyfans", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/onlyfans", location)
                      ? "text-cyan-400 font-medium bg-cyan-500/15 border border-cyan-500/30"
                      : "text-cyan-400/90 hover:text-cyan-300 hover:bg-cyan-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/onlyfans")}
                  onFocus={() => prefetchRoute("/onlyfans")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Broadcast size={16} weight="fill" className="text-cyan-400" />
                    OnlyFans Leaks
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 uppercase">
                    4K/HD
                  </span>
                </span>
              </Link>
              <Link href="/japanese" aria-current={isActiveNavigationRoute("/japanese", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/japanese", location)
                      ? "text-rose-400 font-medium bg-rose-500/15 border border-rose-500/30"
                      : "text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/japanese")}
                  onFocus={() => prefetchRoute("/japanese")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <GlobeHemisphereWest size={16} weight="fill" className="text-rose-500" />
                    Japanese (JAV)
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 uppercase">
                    Hot
                  </span>
                </span>
              </Link>
              <Link href="/myanmar" aria-current={isActiveNavigationRoute("/myanmar", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/myanmar", location)
                      ? "text-rose-400 font-medium bg-rose-500/15 border border-rose-500/30"
                      : "text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/myanmar")}
                  onFocus={() => prefetchRoute("/myanmar")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <FilmStrip size={16} weight="fill" className="text-rose-500" />
                    Myanmar
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 uppercase">
                    New
                  </span>
                </span>
              </Link>
              <Link href="/voyeurhouse" aria-current={isActiveNavigationRoute("/voyeurhouse", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/voyeurhouse", location)
                      ? "text-amber-400 font-medium bg-amber-500/15 border border-amber-500/30"
                      : "text-amber-400/90 hover:text-amber-300 hover:bg-amber-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/voyeurhouse")}
                  onFocus={() => prefetchRoute("/voyeurhouse")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Eye size={16} weight="fill" className="text-amber-400" />
                    Voyeur House
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase">
                    5 SRC
                  </span>
                </span>
              </Link>
              <Link href="/chinese" aria-current={isActiveNavigationRoute("/chinese", location) ? "page" : undefined}>
                <span
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-all duration-150 inline-flex items-center justify-between ${
                    isActiveNavigationRoute("/chinese", location)
                      ? "text-sky-400 font-medium bg-sky-500/15 border border-sky-500/30"
                      : "text-sky-400/90 hover:text-sky-300 hover:bg-sky-500/10"
                  }`}
                  onClick={onClose}
                  onMouseEnter={() => prefetchRoute("/chinese")}
                  onFocus={() => prefetchRoute("/chinese")}
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Magnet size={16} weight="fill" className="text-sky-400" />
                    Chinese
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 uppercase">
                    HD+MG
                  </span>
                </span>
              </Link>
            </div>
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
