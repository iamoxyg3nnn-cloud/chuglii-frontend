/**
 * Global advertising kill switch.
 *
 * Ads are OFF unless VITE_ADS_ENABLED is explicitly set to "true", "1", or
 * "yes". To restore advertising later, set VITE_ADS_ENABLED=true in the
 * Vercel Production environment and redeploy. Admin-managed creatives and
 * placement settings remain intact while delivery is disabled.
 */
export function areAdsEnabled(): boolean {
  const flag = (import.meta.env.VITE_ADS_ENABLED ?? "").trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}
