// Cron endpoint hit by pg_cron once per hour 08:00–11:00 UTC on weekdays.
// Idempotent: the workflow's "existing entry" check prevents duplicates.
//
// Auth: shared secret in the `x-cron-secret` header (constant-time compared).
// The Supabase publishable key is NOT acceptable here — it's bundled into the
// public client and would let anyone trigger clock-ins for every user.

import { timingSafeEqual } from "crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeForUser, madridToday } from "@/lib/bamboo/workflow.server";

const CRON_CONCURRENCY = 3;
const DEBOUNCE_MINUTES = 5;

async function checkSecret(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-cron-secret") ?? "";
  if (!provided) return false;

  // 1. Env-based check (manual invocations / external schedulers).
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length) {
      try {
        if (timingSafeEqual(a, b)) return true;
      } catch {
        /* fall through */
      }
    }
  }

  // 2. Vault-based check (used by pg_cron via the verify_cron_secret RPC).
  try {
    const { data, error } = await supabaseAdmin.rpc("verify_cron_secret", {
      provided,
    });
    if (error) {
      console.error("cron: verify_cron_secret rpc failed", error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("cron: rpc threw", e);
    return false;
  }
}

async function processUser(userId: string, todayIso: string) {
  // Skip if a non-failed entry already exists for today.
  const { data: existing } = await supabaseAdmin
    .from("execution_history")
    .select("status, created_at")
    .eq("user_id", userId)
    .eq("run_date", todayIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) {
    const last = existing[0];
    if (last.status !== "failed") {
      return { user: userId, status: "already_processed" };
    }
    // Debounce rapid re-attempts on a failed user.
    const ageMs = Date.now() - new Date(last.created_at).getTime();
    if (ageMs < DEBOUNCE_MINUTES * 60_000) {
      return { user: userId, status: "debounced" };
    }
  }
  try {
    const r = await executeForUser(userId, { triggeredBy: "cron", date: todayIso });
    return { user: userId, status: r.status };
  } catch (e) {
    return {
      user: userId,
      status: "error: " + (e instanceof Error ? e.message.slice(0, 200) : "unknown"),
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function handle(request: Request) {
  if (!(await checkSecret(request))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = madridToday();
  if (today.weekday === 0 || today.weekday === 6) {
    return Response.json({ skipped: "weekend", date: today.iso });
  }

  // Guard against the cron firing before 10:00 Madrid (pg_cron runs hourly).
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    hour12: false,
  });
  const hour = parseInt(hourFmt.format(new Date()), 10);
  if (hour < 10) {
    return Response.json({ skipped: "too_early", hour, date: today.iso });
  }

  const { data: users, error } = await supabaseAdmin
    .from("bamboo_settings")
    .select("user_id")
    .eq("enabled", true);

  if (error) {
    console.error("cron: failed to list users", error);
    return new Response("Internal error", { status: 500 });
  }

  const results = await runWithConcurrency(
    (users ?? []).map((u) => u.user_id),
    CRON_CONCURRENCY,
    (uid) => processUser(uid, today.iso),
  );

  return Response.json({ date: today.iso, processed: results.length, results });
}

export const Route = createFileRoute("/api/public/cron/daily")({
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
    },
  },
});
