import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

/**
 * Approval → recording pool bridge.
 *
 * The archive backend records from `channel_assignments` (see
 * backend/manager/manager.go `LoadPooledConfig`: "the channel_assignments
 * table is the sole source of truth"). Approving a performer request on the
 * frontend admin page used to only flip `requests.status`; nothing ever told
 * the fleet to start recording that performer. This module inserts the pool
 * row (and the matching `channels` catalogue row) when a request is approved,
 * mirroring backend AddToPool / Coordinator.CreateChannelAssignment.
 */

// Defaults match the backend's pool editor (router_handler.go AddToPool):
// 2160p, 60fps, 90-minute rotation. Omitted columns keep their DB defaults.
const DEFAULT_RESOLUTION = 2160;
const DEFAULT_FRAMERATE = 60;
const DEFAULT_MAX_DURATION = 90;
// channel_assignments.min_duration_before_upload defaults to 1200s; the backend
// leaves it alone when adding from the pool editor, so we do the same.

const VALID_SITES = new Set(["chaturbate", "stripchat"]);

/** Path segments in cam-site URLs that are never the model's username. */
const NON_USERNAME_SEGMENTS = new Set([
  "cam",
  "cams",
  "model",
  "models",
  "room",
  "rooms",
  "profile",
  "profiles",
  "tag",
  "tags",
  "api",
  "en",
  "www",
  "m",
]);

export interface RequestPoolRow {
  id: number;
  platform: string;
  performer_username: string | null;
  stream_link: string | null;
}

export interface PoolTarget {
  username: string;
  site: "chaturbate" | "stripchat";
}

/** Raised when a request cannot be mapped to a pool channel (bad/missing data). */
export class MissingPerformerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingPerformerError";
  }
}

/**
 * Normalize a cam-site username the same way the Go backend does
 * (entity.ChannelConfig.Sanitize): lowercase, keep letters/digits/_/-.
 */
export function normalizePerformerUsername(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

/**
 * Pull a username out of a Chaturbate/Stripchat profile URL. Handles the
 * shapes admins paste in practice:
 *   https://chaturbate.com/alice/
 *   https://www.chaturbate.com/alice/?tour=abc
 *   https://stripchat.com/cam/alice
 *   https://stripchat.com/alice?utm_source=...
 *   stripchat.com/#/alice
 */
export function usernameFromStreamLink(link: string | null | undefined): string {
  const raw = (link ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const segments = [
      ...url.pathname.split("/"),
      ...url.hash.replace(/^#/, "").split("/"),
    ]
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .map((segment) => segment.trim())
      .filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i--) {
      if (NON_USERNAME_SEGMENTS.has(segments[i].toLowerCase())) continue;
      const username = normalizePerformerUsername(segments[i]);
      if (username) return username;
    }
  } catch {
    // Fall through to the regex below for malformed URLs.
  }

  const match = raw.match(/(?:chaturbate\.com|stripchat\.com)\/(?:cam\/)?([^/?#]+)/i);
  return match ? normalizePerformerUsername(match[1]) : "";
}

/**
 * Resolve the site + username a request should be recorded under.
 * Throws MissingPerformerError with an admin-readable message when the
 * request has neither a username nor a usable profile URL.
 */
export function resolvePoolTarget(row: RequestPoolRow): PoolTarget {
  const site = row.platform?.trim().toLowerCase();
  if (!site || !VALID_SITES.has(site)) {
    throw new MissingPerformerError(
      `Request #${row.id} has an unsupported platform "${row.platform ?? ""}". Only chaturbate and stripchat can be recorded.`,
    );
  }

  const username =
    normalizePerformerUsername(row.performer_username) ||
    usernameFromStreamLink(row.stream_link);

  if (!username) {
    throw new MissingPerformerError(
      `Request #${row.id} has no performer username and no profile link to derive one from. ` +
        `Edit the request to include one before approving it.`,
    );
  }

  return { username, site: site as PoolTarget["site"] };
}

/**
 * Add the approved request's performer to the recording pool.
 *
 * Idempotent: uses ON CONFLICT DO NOTHING for both tables, so approving the
 * same request twice (or approving a performer another user already requested)
 * never resets an existing channel's config, assignment, or live/recording
 * state. The `channels` catalogue insert is best-effort, exactly like the
 * backend's EnsureChannelExists — the pool row is what actually matters.
 */
export async function addRequestToPool(row: RequestPoolRow): Promise<PoolTarget> {
  const target = resolvePoolTarget(row);

  const { error: catalogueError } = await supabase.from("channels").upsert(
    {
      username: target.username,
      // channels.created_at is BIGINT NOT NULL; the schema default is epoch ms.
      created_at: Date.now(),
    },
    { onConflict: "username", ignoreDuplicates: true },
  );
  if (catalogueError) {
    logger.warn(
      { err: catalogueError, ...target, requestId: row.id },
      "request approval: channels catalogue insert failed (non-fatal)",
    );
  }

  const { error: poolError } = await supabase.from("channel_assignments").upsert(
    {
      username: target.username,
      site: target.site,
      status: "unassigned",
      is_live: false,
      framerate: DEFAULT_FRAMERATE,
      resolution: DEFAULT_RESOLUTION,
      max_duration: DEFAULT_MAX_DURATION,
    },
    { onConflict: "username,site", ignoreDuplicates: true },
  );

  if (poolError) {
    throw new Error(
      `Failed to add @${target.username} to the ${target.site} recording pool: ${poolError.message}`,
    );
  }

  logger.info(
    { ...target, requestId: row.id },
    "request approval: performer queued in recording pool",
  );
  return target;
}
