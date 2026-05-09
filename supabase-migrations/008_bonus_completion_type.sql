-- Allow 'bonus' as a valid completion_type for the persisted weekly bonus rows
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_completion_type_check;

ALTER TABLE tasks ADD CONSTRAINT tasks_completion_type_check
  CHECK (completion_type IN (
    'on_time_no_reminder',
    'on_time_with_reminder',
    'late',
    'not_done',
    'bonus'
  ));
