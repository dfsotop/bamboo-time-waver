import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeForUser } from "./workflow.server";

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
    return executeForUser(context.userId, {
      triggeredBy: "retry",
      date: row.run_date,
      force: true,
    });
  });
