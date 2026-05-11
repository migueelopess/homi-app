-- ============================================================
-- 012: Ensure RLS on `tasks` does not block approvals.
--
-- Symptom this fixes: PATCH /tasks?id=eq.<id>&select=* returns 406
-- (with .single()) or an empty array (bulk), so approve/reject
-- silently does nothing. SELECT and INSERT work, only UPDATE was
-- filtered to 0 rows — classic missing UPDATE policy.
--
-- This migration is safe to run whether RLS is currently enabled
-- or not: it (re)defines explicit policies for authenticated users
-- and then enables RLS. If RLS was already off, behaviour is
-- functionally the same (everyone authenticated can read/write
-- tasks, which matches the app's current trust model).
-- ============================================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can insert tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can update tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can delete tasks" ON tasks;

CREATE POLICY "Authenticated users can read tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (true);
