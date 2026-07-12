-- ============================================================
-- 015: Task revision — "send back to correct"
-- Parents can bounce a submitted task back to the child to fix a detail.
-- The task goes to approval_status = 'needs_revision' with a note, and its
-- value is halved once (revised = true). The child re-submits (new photo),
-- which returns it to 'pending' for final approval.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS revision_note text,
  ADD COLUMN IF NOT EXISTS revised boolean NOT NULL DEFAULT false;

-- Allow the new status value.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_approval_status_check;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_revision'));

-- Quick lookup of a child's tasks that need correcting.
CREATE INDEX IF NOT EXISTS idx_tasks_needs_revision
  ON tasks (person)
  WHERE approval_status = 'needs_revision';
