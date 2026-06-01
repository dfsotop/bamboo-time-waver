// Server-only workflow: for a given user, check time-off + existing entries
// and submit a randomized clock-in / clock-out to BambooHR.

import { randomInt } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, encryptSecret, isCurrentFormat } from "./encryption.server";
import {
  getTimeOffToday,
  hasEntryForDate,
  sanitizeBambooErrorBody,
  storeClockEntries,
} from "./client.server";

export type ExecutionStatus =
  | "success"
  | "skipped_holiday"
  | "skipped_timeoff"
  | "skipped_existing"
  | "skipped_weekend"
  | "failed";

export interface ExecutionResult {
  status: ExecutionStatus;
  planned_clock_in?: string;
  planned_clock_out?: string;
  planned_lunch_out?: string;
  planned_lunch_in?: string;
  error?: string;
  response?: { ok: boolean; status: number };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fromMinutes(mins: number): string {
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}
function randomBetween(start: string, end: string): string {
  const a = toMinutes(start);
  const b = toMinutes(end);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  // crypto.randomInt is upper-exclusive
  return fromMinutes(lo + randomInt(0, hi - lo + 1));
}

/** ISO date in Europe/Madrid for "right now". */
export function madridToday(): { iso: string; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { iso: `${y}-${m}-${d}`, weekday: wdMap[wd] ?? 0 };
}

export interface ExecuteOptions {
  /** If provided, use this date instead of "today in Madrid". Format YYYY-MM-DD. */
  date?: string;
  /** Skip the weekday check (used by manual "Run now"). */
  force?: boolean;
  triggeredBy: "cron" | "manual" | "retry";
}

export async function executeForUser(
  userId: string,
  opts: ExecuteOptions,
): Promise<ExecutionResult> {
  const today = madridToday();
  const date = opts.date ?? today.iso;
  const weekday = opts.date ? new Date(opts.date + "T12:00:00Z").getUTCDay() : today.weekday;

  if (!opts.force && (weekday === 0 || weekday === 6)) {
    return await recordResult(userId, date, { status: "skipped_weekend" }, opts.triggeredBy);
  }

  const { data: settings, error: settingsErr } = await supabaseAdmin
    .from("bamboo_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsErr || !settings) {
    return await recordResult(
      userId,
      date,
      { status: "failed", error: "No settings configured" },
      opts.triggeredBy,
    );
  }

  if (!settings.enabled && opts.triggeredBy === "cron") {
    return await recordResult(
      userId,
      date,
      { status: "failed", error: "Scheduler disabled" },
      opts.triggeredBy,
    );
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(settings.api_key_encrypted);
  } catch {
    return await recordResult(
      userId,
      date,
      { status: "failed", error: "Failed to decrypt API key" },
      opts.triggeredBy,
    );
  }

  // Lazy re-encryption: if stored ciphertext is still on the legacy seed, upgrade it.
  if (!isCurrentFormat(settings.api_key_encrypted)) {
    try {
      await supabaseAdmin
        .from("bamboo_settings")
        .update({ api_key_encrypted: encryptSecret(apiKey) })
        .eq("user_id", userId);
    } catch (e) {
      console.warn("Failed to lazy re-encrypt API key for user", userId, e);
    }
  }

  try {
    const off = await getTimeOffToday(settings.subdomain, apiKey, settings.employee_id, date);
    if (off.isOff) {
      const status: ExecutionStatus = off.reason?.startsWith("holiday")
        ? "skipped_holiday"
        : "skipped_timeoff";
      return await recordResult(
        userId,
        date,
        { status, error: off.reason },
        opts.triggeredBy,
      );
    }

    const exists = await hasEntryForDate(settings.subdomain, apiKey, settings.employee_id, date);
    if (exists) {
      return await recordResult(
        userId,
        date,
        { status: "skipped_existing" },
        opts.triggeredBy,
      );
    }

    const inAt = randomBetween(
      String(settings.clockin_start).slice(0, 5),
      String(settings.clockin_end).slice(0, 5),
    );
    const outAt = randomBetween(
      String(settings.clockout_start).slice(0, 5),
      String(settings.clockout_end).slice(0, 5),
    );
    const resp = (await storeClockEntries(
      settings.subdomain,
      apiKey,
      settings.employee_id,
      date,
      inAt,
      outAt,
    )) as { ok: boolean; status: number };
    return await recordResult(
      userId,
      date,
      {
        status: "success",
        planned_clock_in: inAt,
        planned_clock_out: outAt,
        response: resp,
      },
      opts.triggeredBy,
    );
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return await recordResult(
      userId,
      date,
      { status: "failed", error: sanitizeBambooErrorBody(raw) },
      opts.triggeredBy,
    );
  }
}

async function recordResult(
  userId: string,
  date: string,
  result: ExecutionResult,
  triggeredBy: string,
): Promise<ExecutionResult> {
  await supabaseAdmin.from("execution_history").insert({
    user_id: userId,
    run_date: date,
    planned_clock_in: result.planned_clock_in ?? null,
    planned_clock_out: result.planned_clock_out ?? null,
    status: result.status,
    error: result.error ?? null,
    bamboo_response: result.response ?? null,
    triggered_by: triggeredBy,
  });
  return result;
}
