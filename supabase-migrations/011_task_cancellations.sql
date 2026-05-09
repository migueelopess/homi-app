-- Task Cancellations: allows parents to cancel/remove a task for a child on a specific day.
-- A cancelled task is hidden from the child's schedule and is NOT marked as missed (no failure recorded).

create table if not exists task_cancellations (
  id           uuid primary key default gen_random_uuid(),
  person       text not null,
  task_name    text not null,
  task_date    date not null,
  cancelled_by uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  unique (person, task_name, task_date)
);

alter table task_cancellations enable row level security;

create policy "Authenticated users can read task_cancellations"
  on task_cancellations for select
  to authenticated
  using (true);

create policy "Authenticated users can insert task_cancellations"
  on task_cancellations for insert
  to authenticated
  with check (true);

create policy "Authenticated users can delete task_cancellations"
  on task_cancellations for delete
  to authenticated
  using (true);
