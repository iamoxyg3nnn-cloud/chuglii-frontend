import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_SUPABASE_URL = "https://supabase.chuglii.in";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3MDAwMDAwMDAsICJleHAiOiAyMDE1MzYwMDAwfQ.NSqjip-vQHwHjATurt4ensfmKBHa4Pt5m_dLP909lV8";

function resolveSupabaseConfig(): { url: string; key: string } {
  let url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  let key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

  if (!url || url === "[SENSITIVE]" || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    url = DEFAULT_SUPABASE_URL;
  }
  if (!key || key === "[SENSITIVE]" || key.length < 20) {
    key = DEFAULT_SUPABASE_ANON_KEY;
  }

  return { url, key };
}

// Lazy-load the Supabase SDK (208KB) — defer loading until first access.
// This removes the SDK from the critical rendering path so the Home page
// paints before the heavy auth library finishes downloading.
let _client: SupabaseClient | null = null;
let _loadPromise: Promise<SupabaseClient> | null = null;

function ensureClient(): Promise<SupabaseClient> {
  if (_client) return Promise.resolve(_client);
  if (!_loadPromise) {
    _loadPromise = import("@supabase/supabase-js")
      .then(({ createClient }) => {
        const { url, key } = resolveSupabaseConfig();
        _client = createClient(url, key);
        return _client;
      })
      .catch((err) => {
        // Don't cache a rejected promise — allow a retry on next access
        // instead of leaving an unhandled rejection poisoning all callers.
        _loadPromise = null;
        throw err;
      });
  }
  return _loadPromise;
}

/**
 * Get the lazily-loaded Supabase client. Returns a promise that resolves
 * to the real client on first call, then returns the cached client after.
 *
 * AuthContext should be updated to use:
 *   const client = await getSupabase();
 *   client.auth.getSession()...
 */
export async function getSupabase(): Promise<SupabaseClient> {
  return ensureClient();
}

// Synchronous getter for code that already has the client cached.
// Returns null if the SDK hasn't been loaded yet.
export function getSupabaseSync(): SupabaseClient | null {
  return _client;
}
