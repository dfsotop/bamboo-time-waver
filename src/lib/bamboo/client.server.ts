// Server-only BambooHR API client.
// Auth: HTTP Basic, username = API key, password = "x".
// Docs: https://documentation.bamboohr.com/reference

function basicAuth(apiKey: string): string {
  return "Basic " + Buffer.from(`${apiKey}:x`).toString("base64");
}

function baseUrl(subdomain: string): string {
  return `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(subdomain)}/v1`;
}

async function bambooFetch(
  subdomain: string,
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${baseUrl(subdomain)}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", basicAuth(apiKey));
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

export interface BambooEmployee {
  id: string;
  workEmail?: string | null;
  displayName?: string;
}

/** Find an employee in the directory by email (case-insensitive). */
export async function findEmployeeByEmail(
  subdomain: string,
  apiKey: string,
  email: string,
): Promise<BambooEmployee | null> {
  const res = await bambooFetch(subdomain, apiKey, "/employees/directory");
  if (!res.ok) {
    throw new Error(`BambooHR directory lookup failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { employees?: BambooEmployee[] };
  const target = email.trim().toLowerCase();
  return (
    data.employees?.find(
      (e) => (e.workEmail ?? "").toLowerCase() === target,
    ) ?? null
  );
}

/** Check whether an employee has any time-off / holiday today. */
export async function getTimeOffToday(
  subdomain: string,
  apiKey: string,
  employeeId: string,
  isoDate: string,
): Promise<{ isOff: boolean; reason?: string }> {
  const res = await bambooFetch(
    subdomain,
    apiKey,
    `/time_off/whos_out?start=${isoDate}&end=${isoDate}`,
  );
  if (!res.ok) {
    throw new Error(`BambooHR whos_out failed (${res.status}): ${await res.text()}`);
  }
  const items = (await res.json()) as Array<{
    type: string;
    employeeId?: number;
    name?: string;
  }>;
  // Holidays apply to everyone and have no employeeId
  const holiday = items.find((i) => i.type === "holiday");
  if (holiday) return { isOff: true, reason: `holiday: ${holiday.name ?? "company holiday"}` };
  const personal = items.find(
    (i) => i.type === "timeOff" && String(i.employeeId) === String(employeeId),
  );
  if (personal) return { isOff: true, reason: "time off / vacation / sick" };
  return { isOff: false };
}

/** Returns true if any clock entry or timesheet entry exists for that day. */
export async function hasEntryForDate(
  subdomain: string,
  apiKey: string,
  employeeId: string,
  isoDate: string,
): Promise<boolean> {
  const res = await bambooFetch(
    subdomain,
    apiKey,
    `/time_tracking/timesheet_entries?employeeIds=${encodeURIComponent(employeeId)}&start=${isoDate}&end=${isoDate}`,
  );
  if (!res.ok) {
    // If the time tracking endpoint isn't enabled for this company, treat as no entries.
    if (res.status === 404) return false;
    throw new Error(`BambooHR timesheet_entries failed (${res.status}): ${await res.text()}`);
  }
  const items = (await res.json()) as unknown;
  return Array.isArray(items) && items.length > 0;
}

/** Submit a clock-in + clock-out entry pair for the given date. */
export async function storeClockEntries(
  subdomain: string,
  apiKey: string,
  employeeId: string,
  isoDate: string,
  clockInHHMM: string,
  clockOutHHMM: string,
): Promise<unknown> {
  const body = {
    entries: [
      {
        employeeId: Number(employeeId),
        date: isoDate,
        start: clockInHHMM,
        end: clockOutHHMM,
      },
    ],
  };
  const res = await bambooFetch(subdomain, apiKey, "/time_tracking/clock_entries/store", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`BambooHR clock_entries/store failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
