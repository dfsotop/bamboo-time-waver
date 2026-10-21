import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret } from "./encryption.server";
import { findEmployeeByEmail } from "./client.server";

const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const SaveInput = z
  .object({
    subdomain: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/),
    apiKey: z.string().trim().min(8).max(512).optional(),
    clockin_start: TimeStr,
    clockin_end: TimeStr,
    lunch_out_start: TimeStr,
    lunch_out_end: TimeStr,
    lunch_in_start: TimeStr,
    lunch_in_end: TimeStr,
    clockout_start: TimeStr,
    clockout_end: TimeStr,
    enabled: z.boolean(),
  })
  .refine((d) => toMin(d.clockin_start) < toMin(d.clockin_end), {
    message: "Clock-in earliest must be before clock-in latest",
    path: ["clockin_end"],
  })
  .refine((d) => toMin(d.lunch_out_start) < toMin(d.lunch_out_end), {
    message: "Lunch-out earliest must be before lunch-out latest",
    path: ["lunch_out_end"],
  })
  .refine((d) => toMin(d.lunch_in_start) < toMin(d.lunch_in_end), {
    message: "Lunch-in earliest must be before lunch-in latest",
    path: ["lunch_in_end"],
  })
  .refine((d) => toMin(d.clockout_start) < toMin(d.clockout_end), {
    message: "Clock-out earliest must be before clock-out latest",
    path: ["clockout_end"],
  })
  .refine((d) => toMin(d.clockin_end) <= toMin(d.lunch_out_start), {
    message: "Clock-in window must end before lunch-out window starts",
    path: ["lunch_out_start"],
  })
  .refine((d) => toMin(d.lunch_out_end) <= toMin(d.lunch_in_start), {
    message: "Lunch-out window must end before lunch-in window starts",
    path: ["lunch_in_start"],
  })
  .refine((d) => toMin(d.lunch_in_end) <= toMin(d.clockout_start), {
    message: "Lunch-in window must end before clock-out window starts",
    path: ["clockout_start"],
  })
  .refine((d) => toMin(d.clockin_end) - toMin(d.clockin_start) <= 120, {
    message: "Clock-in window must be at most 2 hours wide",
    path: ["clockin_end"],
  })
  .refine((d) => toMin(d.lunch_out_end) - toMin(d.lunch_out_start) <= 120, {
    message: "Lunch-out window must be at most 2 hours wide",
    path: ["lunch_out_end"],
  })
  .refine((d) => toMin(d.lunch_in_end) - toMin(d.lunch_in_start) <= 120, {
    message: "Lunch-in window must be at most 2 hours wide",
    path: ["lunch_in_end"],
  })
  .refine((d) => toMin(d.clockout_end) - toMin(d.clockout_start) <= 120, {
    message: "Clock-out window must be at most 2 hours wide",
    path: ["clockout_end"],
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const userEmail = (context.claims.email as string | undefined) ?? "";
    const emailVerified =
      (context.claims.email_verified as boolean | undefined) ??
      // Google/OAuth providers may set this nested under user_metadata
      Boolean(
        (context.claims as Record<string, unknown>).email_verified ||
          ((context.claims as { user_metadata?: { email_verified?: boolean } }).user_metadata
            ?.email_verified),
      );

    if (!emailVerified) {
      throw new Error(
        "Please verify your email address before connecting BambooHR (check your inbox for the confirmation link).",
      );
    }

    const { data: existing } = await supabaseAdmin
      .from("bamboo_settings")
      .select("api_key_encrypted, employee_id")
      .eq("user_id", userId)
      .maybeSingle();

    let employeeId: string | undefined;
    const apiKey = data.apiKey;

    if (apiKey) {
      const emp = await findEmployeeByEmail(data.subdomain, apiKey, userEmail);
      if (!emp) {
        throw new Error(
          `API key works but no BambooHR employee matches "${userEmail}". Your verified account email must match your work email in BambooHR.`,
        );
      }
      employeeId = emp.id;
    } else if (existing) {
      employeeId = existing.employee_id;
    } else {
      throw new Error("API key is required for first-time setup");
    }

    const row = {
      user_id: userId,
      subdomain: data.subdomain,
      employee_id: employeeId!,
      api_key_encrypted: apiKey ? encryptSecret(apiKey) : existing!.api_key_encrypted,
      clockin_start: data.clockin_start,
      clockin_end: data.clockin_end,
      lunch_out_start: data.lunch_out_start,
      lunch_out_end: data.lunch_out_end,
      lunch_in_start: data.lunch_in_start,
      lunch_in_end: data.lunch_in_end,
      clockout_start: data.clockout_start,
      clockout_end: data.clockout_end,
      enabled: data.enabled,
    };

    const { error } = await supabaseAdmin
      .from("bamboo_settings")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    return { ok: true, employeeId };
  });

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await supabaseAdmin
      .from("bamboo_settings")
      .select(
        "subdomain, employee_id, clockin_start, clockin_end, lunch_out_start, lunch_out_end, lunch_in_start, lunch_in_end, clockout_start, clockout_end, enabled, updated_at",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const emailVerified =
      (context.claims.email_verified as boolean | undefined) ??
      Boolean(
        (context.claims as { user_metadata?: { email_verified?: boolean } }).user_metadata
          ?.email_verified,
      );
    return {
      settings: data,
      hasApiKey: Boolean(data),
      email: (context.claims.email as string | undefined) ?? "",
      emailVerified,
    };
  });

const EnabledInput = z.object({ enabled: z.boolean() });

export const setSchedulerEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => EnabledInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await supabaseAdmin
      .from("bamboo_settings")
      .update({ enabled: data.enabled })
      .eq("user_id", context.userId)
      .select("enabled");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("Connect BambooHR in Settings first");
    return { enabled: rows[0].enabled };
  });

export const deleteSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await supabaseAdmin
      .from("bamboo_settings")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
