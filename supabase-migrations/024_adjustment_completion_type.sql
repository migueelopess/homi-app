-- 024 — Money adjustments: fines and carried-over balances
--
-- At three failures the parents can now take EUR 10 off a child's Homi balance
-- instead of applying the punishment, and the balance may go negative. A fine
-- is stored as a `tasks` row with completion_type 'adjustment' and a negative
-- value, so it flows through every earnings/payment total unchanged.
--
-- The monthly cleanup writes the same kind of row ("Saldo transitado") to keep
-- an unpaid balance — a debt included — from being deleted with the rows that
-- made it up.
--
-- Adjustments are not chores: the app excludes them from the weekly bonus and
-- from task counts (isChore in src/lib/taskHelpers.js).

alter table public.tasks drop constraint tasks_completion_type_check;
alter table public.tasks add constraint tasks_completion_type_check
  check (completion_type = any (array['on_time_no_reminder','on_time_with_reminder',
                                      'late','not_done','bonus','adjustment']));
