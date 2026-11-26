import type { UserNotification } from "@/lib/user-api";

export type NotificationTone = "info" | "success" | "attention";
export type NotificationCategory = "request" | "recording" | "system";

export interface NotificationMeta {
  label: string;
  shortLabel: string;
  description: string;
  tone: NotificationTone;
  category: NotificationCategory;
}

const FALLBACK: NotificationMeta = {
  label: "Archive update",
  shortLabel: "Update",
  description: "A new update from the archive.",
  tone: "info",
  category: "system",
};

const META: Record<string, NotificationMeta> = {
  request_submitted: {
    label: "Request submitted",
    shortLabel: "Request",
    description: "Your recording request was received.",
    tone: "info",
    category: "request",
  },
  request_status: {
    label: "Request update",
    shortLabel: "Request",
    description: "The status of one of your requests changed.",
    tone: "success",
    category: "request",
  },
  recording_available: {
    label: "Recording available",
    shortLabel: "Recording",
    description: "A new recording matches one of your requests.",
    tone: "success",
    category: "recording",
  },
};

export function getNotificationMeta(type: string | undefined): NotificationMeta {
  return (type && META[type]) || FALLBACK;
}

export interface NotificationDayGroup {
  key: string;
  label: string;
  items: UserNotification[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (dayKey(date) === dayKey(today)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function groupNotificationsByDay(notifications: UserNotification[]): NotificationDayGroup[] {
  const groups: NotificationDayGroup[] = [];

  for (const notification of notifications) {
    const date = new Date(notification.created_at);
    const valid = !Number.isNaN(date.getTime());
    const key = valid ? dayKey(date) : "unknown";
    const label = valid ? dayLabel(date) : "Earlier";
    let group = groups.find((candidate) => candidate.key === key);

    if (!group) {
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(notification);
  }

  return groups;
}

export function formatExactTime(dateString: string | null | undefined): string | undefined {
  if (!dateString) return undefined;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
