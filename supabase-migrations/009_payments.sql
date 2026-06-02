-- ============================================================
-- 009: Payments table
-- Records each "marcar como pago" action by parents.
-- For each person, the latest paid_through_date defines the
-- cutoff: any task with date > paid_through_date is unpaid.
-- ============================================================

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person text NOT NULL,
  paid_through_date date NOT NULL,
  paid_at timestamptz DEFAULT now(),
  paid_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_payments_person_through
  ON payments (person, paid_through_date DESC);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- Parents (admin/parent role) can insert
CREATE POLICY "Parents can insert payments"
  ON payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'parent')
    )
  );

-- Parents can read all payments
CREATE POLICY "Parents can read all payments"
  ON payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'parent')
    )
  );
