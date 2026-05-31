// Cron endpoint hit by pg_cron once per hour 08:00–11:00 UTC on weekdays.
// Idempotent: the workflow's "existing entry" check prevents duplicates,
// so running multiple times per day is safe.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeForUser, madridToday } from "@/lib/bamboo/workflow.server";

async function handle(request: Request) {
  // Authenticate using the Supabase anon key (canonical pg_cron pattern).
  const apikey = request.headers.get("apikey");
  if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = madridToday();
  // Only run on Mon–Fri in Madrid.
  if (today.weekday === 0 || today.weekday === 6) {
    return Response.json({ skipped: "weekend", date: today.iso });
  }

  // Verify Madrid time is at or past 10:00 (cron may fire earlier).
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
    return new Response(`DB error: ${error.message}`, { status: 500 });
  }

  // Skip users that already have a non-failed entry for today (avoid spam).
  const results: Array<{ user: string; status: string }> = [];
  for (const u of users ?? []) {
    const { data: existing } = await supabaseAdmin
      .from("execution_history")
      .select("status")
      .eq("user_id", u.user_id)
      .eq("run_date", today.iso)
      .neq("status", "failed")
      .limit(1);
    if (existing && existing.length > 0) {
      results.push({ user: u.user_id, status: "already_processed" });
      continue;
    }
    try {
      const r = await executeForUser(u.user_id, { triggeredBy: "cron", date: today.iso });
      results.push({ user: u.user_id, status: r.status });
    } catch (e) {
      results.push({
        user: u.user_id,
        status: "error: " + (e instanceof Error ? e.message : String(e)),
      });
    }
  }

  return Response.json({ date: today.iso, processed: results.length, results });
}

export const Route = createFileRoute("/api/public/cron/daily")({
  server: {
    handlers: {
      GET: async ({ request }) => handle(request),
      POST: async ({ request }) => handle(request),
    },
  },
});
