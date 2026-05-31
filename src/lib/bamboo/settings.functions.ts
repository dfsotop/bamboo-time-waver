import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret } from "./encryption.server";
import { findEmployeeByEmail } from "./client.server";

const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

const SaveInput = z.object({
  subdomain: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9-]+$/),
  apiKey: z.string().trim().min(8).max(512).optional(), // optional on update if already set
  clockin_start: TimeStr,
  clockin_end: TimeStr,
  clockout_start: TimeStr,
  clockout_end: TimeStr,
  enabled: z.boolean(),
});

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    const userEmail = (context.claims.email as string | undefined) ?? "";

    // Load existing row to know if we have a stored key
    const { data: existing } = await supabaseAdmin
      .from("bamboo_settings")
      .select("api_key_encrypted, employee_id")
      .eq("user_id", userId)
      .maybeSingle();

    let apiKey = data.apiKey;
    let employeeId: string | undefined;

    if (apiKey) {
      // Verify the key + auto-detect employee
      const emp = await findEmployeeByEmail(data.subdomain, apiKey, userEmail);
      if (!emp) {
        throw new Error(
          `API key works but no BambooHR employee matches "${userEmail}". Make sure your account email matches your work email in BambooHR.`,
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
        "subdomain, employee_id, clockin_start, clockin_end, clockout_start, clockout_end, enabled, updated_at",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      settings: data,
      hasApiKey: Boolean(data),
      email: (context.claims.email as string | undefined) ?? "",
    };
  });
