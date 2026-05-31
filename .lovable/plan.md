
# Security Remediation Plan

Fix every finding from the prior analysis, ordered by risk. Each step lists the change and the verification.

## 1. Critical — Lock down the cron endpoint (C1)

- Add a new `CRON_SECRET` runtime secret (server-only, random 32-byte base64).
- In `src/routes/api/public/cron/daily.ts`:
  - Remove the `GET` handler; keep only `POST`.
  - Read `x-cron-secret` header, compare to `process.env.CRON_SECRET` using `crypto.timingSafeEqual` (length-checked).
  - Stop trusting `SUPABASE_PUBLISHABLE_KEY` as auth.
- Update the pg_cron job (migration) to call the endpoint via `net.http_post` with `x-cron-secret` header instead of `apikey`.

Verify: `invoke-server-function POST /api/public/cron/daily` without header → 401; with header → 200; `cron.job` row updated.

## 2. High — Dedicated encryption key for BambooHR API keys (H1)

- Add `BAMBOO_ENC_KEY` secret (32 random bytes, base64).
- Refactor `src/lib/bamboo/encryption.server.ts`:
  - `getKey()` reads `BAMBOO_ENC_KEY`, base64-decodes, asserts 32 bytes.
  - No more dependence on `SUPABASE_SERVICE_ROLE_KEY`.
- Add a one-time re-encryption path: since the current encryption seed only exists in this environment and decrypt still works during the same deploy, write a tiny admin server fn `migrateEncryption` that decrypts using the old seed and re-encrypts with the new key for every row, gated by `CRON_SECRET` header on a public route `/api/public/admin/migrate-enc` (single use). Document that after running it, existing keys remain valid.
- Alternative if simpler: instruct users their stored key will be invalidated and require re-entry. Plan defaults to the migration path for zero user friction.

Verify: run the one-shot migration; then `runNow` for a test user succeeds (decrypt works with new key); inspect `api_key_encrypted` changed.

## 3. High — Prevent employee impersonation (H2)

- Require verified email before saving settings:
  - In `saveSettings`, read `context.claims.email_verified`; if not true, throw a clear error ("Verify your email before connecting BambooHR").
- Enable email confirmation in auth config (`supabase--configure_auth` with `email_confirm: true`) since the user originally wanted standard signup.
- Keep auto-detect by email as the default but show the detected employee (name + id) and require explicit confirmation: add a `confirmed_employee_id` field flow — first save returns the detected employee, second save with `confirmEmployeeId` matches; persist only on match.

Verify: signup with unverified email → settings save blocked; verified email + matching employee → save succeeds; mismatched confirm → blocked.

## 4. High — Cron per-user safety (H3)

- In cron handler: process users with `Promise.allSettled` capped at concurrency 3 (simple semaphore).
- Add per-call timeout (`AbortController`, 15s) to all `bambooFetch` calls in `client.server.ts`.
- Skip `enabled=false` users (already done) and skip users whose last attempt within 5 minutes (debounce).

Verify: trigger cron twice in quick succession → second call reports `already_processed` / debounced; manual stub of slow Bamboo endpoint → request aborts at 15s with clean failure recorded.

## 5. Medium — Password & auth hardening (M1)

- `supabase--configure_auth`: `password_min_length: 10`, `password_hibp_enabled: true`, `email_confirm: true`.
- In `login.tsx`, raise client-side `minLength` to 10 and surface HIBP rejection message from Supabase.

Verify: signup with `password123` → rejected (HIBP); short password → rejected client + server.

## 6. Medium — Sanitize stored error output (M2)

- New helper `sanitizeBambooError(status, text)` in `client.server.ts`:
  - Truncate to 500 chars.
  - Strip obvious tokens (`/[A-Za-z0-9_-]{20,}/` → `[redacted]`).
- All `throw new Error(...)` in client.server.ts use it.
- In `workflow.server.ts`, store sanitized message + status code in `error` column; `bamboo_response` only stores response shape (status, sanitized body) — never raw key/PII.
- Add nightly cleanup pg_cron job: delete `execution_history` rows older than 90 days.

Verify: induce a 401 from Bamboo with a fake key → `execution_history.error` shows truncated/redacted text; cleanup query removes >90d rows.

## 7. Medium — Clamp retry date (M3)

- In `retryExecution`, compute today's Madrid date and replace `row.run_date` with `min(today, row.run_date + 1 working day)`; reject if older than today by >1 day with explicit error.

Verify: create a synthetic history row dated 1 month ago → retry uses today; row dated tomorrow → rejected.

## 8. Medium — Server-side time range validation (M4)

- Tighten `SaveInput` zod schema with `.refine()`:
  - `clockin_start < clockin_end`
  - `clockout_start < clockout_end`
  - `clockin_end <= clockout_start`
  - Each range max 2h wide.

Verify: send swapped ranges → 400 with clear message.

## 9. Medium — execution_history defense-in-depth (M5)

- Migration: add restrictive policies on `execution_history`:
  - `INSERT TO authenticated WITH CHECK (false)`
  - `UPDATE TO authenticated USING (false)`
  - `DELETE TO authenticated USING (false)`
- Service role retains all access (bypasses RLS).

Verify: from browser console (logged in), `supabase.from('execution_history').insert(...)` returns RLS error; server cron still writes successfully.

## 10. Low — Cleanups

- L1: cron header check uses `timingSafeEqual` (covered in §1).
- L2: switch `findEmployeeByEmail` to `/employees/directory` once at setup, but on subsequent calls use stored `employee_id` directly (already done in workflow).
- L3: replace `Math.random()` in time picker with `crypto.randomInt`.
- L5: in `_authenticated.tsx`, logout button calls `supabase.auth.signOut()` then `navigate({ to: '/login' })`; root already invalidates queries.
- L6: add basic security headers in `__root.tsx` head() or via a request middleware — CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.
- L7: include `triggered_by` already; also store `triggered_by_user_id` for retry/manual to differentiate cron vs human; add user_id to log lines.

Verify: build passes; logout returns to /login; response headers contain CSP & nosniff (curl check).

## Technical notes

- New secrets requested via `secrets--add_secret`: `CRON_SECRET`, `BAMBOO_ENC_KEY`.
- One DB migration: cron job update + restrictive `execution_history` policies + history cleanup cron + (optional) `confirmed_at` column on `bamboo_settings`.
- Auth config: `email_confirm`, `password_min_length=10`, `password_hibp_enabled`.
- Files touched: `cron/daily.ts`, `encryption.server.ts`, `client.server.ts`, `workflow.server.ts`, `settings.functions.ts`, `run.functions.ts`, `login.tsx`, `_authenticated.tsx`, `__root.tsx`, new `admin.functions.ts` for one-time re-encryption.

## Verification pass (end of implementation)

1. `bun run` build succeeds (auto-run by harness).
2. `invoke-server-function`:
   - `POST /api/public/cron/daily` w/o header → 401.
   - `POST /api/public/cron/daily` with header → 200, JSON results.
3. Manual UI smoke (browser tools):
   - Sign up (unverified) → settings save blocked.
   - Verify, save settings with bad time range → 400; with good range + correct API key → success.
   - Run Now → success; history shows entry with sanitized error on induced failure.
4. `supabase--linter` clean.
5. Confirm `cron.job` row uses new URL/header; `cron.job_run_details` shows recent success.

## Out of scope

- Per-user calendar overrides, admin cross-user view, email notifications.
