-- ============================================================
-- 016: Weighted failures.
--
-- A not_done row normally costs the child 1 failure toward the
-- 3-failures-per-30-days punishment threshold. Breaking a task you
-- accepted as a delegation costs 2 — you let a sibling down after
-- promising to cover for them.
--
-- Stored on the row (rather than derived from task_delegations at
-- read time) so history stays exact even if the delegation is later
-- deleted, and so applyPenalty can consume weights server-side.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS failure_weight smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN tasks.failure_weight IS
  'Failures this not_done row consumes: 1 normally, 2 when the child accepted the task as a delegation and did not do it.';
