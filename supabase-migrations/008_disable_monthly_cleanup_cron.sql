-- ============================================================
-- 008: Disable automatic monthly cleanup
-- The cron job scheduled in 005_monthly_cleanup_cron.sql is removed.
-- The monthly-cleanup Edge Function remains deployed so the manual
-- "limpar tudo" button in Parents.jsx continues to work.
-- ============================================================

SELECT cron.unschedule('monthly-cleanup');
