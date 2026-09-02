-- 019 — Occurrence identity for task records
--
-- A row in `tasks` used to be tied to the thing it settled only by
-- (person, task_name, date, end_time). That is not unique:
--
--   * A chore registered from the Registar page carries no deadline at all, and
--     the matching rule treated a missing end_time as "matches every slot" — so
--     registering an unscheduled "Máquina da louça" ticked off the scheduled
--     19:00 one and hid it from the missed-task check.
--   * "Arrumar quarto" 19:00 and "Meias (10x)" 20:00 exist for all three
--     children, "Passear Sidney" 20:00 for two — so once one delegates their
--     copy to a sibling who already has their own, the two occurrences are
--     indistinguishable and a single photo settled both.
--
-- Each record now names the occurrence it settles. Exactly one column is set,
-- or none for an ad-hoc chore, which settles nothing.

alter table public.tasks
  add column if not exists scheduled_task_id  bigint,
  add column if not exists occasional_task_id bigint,
  add column if not exists delegation_id      uuid;

-- No foreign keys on purpose: parents can delete a scheduled task, and the
-- history of what was done must survive that.
create index if not exists idx_tasks_scheduled_source
  on public.tasks (date, scheduled_task_id) where scheduled_task_id is not null;
create index if not exists idx_tasks_delegation_source
  on public.tasks (delegation_id) where delegation_id is not null;

-- "One auto-generated failure per occurrence" has to follow the same identity,
-- otherwise a child who misses both their own "Arrumar quarto" and the one they
-- accepted from a sibling only ever gets charged for one of them.
drop index if exists public.tasks_auto_miss_unique;

create unique index tasks_auto_miss_unique on public.tasks (
  person,
  date,
  coalesce(
    'd:' || delegation_id::text,
    'o:' || occasional_task_id::text,
    's:' || scheduled_task_id::text,
    'n:' || task_name || '@' || coalesce(end_time, '')
  )
) where completion_type = 'not_done' and approval_status = 'approved';
