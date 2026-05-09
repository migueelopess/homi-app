-- ============================================================
-- 009: Photo approval system
-- Adds approval_status to tasks and backfills existing rows as 'approved'
-- so historical earnings are unaffected. New tasks default to 'pending'.
-- ============================================================

-- Add columns
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);

-- Constrain to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_approval_status_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_approval_status_check
      CHECK (approval_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

-- Backfill: every existing task is treated as already approved.
-- This MUST run before any new task is created, otherwise older tasks
-- would lose their earnings credit.
UPDATE tasks
SET approval_status = 'approved',
    approved_at = COALESCE(approved_at, created_date)
WHERE approval_status = 'pending';

-- Indexes for the approvals query and the cron summary
CREATE INDEX IF NOT EXISTS idx_tasks_approval_status ON tasks (approval_status);
CREATE INDEX IF NOT EXISTS idx_tasks_pending_person_date
  ON tasks (person, date)
  WHERE approval_status = 'pending';
