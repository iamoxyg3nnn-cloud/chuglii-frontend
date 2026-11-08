#!/usr/bin/env node
/**
 * Create (or repair) a VAULT admin account.
 *
 * Idempotent: runs are safe to repeat. If the auth user already exists it is
 * reused (its password is only changed when --password is supplied), and the
 * profile/role rows are upserted.
 *
 * Usage:
 *   node scripts/create-admin.mjs \
 *     --email owner@example.com \
 *     --password 'S0me-Str0ng-Pass' \
 *     --username owner \
 *     --name "Owner" \
 *     [--role admin|moderator|user] \
 *     [--premium-days 365]
 *
 * Credentials come from the environment (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY) or from `frontend/.env`. The service-role key is
 * required: creating auth users and writing user_roles bypasses RLS.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROLE_VALUES = new Set(["user", "moderator", "admin"]);
const VALID_USERNAME = /^[a-z0-9_-]{3,30}$/;

function loadDotEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "..", ".env");
  try {
    for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env file — rely on the real environment.
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(
    "Usage: node scripts/create-admin.mjs --email <email> [--password <pw>] [--username <name>] [--name <display>] [--role admin|moderator|user] [--premium-days N]",
  );
  process.exit(0);
}

loadDotEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  fail("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (env or frontend/.env).");
}

const email = String(args.email ?? "").trim().toLowerCase();
const password = typeof args.password === "string" ? args.password : "";
const role = String(args.role ?? "admin").trim();
const displayName = String(args.name ?? args["display-name"] ?? "").trim();
let username = String(args.username ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("--email is required and must be valid.");
if (password && password.length < 6) fail("--password must be at least 6 characters.");
if (!ROLE_VALUES.has(role)) fail(`--role must be one of: ${[...ROLE_VALUES].join(", ")}.`);
if (username && !VALID_USERNAME.test(username)) {
  fail("--username must be 3-30 chars of lowercase letters, numbers, underscore or hyphen.");
}
if (!username) username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
if (!VALID_USERNAME.test(username)) fail("Could not derive a valid username; pass --username explicitly.");

const premiumDays = args["premium-days"] === undefined ? 0 : Math.round(Number(args["premium-days"]));
if (premiumDays && (!Number.isFinite(premiumDays) || premiumDays < 1)) fail("--premium-days must be a positive number.");

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

async function api(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { ...authHeaders, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function describeError(body) {
  if (!body) return "unknown error";
  if (typeof body === "string") return body;
  return body.message ?? body.error_description ?? body.error ?? JSON.stringify(body);
}

async function findUserByEmail(target) {
  for (let page = 1; page <= 20; page += 1) {
    const res = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    if (!res.ok) throw new Error(`listing auth users failed: ${describeError(res.body)}`);
    const users = res.body?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function upsert(table, row, conflictColumn) {
  const res = await api(`/rest/v1/${table}?on_conflict=${conflictColumn}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`${table} upsert failed: ${describeError(res.body)}`);
  return res.body;
}

async function main() {
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`Target   : ${email} (username: ${username}, role: ${role})`);

  let user = await findUserByEmail(email);
  const metadata = { username, display_name: displayName || username, role };

  if (!user) {
    if (!password) fail("User does not exist yet — --password is required to create it.");
    const res = await api("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: metadata,
      }),
    });
    if (!res.ok) fail(`auth user creation failed: ${describeError(res.body)}`);
    user = res.body;
    console.log(`✓ Created auth user ${user.id}`);
  } else {
    console.log(`• Auth user already exists (${user.id})`);
    const patch = { user_metadata: { ...(user.user_metadata ?? {}), ...metadata } };
    if (password) {
      patch.password = password;
      patch.email_confirm = true;
    }
    const res = await api(`/auth/v1/admin/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!res.ok) fail(`auth user update failed: ${describeError(res.body)}`);
    console.log(password ? "✓ Password reset and email confirmed" : "• Password left unchanged");
  }

  const userId = user.id;

  await upsert(
    "user_profiles",
    { user_id: userId, username, display_name: displayName || username, email },
    "user_id",
  );
  console.log("✓ user_profiles upserted");

  await upsert("user_roles", { user_id: userId, role }, "user_id");
  console.log(`✓ user_roles set to "${role}"`);

  if (premiumDays > 0) {
    const expires = new Date(Date.now() + premiumDays * 86_400_000).toISOString();
    // The live schema has changed shape over time: prefer the current column
    // and fall back to the legacy one so this script works on both.
    const modern = await api("/rest/v1/user_premium?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: userId, premium_expires_at: expires, updated_at: new Date().toISOString() }),
    });
    if (modern.ok) {
      console.log(`✓ Premium granted until ${expires}`);
    } else {
      const legacy = await api("/rest/v1/user_premium?on_conflict=user_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: userId, premium_until: expires, updated_at: new Date().toISOString() }),
      });
      if (!legacy.ok) {
        console.warn(
          `! Premium not granted (${describeError(modern.body)}). ` +
            "Run supabase/migrations/005-premium.sql against the database, then retry.",
        );
      } else {
        console.log(`✓ Premium granted until ${expires} (legacy column)`);
      }
    }
  }

  console.log("\nDone. Sign in at /login with this email (or username) and password.");
  console.log("If this is the first admin, open /admin — the role is enforced server-side.");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
