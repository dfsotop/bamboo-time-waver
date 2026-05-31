DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bamboo-auto-clockin-daily') THEN
    PERFORM cron.unschedule('bamboo-auto-clockin-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'bamboo-auto-clockin-daily',
  '0 6-11 * * 1-5',
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