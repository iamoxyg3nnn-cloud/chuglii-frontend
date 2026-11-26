import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { usePremium } from "@/contexts/PremiumContext";
import {
  UserCircle,
  Gear,
  SignOut,
  BookmarkSimple,
  Clock,
  ClockCounterClockwise,
  Playlist,
  FolderSimplePlus,
  Heart,
  Bell,
  ShieldCheck,
  CaretDown,
  PaperPlaneTilt,
  Crown,
} from "@phosphor-icons/react";

export function UserMenu() {
  const { user, signOut, role } = useAuth();
  const { adsEnabled, config } = usePremium();
  const premiumOffered = adsEnabled && config !== undefined && config.ads_enabled !== false;
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <Link href="/login">
          <span className="hidden sm:inline-flex items-center h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/50 hover:border-border rounded-lg transition-colors">
            Sign in
          </span>
        </Link>
        <Link href="/signup">
          <span className="hidden sm:inline-flex items-center h-8 px-3 text-xs font-semibold border border-primary/30 text-primary hover:border-primary/60 rounded-lg transition-colors">
            Sign up
          </span>
        </Link>
        <Link href="/login">
          <span className="sm:hidden flex items-center justify-center w-8 h-8 text-muted-foreground hover:text-foreground transition-colors rounded-lg">
            <UserCircle size={18} weight="regular" />
          </span>
        </Link>
      </div>
    );
  }

  const displayName = (user.user_metadata?.username as string) ?? user.email?.split("@")[0] ?? "Account";
  const initials = displayName.slice(0, 2).toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    setLocation("/");
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-8 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg cursor-pointer"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <div className="w-6 h-6 rounded-full border border-primary/40 flex items-center justify-center text-[10px] font-bold text-red-400">
          {initials}
        </div>
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 glass-dropdown rounded-xl z-50 max-h-[calc(100dvh-4.5rem)] overflow-y-auto overscroll-contain shadow-2xl">
          <Link href="/profile">
            <div
              onClick={() => setOpen(false)}
              className="px-3 py-2.5 border-b border-border/40 hover:bg-secondary/40 transition-colors cursor-pointer group"
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                  {displayName}
                </div>
                <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors">
                  Profile →
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">{user.email}</div>
              {role && role !== "user" && (
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  <ShieldCheck size={12} weight="bold" />
                  {role}
                </span>
              )}
            </div>
          </Link>

          <div className="py-1">
            {[
              { href: "/profile", label: "Profile & Activity", Icon: UserCircle },
              ...(premiumOffered ? [{ href: "/premium", label: "Go Premium", Icon: Crown }] : []),
              { href: "/bookmarks", label: "Bookmarks", Icon: BookmarkSimple },
              { href: "/history", label: "History", Icon: ClockCounterClockwise },
              { href: "/watch-later", label: "Watch Later", Icon: Clock },
              { href: "/collections", label: "Collections", Icon: FolderSimplePlus },
              { href: "/my-requests", label: "My Requests", Icon: PaperPlaneTilt },
              { href: "/following", label: "Following", Icon: Heart },
              { href: "/notifications", label: "Notifications", Icon: Bell },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href}>
                <span
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
                >
                  <Icon size={15} weight="regular" className="shrink-0" />
                  {label}
                </span>
              </Link>
            ))}
          </div>

          {(role === "admin" || role === "moderator") && (
            <div className="border-t border-border/40 py-1">
              <Link href="/admin">
                <span
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-xs text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                >
                  <ShieldCheck size={15} weight="regular" className="shrink-0" />
                  Admin panel
                </span>
              </Link>
            </div>
          )}

          <div className="border-t border-border/40 py-1">
            <Link href="/settings">
              <span
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
              >
                <Gear size={15} weight="regular" className="shrink-0" />
                Settings
              </span>
            </Link>
            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            >
              <SignOut size={15} weight="regular" className="shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
