-- 026 — Siblings can refuse a delegation
--
-- A request for help can now be accepted *or refused* by each sibling. Once
-- every sibling has refused, the request closes as 'unanswered' straight away
-- and the parents are asked to decide (cancel the task, or it was the child's
-- to do). A sibling who ignores it counts as a "no" when the hour is up — that
-- path stays with the close-unanswered-delegations edge function (migration 025).

alter table public.task_delegations
  add column if not exists refused_by text[] not null default '{}';

-- Refusing in a single statement: two siblings saying no at the same moment
-- must not overwrite each other's answer (a read-modify-write from the app
-- would), and the request must close exactly when the last sibling refuses.
-- Returns the updated row, or null if the request was no longer pending.
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

  if remaining = 0 then
    update public.task_delegations
       set status = 'unanswered', closed_at = now()
     where id = p_id and status = 'pending'
    returning * into d;
  end if;

  return d;
end;
$$;

grant execute on function public.refuse_delegation(uuid, text) to authenticated;
