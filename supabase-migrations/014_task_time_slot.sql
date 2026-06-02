-- Distinguish same-named tasks scheduled at different times on the same day.
-- Previously a task occurrence was identified only by (person, task_name, date),
-- so two "Máquina da louça" runs (e.g. noon and 19:00) collided: completing,
-- cancelling, extending or reminding one affected the other.
--
-- The deadline (end_time) is the "slot" that tells occurrences apart. We add it
-- to every state table and make the uniqueness constraints slot-aware.
-- Existing rows keep end_time = NULL and behave as before (name-only matching).

-- 1. tasks (completions). No unique constraint here — just record the slot.
ALTER TABLE tasks              ADD COLUMN IF NOT EXISTS end_time text;

-- 2. task_reminders — one reminder per (person, task, day, slot)
ALTER TABLE task_reminders     ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE task_reminders     DROP CONSTRAINT IF EXISTS task_reminders_unique;
CREATE UNIQUE INDEX IF NOT EXISTS task_reminders_slot_unique
  ON task_reminders (person, task_name, task_date, COALESCE(end_time, ''));

-- 3. task_extensions — one extension per (person, task, day, slot)
ALTER TABLE task_extensions    ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE task_extensions    DROP CONSTRAINT IF EXISTS task_extensions_person_task_name_task_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS task_extensions_slot_unique
  ON task_extensions (person, task_name, task_date, COALESCE(end_time, ''));

-- 4. task_cancellations — one cancellation per (person, task, day, slot)
ALTER TABLE task_cancellations ADD COLUMN IF NOT EXISTS end_time text;
ALTER TABLE task_cancellations DROP CONSTRAINT IF EXISTS task_cancellations_person_task_name_task_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS task_cancellations_slot_unique
  ON task_cancellations (person, task_name, task_date, COALESCE(end_time, ''));

-- Safety net: drop any remaining old (person, task_name, task_date) UNIQUE
-- constraints whose auto-generated names differ from the ones assumed above.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conrelid::regclass::text AS tbl, con.conname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    WHERE con.contype = 'u'
      AND cls.relname IN ('task_extensions', 'task_cancellations')
      AND (
        SELECT array_agg(att.attname::text ORDER BY att.attname::text)
        FROM unnest(con.conkey) AS k(attnum)
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
      ) = ARRAY['person', 'task_date', 'task_name']
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
