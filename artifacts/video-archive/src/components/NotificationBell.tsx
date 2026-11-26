import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTrackedMutation } from "@/contexts/SyncStatusContext";
import { useAuth } from "@/contexts/AuthContext";
import { userApi, type UserNotification } from "@/lib/user-api";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { getNotificationAction } from "@/lib/notification-actions";
import {
  getNotificationMeta,
  formatExactTime,
  type NotificationTone,
} from "@/lib/notification-meta";
import { fetchSoundPreferences } from "@/lib/sound-prefs";
import { formatRelativeTime } from "@/lib/formatters";
import { toast } from "@/hooks/use-toast";
import {
  ArrowsClockwise,
  ArrowSquareOut,
  Bell,
  BellRinging,
  Check,
  CheckCircle,
  Checks,
  Info,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

type Filter = "all" | "unread";

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
  live: "Live updates",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  offline: "Refresh only",
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [soundOpts, setSoundOpts] = useState({ sound: true, vibration: true });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

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
    if (!user) return;
    let active = true;
    fetchSoundPreferences()
      .then((prefs) => {
        if (active) setSoundOpts({ sound: prefs.sound_enabled, vibration: prefs.vibration_enabled });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.id]);

  const {
    data: notifications = [],
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["user", "notifications"],
    queryFn: () => userApi.getNotifications({ limit: 50 }),
    enabled: !!user,
    staleTime: 10_000,
    // Realtime is the primary channel. Polling remains as a safety net only.
    refetchInterval: realtimeStatus === "live" ? 120_000 : 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const onNewNotification = useCallback((n: { message?: string; type?: string }, count: number) => {
    const label = getNotificationMeta(n.type).shortLabel;
    toast({
      title: count > 1 ? `${count} new notifications` : `New ${label.toLowerCase()}`,
      description: n.message || "A new notification arrived.",
      duration: 5000,
    });
  }, []);

  useNotificationSound(notifications, !!user, onNewNotification, {
    sound: soundOpts.sound,
    vibration: soundOpts.vibration,
    resetKey: user?.id ?? null,
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["user", "notifications"] });
  }, [queryClient]);

  const markAllRead = useTrackedMutation({
    mutationFn: () => userApi.markAllRead(),
    onSuccess: invalidate,
    onError: () => toast({ title: "Could not mark notifications read", variant: "destructive" }),
  });

  const markOneRead = useTrackedMutation({
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

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const unread = stats?.unread ?? notifications.filter((n: UserNotification) => !n.is_read).length;

  const visible = useMemo(() => {
    const list = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
    return list.slice(0, 12);
  }, [filter, notifications]);

  if (!user) return null;

  const statusLabel = STATUS_LABEL[realtimeStatus] ?? "Refresh only";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex items-center justify-center w-9 h-9 text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors rounded-lg cursor-pointer"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-haspopup="dialog"
      >
        {realtimeStatus === "live" ? (
          <BellRinging size={18} weight="regular" />
        ) : (
          <Bell size={18} weight="regular" />
        )}
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 border-2 border-background bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center leading-none"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          id="notification-panel"
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className="absolute right-0 top-full mt-2 w-[min(22rem,calc(100vw-2rem))] glass-dropdown rounded-2xl z-50 max-h-[calc(100dvh-4.5rem)] overflow-hidden shadow-2xl outline-none animate-fade-in-scale"
        >
          <div className="px-4 pt-3.5 pb-3 border-b border-border/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors cursor-pointer"
                aria-label="Refresh notifications"
              >
                <ArrowsClockwise size={14} className={isFetching ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex gap-1 p-0.5 rounded-lg bg-secondary/50" role="group" aria-label="Filter notifications">
                {(["all", "unread"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      filter === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {value === "all" ? "All" : "Unread"}
                    <span className="ml-1 text-muted-foreground">
                      {value === "all" ? (stats?.total ?? notifications.length) : unread}
                    </span>
                  </button>
                ))}
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="h-7 px-2 flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors rounded-md hover:bg-primary/10 disabled:opacity-50 cursor-pointer"
                >
                  <Checks size={13} weight="bold" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <div className="p-3 space-y-2" aria-busy="true" aria-label="Loading notifications">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3 p-2">
                    <div className="h-9 w-9 rounded-xl bg-secondary/50 animate-pulse" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3 w-4/5 rounded bg-secondary/50 animate-pulse" />
                      <div className="h-2.5 w-1/3 rounded bg-secondary/40 animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div role="alert" className="px-4 py-8 text-center space-y-2">
                <WarningCircle size={24} className="mx-auto text-amber-500" />
                <p className="text-xs font-medium text-foreground">Could not load notifications</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="text-[11px] text-primary hover:underline cursor-pointer"
                >
                  Try again
                </button>
              </div>
            ) : visible.length === 0 ? (
              <div className="px-6 py-10 text-center space-y-2">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary/50 text-muted-foreground">
                  <Bell size={20} weight="duotone" />
                </div>
                <p className="text-xs font-semibold text-foreground">
                  {filter === "unread" && notifications.length > 0
                    ? "You're all caught up"
                    : "No notifications yet"}
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {filter === "unread" && notifications.length > 0
                    ? "Nothing needs your attention right now."
                    : "Requests, status changes and new recordings will appear here."}
                </p>
                {filter === "unread" && notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className="text-[11px] text-primary hover:underline cursor-pointer"
                  >
                    View all notifications
                  </button>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {visible.map((n: UserNotification) => {
                  const meta = getNotificationMeta(n.type);
                  const Icon = TONE_ICONS[meta.tone];
                  const action = getNotificationAction(n);
                  return (
                    <li
                      key={n.id}
                      className={`relative flex gap-3 px-4 py-3 transition-colors ${
                        n.is_read ? "" : "bg-primary/[0.035]"
                      }`}
                    >
                      {!n.is_read && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-primary"
                        />
                      )}
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE_CLASSES[meta.tone]}`}
                      >
                        <Icon size={16} weight="duotone" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {meta.shortLabel}
                          </p>
                          {!n.is_read && <span className="sr-only">Unread</span>}
                        </div>
                        <p className="mt-0.5 text-xs leading-relaxed text-foreground break-words">
                          {n.message}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span
                            className="text-[10px] text-muted-foreground"
                            title={formatExactTime(n.created_at)}
                          >
                            {formatRelativeTime(n.created_at)}
                          </span>
                          {action && (
                            <Link
                              href={action.href}
                              onClick={() => {
                                setOpen(false);
                                if (!n.is_read) markOneRead.mutate(n.id);
                              }}
                              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline"
                            >
                              {action.label}
                              <ArrowSquareOut size={10} weight="bold" />
                            </Link>
                          )}
                          {!n.is_read && (
                            <button
                              type="button"
                              onClick={() => markOneRead.mutate(n.id)}
                              disabled={markOneRead.isPending}
                              aria-label={`Mark read: ${n.message}`}
                              className="inline-flex h-6 items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <Check size={11} weight="bold" />
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
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Trash size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-2.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
            >
              Open notification center
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 items-center gap-1 px-2 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors cursor-pointer"
            >
              <X size={12} weight="bold" />
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
