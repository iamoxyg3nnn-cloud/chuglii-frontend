import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const NOTIF_QUERY_KEY = ["user", "notifications"];

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "offline";

let activeChannel: RealtimeChannel | null = null;
let currentUserId: string | null = null;
let sharedStatus: RealtimeStatus = "offline";
const listeners = new Set<(status: RealtimeStatus) => void>();

function publishStatus(status: RealtimeStatus) {
  sharedStatus = status;
  listeners.forEach((listener) => listener(status));
}

function statusFromSubscribe(status: string): RealtimeStatus {
  if (status === "SUBSCRIBED") return "live";
  if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") return "reconnecting";
  if (status === "CLOSED") return "offline";
  return "connecting";
}

/**
 * Subscribes to real-time INSERT/UPDATE/DELETE events on `user_notifications`
 * for the given user and invalidates the notifications query cache.
 *
 * One channel is shared by every caller (bell, page, settings). The hook also
 * returns the connection state so the UI can tell people whether live updates
 * are active, instead of silently falling back to polling without feedback.
 */
export function useRealtimeNotifications(userId: string | null | undefined): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(userId ? sharedStatus : "offline");

  useEffect(() => {
    if (!userId) {
      setStatus("offline");
      return;
    }

    const uid = userId;
    let active = true;

    const listener = (next: RealtimeStatus) => setStatus(next);
    listeners.add(listener);
    setStatus(sharedStatus);

    async function setup() {
      try {
        const sb = await getSupabase();
        if (!active || listeners.size === 0) return;

        if (activeChannel && currentUserId !== uid) {
          await sb.removeChannel(activeChannel).catch(() => {});
          activeChannel = null;
          currentUserId = null;
          publishStatus("connecting");
        }

        if (!activeChannel) {
          const channelName = `notif-${uid}-${Math.random().toString(36).slice(2, 8)}`;
          const channel = sb
            .channel(channelName)
            .on(
              "postgres_changes",
              {
                event: "*",
                schema: "public",
                table: "user_notifications",
                filter: `user_id=eq.${uid}`,
              },
              () => {
                queryClient.invalidateQueries({ queryKey: NOTIF_QUERY_KEY });
              },
            )
            .subscribe((nextStatus) => {
              const mapped = statusFromSubscribe(nextStatus);
              publishStatus(mapped);
              if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT") {
                console.warn(
                  `[realtime] notification subscription ${nextStatus.toLowerCase()}. ` +
                  "Polling will continue until the channel reconnects.",
                );
              }
            });

          activeChannel = channel;
          currentUserId = uid;
        }
      } catch (err: unknown) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        publishStatus("offline");
        console.warn("[realtime] notifications disabled:", msg);
      }
    }

    void setup();

    return () => {
      active = false;
      listeners.delete(listener);

      if (listeners.size === 0 && activeChannel) {
        const channel = activeChannel;
        activeChannel = null;
        currentUserId = null;
        void getSupabase()
          .then((sb) => sb.removeChannel(channel))
          .catch(() => {});
        publishStatus("offline");
      }
    };
  }, [userId, queryClient]);

  return status;
}
