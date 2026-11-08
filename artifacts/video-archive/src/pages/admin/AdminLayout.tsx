import { useAuth } from "@/contexts/AuthContext";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  SquaresFour, ListNumbers, UsersThree, Database, CaretLeft,
  Shield, SignOut, Crown, Megaphone,
} from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: SquaresFour, exact: true },
  { href: "/admin/requests", label: "Requests", icon: ListNumbers },
  { href: "/admin/users", label: "Users", icon: UsersThree },
  { href: "/admin/ads", label: "Ads", icon: Megaphone },
  { href: "/admin/cache", label: "Cache", icon: Database },
  { href: "/admin/premium", label: "Premium", icon: Crown },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, role, signOut } = useAuth();
  const [location] = useLocation();

  const isActive = (href: string, exact = false) => {
    if (exact) return location === href;
    return location.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="hidden lg:flex lg:flex-col w-64 border-r border-border/40 bg-card/30">
        <div className="p-5">
          <Link href="/admin">
            <div className="flex items-center gap-2.5 cursor-pointer">
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Shield size={16} weight="duotone" className="text-primary" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight">Admin</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Control Panel</div>
              </div>
            </div>
          </Link>
        </div>

        <Separator />

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => (
            <Link key={href} href={href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer",
                  isActive(href, exact)
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border border-transparent",
                )}
              >
                <Icon size={16} className="shrink-0" />
                {label}
              </div>
            </Link>
          ))}
        </nav>

        <Separator />

        <div className="p-3 space-y-2">
          <Link href="/">
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-md hover:bg-accent/50">
              <CaretLeft size={14} />
              Back to site
            </div>
          </Link>

          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {user?.email?.charAt(0).toUpperCase() ?? "A"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                {user?.email ?? "Admin"}
              </div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                {role}
              </div>
            </div>
            <button
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Sign out"
            >
              <SignOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="lg:hidden border-b border-border/40 bg-card/20">
          <div className="flex items-center justify-between px-4 h-14">
            <Link href="/admin">
              <div className="flex items-center gap-2">
                <Shield size={16} weight="duotone" className="text-primary" />
                <span className="text-sm font-bold">Admin</span>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <span className="max-w-32 truncate text-[11px] text-muted-foreground">
                {user?.email ?? "Admin"}
              </span>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out of admin"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <SignOut size={16} />
              </button>
            </div>
          </div>
          <nav
            aria-label="Admin navigation"
            className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:thin]"
          >
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <Link key={href} href={href}>
                  <div
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors",
                      active
                        ? "border-primary/20 bg-primary/10 text-primary"
                        : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon size={14} className="shrink-0" />
                    {label}
                  </div>
                </Link>
              );
            })}
            <Link href="/">
              <div className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-transparent px-3 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground">
                <CaretLeft size={14} />
                Back to site
              </div>
            </Link>
          </nav>
        </header>

        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
