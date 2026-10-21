-- 027 — Children can ask the parents for more time
--
-- Until now only a parent could give more time, only once a task was already
-- late, and "more time" meant "not late for the rest of the day". Now a child
-- can ask — before or after the deadline — for a specific new time (+30 min,
-- +1 h, +2 h) or for the rest of the day, with an optional reason. The parents
-- grant or refuse it on Relatório → Aprovações.
--
-- A granted request becomes an ordinary task_extensions row, which now carries
-- the new deadline in `until_time` (null = the rest of the day, which is what
-- every extension written before this migration means). Done by then is on
-- time; after it, late; never done that day, a failure as always.

alter table public.task_extensions
  add column if not exists until_time text;   -- 'HH:MM'; null = until the end of the day

create table if not exists public.extension_requests (
  id                 uuid primary key default gen_random_uuid(),
  person             text not null,
  task_type          text not null check (task_type in ('scheduled', 'occasional')),
  scheduled_task_id  bigint,
  occasional_task_id bigint,
  task_name          text not null,
  task_date          date not null,
  end_time           text,                       -- the task's own deadline
  until_time         text,                       -- what was asked for; null = the rest of the day
  reward             numeric,                    -- an occasional task's own reward, to correct a late row
  reason             text check (char_length(reason) <= 120),
  status             text not null default 'pending'
                     check (status in ('pending', 'granted', 'refused')),
  created_at         timestamptz not null default now(),
  decided_at         timestamptz,
  decided_by         uuid
);

-- One request per occurrence and day, the same slot rule as task_extensions.
create unique index if not exists extension_requests_slot_unique
  on public.extension_requests (person, task_name, task_date, coalesce(end_time, ''));

create index if not exists idx_extension_requests_task_date
  on public.extension_requests (task_date);

alter table public.extension_requests enable row level security;

create policy "Authenticated users can read extension_requests"
  on public.extension_requests for select
  to authenticated
  using (true);

-- A child can only open a request, never write a decision into it.
create policy "Authenticated users can ask for more time"
  on public.extension_requests for insert
  to authenticated
  with check (status = 'pending' and decided_at is null and decided_by is null);

create policy "Parents decide extension_requests"
  on public.extension_requests for update
  to authenticated
  using (exists (select 1 from public.profiles
                 where profiles.id = auth.uid() and profiles.role in ('admin', 'parent')))
  with check (exists (select 1 from public.profiles
                      where profiles.id = auth.uid() and profiles.role in ('admin', 'parent')));

-- check-task-reminders must also wake up for a new deadline. Appended to the
-- gate of migration 023 by rewriting the job's command in place (the
-- service-role key in it never leaves the database):
--
-- select cron.alter_job(jobid,
--   command => regexp_replace(command, ';\s*$', '') || E'\n  or exists (\n'
--     || E'    select 1 from public.task_extensions e\n'
--     || E'    where e.task_date = (now() at time zone ''Europe/Lisbon'')::date\n'
--     || E'      and e.until_time is not null\n'
--     || E'      and (e.until_time::time - (now() at time zone ''Europe/Lisbon'')::time)\n'
--     || E'          between interval ''-14 minutes'' and interval ''30 minutes'');')
-- from cron.job where jobname = 'check-task-reminders';
