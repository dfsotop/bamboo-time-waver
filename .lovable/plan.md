
# BambooHR Auto Clock-In

A multi-user web app that, every weekday at 10:00 Europe/Madrid, automatically posts a clock-in/clock-out time entry for each configured user to BambooHR — at a randomized time within the user's chosen ranges — and skips days where BambooHR already shows time off (holiday, vacation, sick) or an existing entry.

## User flow

1. **Sign up / log in** with email+password or Google.
2. **Settings page**: enter BambooHR subdomain + API key + clock-in range (e.g. 08:50–09:10) + clock-out range (e.g. 17:50–18:30). App tests the key, auto-detects the employee ID, and stores the key encrypted.
3. **Dashboard**: shows next scheduled run, today's status, and an execution history table (date, planned in/out, status: success / skipped-holiday / skipped-vacation / skipped-existing / failed, error message). Each failed row has a **Retry** button.
4. **Manual "Run now"** button for testing.

## How it works

- A daily cron (10:00 Europe/Madrid, Mon–Fri) iterates over all users with valid settings and triggers their clock-in.
- For each user:
  1. Fetch BambooHR time-off / who's-out for today → skip if holiday/vacation/sick.
  2. Fetch existing time entries for today → skip if any exist.
  3. Pick random `HH:MM` inside each range, then POST a clock-in and clock-out via the BambooHR Time Tracking API.
  4. Record the attempt in `execution_history`.
- Retry endpoint re-runs steps 1–4 for a given history row.

## Technical details

**Stack**: TanStack Start + Lovable Cloud (Supabase). Frontend Tailwind + shadcn.

**Auth**: Lovable Cloud email/password + Google (via `lovable.auth.signInWithOAuth("google", ...)` + `supabase--configure_social_auth`). Routes under `/_authenticated`.

**Database** (Supabase, RLS on, scoped to `auth.uid()`):
- `bamboo_settings`: `user_id PK`, `subdomain`, `employee_id`, `api_key_encrypted` (bytea, AES-GCM via `pgsodium`/`pgcrypto` with server-side key), `clockin_start`, `clockin_end`, `clockout_start`, `clockout_end`, `enabled bool`, timestamps.
- `execution_history`: `id`, `user_id`, `run_date`, `planned_clock_in`, `planned_clock_out`, `status` (success/skipped_holiday/skipped_timeoff/skipped_existing/failed), `error`, `bamboo_response jsonb`, `created_at`.

**Server functions** (`createServerFn` with `requireSupabaseAuth`):
- `saveSettings` — encrypts API key, calls BambooHR `/v1/employees/directory` filtered by current user email to auto-detect `employee_id`, validates the key.
- `getSettings`, `getHistory`.
- `runNow` — executes the workflow for the current user, inserts a history row.
- `retryExecution(historyId)` — re-runs for the user/date of that row.

**Server route** (`src/routes/api/public/cron/daily.ts`): protected by a shared `CRON_SECRET` header. Iterates over all `bamboo_settings.enabled = true` rows using `supabaseAdmin`, calls the same workflow as `runNow`.

**BambooHR client** (server-only helper):
- Base: `https://api.bamboohr.com/api/gateway.php/{subdomain}/v1/`
- Auth: HTTP Basic, username = API key, password = `x`.
- Endpoints used:
  - `GET /employees/directory` — to find employee by email (auto-detect ID).
  - `GET /time_off/whos_out?start=YYYY-MM-DD&end=YYYY-MM-DD` — holiday/vacation/sick detection for today.
  - `GET /time_tracking/timesheet_entries?employeeIds={id}&start=...&end=...` — existing-entry check.
  - `POST /time_tracking/clock_entries/store` — create clock in/out entries with randomized timestamps.

**Scheduling**: pg_cron job in Supabase calling the public cron endpoint with the secret header. Daily at 09:00 UTC (= 10:00 Madrid in winter / 11:00 in summer — we'll handle DST by computing target time in Europe/Madrid inside the handler and only running if it's a Mon–Fri there; cron fires hourly between 08–10 UTC and the handler is idempotent via the existing-entry check).

**Secret storage**: BambooHR API keys are encrypted at rest using a server-side `BAMBOO_ENC_KEY` secret + AES-GCM in a server helper. Never sent to the client after save (settings page only shows "key set ✓ — replace?").

**Secrets needed**: `CRON_SECRET`, `BAMBOO_ENC_KEY` (both auto-generated and stored via Lovable Cloud).

## Out of scope (v1)

- Per-user custom working-day calendars (assumes Mon–Fri).
- Timezone customization (Europe/Madrid only).
- Admin view across users.
