-- 021 — Occurrence identity for cancellations (tombstones)
--
-- Migration 019 gave every `tasks` row the identity of the occurrence it
-- settles. `task_cancellations` was left matching on name + deadline, and it is
-- the other half of the same decision: a tombstone is what stops a failure from
-- being recreated, and what tells the app an occurrence was waived.
--
-- Without identity here, one tombstone waives every same-named occurrence at
-- that hour. A child who misses both their own "Arrumar quarto" 19:00 and the
-- one they accepted from a sibling collects two failures — and a parent
-- deleting just one of them wiped out both.
--
-- Rows written before this migration carry no identity and keep their old,
-- broader meaning, which is the safe direction: they waive too much, never too
-- little.

alter table public.task_cancellations
  add column if not exists scheduled_task_id  bigint,
  add column if not exists occasional_task_id bigint,
  add column if not exists delegation_id      uuid;

create index if not exists idx_cancellations_scheduled_source
  on public.task_cancellations (task_date, scheduled_task_id) where scheduled_task_id is not null;
create index if not exists idx_cancellations_delegation_source
  on public.task_cancellations (delegation_id) where delegation_id is not null;
