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

/**
 * Reserved "Advertisement" boxes in ad slots that have no creative yet.
 *
 * OFF for now: an empty slot renders NOTHING, so pages carry no dashed ad
 * boxes. Flip to `true` (or pass `placeholder` to a single <AdBanner />)
 * once the creatives are ready. Real creatives still render normally while
 * this is false.
 */
export const AD_PLACEHOLDERS_ENABLED = false;
