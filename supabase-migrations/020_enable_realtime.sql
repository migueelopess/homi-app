-- 020 — Turn Realtime on
--
-- useRealtimeSync has been subscribing to postgres_changes on eight tables
-- since it was written, and receiving nothing: the `supabase_realtime`
-- publication was empty, so Postgres never emitted a single change to it.
--
-- That is why the app so often showed stale data until it was force-closed and
-- reopened — a parent approving a task, cancelling an occurrence or sending a
-- reminder never reached the child's screen. Pull-to-refresh was treating the
-- symptom.
--
-- Replica identity stays DEFAULT: the client only needs to know *that*
-- something changed in order to invalidate its cache, never the old row.

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.scheduled_tasks;
alter publication supabase_realtime add table public.occasional_tasks;
alter publication supabase_realtime add table public.task_delegations;
alter publication supabase_realtime add table public.task_extensions;
alter publication supabase_realtime add table public.task_cancellations;
alter publication supabase_realtime add table public.task_reminders;
alter publication supabase_realtime add table public.payments;
