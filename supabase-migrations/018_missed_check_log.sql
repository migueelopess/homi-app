-- ============================================================
-- 018: Per-child checkpoint for the missed-task detector.
--
-- The detector used a fixed 7-day lookback, which meant a child
-- who did not open the app for two weeks had the first week
-- silently drop out of range and never be checked at all —
-- not opening the app was the cheapest way to dodge penalties.
--
-- Instead we remember, per child, the last day already checked
-- and scan forward from there, so a gap of any length is caught
-- up exactly once. Advanced only after a successful run, so a
-- failed or interrupted run is retried rather than skipped.
-- ============================================================

create table if not exists missed_check_log (
  person          text primary key,
  checked_through date not null,
  updated_at      timestamptz not null default now()
);

alter table missed_check_log enable row level security;

create policy "Authenticated users can read missed_check_log"
  on missed_check_log for select to authenticated using (true);

create policy "Authenticated users can insert missed_check_log"
  on missed_check_log for insert to authenticated with check (true);

create policy "Authenticated users can update missed_check_log"
  on missed_check_log for update to authenticated using (true) with check (true);

-- Seed at today-8 so the first run after deploy scans exactly the same
-- 7 days the old code would have. The fix stops future escapes; it does
-- not retroactively punish days the old system had already let go.
insert into missed_check_log (person, checked_through)
select distinct person, current_date - 8 from scheduled_tasks
on conflict (person) do nothing;
