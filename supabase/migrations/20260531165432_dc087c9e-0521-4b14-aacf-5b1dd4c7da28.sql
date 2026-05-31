
-- 1. Store a random shared secret for the cron endpoint in Supabase Vault.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'base64'),
      'cron_secret',
      'Shared secret used to authenticate pg_cron calls to /api/public/cron/daily'
    );
  END IF;
END $$;

-- 2. Security-definer helper so the server (via supabaseAdmin) can verify a
--    provided secret without exposing the vault table to PostgREST.
CREATE OR REPLACE FUNCTION public.verify_cron_secret(provided text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  expected text;
BEGIN
  SELECT decrypted_secret INTO expected
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1;
  IF expected IS NULL THEN
    RETURN false;
  END IF;
  -- length check first to keep this constant-ish time
  IF length(provided) <> length(expected) THEN
    RETURN false;
  END IF;
  RETURN provided = expected;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;

-- 3. Replace the existing pg_cron job with one that sends the vault secret in
--    the x-cron-secret header instead of the public anon key.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bamboo-auto-clockin-daily') THEN
    PERFORM cron.unschedule('bamboo-auto-clockin-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'bamboo-auto-clockin-daily',
  '0 8-11 * * 1-5',
  $job$
  SELECT net.http_post(
    url := 'https://project--f313f4b4-282c-4e64-8a18-4d527f3da743.lovable.app/api/public/cron/daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $job$
);

-- 4. Nightly cleanup: drop execution_history rows older than 90 days.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'execution-history-cleanup') THEN
    PERFORM cron.unschedule('execution-history-cleanup');
  END IF;
END $$;

SELECT cron.schedule(
  'execution-history-cleanup',
  '15 3 * * *',
  $job$
  DELETE FROM public.execution_history WHERE created_at < now() - interval '90 days';
  $job$
);
