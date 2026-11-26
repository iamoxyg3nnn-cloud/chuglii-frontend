import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { Layout } from "@/components/Layout";
import { AdBanner } from "@/components/ads/AdBanner";
import { AdLeaderboard } from "@/components/ads/AdLeaderboard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserNotification } from "@/lib/user-api";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";
import { getNotificationAction } from "@/lib/notification-actions";
import {
  formatExactTime,
  getNotificationMeta,
  groupNotificationsByDay,
  type NotificationCategory,
  type NotificationTone,
} from "@/lib/notification-meta";
import { formatRelativeTime } from "@/lib/formatters";
import { toast } from "@/hooks/use-toast";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  Bell,
  BellRinging,
  BellSlash,
  Check,
  CheckCircle,
  Checks,
  Gear,
  Info,
  MagnifyingGlass,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const NOTIF_PAGE_SIZE = 50;

type Filter = "all" | "unread" | NotificationCategory;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "request", label: "Requests" },
  { value: "recording", label: "Recordings" },
];

const TONE_ICONS: Record<NotificationTone, typeof Bell> = {
  info: Info,
  success: CheckCircle,
  attention: WarningCircle,
};

const TONE_CLASSES: Record<NotificationTone, string> = {
  info: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-500",
  attention: "bg-amber-500/10 text-amber-500",
};

const STATUS_LABEL: Record<string, string> = {
  live: "Live",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  offline: "Refresh only",
};

export default function Notifications() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const realtimeStatus = useRealtimeNotifications(user?.id);

  const { data: stats } = useQuery({
    queryKey: ["user", "notifications", "stats"],
    queryFn: () => userApi.getNotificationStats(),
    enabled: !!user,
    staleTime: 10_000,
    refetchInterval: realtimeStatus === "live" ? 120_000 : 30_000,
    retry: 1,
  });

  useEffect(() => {
    if (!loading && !user) setLocation("/login");
  }, [user, loading, setLocation]);

  const {
    data: pages,
    isLoading,
    isError,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    dataUpdatedAt,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["user", "notifications", "infinite"],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await userApi.getNotifications({ limit: NOTIF_PAGE_SIZE, offset: pageParam });
      return Array.isArray(res) ? res : [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!Array.isArray(lastPage) || lastPage.length < NOTIF_PAGE_SIZE) return undefined;
      return allPages.length * NOTIF_PAGE_SIZE;
    },
    enabled: !!user,
    staleTime: 10_000,
    refetchInterval: realtimeStatus === "live" ? 120_000 : 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const notifications = useMemo(() => {
    if (!pages?.pages) return [];
    return pages.pages.filter(Array.isArray).flat().filter(Boolean) as UserNotification[];
  }, [pages]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return notifications.filter((n) => {
      const meta = getNotificationMeta(n.type);
      if (filter === "unread" && n.is_read) return false;
      if (filter !== "all" && filter !== "unread" && meta.category !== filter) return false;
      if (needle && !n.message.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [filter, notifications, search]);

  const groups = useMemo(() => groupNotificationsByDay(filtered), [filtered]);
  const unread = stats?.unread ?? notifications.filter((n) => !n.is_read).length;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["user", "notifications"] });
  };

  const markAll = useTrackedMutation({
    mutationFn: () => userApi.markAllRead(),
    onSuccess: () => {
      invalidate();
      toast({ title: "All notifications marked read", duration: 2500 });
    },
    onError: () => toast({ title: "Could not update notifications", variant: "destructive" }),
  });

  const markOne = useTrackedMutation({
    mutationFn: (id: number) => userApi.markAsRead(id),
    onSuccess: invalidate,
    onError: () => toast({ title: "Could not update notification", variant: "destructive" }),
  });

  const deleteOne = useTrackedMutation({
    mutationFn: (id: number) => userApi.deleteNotification(id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Notification removed", duration: 2500 });
    },
    onError: () => toast({ title: "Could not delete notification", variant: "destructive" }),
  });

  const clearAll = useTrackedMutation({
    mutationFn: () => userApi.clearNotifications(),
    onSuccess: () => {
      setConfirmClear(false);
      invalidate();
      toast({ title: "Notification center cleared", duration: 2500 });
    },
    onError: () => toast({ title: "Could not clear notifications", variant: "destructive" }),
  });

  if (!user) return null;

  const statusLabel = STATUS_LABEL[realtimeStatus] ?? "Refresh only";
  const lastChecked = dataUpdatedAt ? formatRelativeTime(new Date(dataUpdatedAt).toISOString()) : "not yet";

  return (
    <Layout>
      <div className="section-accent min-h-screen">
        <div className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">
          <header className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/70 p-6 shadow-sm backdrop-blur-sm sm:p-8">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
            />
            <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                  <BellRinging size={13} weight="duotone" />
                  Notification center
                </span>
                <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Stay in the loop.
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Requests, status changes and newly matched recordings, all in one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[104px] rounded-2xl border border-border/40 bg-background/60 px-4 py-3">
                  <p className="text-2xl font-bold leading-none text-foreground">{unread}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Unread</p>
                </div>
                <div className="min-w-[132px] rounded-2xl border border-border/40 bg-background/60 px-4 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${
                        realtimeStatus === "live"
                          ? "bg-emerald-500"
                          : realtimeStatus === "offline"
                            ? "bg-muted-foreground/50"
                            : "bg-amber-500"
                      }`}
                    />
                    {statusLabel}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Live delivery</p>
                </div>
              </div>
            </div>
          </header>

          <AdLeaderboard className="mt-6" />

          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:max-w-sm" role="search">
              <MagnifyingGlass
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search notifications"
                aria-label="Search notifications"
                className="h-10 w-full rounded-xl border border-border/50 bg-card/70 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 cursor-pointer"
                >
                  <X size={13} weight="bold" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex gap-1 overflow-x-auto rounded-xl border border-border/40 bg-card/60 p-1"
                role="group"
                aria-label="Filter notifications"
              >
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={`h-8 shrink-0 rounded-lg px-3 text-xs font-medium transition-colors cursor-pointer ${
                      filter === option.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                disabled={isFetching && !isFetchingNextPage}
                aria-label="Refresh notifications"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/40 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <ArrowsClockwise size={16} className={isFetching ? "animate-spin" : ""} />
              </button>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="flex h-10 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3.5 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <Checks size={15} weight="bold" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
            <section aria-label="Notification list" className="min-w-0">
              {isLoading ? (
                <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3 rounded-2xl border border-border/40 bg-card/60 p-4">
                      <div className="h-10 w-10 rounded-xl bg-secondary/50 animate-pulse" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-3 w-1/3 rounded bg-secondary/50 animate-pulse" />
                        <div className="h-3 w-4/5 rounded bg-secondary/40 animate-pulse" />
                        <div className="h-2.5 w-1/4 rounded bg-secondary/30 animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : isError ? (
                <div role="alert" className="rounded-2xl border border-border/40 bg-card/70 px-6 py-14 text-center">
                  <WarningCircle size={32} className="mx-auto text-amber-500" />
                  <h2 className="mt-3 text-base font-semibold text-foreground">
                    We couldn't load your notifications
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Check your connection and try again. Nothing has been removed.
                  </p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <ArrowsClockwise size={14} />
                    Try again
                  </button>
                </div>
              ) : notifications.length === 0 ? (
                <div className="rounded-2xl border border-border/40 bg-card/60 px-6 py-16 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/50 text-muted-foreground">
                    <BellSlash size={26} weight="duotone" />
                  </div>
                  <h2 className="mt-4 text-base font-semibold text-foreground">Nothing here yet</h2>
                  <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                    When you submit a request or a matching recording is added, you'll see it here.
                  </p>
                  <Link
                    href="/request"
                    className="mt-4 inline-flex h-9 items-center rounded-lg border border-border/50 px-4 text-xs font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                  >
                    Request a recording
                  </Link>
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-2xl border border-border/40 bg-card/60 px-6 py-14 text-center">
                  <MagnifyingGlass size={28} className="mx-auto text-muted-foreground" />
                  <h2 className="mt-3 text-base font-semibold text-foreground">No matching notifications</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try a different filter or clear your search.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setFilter("all");
                      setSearch("");
                    }}
                    className="mt-4 inline-flex h-9 items-center rounded-lg border border-border/50 px-4 text-xs font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors cursor-pointer"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <div className="mb-2 flex items-center gap-3 px-1">
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </h2>
                        <div className="h-px flex-1 bg-border/40" />
                        <span className="text-[11px] text-muted-foreground">{group.items.length}</span>
                      </div>
                      <ul className="space-y-2">
                        {group.items.map((n: UserNotification) => {
                          const meta = getNotificationMeta(n.type);
                          const Icon = TONE_ICONS[meta.tone];
                          const action = getNotificationAction(n);
                          return (
                            <li
                              key={n.id}
                              className={`group relative flex gap-3 rounded-2xl border p-4 transition-all sm:gap-4 ${
                                n.is_read
                                  ? "border-border/40 bg-card/50 hover:border-border/70"
                                  : "border-primary/25 bg-primary/[0.045] shadow-sm hover:border-primary/40"
                              }`}
                            >
                              {!n.is_read && (
                                <span
                                  aria-hidden="true"
                                  className="absolute left-4 top-5 bottom-5 w-0.5 rounded-full bg-primary sm:left-5"
                                />
                              )}
                              <span
                                aria-hidden="true"
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${TONE_CLASSES[meta.tone]}`}
                              >
                                <Icon size={19} weight="duotone" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {meta.label}
                                  </span>
                                  {!n.is_read && (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                      New
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1.5 text-sm leading-relaxed text-foreground break-words">
                                  {n.message}
                                </p>
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                                  <time
                                    dateTime={n.created_at}
                                    title={formatExactTime(n.created_at)}
                                    className="text-[11px] text-muted-foreground"
                                  >
                                    {formatRelativeTime(n.created_at)}
                                  </time>
                                  {action && (
                                    <Link
                                      href={action.href}
                                      onClick={() => {
                                        if (!n.is_read) markOne.mutate(n.id);
                                      }}
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                                    >
                                      {action.label}
                                      <ArrowSquareOut size={12} weight="bold" />
                                    </Link>
                                  )}
                                  {!n.is_read && (
                                    <button
                                      type="button"
                                      onClick={() => markOne.mutate(n.id)}
                                      disabled={markOne.isPending}
                                      aria-label={`Mark read: ${n.message}`}
                                      className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <Check size={12} weight="bold" />
                                      Mark read
                                    </button>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => deleteOne.mutate(n.id)}
                                disabled={deleteOne.isPending}
                                aria-label={`Delete notification: ${n.message}`}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-70 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-40 cursor-pointer"
                              >
                                <Trash size={15} />
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}

                  {hasNextPage && (
                    <div className="flex justify-center pt-2">
                      <button
                        type="button"
                        onClick={() => void fetchNextPage()}
                        disabled={isFetchingNextPage}
                        aria-busy={isFetchingNextPage}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-4 text-xs font-semibold text-foreground hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {isFetchingNextPage ? "Loading older notifications" : "Load older notifications"}
                      </button>
                    </div>
                  )}

                  <div className="flex flex-col gap-3 border-t border-border/30 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] text-muted-foreground">
                      Showing {filtered.length} of {notifications.length} loaded notifications
                    </p>
                    <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(true)}
                        className="inline-flex h-9 items-center gap-2 self-start rounded-lg px-3 text-xs font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                      >
                        <Trash size={14} />
                        Clear all
                      </button>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Clear every notification?</DialogTitle>
                          <DialogDescription>
                            This removes all {notifications.length} notifications from your account.
                            Requests themselves are not affected. This cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="mt-5 flex justify-end gap-2">
                          <Dialog.Close asChild>
                            <button
                              type="button"
                              className="h-9 rounded-lg border border-border/50 px-4 text-xs font-semibold text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </Dialog.Close>
                          <button
                            type="button"
                            onClick={() => clearAll.mutate()}
                            disabled={clearAll.isPending}
                            className="h-9 rounded-lg bg-destructive px-4 text-xs font-semibold text-destructive-foreground hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                          >
                            {clearAll.isPending ? "Clearing" : "Clear all"}
                          </button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              )}
            </section>

            <aside className="space-y-4" aria-label="Notification information">
              <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
                <h2 className="text-xs font-semibold text-foreground">Delivery status</h2>
                <dl className="mt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">Connection</dt>
                    <dd className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          realtimeStatus === "live"
                            ? "bg-emerald-500"
                            : realtimeStatus === "offline"
                              ? "bg-muted-foreground/50"
                              : "bg-amber-500"
                        }`}
                      />
                      {statusLabel}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">Last checked</dt>
                    <dd className="text-[11px] font-semibold text-foreground">{lastChecked}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">Loaded</dt>
                    <dd className="text-[11px] font-semibold text-foreground">
                      {notifications.length} / {stats?.total ?? notifications.length}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-2xl border border-border/40 bg-card/60 p-4">
                <div className="flex items-center gap-2">
                  <Gear size={15} weight="duotone" className="text-primary" />
                  <h2 className="text-xs font-semibold text-foreground">Fine-tune alerts</h2>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Choose which events reach you, plus sound and vibration preferences.
                </p>
                <Link
                  href="/settings"
                  className="mt-3 inline-flex h-8 items-center rounded-lg border border-border/50 px-3 text-[11px] font-semibold text-foreground hover:border-primary/50 hover:text-primary transition-colors"
                >
                  Notification settings
                </Link>
              </div>

              <div className="rounded-2xl border border-dashed border-border/50 bg-card/40 p-4">
                <Info size={15} className="text-muted-foreground" />
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Request and recording notifications include a shortcut to the relevant page.
                </p>
              </div>
            </aside>
          </div>

          <div className="mt-10 flex justify-center">
            <AdBanner file="medium-rect-300x250" />
          </div>
        </div>
      </div>
    </Layout>
  );
}

// asset-cache-bust: 2026-11-26T1
