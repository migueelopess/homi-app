-- 028 — A request for help stays open all day; the 3 hours only warn the parents
--
-- Until now the three hours did two things at once: they told the parents, and
-- they closed the request to the siblings ('unanswered'). A sibling who decided
-- to help later found nothing left to accept. Now:
--
--   * a request stays 'pending' — acceptable by any sibling, including one who
--     refused and changed their mind — until someone accepts, the parents
--     decide, or the day ends;
--   * after 3 hours with no "yes" (or once every sibling has refused, or from
--     22:00 for a late request) the parents are told: `parents_notified_at`;
--   * the parents can still cancel it or say it was the child's to do;
--   * a request still open when its day ends is closed by mark-missed-tasks as
--     'auto_cancelled', with a tombstone: no failure for the child who asked.
--
-- 'unanswered' stays in the check constraint for older rows.

alter table public.task_delegations
  add column if not exists parents_notified_at timestamptz;

alter table public.task_delegations drop constraint task_delegations_status_check;
alter table public.task_delegations add constraint task_delegations_status_check
  check (status = any (array['pending','accepted','expired','unanswered',
                             'parent_cancelled','parent_rejected','auto_cancelled']));

-- Today's requests that the old rule had already closed reopen, with the
-- parents marked as told (they were).
update public.task_delegations
   set status = 'pending',
       parents_notified_at = coalesce(closed_at, now())
 where status = 'unanswered'
   and task_date >= (now() at time zone 'Europe/Lisbon')::date;

-- Refusing no longer closes the request: when the last sibling says no, the
-- parents are told (parents_notified_at) and the request stays open, so any of
-- them can still change their mind. Returns the updated row, or null if the
-- request was no longer pending.
create or replace function public.refuse_delegation(p_id uuid, p_person text)
returns public.task_delegations
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.task_delegations;
  remaining int;
begin
  update public.task_delegations
     set refused_by = case when p_person = any(refused_by) then refused_by
                           else array_append(refused_by, p_person) end
   where id = p_id
     and status = 'pending'
     and from_person <> p_person
  returning * into d;

  if d.id is null then
    return null;
  end if;

  -- Siblings who could still say yes. Kept in step with PEOPLE in
  -- src/lib/taskHelpers.js (and the tasks_person_check constraint).
  select count(*) into remaining
    from unnest(array['Inês', 'Pedro', 'Miguel']) as p(name)
   where p.name <> d.from_person
     and not (p.name = any(d.refused_by));

  if remaining = 0 and d.parents_notified_at is null then
    update public.task_delegations
       set parents_notified_at = now()
     where id = p_id and status = 'pending' and parents_notified_at is null
    returning * into d;
  end if;

  return d;
end;
$$;

-- The close-unanswered-delegations job now only tells the parents. Its gate,
-- rewritten in place (the service-role key never leaves the database):
--
-- select cron.alter_job(jobid, command =>
--   regexp_replace(command, 'WHERE exists \(.*$', '')
--   || 'WHERE exists (select 1 from public.task_delegations'
--   || ' where status = ''pending'' and parents_notified_at is null'
--   || ' and task_date = (now() at time zone ''Europe/Lisbon'')::date'
--   || ' and (created_at < now() - interval ''3 hours'''
--   || '      or (now() at time zone ''Europe/Lisbon'')::time >= time ''22:00''));')
-- from cron.job where jobname = 'close-unanswered-delegations';
