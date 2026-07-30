-- ============================================================
-- 017: One failure per task slot, enforced by the database.
--
-- A child can only fail a given scheduled occurrence once. The
-- app used to be the only thing guaranteeing that, and when
-- useMarkMissedTasks read a stale cache it created duplicate
-- not_done rows for the same slot — each one costing a real
-- failure toward a punishment.
--
-- Scoped to approval_status = 'approved', which is what the
-- auto-marker writes. Rejected submissions are also stored as
-- not_done but carry approval_status = 'rejected', so they stay
-- outside this index and parents can still reject a photo for a
-- slot that already has a recorded miss.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS tasks_auto_miss_unique
  ON tasks (person, task_name, date, COALESCE(end_time, ''))
  WHERE completion_type = 'not_done' AND approval_status = 'approved';
