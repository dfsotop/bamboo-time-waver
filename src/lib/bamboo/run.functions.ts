import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeForUser, madridToday } from "./workflow.server";

export const runNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return executeForUser(context.userId, { triggeredBy: "manual", force: true });
  });

const RetryInput = z.object({ historyId: z.string().uuid() });

export const retryExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RetryInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await supabaseAdmin
      .from("execution_history")
      .select("user_id, run_date")
      .eq("id", data.historyId)
      .maybeSingle();
    if (error || !row) throw new Error("History row not found");
    if (row.user_id !== context.userId) throw new Error("Not authorized");

    // Clamp the retry date: never submit entries for dates >1 day in the future,
    // and reuse today's date if the original run_date is in the past.
    const today = madridToday().iso;
    const todayMs = Date.parse(today + "T00:00:00Z");
    const rowMs = Date.parse(row.run_date + "T00:00:00Z");
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (rowMs > todayMs + oneDayMs) {
      throw new Error("Cannot retry an execution scheduled more than 1 day in the future");
    }
    const targetDate = rowMs < todayMs ? today : row.run_date;

    return executeForUser(context.userId, {
      triggeredBy: "retry",
      date: targetDate,
      force: true,
    });
  });
