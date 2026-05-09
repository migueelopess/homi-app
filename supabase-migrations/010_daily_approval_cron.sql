-- ============================================================
-- 010: Daily approval summary push at 22:00 Europe/Lisbon
-- Fires both 21:00 and 22:00 UTC (winter and summer DST window).
-- The edge function itself gates on the actual local hour and
-- exits early if the Lisbon hour is not 22.
-- ============================================================

-- Replace <YOUR_SUPABASE_URL> and <YOUR_SERVICE_ROLE_KEY>
-- (Supabase Dashboard → Settings → API).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'daily-approval-summary',
  '0 21,22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<YOUR_SUPABASE_URL>.supabase.co/functions/v1/daily-approval-summary',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
