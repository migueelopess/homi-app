-- 025 — One hour to accept a delegation, then the parents decide
--
-- A child who cannot do a task delegates it; siblings now have one hour to
-- accept. If nobody does, the request becomes 'unanswered' and the parents are
-- notified (edge function close-unanswered-delegations). They then either
-- cancel the task ('parent_cancelled' — a tombstone is written, no failure) or
-- decide the child could have done it ('parent_rejected' — the task is theirs
-- again and an ordinary failure if left undone).
--
-- Before this, an unanswered request sat 'pending' all day and the child who
-- asked for help took the failure regardless.

alter table public.task_delegations drop constraint task_delegations_status_check;
alter table public.task_delegations add constraint task_delegations_status_check
  check (status = any (array['pending','accepted','expired',
                             'unanswered','parent_cancelled','parent_rejected']));

alter table public.task_delegations
  add column if not exists closed_at  timestamptz,   -- when the acceptance window closed unanswered
  add column if not exists decided_at timestamptz,   -- when a parent decided
  add column if not exists decided_by uuid;          -- which parent

-- The cron gate looks for pending requests past their hour.
create index if not exists idx_task_delegations_pending_created
  on public.task_delegations (created_at) where status = 'pending';

-- pg_cron job `close-unanswered-delegations`, every 10 minutes, calling the
-- edge function only when a pending request is already past its hour. Built
-- from an existing job's command so the service-role key is never handled:
--
-- select cron.schedule('close-unanswered-delegations', '*/10 * * * *',
--   regexp_replace(replace(command, 'mark-missed-tasks', 'close-unanswered-delegations'), ';\s*$', '')
--   || E'\n  WHERE exists (select 1 from public.task_delegations'
--   || ' where status = ''pending'' and created_at < now() - interval ''1 hour'');')
-- from cron.job where jobname = 'mark-missed-tasks';
