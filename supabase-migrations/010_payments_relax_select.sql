-- ============================================================
-- 010: Relax payments SELECT policy
-- Children need to read payment rows to show their own
-- "unpaid balance" on the Home page. INSERT remains parent-only.
-- ============================================================

DROP POLICY IF EXISTS "Parents can read all payments" ON payments;

CREATE POLICY "Authenticated can read payments"
  ON payments FOR SELECT
  TO authenticated
  USING (true);
