-- ============================================================
-- 013: Track when a "not_done" task has been discharged by a
-- parent applying a punishment ("castigo").
--
-- The Penalizações card counts not_done tasks in the last 30 days.
-- When a parent applies a punishment they "consume" 3 failures —
-- those tasks get penalty_applied_at set and stop counting toward
-- the next punishment. History is preserved.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS penalty_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS penalty_applied_by uuid REFERENCES auth.users(id);

-- Speeds up "find the 3 oldest undischarged failures for person X"
CREATE INDEX IF NOT EXISTS idx_tasks_pending_penalty
  ON tasks (person, date)
  WHERE completion_type = 'not_done' AND penalty_applied_at IS NULL;
