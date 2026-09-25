-- 022 — Turn postgres_changes Realtime back off
--
-- Migration 020 published eight tables to Realtime so the app could update
-- live. On the free plan's Nano instance (426 MB of RAM shared by Postgres,
-- PostgREST, auth and storage) that proved too expensive: Realtime's WAL
-- polling was ~43% of all database time, around the clock, on a machine that
-- was already living in swap. The 19:00 deadline rush then produced 20-30 s
-- stalls and "database timeout"s on task submission.
--
-- The app now polls instead (src/lib/query-client.js). Re-publish these only
-- together with a compute upgrade.

alter publication supabase_realtime drop table public.tasks;
alter publication supabase_realtime drop table public.scheduled_tasks;
alter publication supabase_realtime drop table public.occasional_tasks;
alter publication supabase_realtime drop table public.task_delegations;
alter publication supabase_realtime drop table public.task_extensions;
alter publication supabase_realtime drop table public.task_cancellations;
alter publication supabase_realtime drop table public.task_reminders;
alter publication supabase_realtime drop table public.payments;

-- Safety net, scheduled as pg_cron job `drop-idle-realtime-slot` (hourly):
-- once no client subscribes any more, Realtime's wal2json slot could sit
-- inactive and retain WAL indefinitely, filling the disk. Drop it only when it
-- is both inactive and holding more than 64 MB. Realtime recreates the slot on
-- demand if postgres_changes is ever used again. Realtime's own broadcast slot
-- (supabase_realtime_messages_*) is deliberately left alone.
--
-- select cron.schedule('drop-idle-realtime-slot', '40 * * * *',
--   $$select pg_drop_replication_slot(slot_name) from pg_replication_slots
--     where slot_name like 'supabase_realtime_replication_slot%'
--       and not active
--       and pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) > 64 * 1024 * 1024$$);
