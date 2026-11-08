#!/usr/bin/env node
/**
 * Allow search-engine crawlers through the Cloudflare WAF.
 *
 * A custom "AI Crawl Control - Block AI bots by User Agent" firewall rule on
 * the chuglii.in zone blocked Googlebot / bingbot / Applebot for every path
 * except /robots.txt. Google Search Console therefore reported:
 *
 *   "Sitemap could not be read — General HTTP error (403)"
 *
 * This script removes those search-engine user agents from any enabled block
 * rule while leaving AI/scraper blocks (archive.org_bot, Manus-User, etc.)
 * intact. Idempotent: if no search-engine clause is present it does nothing.
 *
 * Usage:
 *   node scripts/cloudflare-search-bot-allowlist.mjs --dry-run
 *   node scripts/cloudflare-search-bot-allowlist.mjs
 *
 * Requires CLOUDFLARE_API_TOKEN in the repo .env with:
 *   Zone / Firewall Services / Edit  +  Zone / Zone / Read
 * Optional: CLOUDFLARE_ZONE_NAME (default chuglii.in) or CLOUDFLARE_ZONE_ID.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import { loadEnv } from "./env.mjs";

const API = "https://api.cloudflare.com/client/v4";
const DEFAULT_ZONE_NAME = "chuglii.in";
const PHASE = "http_request_firewall_custom";

/** Search-engine crawlers that must never be blocked for a public site. */
export const SEARCH_BOTS = ["Googlebot", "bingbot", "Applebot"];

const DRY_RUN = process.argv.includes("--dry-run");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove `or (http.user_agent contains "Bot")` / leading-clause variants for
 * the given search bots. Pure function so it can be unit-tested.
 */
export function stripSearchBots(expression, bots = SEARCH_BOTS) {
  let result = expression;
  for (const bot of bots) {
    const quoted = `"${escapeRegex(bot)}"`;
    // Cloudflare expression syntax: `http.user_agent contains "Googlebot"`.
    const clause = `\\(\\s*http\\.user_agent\\s+contains\\s+${quoted}\\s*\\)`;
    // Middle/end of an OR chain: "or (...)"
    result = result.replace(new RegExp(`\\s*\\bor\\b\\s*${clause}`, "gi"), "");
    // Start of an OR chain: "(...) or"
    result = result.replace(new RegExp(`${clause}\\s*\\bor\\b\\s*`, "gi"), "");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

/** Minimal sanity check: the rewritten expression must stay balanced. */
export function isBalanced(expression) {
  let depth = 0;
  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

async function main() {
  const env = loadEnv();
  const token = (env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const zoneName = (env.CLOUDFLARE_ZONE_NAME ?? DEFAULT_ZONE_NAME).trim();
  const zoneIdFromEnv = (env.CLOUDFLARE_ZONE_ID ?? "").trim();

  if (!token) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is not set in the environment or .env",
    );
  }

  const log = (...args) => console.log(...args);
  log(`mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  log(`zone:  ${zoneName}\n`);

  async function cf(pathname, init = {}) {
    const res = await fetch(`${API}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    if (!res.ok || body.success === false) {
      const message =
        (body.errors ?? [])
          .map((error) => `${error.code}: ${error.message}`)
          .join("; ") || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return body.result;
  }

  let zoneId = zoneIdFromEnv;
  if (!zoneId) {
    const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
    if (!zones?.length) {
      throw new Error(
        `zone ${zoneName} is not visible to this token (wrong scope or account?)`,
      );
    }
    zoneId = zones[0].id;
  }
  log(`zone id: ${zoneId}\n`);

  const ruleset = await cf(
    `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`,
  );
  const rules = ruleset?.rules ?? [];
  log(`ruleset: ${ruleset?.id ?? "none"} (${rules.length} rule(s))\n`);

  let changed = 0;
  for (const rule of rules) {
    if (rule.action !== "block" || rule.enabled === false) continue;
    const expression = String(rule.expression ?? "");
    const updated = stripSearchBots(expression);
    if (updated === expression) continue;

    if (!isBalanced(updated)) {
      log(`skipping rule ${rule.id}: rewritten expression is unbalanced`);
      log(`  before: ${expression}`);
      log(`  after : ${updated}`);
      continue;
    }

    log(`rule: ${rule.description || rule.id}`);
    log(`  before: ${expression}`);
    log(`  after : ${updated}`);

    if (DRY_RUN) {
      log("  would PATCH this rule (dry run)\n");
    } else {
      await cf(`/zones/${zoneId}/rulesets/${ruleset.id}/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: rule.action,
          description: rule.description,
          enabled: rule.enabled,
          expression: updated,
        }),
      });
      log("  patched\n");
    }
    changed += 1;
  }

  if (changed === 0) {
    log("OK: no enabled block rule targets Googlebot / bingbot / Applebot.");
  } else {
    log(
      `${DRY_RUN ? "would update" : "updated"} ${changed} rule(s) on ${zoneName}.`,
    );
  }

  // Post-check with real crawler user agents (read-only, safe in dry runs).
  const origin = `https://${zoneName.replace(/^https?:\/\//, "")}`;
  for (const bot of ["Googlebot", "bingbot"]) {
    const ua = `Mozilla/5.0 (compatible; ${bot}/2.1; +http://www.google.com/bot.html)`;
    try {
      const res = await fetch(`${origin}/sitemap.xml`, {
        headers: { "User-Agent": ua },
        redirect: "follow",
      });
      log(`check /sitemap.xml as ${bot}: HTTP ${res.status}`);
    } catch (error) {
      log(`check /sitemap.xml as ${bot}: failed (${error.message})`);
    }
  }
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error.message}`);
    process.exit(1);
  });
}
