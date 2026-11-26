import { useEffect, useRef } from "react";

export interface SoundNotification {
  id?: number;
  is_read: boolean;
  message?: string;
  type?: string;
}

export type NotifiedNotification = Pick<SoundNotification, "id" | "message" | "type">;

/**
 * Generates a short two-tone notification chime using the Web Audio API.
 * No audio files needed - the sound is synthesized on the fly.
 */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedCtx || sharedCtx.state === "closed") {
      sharedCtx = new AudioContext();
    } else if (sharedCtx.state === "suspended") {
      void sharedCtx.resume();
    }
    return sharedCtx;
  } catch {
    return null;
  }
}

function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    const first = ctx.createOscillator();
    first.type = "sine";
    first.frequency.setValueAtTime(880, ctx.currentTime);
    first.connect(gain);
    first.start(ctx.currentTime);
    first.stop(ctx.currentTime + 0.15);

    const second = ctx.createOscillator();
    second.type = "sine";
    second.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    second.connect(gain);
    second.start(ctx.currentTime + 0.12);
    second.stop(ctx.currentTime + 0.35);
  } catch {
    // Web Audio API unavailable - fail quietly.
  }
}

function vibrate() {
  try {
    if ("vibrate" in navigator) navigator.vibrate(50);
  } catch {
    // Vibration API unavailable - fail quietly.
  }
}

/**
 * Fires feedback for notifications whose IDs are newer than the last seen ID.
 * Using notification identity instead of the unread count prevents false
 * alerts when a list refetch reorders rows or an older page is loaded.
 */
export function useNotificationSound(
  notifications: SoundNotification[],
  enabled = true,
  onNewNotification?: (notification: NotifiedNotification, count: number) => void,
  opts?: { sound?: boolean; vibration?: boolean; resetKey?: string | null },
) {
  const lastSeenIdRef = useRef<number | null>(null);
  const resetKeyRef = useRef<string | null | undefined>(opts?.resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== opts?.resetKey) {
      resetKeyRef.current = opts?.resetKey;
      lastSeenIdRef.current = null;
    }
  }, [opts?.resetKey]);

  useEffect(() => {
    if (!enabled) {
      lastSeenIdRef.current = null;
      return;
    }

    const ids = notifications
      .map((n) => n.id)
      .filter((id): id is number => typeof id === "number");
    if (ids.length === 0) return;

    const maxId = Math.max(...ids);
    const previous = lastSeenIdRef.current;

    if (previous === null) {
      lastSeenIdRef.current = maxId;
      return;
    }
    // Never move the watermark backwards: deleting the newest row must not
    // cause the next arrival to be treated as an old notification.
    if (maxId <= previous) return;

    lastSeenIdRef.current = maxId;

    const fresh = notifications
      .filter((n) => typeof n.id === "number" && n.id > previous && !n.is_read)
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    if (fresh.length === 0) return;

    if (opts?.sound !== false) playNotificationSound();
    if (opts?.vibration !== false) vibrate();

    if (onNewNotification) {
      onNewNotification(
        {
          id: fresh[0].id,
          message: fresh[0].message,
          type: fresh[0].type,
        },
        fresh.length,
      );
    }
  }, [notifications, enabled, onNewNotification, opts?.sound, opts?.vibration, opts?.resetKey]);
}
